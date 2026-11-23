// npm run audit:check : audits the production dependencies of the server and the website (docs/security/SAFETY_CHECKS.md).
// Exit 0: both audits completed and every advisory is accepted in audit-allowlist.json and not past its review date.
// Exit 1: an audit completed and found an advisory that is new or past its review date.
// Exit 2: an audit is incomplete (missing folder or files, npm failure, unreadable or inconsistent report). Never reported as "no advisories" (R40).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { auditTree, judge } from "./auditCore.mjs";

const allow = JSON.parse(readFileSync(new URL("../audit-allowlist.json", import.meta.url), "utf8")).accepted;
const trees = [["server", fileURLToPath(new URL("..", import.meta.url))], ["website", fileURLToPath(new URL("../..", import.meta.url))]];
let incomplete = false, unreviewed = false;
for (const [name, dir] of trees) {
  const t = auditTree({ name, dir });
  if (t.status === "incomplete") { console.error(`${name}: AUDIT INCOMPLETE: ${t.reason}. This is a failure, not a clean result.`); incomplete = true; continue; }
  if (t.status === "clean") { console.log(`${name}: audit completed, ${t.checkedProduction} production packages checked, no advisories`); continue; }
  for (const j of judge(t.advisories, allow)) {
    if (j.verdict === "new") { console.error(`${name}: NEW advisory ${j.id} is not reviewed`); unreviewed = true; }
    else if (j.verdict === "expired") { console.error(`${name}: ${j.id} was due for review on ${j.reviewBy}`); unreviewed = true; }
    else console.log(`${name}: ${j.id} accepted until ${j.reviewBy} (${j.package})`);
  }
  console.log(`${name}: audit completed, ${t.checkedProduction} production packages checked, ${t.advisories.length} advisor${t.advisories.length === 1 ? "y" : "ies"}`);
}
process.exit(incomplete ? 2 : unreviewed ? 1 : 0);
