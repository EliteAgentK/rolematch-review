// Cleans a photo or scan before OCR. Tesseract reads sharp, straight, evenly lit black-on-white text well and almost anything else badly,
// and a phone photo is rarely any of those. Everything here is plain pixel arithmetic on @napi-rs/canvas (already a dependency), so no
// document leaves the server and nothing new is installed.
//   1. honour the camera's rotation flag (EXIF), so a portrait photo is not read sideways
//   2. scale to a size OCR likes (about 300 dpi for A4)
//   3. flatten shadows and uneven light by dividing by the page's own estimated brightness
//   4. find the small tilt of the text lines and straighten the page
//   5. crop away the desk around the page
import { createCanvas, loadImage, type Image } from "@napi-rs/canvas";

export interface Prepared { png: Buffer; angle: number; width: number; height: number; /** Where the cropped image sits on the whole page: a word's place on the page is its position plus x and y, over width and height. */ frame: { x: number; y: number; width: number; height: number }; notes: string[] }

const TARGET_LONG_EDGE = 3000;   // A4 at about 300 dpi is 3508 px; 3000 is plenty for 10pt text and keeps OCR quick
const MAX_LONG_EDGE = 4200;
const SEARCH_DEGREES = 10;        // tilts beyond this are not a tilted page, they are a sideways one

/** The camera's orientation flag (1 = upright). Only JPEG carries one. */
export function exifOrientation(b: Uint8Array): number {
  if (b[0] !== 0xff || b[1] !== 0xd8) return 1;
  let i = 2;
  while (i + 4 < b.length && b[i] === 0xff) {
    const marker = b[i + 1], len = (b[i + 2] << 8) | b[i + 3];
    if(len<2||i+2+len>b.length)return 1;
    if (marker === 0xe1 && len>=16 && b[i + 4] === 0x45 && b[i + 5] === 0x78 && b[i+6]===0x69 && b[i+7]===0x66 && b[i+8]===0 && b[i+9]===0) {
      const t = i + 10, little = b[t] === 0x49, u16 = (o: number) => (little ? b[t + o] | (b[t + o + 1] << 8) : (b[t + o] << 8) | b[t + o + 1]);
      const u32 = (o: number) => (little ? (b[t + o] | (b[t + o + 1] << 8) | (b[t + o + 2] << 16) | (b[t + o + 3] << 24)) >>> 0 : ((b[t + o] << 24) | (b[t + o + 1] << 16) | (b[t + o + 2] << 8) | b[t + o + 3]) >>> 0);
      if(!((b[t]===0x49&&b[t+1]===0x49)||(b[t]===0x4d&&b[t+1]===0x4d))||u16(2)!==42)return 1;
      const ifd = u32(4), end=i+2+len;
      if(t+ifd+2>end)return 1;const n=u16(ifd);
      if(n>4096||t+ifd+2+n*12>end)return 1;
      for (let k = 0; k < n; k++) if (u16(ifd + 2 + k * 12) === 0x0112) {const o=ifd+2+k*12;if(u16(o+2)!==3||u32(o+4)!==1)return 1;const orientation=u16(o+8);return orientation>=1&&orientation<=8?orientation:1;}
      return 1;
    }
    i += 2 + len;
  }
  return 1;
}

/** Draws the image upright (applying EXIF) at the working size. */
function upright(img: Image, orientation: number) {
  const swap = orientation >= 5, sw = swap ? img.height : img.width, sh = swap ? img.width : img.height;
  const long = Math.max(sw, sh);
  const scale = Math.min(MAX_LONG_EDGE, Math.max(long > TARGET_LONG_EDGE ? TARGET_LONG_EDGE : Math.min(TARGET_LONG_EDGE, long * 2), 1)) / long;
  const w = Math.round(sw * scale), h = Math.round(sh * scale), c = createCanvas(w, h), ctx = c.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);
  const m: Record<number, [number, number, number, number, number, number]> = { 1: [1, 0, 0, 1, 0, 0], 2: [-1, 0, 0, 1, w, 0], 3: [-1, 0, 0, -1, w, h], 4: [1, 0, 0, -1, 0, h], 5: [0, 1, 1, 0, 0, 0], 6: [0, 1, -1, 0, w, 0], 7: [0, -1, -1, 0, w, h], 8: [0, -1, 1, 0, 0, h] };
  ctx.setTransform(...(m[orientation] ?? m[1]));
  ctx.drawImage(img, 0, 0, swap ? h : w, swap ? w : h);
  return c;
}

/** Brightness 0..255 per pixel. */
function gray(c: ReturnType<typeof createCanvas>): Float32Array {
  const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data, g = new Float32Array(c.width * c.height);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) g[p] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  return g;
}

/**
 * Light text on a dark panel (a dark sidebar with white writing) is read by OCR as nothing at all. A block that is dark on average is turned the
 * right way round, so its writing becomes dark on light like the rest of the page. A shadow is much lighter than a dark panel and is left to flatten().
 */
/**
 * Turns dark panels using their real edges, and makes each panel's background the same as the paper. Working in whole grid blocks spills over a panel's edge, and a turned panel left mid-grey is a step in brightness; the
 * flattening after this smears both into dark halos across the letters at the panel's edges, which OCR then loses.
 */
function turnPanels(g: Float32Array, w: number, h: number, block: number, rects: { x0: number; x1: number; y0: number; y1: number }[], paper: number): Float32Array {
  const out = g.slice(), middle = (xs: number[]) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
  for (const r of rects) {
    const px0 = r.x0 * block, px1 = Math.min(w, (r.x1 + 1) * block), py0 = r.y0 * block, py1 = Math.min(h, (r.y1 + 1) * block), inner: number[] = [];
    for (let y = py0 + block; y < py1 - block; y += 4) for (let x = px0 + block; x < px1 - block; x += 4) inner.push(g[y * w + x]);
    const bg = middle(inner.length ? inner : [paper * 0.5]), edge = (bg + paper) / 2;
    // each side moves to where the row or column stops being mostly panel, searching one block either side of the grid
    const colDark = (x: number) => { const v: number[] = []; for (let y = py0 + block; y < py1 - block; y += 3) v.push(g[y * w + x]); return middle(v) < edge; }, rowDark = (y: number) => { const v: number[] = []; for (let x = px0 + block; x < px1 - block; x += 3) v.push(g[y * w + x]); return middle(v) < edge; };
    let left = px0 + block, right = px1 - block - 1, top = py0 + block, bottom = py1 - block - 1;
    while (left > Math.max(0, px0 - block) && colDark(left - 1)) left--;
    while (right < Math.min(w - 1, px1 + block) && colDark(right + 1)) right++;
    while (top > Math.max(0, py0 - block) && rowDark(top - 1)) top--;
    while (bottom < Math.min(h - 1, py1 + block) && rowDark(bottom + 1)) bottom++;
    const turnedBg = Math.max(1, 255 - bg), scale = paper / turnedBg;
    for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) out[y * w + x] = Math.min(255, (255 - g[y * w + x]) * scale);
  }
  return out;
}

export function invertDarkRegions(g: Float32Array, w: number, h: number, block = 48, exact = false): { out: Float32Array; inverted: number } {
  const rects: { x0: number; x1: number; y0: number; y1: number }[] = [];
  const bw = Math.ceil(w / block), bh = Math.ceil(h / block), stats: { mean: number; spreadUp: number; spreadDown: number }[] = [];
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
    const v: number[] = [];
    for (let y = by * block; y < Math.min(h, (by + 1) * block); y += 2) for (let x = bx * block; x < Math.min(w, (bx + 1) * block); x += 2) v.push(g[y * w + x]);
    v.sort((p, q) => p - q);
    const mean = v.reduce((p, q) => p + q, 0) / Math.max(1, v.length);
    stats.push({ mean, spreadUp: (v[Math.floor(v.length * 0.95)] ?? mean) - mean, spreadDown: mean - (v[Math.floor(v.length * 0.05)] ?? mean) });
  }
  const paper = [...stats.map((x) => x.mean)].sort((p, q) => p - q)[Math.floor(stats.length * 0.9)] ?? 255;
  // Candidate blocks are clearly darker than the paper. A panel is a LARGE connected region of them whose writing is lighter than its background
  // (a shadow over paper has writing darker than its background), and the whole rectangle of the panel is turned, including blocks inside it that
  // happen to be full of writing and so look less dark.
  const cand = stats.map((x) => x.mean < paper * 0.78);
  const seen = new Uint8Array(cand.length), dark = new Uint8Array(cand.length);
  for (let start = 0; start < cand.length; start++) {
    if (!cand[start] || seen[start]) continue;
    const comp: number[] = [], queue = [start]; seen[start] = 1;
    while (queue.length) {
      const i = queue.pop()!; comp.push(i);
      const x = i % bw, y = Math.floor(i / bw);
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) if (nx >= 0 && nx < bw && ny >= 0 && ny < bh && cand[ny * bw + nx] && !seen[ny * bw + nx]) { seen[ny * bw + nx] = 1; queue.push(ny * bw + nx); }
    }
    if (comp.length < 10) continue;
    const up = comp.reduce((t, i) => t + stats[i].spreadUp, 0), down = comp.reduce((t, i) => t + stats[i].spreadDown, 0);
    if (up < down * 0.8) continue;                                   // dark writing on a shaded page, not light writing on a dark panel
    const xs = comp.map((i) => i % bw), ys = comp.map((i) => Math.floor(i / bw)), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    if (comp.length / ((x1 - x0 + 1) * (y1 - y0 + 1)) < 0.55) continue; // a panel is a rectangle, not a ragged shadow
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) dark[y * bw + x] = 1;
    rects.push({ x0, x1, y0, y1 });
  }
  const count = dark.reduce((t, v) => t + v, 0);
  if (!count) return { out: g, inverted: 0 };
  if (exact) return { out: turnPanels(g, w, h, block, rects, paper), inverted: count };
  const out = new Float32Array(g.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = dark[Math.floor(y / block) * bw + Math.floor(x / block)] ? 255 - g[y * w + x] : g[y * w + x];
  return { out, inverted: count };
}

/**
 * Removes shadows and uneven light. The paper's brightness is estimated block by block (the bright end of each block, since ink is a
 * small share of every block), smoothed, and every pixel is divided by it, so paper becomes white wherever it sits in the light.
 */
function flatten(g: Float32Array, w: number, h: number, block = 48): Float32Array {
  const bw = Math.ceil(w / block), bh = Math.ceil(h / block), bg = new Float32Array(bw * bh), buf: number[] = [];
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
    buf.length = 0;
    for (let y = by * block; y < Math.min(h, (by + 1) * block); y += 2) for (let x = bx * block; x < Math.min(w, (bx + 1) * block); x += 2) buf.push(g[y * w + x]);
    buf.sort((a, b) => a - b);
    bg[by * bw + bx] = buf[Math.floor(buf.length * 0.9)] ?? 255; // bright end: the paper, not the ink
  }
  const smooth = new Float32Array(bg.length);                    // 3x3 average so block edges do not show
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    let s = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const yy = y + dy, xx = x + dx; if (yy >= 0 && yy < bh && xx >= 0 && xx < bw) { s += bg[yy * bw + xx]; n++; } }
    smooth[y * bw + x] = s / n;
  }
  const out = new Float32Array(g.length);
  for (let y = 0; y < h; y++) {
    const fy = Math.min(bh - 1, Math.max(0, y / block - 0.5)), y0 = Math.floor(fy), y1 = Math.min(bh - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(bw - 1, Math.max(0, x / block - 0.5)), x0 = Math.floor(fx), x1 = Math.min(bw - 1, x0 + 1), tx = fx - x0;
      const b = (smooth[y0 * bw + x0] * (1 - tx) + smooth[y0 * bw + x1] * tx) * (1 - ty) + (smooth[y1 * bw + x0] * (1 - tx) + smooth[y1 * bw + x1] * tx) * ty;
      out[y * w + x] = Math.max(0, Math.min(255, (g[y * w + x] / Math.max(b, 40)) * 255));
    }
  }
  return out;
}

/**
 * Pale writing on a pale page (light grey on off-white) is the weakest case for OCR: the letters are present but barely darker than the paper. After
 * flatten() the paper is white, so each block of the page can be judged on its own: where the ink in a block is no darker than about 40% grey, that block is
 * smoothed (the scanner's grain would otherwise be stretched into speckle) and its ink brought to about 90. Blocks with ordinary dark ink, and blocks
 * with no ink, are left exactly as they are, so a page that mixes a bold dark banner with pale body text is handled correctly.
 */
function stretchContrast(g: Float32Array, w: number, h: number, block = 64): { out: Float32Array; applied: boolean } {
  const bw = Math.ceil(w / block), bh = Math.ceil(h / block), kmap = new Float32Array(bw * bh).fill(1), buf: number[] = [];
  let any = false;
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
    buf.length = 0;
    for (let y = by * block; y < Math.min(h, (by + 1) * block); y += 2) for (let x = bx * block; x < Math.min(w, (bx + 1) * block); x += 2) buf.push(g[y * w + x]);
    buf.sort((p, q) => p - q);
    const ink = buf[Math.floor(buf.length * 0.03)] ?? 255, paper = buf[Math.floor(buf.length * 0.9)] ?? 255;
    // a block holds writing when its darker end is clearly apart from its paper. The strength comes in gradually between ink levels 130 and 175, never as a
    // sudden step, so neighbouring blocks (or two halves of one word) are never treated very differently and no patchwork appears.
    if (paper - ink < 25 || ink > 215) continue;
    const weight = Math.max(0, Math.min(1, (ink - 130) / 45));
    if (weight <= 0) continue;
    kmap[by * bw + bx] = 1 + (Math.min(4, 165 / (255 - ink)) - 1) * weight; any = true;
  }
  if (!any) return { out: g, applied: false };
  const sm = new Float32Array(g.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let t = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const yy = y + dy, xx = x + dx; if (yy >= 0 && yy < h && xx >= 0 && xx < w) { t += g[yy * w + xx]; n++; } }
    sm[y * w + x] = t / n;
  }
  // How grainy is the page? The average difference between a pixel and its 3 x 3 neighbourhood, over the pixels that will be strengthened. A grainy scan needs the
  // smoothing; a blurred phone photo has no grain and is only made worse by it, so the smoothing is applied in proportion to the grain.
  let grain = 0, counted = 0;
  for (let y = 0; y < h; y += 3) for (let x = 0; x < w; x += 3) { const b = kmap[Math.min(bh - 1, Math.floor(y / block)) * bw + Math.min(bw - 1, Math.floor(x / block))]; if (b > 1.02) { grain += Math.abs(g[y * w + x] - sm[y * w + x]); counted++; } }
  const smooth = counted ? Math.max(0, Math.min(1, (grain / counted - 2) / 4)) : 0;
  const out = new Float32Array(g.length);
  for (let y = 0; y < h; y++) {
    const fy = Math.min(bh - 1, Math.max(0, y / block - 0.5)), y0 = Math.floor(fy), y1 = Math.min(bh - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(bw - 1, Math.max(0, x / block - 0.5)), x0 = Math.floor(fx), x1 = Math.min(bw - 1, x0 + 1), tx = fx - x0;
      const k = (kmap[y0 * bw + x0] * (1 - tx) + kmap[y0 * bw + x1] * tx) * (1 - ty) + (kmap[y1 * bw + x0] * (1 - tx) + kmap[y1 * bw + x1] * tx) * ty;
      const v = g[y * w + x] * (1 - smooth) + sm[y * w + x] * smooth;
      out[y * w + x] = k > 1.02 ? Math.max(0, Math.min(255, 255 - (255 - v) * k)) : g[y * w + x];
    }
  }
  return { out, applied: true };
}

/** Tilt of the text lines in degrees (positive = clockwise), found where the rows of ink are most sharply separated. */
function estimateSkew(g: Float32Array, w: number, h: number): { angle: number; confident: boolean } {
  const step = Math.max(1, Math.floor(Math.max(w, h) / 1100)), pts: number[] = [];
  let sum = 0, n = 0;
  for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) { sum += g[y * w + x]; n++; }
  const mean = sum / n, cut = Math.min(150, mean * 0.7);
  for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) if (g[y * w + x] < cut) pts.push((x - w / 2) / step, (y - h / 2) / step);
  if (pts.length < 400) return { angle: 0, confident: false };
  const rows = Math.ceil(Math.hypot(w, h) / step) + 2, hist = new Float64Array(rows);
  const score = (deg: number) => {
    const t = (deg * Math.PI) / 180, s = Math.sin(t), c = Math.cos(t); hist.fill(0);
    for (let i = 0; i < pts.length; i += 2) hist[Math.round(pts[i + 1] * c - pts[i] * s + rows / 2)]++;
    let v = 0; for (let r = 0; r < rows; r++) v += hist[r] * hist[r];
    return v;
  };
  let best = 0, bestScore = score(0);
  const flat = bestScore;
  for (let d = -SEARCH_DEGREES; d <= SEARCH_DEGREES; d += 0.5) { const sc = score(d); if (sc > bestScore) { bestScore = sc; best = d; } }
  for (let d = best - 0.5; d <= best + 0.5; d += 0.1) { const sc = score(d); if (sc > bestScore) { bestScore = sc; best = d; } }
  return { angle: Math.round(best * 10) / 10, confident: bestScore > flat * 1.02 || best === 0 };
}

/** Rotates by -angle (undoing the tilt) on white, then crops to the printed area with a margin. */
function straightenAndCrop(g: Float32Array, w: number, h: number, angle: number) {
  const src = createCanvas(w, h), sctx = src.getContext("2d"), id = sctx.createImageData(w, h);
  for (let p = 0; p < g.length; p++) { const v = g[p]; id.data[p * 4] = id.data[p * 4 + 1] = id.data[p * 4 + 2] = v; id.data[p * 4 + 3] = 255; }
  sctx.putImageData(id, 0, 0);
  const t = (angle * Math.PI) / 180, W = Math.ceil(Math.abs(w * Math.cos(t)) + Math.abs(h * Math.sin(t))), H = Math.ceil(Math.abs(w * Math.sin(t)) + Math.abs(h * Math.cos(t)));
  const out = createCanvas(W, H), ctx = out.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H); ctx.translate(W / 2, H / 2); ctx.rotate(-t); ctx.drawImage(src, -w / 2, -h / 2);
  const d = ctx.getImageData(0, 0, W, H).data;
  let x0 = W, x1 = 0, y0 = H, y1 = 0;
  const rowInk = new Uint32Array(H), colInk = new Uint32Array(W);
  for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) if (d[(y * W + x) * 4] < 140) { rowInk[y]++; colInk[x]++; }
  const minInk = 2; for (let y = 0; y < H; y++) if (rowInk[y] >= minInk) { y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  for (let x = 0; x < W; x++) if (colInk[x] >= minInk) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); }
  if (x1 <= x0 || y1 <= y0) return { canvas: out, frame: { x: 0, y: 0, width: W, height: H } };
  const m = 60, cx = Math.max(0, x0 - m), cy = Math.max(0, y0 - m), cw = Math.min(W, x1 + m) - cx, ch = Math.min(H, y1 + m) - cy;
  const crop = createCanvas(cw, ch); crop.getContext("2d").drawImage(out, cx, cy, cw, ch, 0, 0, cw, ch);
  return { canvas: crop, frame: { x: cx, y: cy, width: W, height: H } };
}

export class ImageTooLarge extends Error {}
const MAX_INPUT_PIXELS = 60_000_000; // an image larger than this is refused before it is decoded into memory (same ceiling as TIFF)

/** The width and height an image's header declares, read without decoding it. PNG, GIF, BMP, WebP and JPEG; undefined when not recognised. */
function declaredSize(b: Uint8Array): { w: number; h: number } | undefined {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const ascii = (o: number, n: number) => String.fromCharCode(...b.subarray(o, o + n));
  if (b.length >= 24 && b[0] === 0x89 && ascii(1, 3) === "PNG") return { w: dv.getUint32(16), h: dv.getUint32(20) };
  if (b.length >= 10 && ascii(0, 3) === "GIF") return { w: dv.getUint16(6, true), h: dv.getUint16(8, true) };
  if (b.length >= 26 && ascii(0, 2) === "BM") return { w: Math.abs(dv.getInt32(18, true)), h: Math.abs(dv.getInt32(22, true)) };
  if (b.length >= 30 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") {
    const k = ascii(12, 4);
    if (k === "VP8X") return { w: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), h: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
    if (k === "VP8 ") return { w: dv.getUint16(26, true) & 0x3fff, h: dv.getUint16(28, true) & 0x3fff };
    if (k === "VP8L") { const v = dv.getUint32(21, true); return { w: 1 + (v & 0x3fff), h: 1 + ((v >> 14) & 0x3fff) }; }
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: dv.getUint16(i + 5), w: dv.getUint16(i + 7) };
      if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01 || m === 0xff) { i += m === 0xff ? 1 : 2; continue; }
      i += 2 + dv.getUint16(i + 2);
    }
  }
  return undefined;
}

export async function prepareForOcr(bytes: Uint8Array, opts: { exactPanels?: boolean } = {}): Promise<Prepared> {
  const notes: string[] = [];
  const orientation = exifOrientation(bytes);
  if (orientation !== 1) notes.push(`camera rotation flag ${orientation} applied`);
  const declared = declaredSize(bytes);
  if (declared && declared.w * declared.h > MAX_INPUT_PIXELS) throw new ImageTooLarge(`The image is ${declared.w} x ${declared.h} pixels, larger than the ${MAX_INPUT_PIXELS / 1e6} million pixel limit.`);
  const img = await loadImage(Buffer.from(bytes));
  const base = upright(img, orientation), w = base.width, h = base.height;
  const { out: righted, inverted } = invertDarkRegions(gray(base as any), w, h, 48, opts.exactPanels === true);
  if (inverted) notes.push(`${inverted} dark block(s) turned the right way round`);
  const flattened = flatten(righted, w, h);
  const { out: flat, applied: stretched } = stretchContrast(flattened, w, h);
  if (stretched) notes.push("faint writing strengthened");
  const { angle, confident } = estimateSkew(flat, w, h);
  if (angle) notes.push(`straightened by ${angle} degrees`);
  if (!confident) notes.push("tilt could not be measured reliably");
  const { canvas: out, frame } = straightenAndCrop(flat, w, h, angle);
  return { png: out.toBuffer("image/png"), angle, width: out.width, height: out.height, frame, notes };
}
