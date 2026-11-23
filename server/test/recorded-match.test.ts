// A pair's recorded match is the one shown everywhere (owner, 11 Nov 2026: the Overview showed 90 for a pair whose assessment opened on 86, a later
// result the AI had also finished). recorded.ts holds the one ordering; every query that picks one result per pair must use it.
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, expect, test } from "vitest";
import { platformSql } from "../src/db";
import { recordedFirst } from "../src/recorded";

afterAll(async () => { await platformSql.end({ timeout: 5 }); });

test("the first result the AI finished is the pair's result, whatever came after; else the one being scored; else the newest", async () => {
  const pick = async (rows: [string, string, unknown][]) => (await platformSql`select m.name from (values ${platformSql(rows.map(([name, at, ai]) => [name, at, JSON.stringify(ai === null ? {} : { ai })]))})
    as v(name, at, result), lateral (select v.name, v.at::timestamptz as created_at, v.result::jsonb as result) m order by ${recordedFirst()} limit 1`)[0].name;
  expect(await pick([["first 86", "2026-11-09T10:00:00Z", { state: "checked" }], ["later 90", "2026-11-10T10:00:00Z", { state: "checked" }]])).toBe("first 86");
  expect(await pick([["pending", "2026-11-09T10:00:00Z", { state: "pending" }], ["checked later", "2026-11-10T10:00:00Z", { state: "checked" }]])).toBe("checked later");
  expect(await pick([["old rules", "2026-11-01T10:00:00Z", null], ["pending", "2026-11-09T10:00:00Z", { state: "pending" }]])).toBe("pending");
  expect(await pick([["older", "2026-11-01T10:00:00Z", null], ["newer", "2026-11-02T10:00:00Z", null]])).toBe("newer");
});

test("every query that picks one match per pair orders by the recorded rule", () => {
  const files = readdirSync(new URL("../src/", import.meta.url)).filter((f) => f.endsWith(".ts"));
  const off: string[] = [];
  for (const f of files) {
    const text = readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");
    for (const q of text.match(/distinct on \([^)]*candidate_id[^)]*\)[\s\S]{0,600}?from matches[\s\S]{0,600}?`/g) ?? []) if (!q.includes("recordedFirst()")) off.push(`${f}: ${q.slice(0, 80)}`);
  }
  expect(off).toEqual([]);
});
