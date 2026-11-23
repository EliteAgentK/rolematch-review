// Matching's brief of each named job, exactly as live makes it (readJob in src/aiJobRead.ts, after the job is read as live reads it): seniority and the
// must-haves, to check the owner's rule (10 Nov 2026: at least 4, at most 5, and 5 for an executive role). Local database only; fictional test jobs.
//   DATABASE_URL=<the local database> ANTHROPIC_API_KEY=… node --import tsx test/collection/briefCheck.ts <job file> …
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { jobKeyOf, jobTextOf, readJob } from "../../src/aiJobRead";
import { platformSql as sql } from "../../src/db";
import { prepareDocument } from "../../src/prepare";
import { defaultSettings } from "../../src/settings";
import { readJobAsLive } from "./liveJob";

if (!/@(127\.0\.0\.1|localhost)[:/]/.test(process.env.DATABASE_URL ?? "")) throw new Error("Run against a local database only.");
const started = new Date(Date.now() - 60_000);
for (const file of process.argv.slice(2)) {
  const r: any = await prepareDocument(new Uint8Array(readFileSync(file)), { kind: "jd", org: defaultSettings() as any, asOf: new Date() });
  const advert = String(r.text ?? ""), job = await readJobAsLive(advert), text = jobTextOf(job, advert);
  const b: any = await readJob(job, text, jobKeyOf("job", text), "evaluation");
  if ("failed" in b) { console.log(basename(file), "FAILED", b.failed); continue; }
  const must = b.requirements.filter((x: any) => x.importance === "must_have" && x.fair !== false);
  console.log(JSON.stringify({ job: basename(file), seniority: b.brief?.seniority, mustHaves: must.length, of: b.requirements.length, list: must.map((x: any) => `${x.kind}: ${x.requirement}`) }));
}
console.log(JSON.stringify(await sql`select model, count(*)::int as calls, round(sum(cost_micro_usd) / 1e6::numeric, 4)::float as usd from ai_usage where at >= ${started} group by model`));
await sql.end({ timeout: 5 }); process.exit(0);
