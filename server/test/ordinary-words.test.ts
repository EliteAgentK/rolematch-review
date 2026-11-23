import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { extractionConfig } from "../src/extractionConfig";

test("the ordinary-word list is the one the configuration names", () => {
  const text = readFileSync(join(import.meta.dirname, "..", "src", "docmodel", "ordinaryWords.txt"), "utf8");
  expect(createHash("sha256").update(text).digest("hex").slice(0, 16)).toBe(extractionConfig.evidence.ordinaryWordsSha);
});
