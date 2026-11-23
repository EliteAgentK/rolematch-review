// Run by occurrences.test.ts against a throw-away schema migrated through 020. Uses the REAL recording path (src/occurrences.ts) through the server's own db.ts,
// as a worker would: inside one portal's scope, as the tenant role, with the row rules on.
import { forPortal, platformSql, sql } from "../../src/db";
import { recordingFailures, recordOccurrence } from "../../src/occurrences";

const [org, portal, other] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
await sql`insert into orgs (id, name) values (${org}, 'Rec A')`;
await sql`insert into portals (id, org_id, name) values (${portal}, ${org}, 'P')`;
const out: Record<string, unknown> = {};
const base = { orgId: org, correlationId: "c-1", component: "probe", stage: "reading", code: "SOME_CODE", message: "failed for a@b.co.za" };
await forPortal(org, portal, async () => {
  await recordOccurrence(base); await recordOccurrence({ ...base, correlationId: "c-2" });                 // two occurrences of the same suspected defect
  await recordOccurrence({ ...base, stage: "extracting", correlationId: "c-3" });                         // a different stage is a different defect
});
const rows = await platformSql`select count(*)::int n from error_occurrences where component = 'probe'`;
const groups = await platformSql`select code, occurrences, status, kind from defect_groups where org_id = ${org} order by occurrences desc`;
out.occurrences = rows[0].n; out.groups = groups.map((g: any) => [g.code, g.occurrences, g.status, g.kind]);
out.storedMessageHasNoAddress = !(await platformSql`select detail::text t from error_occurrences where component = 'probe'`).some((r: any) => /@/.test(r.t));
// the recorder failing: an organisation that does not exist violates a foreign key
const before = recordingFailures.count;
await forPortal(other, portal, async () => { await recordOccurrence({ ...base, orgId: other, correlationId: "c-bad" }); });   // must not throw
out.failureCounted = recordingFailures.count - before;
out.noRecursiveRecord = (await platformSql`select count(*)::int n from error_occurrences where correlation_id = 'c-bad'`)[0].n;   // a failed record does not try to record itself
out.otherPortalsRowsInvisible = await forPortal(org, crypto.randomUUID(), async () => Number((await sql`select count(*)::int c from error_occurrences`)[0].c));
console.log(JSON.stringify(out));
process.exit(0);
