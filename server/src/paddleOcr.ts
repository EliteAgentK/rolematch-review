// The PaddleOCR trial engine's reader (PP-OCRv4 line detector and a recognition model, run through ONNX Runtime inside this server). The npm wrapper
// (@gutenye/ocr-node, MIT) supplies the image handling and the splitting of the detector's map into line crops; the detector and recognition STEPS are run
// here instead of through the wrapper's own, because the wrapper departs from PaddleOCR's published settings in places that matter for CVs, and a fair
// trial has to let the engine run as designed:
//   - detector input: the wrapper uses mean 0 and deviation 1; PaddleOCR uses the ImageNet mean and deviation (0.485, 0.456, 0.406 and 0.229, 0.224, 0.225)
//   - detector threshold: the wrapper keeps every pixel with a 3% chance of being text; PaddleOCR's own is 0.3
//   - recognition input: the wrapper uses 0..1; PaddleOCR uses (x / 255 - 0.5) / 0.5
//   - words: the wrapper returns whole lines. The recognition network emits a prediction per horizontal step, so where each character falls, and where a
//     long empty run separates two stretches of text (the gutter between two columns, a tab, a table cell), is known. Lines are returned as WORDS WITH
//     POSITIONS, split at those runs, which is what the shared layout logic expects (and what Tesseract supplies).
// Every setting is an environment variable for measuring only (OCR_PADDLE_*); the defaults are PaddleOCR's own.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);

interface PaddleWord { text: string; x0: number; x1: number; joined?: boolean }
interface PaddleLine { words: PaddleWord[]; text: string; mean: number; x0: number; y0: number; x1: number; y1: number }
type Raw = { data: Uint8Array | Uint8ClampedArray; width: number; height: number };
export interface PaddleReader { read(image: Raw): Promise<{ lines: PaddleLine[]; width: number; height: number }> }

const MEAN = [0.485, 0.456, 0.406], STD = [0.229, 0.224, 0.225];
/** A run of empty steps at least this long (one step is 8 pixels of the 48-pixel-high line) splits a line into separate words even without a space. */
const GAP_STEPS = Number(process.env.OCR_PADDLE_GAP_STEPS ?? 6);

export async function createPaddleReader(models: { detectionPath: string; recognitionPath: string; dictionaryPath: string }): Promise<PaddleReader> {
  await import("@gutenye/ocr-node"); // registers the file, image and ONNX back ends the wrapper's parts rely on
  const ort = await import("onnxruntime-node");
  const common = dirname(require.resolve("@gutenye/ocr-common/splitIntoLineImages")), node = dirname(require.resolve("@gutenye/ocr-node"));
  const load = (file: string) => import(pathToFileURL(file).href);
  const [{ splitIntoLineImages }, { ImageRaw }] = await Promise.all([load(join(common, "splitIntoLineImages.js")), load(join(node, "ImageRaw.js"))]);
  const det = await ort.InferenceSession.create(models.detectionPath), rec = await ort.InferenceSession.create(models.recognitionPath);
  const dictionary = [...readFileSync(models.dictionaryPath, "utf8").split("\n"), " "]; // class 0 is the empty (blank) class
  const threshold = Number(process.env.OCR_PADDLE_DET_THRESHOLD ?? 0.3), normalise = (process.env.OCR_PADDLE_NORMALISE ?? "imagenet") === "imagenet";

  async function detect(image: Raw) {
    const raw = new ImageRaw(image);
    const input = await raw.resize({ width: Math.max(Math.ceil(raw.width / 32) * 32, 32), height: Math.max(Math.ceil(raw.height / 32) * 32, 32) }); // multiples of 32
    const n = input.width * input.height, chw = new Float32Array(3 * n);
    for (let p = 0; p < n; p++) for (let c = 0; c < 3; c++) { // blue, green, red, as the detector was trained
      const v = input.data[p * 4 + (2 - c)] / 255;
      chw[c * n + p] = normalise ? (v - MEAN[2 - c]) / STD[2 - c] : v;
    }
    const out = (await det.run({ [det.inputNames[0]]: new ort.Tensor("float32", chw, [1, 3, input.height, input.width]) }))[det.outputNames[0]];
    const h = out.dims[2] as number, w = out.dims[3] as number, data = out.data as Float32Array, bw = new Uint8Array(w * h * 4);
    for (let i = 0; i < data.length; i++) { const v = data[i] > threshold ? 255 : 0, k = i * 4; bw[k] = v; bw[k + 1] = v; bw[k + 2] = v; bw[k + 3] = 255; }
    const crops = await splitIntoLineImages(new ImageRaw({ data: bw, width: w, height: h }), input);
    return { crops: crops as { box: number[][]; image: Raw & { resize: (s: { height: number }) => Promise<Raw> } }[], width: input.width as number, height: input.height as number };
  }

  /** One line crop to words with positions along the crop's width (0..1). */
  async function recognise(crop: { image: any }): Promise<{ words: { text: string; a: number; b: number; joined: boolean }[]; mean: number }> {
    const img = await crop.image.resize({ height: 48 }) as Raw;
    const n = img.width * 48, chw = new Float32Array(3 * n);
    for (let p = 0; p < n; p++) for (let c = 0; c < 3; c++) chw[c * n + p] = (img.data[p * 4 + (2 - c)] / 255 - 0.5) / 0.5;
    const out = (await rec.run({ [rec.inputNames[0]]: new ort.Tensor("float32", chw, [1, 3, 48, img.width]) }))[rec.outputNames[0]];
    const steps = out.dims[1] as number, classes = out.dims[2] as number, data = out.data as Float32Array;
    type W = { text: string; t: number[]; spaced: boolean }; // the characters and the step each was read at (a CTC network marks a letter at one step, near its centre)
    const found: W[] = [];
    let cur: W | null = null, last = -1, prev = 0, sum = 0, count = 0, sawSpace = false;
    for (let t = 0; t < steps; t++) {
      let best = 0, bp = -Infinity;
      for (let c = 0; c < classes; c++) { const v = data[t * classes + c]; if (v > bp) { bp = v; best = c; } }
      if (best === 0 || best === prev) { prev = best; continue; } // blank step, or the same character held over several steps
      prev = best;
      const ch = dictionary[best - 1] ?? "";
      sum += bp; count++;
      if (ch === " ") { if (cur) found.push(cur); cur = null; sawSpace = true; continue; }
      if (cur && t - last > GAP_STEPS) { found.push(cur); cur = null; sawSpace = false; } // a long empty run: a gutter, tab or table cell, not a letter space
      if (!cur) { cur = { text: "", t: [], spaced: sawSpace && found.length > 0 && t - last <= GAP_STEPS * 2 }; sawSpace = false; }
      cur.text += ch; cur.t.push(t); last = t;
    }
    if (cur) found.push(cur);
    // A letter is marked near its centre, so a word runs from half a letter before its first mark to half a letter after its last. The letter pitch is this
    // line's median distance between neighbouring marks inside words (a heading in large type and small print each get their own).
    const gaps = found.flatMap((w) => w.t.slice(1).map((x, i) => x - w.t[i])).sort((a, b) => a - b), pitch = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 3;
    // `joined`: the network itself read a space between this word and the one before, so they are one stretch of text and not two columns
    const words = found.filter((w) => w.text).map((w) => ({ text: w.text, a: Math.max(0, w.t[0] - pitch / 2) / steps, b: Math.min(steps, w.t[w.t.length - 1] + pitch / 2) / steps, joined: w.spaced }));
    return { words, mean: count ? sum / count : 0 };
  }

  return {
    async read(image) {
      const { crops, width, height } = await detect(image);
      const lines: PaddleLine[] = [];
      for (const crop of crops) {
        const xs = crop.box.map((p) => p[0]), ys = crop.box.map((p) => p[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
        const r = await recognise(crop);
        if (!r.words.length) continue;
        const words = r.words.map((w) => ({ text: w.text, x0: x0 + w.a * (x1 - x0), x1: x0 + w.b * (x1 - x0), joined: w.joined }));
        // words the network read a space between sit a normal word space apart (0.3 of the text height), whatever the estimate of their extents says
        for (let i = 1; i < words.length; i++) if (words[i].joined) words[i - 1].x1 = Math.max(words[i - 1].x1, words[i].x0 - 0.3 * (y1 - y0) / 1.6);
        lines.push({ words, text: words.map((w) => w.text).join(" "), mean: r.mean, x0, y0, x1, y1 });
      }
      return { lines, width, height };
    },
  };
}
