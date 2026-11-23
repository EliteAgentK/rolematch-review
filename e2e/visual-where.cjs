// node e2e/visual-where.cjs <diff.png> : the bounding boxes of the differing (red) areas in a Playwright diff image, to know where to look.
const fs = require("fs");
const { PNG } = require("playwright-core/lib/utilsBundle");
const img = PNG.sync.read(fs.readFileSync(process.argv[2]));
const rows = new Map();
for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
  const i = (y * img.width + x) * 4, [r, g, b] = [img.data[i], img.data[i + 1], img.data[i + 2]];
  if (r > 200 && g < 80 && b < 80) { const band = Math.floor(y / 40); const v = rows.get(band) ?? [x, x, y, y, 0]; rows.set(band, [Math.min(v[0], x), Math.max(v[1], x), Math.min(v[2], y), Math.max(v[3], y), v[4] + 1]); }
}
for (const [, [x0, x1, y0, y1, n]] of [...rows].sort((a, b) => a[0] - b[0])) console.log(`x ${x0}-${x1}, y ${y0}-${y1}: ${n} px`);
