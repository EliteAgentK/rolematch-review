// Stored values compared whatever order their keys are in (src/sameJson.ts). The fault it closes: a job read again reported unchanged requirement groups
// as changed (10 Nov 2026), because the database had put "count" before "heading". The same comparison decided which locked fields an edit would change
// (a 403 for sending a record back unchanged) and what a settings change recorded. The last test keeps the fault from coming back anywhere in the server.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { sameJson } from "../src/sameJson";

test("the same value with its keys in another order is the same; a different value or list order is not", () => {
  expect(sameJson([{ heading: "Requirements", count: 2 }], [{ count: 2, heading: "Requirements" }])).toBe(true);
  expect(sameJson({ a: { y: 1, x: [{ q: 1, p: 2 }] } }, { a: { x: [{ p: 2, q: 1 }], y: 1 } })).toBe(true);
  expect(sameJson([{ heading: "Requirements", count: 2 }], [{ heading: "Requirements", count: 3 }])).toBe(false);
  expect(sameJson(["first", "second"], ["second", "first"])).toBe(false);   // a list's order is part of what it says
  expect(sameJson("", null)).toBe(false);
  expect(sameJson(undefined, undefined)).toBe(true);
});

test("no server code compares values by their JSON text", () => {
  const dir = join(__dirname, "../src"), found: string[] = [];
  const walk = (d: string) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else if (p.endsWith(".ts")) readFileSync(p, "utf8").split("\n").forEach((l, i) => { if (/JSON\.stringify\([^)]*\)\s*[!=]==\s*JSON\.stringify\(/.test(l)) found.push(`${p.slice(dir.length + 1)}:${i + 1}`); }); } };
  walk(dir);
  expect(found, "use sameJson (src/sameJson.ts): the database does not keep an object's key order").toEqual([]);
});
