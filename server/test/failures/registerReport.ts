// What the register says, by shared cause, with whether any retained case has come back: npm run register:report
import { readFileSync } from "node:fs";
import { join } from "node:path";
const dir = import.meta.dirname, reg = JSON.parse(readFileSync(join(dir, "register.json"), "utf8")), ledger = JSON.parse(readFileSync(join(dir, "ledger.json"), "utf8"));
const groups = new Map<string, any[]>(); for (const e of reg.entries) groups.set(e.group, [...(groups.get(e.group) ?? []), e]);
for (const [g, list] of [...groups].sort((a, b) => b[1].length - a[1].length)) { console.log(`\n${g}: ${list.length}`); for (const e of list) console.log(`  ${e.id} [${e.status}] ${e.summary}\n     cause: ${e.cause}\n     measured: ${e.measured}`); }
const by: Record<string, number> = {}; for (const e of reg.entries) by[e.status] = (by[e.status] ?? 0) + 1;
console.log(`\n${reg.entries.length} entries: ${JSON.stringify(by)} | known open library variants: ${Object.keys(ledger.openInPrototype ?? {}).length} | recurrences recorded: ${JSON.stringify(ledger.recurrences ?? ledger.recurrence ?? {})}`);
