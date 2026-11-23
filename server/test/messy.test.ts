import { expect, test } from "vitest";
import { CHROME } from "./messy/build";
import { evaluate, summarise } from "./messy/eval";

// The messy-CV corpus (368 fictional CVs in 33 layouts, PDF and Word) is rebuilt with headless Chrome when missing.
// It guards the parser against regressions. Known limits are listed below; anything else failing is a regression.
const KNOWN_LIMITS = new Set([
  "pdf/skillstable__nomvula.pdf", // a skill name wrapped inside a narrow table cell
  "pdf/tabs__zoe.pdf", //            an institution name wrapped inside a narrow table cell
  "pdf/companyfirst__physio.pdf", //  a hospital employer and a long community-service job title in company-first layout
]);

test.skipIf(!CHROME)("messy CV corpus: accuracy has not regressed", async () => {
  const rows = await evaluate();
  const all = summarise(rows);
  console.log("messy corpus:", JSON.stringify(all));

  // Things that must never go wrong
  expect(all.leaks).toBe(0); // ID numbers, birth dates, marital status etc. never appear in extracted fields
  // A floor at what the one reader measured on 2026-11-05 (register R141), so it cannot quietly get worse. It is lower than the older reading's 98% "perfect", because that was measured on a reading the service never used. The target test below keeps the gap in view.
  expect(all.name).toBeGreaterThanOrEqual(99);
  expect(all.email).toBe(100);
  expect(all.phone).toBe(100);
  expect(all.location).toBe(100);
  expect(all.rolePrecision).toBe(100); // never invent a job
  expect(all.perfect).toBeGreaterThanOrEqual(93);
  expect(all.roleRecall).toBeGreaterThanOrEqual(98);
  expect(all.skills).toBeGreaterThanOrEqual(99);
  expect(all.education).toBeGreaterThanOrEqual(99);
}, 900000);

// The target, not yet met, in the open: date-column and table layouts lose employers and wrapped skills (R141).
// Without a Chrome to render the corpus this cannot run at all; it must skip, not wait out its time limit and count as the expected failure.
test.skipIf(!CHROME).fails("messy CV corpus: at least 98% of documents read perfectly", async () => {
  expect(summarise(await evaluate()).perfect).toBeGreaterThanOrEqual(98);
}, 900000);
