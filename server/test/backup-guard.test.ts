import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test } from "vitest";
import { OriginalsCopy, pruneLooksSafe } from "../src/originalsCopy";

// R98. The vault exists for when the database is lost, so a database that suddenly lists few documents must not empty it. Ordinary deletions must still be tidied.
const dir = mkdtempSync(join(tmpdir(), "vault-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
test("an empty or much smaller database never looks safe to prune; a few real deletions do", () => {
  expect(pruneLooksSafe(15, 15)).toBe(false);     // every document gone: a lost database
  expect(pruneLooksSafe(100, 500)).toBe(false);   // a fifth gone at once
  expect(pruneLooksSafe(3, 3)).toBe(false);       // however few: nothing left in the database is never tidied away
  expect(pruneLooksSafe(3, 20)).toBe(true);       // a few real deletions
  expect(pruneLooksSafe(40, 500)).toBe(true);     // under a tenth
  expect(pruneLooksSafe(0, 0)).toBe(true);
});
test("orphans are counted without removing anything, and only prune removes", () => {
  const v = new OriginalsCopy(dir, Buffer.alloc(32, 7));
  for (const p of ["a/1", "a/2", "a/3"]) v.write(p, new Uint8Array([1, 2, 3]));
  expect(v.orphans(["a/1"])).toBe(2);
  expect(v.missing(["a/1", "a/2", "a/3"])).toEqual([]);
  expect(v.prune(["a/1"])).toBe(2);
  expect(v.read("a/1")).not.toBeNull();
  expect(v.read("a/2")).toBeNull();
});
