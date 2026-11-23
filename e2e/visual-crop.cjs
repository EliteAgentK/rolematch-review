// node e2e/visual-crop.cjs <in.png> <out.png> x y w h : cuts a region out of a screenshot (to look closely at a difference).
const fs = require("fs");
const { PNG } = require("playwright-core/lib/utilsBundle");
const [inp, out, x, y, w, h] = process.argv.slice(2); const [X, Y, W, H] = [x, y, w, h].map(Number);
const src = PNG.sync.read(fs.readFileSync(inp)), dst = new PNG({ width: W, height: H });
for (let r = 0; r < H; r++) src.data.copy(dst.data, r * W * 4, ((Y + r) * src.width + X) * 4, ((Y + r) * src.width + X + W) * 4);
fs.writeFileSync(out, PNG.sync.write(dst));
