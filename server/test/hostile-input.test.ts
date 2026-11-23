import { expect, test } from "vitest";
import { parseCv } from "../src/rules";
import { cleanOcr } from "../src/ocr";
import { rtrim } from "../src/textsafe";

// A document is hostile input. These shapes used to make pattern matching take seconds to minutes; each must now finish quickly however long it is.
const shapes: Record<string, string> = {
  "one huge line of capitals": "A B C ".repeat(25_000),
  "a very long word": "Experience" + "e".repeat(80_000),
  "a long run of spaces": "a" + " ".repeat(150_000) + "!",
  "an address with no end": "a.".repeat(40_000) + "@x",
  "dates without end": "Jan 2020 - ".repeat(12_000),
};

test.each(Object.entries(shapes))("hostile input stays fast: %s", (_name, text) => {
  for (const run of [() => parseCv(text), () => cleanOcr(text)]) {
    const t = performance.now();
    run();
    expect(performance.now() - t).toBeLessThan(3000);
  }
});

test("rtrim removes only trailing spaces and tabs", () => {
  expect(rtrim("abc \t ")).toBe("abc");
  expect(rtrim("  a b")).toBe("  a b");
  expect(rtrim("   ")).toBe("");
});
