import { expect, test, vi } from "vitest";
vi.mock("@napi-rs/canvas", () => ({
  createCanvas: vi.fn(),
  loadImage: vi
    .fn()
    .mockRejectedValue(
      new Error("decoder entered before dimension validation"),
    ),
}));
import { loadImage } from "@napi-rs/canvas";
import { prepareForOcr } from "../src/imageprep";
test(
  "oversized image dimensions must be checked before native decoding",
  async () => {
    const b = Buffer.alloc(33);
    b.set([137, 80, 78, 71, 13, 10, 26, 10]);
    b.writeUInt32BE(13, 8);
    b.write("IHDR", 12);
    b.writeUInt32BE(100000, 16);
    b.writeUInt32BE(100000, 20);
    await prepareForOcr(b).catch(() => {});
    expect(loadImage).not.toHaveBeenCalled();
  },
);
