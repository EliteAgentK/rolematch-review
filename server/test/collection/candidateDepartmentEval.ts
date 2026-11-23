// The candidate department question (src/department.ts) measured on the 30 real CVs' checked keys (data/real-cvs/keys: each person's jobs and the
// provisional headline), with real Claude, exactly as live asks it: the headline and the three latest jobs, never the CV's text. Each is asked twice.
// Pass, set before running (10 Nov 2026): every person placed (no empty answer); the same department both times for at least 28 of 30; and no person in
// Executive leadership whose current title does not head a whole business (the structural rule). Whether each department is the right one is read by a
// person from the printed list: there is no answer key for departments yet. Prints ids, headlines and latest titles only, never names or contact details.
//   ROLEMATCH_ENV_FILE=/dev/null <local settings> ANTHROPIC_API_KEY=... node --import tsx test/collection/candidateDepartmentEval.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { candidateDepartment } from "../../src/department";
import { spentThisMonthUsd } from "../../src/ai/claude";
import { askAi } from "../../src/hybridReader";

const KEYS = join(import.meta.dirname, "..", "..", "data", "real-cvs", "keys");
const headlines = JSON.parse(readFileSync(join(KEYS, "headlines.json"), "utf8")).labels as Record<string, string[]>;
const people = readFileSync(join(KEYS, "keys.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as { id: string; name: string; roles: [string, string, string, string][] });
// What it cost, from the usage every call records (ai/claude.ts), on this machine's own database.
const before = await spentThisMonthUsd();
let same = 0, placed = 0;
const rows: string[] = [];
for (const p of people) {
  const headline = headlines[p.id]?.[0] ?? "", roles = p.roles.map(([title, employer]) => ({ title, employer }));
  const once = async () => (await candidateDepartment(askAi([p.name], "evaluation"), headline, roles, 60_000)).group;
  const [a, b] = [await once(), await once()];
  if (a) placed++; if (a === b) same++;
  rows.push(`${p.id}  ${a}${a === b ? "" : `  / second time: ${b}`}  <-  ${headline || "(no headline)"}  ·  latest: ${roles[0]?.title ?? "(none)"}`);
}
console.log(rows.join("\n"));
console.log(`\nplaced ${placed}/${people.length}, the same both times ${same}/${people.length}, about $${((await spentThisMonthUsd()) - before).toFixed(4)}`);
process.exit(0);
