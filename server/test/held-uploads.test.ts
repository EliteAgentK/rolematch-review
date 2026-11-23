// Uploads held while saving is paused (src/heldUploads.ts): encrypted at rest, private to their organisation, bounded, and tamper-evident.
import { expect, test } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { HeldUploads } from "../src/heldUploads";

const fresh = (limits?: { perOrg: number; totalBytes: number }) => { const dir = mkdtempSync(join(tmpdir(), "held-")); return { dir, h: new HeldUploads(dir, randomBytes(32), limits) }; };
const meta = (over: Record<string, unknown> = {}) => ({ id: crypto.randomUUID(), orgId: "org-a", userId: "user-1", kind: "cv" as const, fileName: "Thandeka_Mokoena_CV.pdf", type: "pdf", size: 0, sha256: randomBytes(32).toString("hex"), requestId: "req-1", ...over });
const FILE = Buffer.from("Thandeka Mokoena\nthandeka@example.test\nSenior Data Analyst at Example Bank, 2019 - Present");

test("the file and its details are encrypted on disk: neither the CV's words nor its file name can be read there", () => {
  const { dir, h } = fresh();
  const r = h.hold(meta({ size: FILE.length }), FILE);
  expect("meta" in r && !r.duplicate).toBe(true);
  for (const f of readdirSync(dir)) {
    const raw = readFileSync(join(dir, f));
    expect(raw.includes(Buffer.from("Thandeka"))).toBe(false);
    expect(raw.includes(Buffer.from("example.test"))).toBe(false);
    expect(statSync(join(dir, f)).mode & 0o077).toBe(0); // owner only
  }
  const [m] = h.list("org-a");
  expect(m.fileName).toBe("Thandeka_Mokoena_CV.pdf");
  expect(h.bytes(m.id).equals(FILE)).toBe(true);
});

test("a tampered file is refused instead of being processed", () => {
  const { dir, h } = fresh();
  const r = h.hold(meta({ size: FILE.length }), FILE) as { meta: { id: string } };
  const path = join(dir, `${r.meta.id}.bin`), raw = readFileSync(path);
  raw[raw.length - 1] ^= 0xff;
  writeFileSync(path, raw);
  expect(() => h.bytes(r.meta.id)).toThrow();
});

test("another key, or no key, reads nothing", () => {
  const { dir, h } = fresh();
  h.hold(meta({ size: FILE.length }), FILE);
  expect(new HeldUploads(dir, randomBytes(32)).all()).toEqual([]);
  const none = new HeldUploads(dir, null);
  expect(none.enabled).toBe(false);
  expect(none.hold(meta(), FILE)).toEqual({ full: "holding is not configured" });
});

test("each organisation sees only its own held uploads", () => {
  const { h } = fresh();
  const a = h.hold(meta({ orgId: "org-a" }), FILE) as { meta: { id: string } };
  h.hold(meta({ orgId: "org-b" }), FILE);
  expect(h.list("org-a").map((m) => m.id)).toEqual([a.meta.id]);
  expect(h.get("org-b", a.meta.id)).toBeUndefined();
});

test("the same file held twice is one held upload; the holding area has limits", () => {
  const { h } = fresh({ perOrg: 2, totalBytes: 1024 });
  const m = meta();
  const first = h.hold(m, FILE) as { meta: { id: string } };
  expect(h.hold({ ...m, id: crypto.randomUUID() }, FILE)).toMatchObject({ duplicate: true, meta: { id: first.meta.id } });
  h.hold(meta(), FILE);
  expect(h.hold(meta(), FILE)).toMatchObject({ full: expect.stringMatching(/already has 2 uploads waiting/) });
  expect(h.hold(meta({ orgId: "org-c" }), randomBytes(2048))).toMatchObject({ full: "the holding area is full" });
});

test("released uploads are gone from disk", () => {
  const { dir, h } = fresh();
  const r = h.hold(meta(), FILE) as { meta: { id: string } };
  h.release(r.meta.id);
  expect(readdirSync(dir)).toEqual([]);
  expect(h.list("org-a")).toEqual([]);
});
