// RoleMatch's own copy of original files, and the audit journal used while the audit log cannot be written (docs/architecture/RESILIENCE.md, step 5).
import { expect, test } from "vitest";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { OriginalsCopy } from "../src/originalsCopy";
import { AuditJournal } from "../src/auditJournal";

const dir = () => mkdtempSync(join(tmpdir(), "vault-"));
const CV = Buffer.from("Naledi Khumalo, naledi@example.test, Financial Manager at Example Holdings");

test("copied originals are encrypted and named so that neither the content nor the organisation or document can be read from disk", () => {
  const d = dir(), store = new OriginalsCopy(d, randomBytes(32));
  store.write("org-123/doc-456", CV);
  const [file] = readdirSync(d);
  expect(file).not.toMatch(/org-123|doc-456/);
  expect(readFileSync(join(d, file)).includes(Buffer.from("Naledi"))).toBe(false);
  expect(store.read("org-123/doc-456")?.equals(CV)).toBe(true);
});

test("a deleted document's original leaves the copy at the next refresh; only missing ones are fetched", () => {
  const store = new OriginalsCopy(dir(), randomBytes(32));
  store.write("o/a", CV); store.write("o/b", CV);
  expect(store.missing(["o/a", "o/b", "o/c"])).toEqual(["o/c"]);
  expect(store.prune(["o/b"])).toBe(1);   // o/a's document was deleted
  expect(store.read("o/a")).toBeNull();
  expect(store.has("o/b")).toBe(true);
});

test("without a key nothing is kept or read", () => {
  const store = new OriginalsCopy(dir(), null);
  expect(store.enabled).toBe(false);
  expect(store.read("o/a")).toBeNull();
});

test("a journaled audit entry is on disk, encrypted, before append returns, and keeps its own time and id", () => {
  const d = dir(), j = new AuditJournal(d, randomBytes(32));
  const e = j.append({ orgId: "org-1", actorId: "user-1", action: "document.original_viewed", entityType: "document", entityId: "doc-1", detail: { journaled: true }, correlationId: "req-9" });
  const files = readdirSync(d);
  expect(files).toEqual([`${e.id}.json`]);
  expect(readFileSync(join(d, files[0])).includes(Buffer.from("original_viewed"))).toBe(false);
  expect(j.all()).toEqual([e]);
  expect(Date.parse(e.createdAt)).toBeLessThanOrEqual(Date.now());
  j.done(e.id);
  expect(j.all()).toEqual([]);
});

test("without a key the journal refuses, so the action is refused rather than done unrecorded", () => {
  expect(() => new AuditJournal(dir(), null).append({ orgId: "o", actorId: null, action: "x", entityType: "y", entityId: null, detail: {}, correlationId: null })).toThrow(/not configured/);
});
