// Every JSON reply leaves the server through one step (replyText in index.ts), which shows names and titles by one rule (shown.ts) and never names the
// AI model (noModelNames.ts). Owner, 11 Nov 2026: the board's cards showed a name in capitals because their cached pages were written without it.
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

test("no JSON reply is written except by replyText", () => {
  const src = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
  // Every Response that carries JSON is either json() itself or the board's cached page, whose text is written by replyText.
  const lines = src.split("\n").filter((l) => l.includes("new Response(") && l.includes("application/json"));
  expect(lines).toHaveLength(2);
  expect(lines.some((l) => /const json = .*new Response\(replyText\(data\)/.test(l))).toBe(true);
  expect(lines.some((l) => /return new Response\(text, /.test(l))).toBe(true);
  expect(src).toMatch(/const read = async \(\) => \{[^}]*return replyText\(\{ \.\.\.p, items/);
});
