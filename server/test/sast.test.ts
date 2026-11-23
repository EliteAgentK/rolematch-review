import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { sastDate, sastDates, sastMonth } from "../src/sast";

// Code review, 16 Nov 2026, C-M5 (G4 in docs/architecture/PLAN_PORTAL_BILLING.md): months and days were cut at midnight UTC, two hours after midnight in
// Johannesburg, on the Overview's credits, the unusual-activity allowance, a company's AI allowance and the daily figures. One place now says where a
// Johannesburg day and month begin (server/src/sast.ts, supabase/migrations/065_sast_boundaries.sql).
test("Johannesburg's date and month, and the days of a period, are Johannesburg's, not UTC's", () => {
  const lateUtc = new Date("2026-11-30T22:30:00Z");   // 00:30 on 1 December in Johannesburg
  expect(sastDate(lateUtc)).toBe("2026-12-01");
  expect(sastMonth(lateUtc)).toBe("2026-12");
  expect(sastMonth(new Date("2026-11-30T21:59:00Z"))).toBe("2026-11");
  expect(sastDates(3, lateUtc)).toEqual(["2026-11-29", "2026-11-30", "2026-12-01"]);
});

test("nothing in the service cuts a month or a day at midnight UTC: every such boundary goes through the one Johannesburg helper", () => {
  const dir = fileURLToPath(new URL("../src", import.meta.url)), found: string[] = [];
  const walk = (d: string) => { for (const f of readdirSync(d, { withFileTypes: true })) { const p = join(d, f.name); if (f.isDirectory()) walk(p); else if (/\.ts$/.test(f.name)) readFileSync(p, "utf8").split("\n").forEach((l, i) => {
    if (/date_trunc\(\s*'(month|day)'\s*,\s*(now\(\)|[a-z_.]*(created_at|updated_at|\bat))\s*\)/.test(l) || /toISOString\(\)\.slice\(0, 7\)/.test(l)) found.push(`${p.slice(dir.length + 1)}:${i + 1}`);
  }); } };
  walk(dir);
  expect(found).toEqual([]);
});
