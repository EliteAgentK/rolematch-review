import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { FAMILIES, POINTS } from "../src/points";
import { ruleset } from "../src/ruleset";
import { CATALOGUE_PATH, renderCatalogue } from "../scripts/pointsDoc";

test("the catalogue is extensive and its ids are unique, ordered and in a real family", () => {
  expect(POINTS.length).toBeGreaterThanOrEqual(100);
  expect(new Set(POINTS.map((p) => p.id)).size).toBe(POINTS.length);
  for (const f of Object.keys(FAMILIES)) {
    const ids = POINTS.filter((p) => p.family === f).map((p) => Number(p.id.slice(1)));
    expect(ids.length, `family ${f} has points`).toBeGreaterThan(0);
    expect(ids, `family ${f} is numbered 1..n in order`).toEqual(ids.map((_, i) => i + 1));
  }
  for (const p of POINTS) for (const field of [p.name, p.evidence, p.rule]) expect(field.trim().length, `${p.id} is filled in`).toBeGreaterThan(2);
});

test("forbidden points are never used, and everything never used is either forbidden or reserved to people", () => {
  for (const p of POINTS) expect(p.kind === "forbidden", `${p.id}`).toBe(p.family === "X");
  for (const p of POINTS.filter((x) => x.family === "X")) expect(p.status).toBe("never");
  expect(POINTS.filter((p) => p.status === "never" && p.family !== "X").map((p) => p.id)).toEqual(["H08"]);   // a hiring decision is not a platform function
});

test("every trait the rules say are off limits is covered by a forbidden point", () => {
  const forbidden = POINTS.filter((p) => p.family === "X").map((p) => `${p.name} ${p.evidence} ${p.rule}`.toLowerCase()).join(" | ");
  const words: Record<string, string> = { rating: "rating", name: "name", email: "email", phone: "phone", avatar: "photograph", age: "age", gender: "gender", race: "race", religion: "religion", nationality: "nationality" };
  for (const trait of ruleset.neverUsedAsInputs) expect(forbidden, `forbidden point for ${trait}`).toContain(words[trait]);
});

test("no scored or flagged point reads from a forbidden source", () => {
  const bad = /date of birth|\bgender\b|\brace\b|\breligion\b|nationality|photograph|marital|pregnan|disabilit|postal code|id number/i;
  for (const p of POINTS.filter((x) => x.kind === "scored" || x.kind === "gate")) expect(bad.test(`${p.evidence} ${p.rule}`), `${p.id} ${p.name}`).toBe(false);
});

test("every scored point says how it avoids counting the same thing twice", () => {
  for (const p of POINTS.filter((x) => x.kind === "scored")) expect(p.guard.trim().length, `${p.id} has a guard`).toBeGreaterThan(10);
});

test("the published catalogue matches the data (run npm run docs:points after changing src/points.ts)", () => {
  expect(readFileSync(CATALOGUE_PATH, "utf8")).toBe(renderCatalogue());
});
