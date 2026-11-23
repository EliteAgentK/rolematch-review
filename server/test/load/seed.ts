// Invented organisations, portals, people and records for load tests on the disposable local stack. Refuses any address that is not on this machine.
//   node --env-file=$HOME/.rolematch/rehearsal.env --import tsx test/load/seed.ts <orgs> <usersPerOrg> <candidatesPerPortal> <jobsPerPortal> <out.json>
// Records are copies of one document the service itself read, with invented names, so reads and matches do real work. Every address ends in .invalid: nothing can be mailed to it.
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const [orgs, usersPerOrg, candidates, jobs] = process.argv.slice(2, 6).map(Number), out = process.argv[6];
const { DATABASE_URL: db, SUPABASE_URL: api, SUPABASE_SERVICE_ROLE_KEY: key, PORT } = process.env as Record<string, string>;
const local = (u: string) => /^(?:https?|postgres(?:ql)?):\/\/(?:[^@/]*@)?(?:127\.0\.0\.1|localhost)(?::\d+)?(?:\/|$)/.test(u);
if (!orgs || !usersPerOrg || !out || !local(db) || !local(api)) { console.error("Needs numbers, an output file and a stack on this machine."); process.exit(1); }

const BASE = `http://localhost:${PORT}`, PASSWORD = `load-${randomUUID()}`, RUN = randomUUID().slice(0, 6);
const sql = postgres(db, { max: 8, onnotice: () => {} });
const FIRST = ["Thandi", "Pieter", "Aisha", "Lungile", "Maria", "Sipho", "Neha", "Jacques", "Fatima", "Bongani", "Zanele", "Ruan"], LAST = ["Mokoena", "Naidoo", "Jacobs", "Dlamini", "Pretorius", "Khumalo", "Govender", "Botha", "Adams", "Nkosi"];
const person = (i: number) => `${FIRST[i % FIRST.length]} ${LAST[(i * 7) % LAST.length]} ${i}`;
const fixture = (n: string) => new File([readFileSync(join(import.meta.dirname, "../fixtures/journey", n))], n);

async function createAuthUser(email: string, name: string) {
  const r = await fetch(`${api}/auth/v1/admin/users`, { method: "POST", headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify({ email, password: PASSWORD, email_confirm: true, user_metadata: { name } }) });
  const b = (await r.json()) as any;
  if (!r.ok) throw new Error(`create user: ${r.status} ${b.msg ?? b.message ?? ""}`);
  return b.id as string;
}
async function inBatches<T, R>(items: T[], size: number, run: (x: T) => Promise<R>) { const results: R[] = []; for (let i = 0; i < items.length; i += size) results.push(...(await Promise.all(items.slice(i, i + size).map(run)))); return results; }

// One document of each kind read by the service itself, in an organisation of its own, as the shape every copy takes.
async function templates() {
  const email = `load-template-${RUN}@load.invalid`, origin = process.env.ALLOWED_ORIGINS?.split(",")[0] ?? BASE;
  const orgId = randomUUID(), portalId = randomUUID(), userId = await createAuthUser(email, "Load Template");
  await sql`insert into orgs (id, name) values (${orgId}, ${"Load template " + RUN})`;
  await sql`insert into members (user_id, org_id, name, role, email) values (${userId}, ${orgId}, 'Load Template', 'admin', ${email})`;
  await sql`insert into portals (id, org_id, name, created_by) values (${portalId}, ${orgId}, 'Template', ${userId})`;
  await sql`insert into portal_members (portal_id, org_id, user_id, role) values (${portalId}, ${orgId}, ${userId}, 'admin')`;
  const signed = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify({ email, password: PASSWORD }) });
  const cookie = signed.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  if (!cookie) throw new Error(`Could not sign in the template account (${signed.status}).`);
  const up = async (n: string, kind: string) => {
    const f = new FormData(); f.append("kind", kind); f.append("file", fixture(n));
    const r = (await (await fetch(`${BASE}/api/documents`, { method: "POST", headers: { cookie, origin }, body: f })).json()) as any;
    for (let i = 0; i < 600; i++) { const d = (await (await fetch(`${BASE}/api/documents/${r.id}`, { headers: { cookie, origin } })).json()) as any; if (d.status === "published") return d.recordId as string; if (d.status === "exception") throw new Error(`template ${n}: ${d.errorCode}`); await new Promise((res) => setTimeout(res, 500)); }
    throw new Error(`template ${n} was not read in time`);
  };
  const c = await up("CV0501.docx", "cv"), j = await up("JD0151.docx", "jd");
  const [cand] = await sql`select data, extracted, document_id from candidates where id = ${c}`, [job] = await sql`select data, extracted, document_id from jobs where id = ${j}`;
  const [cvDoc] = await sql`select * from documents where id = ${cand.document_id}`, [jdDoc] = await sql`select * from documents where id = ${job.document_id}`;
  return { cand, job, cvDoc, jdDoc };
}

const { cand, job, cvDoc, jdDoc } = await templates();
const accounts: { email: string; org: string; portal: string; role: string; ip: string }[] = [], t0 = Date.now();
await inBatches(Array.from({ length: orgs }, (_, i) => i), 4, async (o) => {
  const orgId = randomUUID(), portalId = randomUUID(), orgLabel = `Load ${RUN} org ${o}`;
  await sql`insert into orgs (id, name) values (${orgId}, ${orgLabel})`;
  const people = Array.from({ length: usersPerOrg }, (_, u) => ({ email: `load-${RUN}-o${o}-u${u}@load.invalid`, name: `Load ${o}.${u}`, role: u === 0 ? "admin" : u % 10 === 9 ? "hiring_manager" : "recruiter" }));
  const ids = await inBatches(people, 8, (p) => createAuthUser(p.email, p.name));
  const members = people.map((p, u) => ({ user_id: ids[u], org_id: orgId, name: p.name, role: p.role, email: p.email }));
  await sql`insert into members ${sql(members)}`;
  await sql`insert into portals (id, org_id, name, created_by) values (${portalId}, ${orgId}, ${"Main " + o}, ${ids[0]})`;
  await sql`insert into portal_members ${sql(people.map((p, u) => ({ portal_id: portalId, org_id: orgId, user_id: ids[u], role: p.role })))}`;
  // Each copy has its own document row, pointing at the one stored file, because a record must have one.
  const doc = (tpl: any, id: string, recordId: string, name: string) => ({ ...tpl, id, org_id: orgId, portal_id: portalId, record_id: recordId, sha256: randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, ""), original_name: name, batch_id: null, created_by: ids[0], uploaded_by_email: people[0].email, source_text: tpl.source_text });
  const docs: any[] = [], rows = Array.from({ length: candidates }, (_, c) => { const id = randomUUID(), docId = randomUUID(), name = person(c); docs.push(doc(cvDoc, docId, id, `load-${c}.docx`)); return { id, org_id: orgId, portal_id: portalId, document_id: docId, data: { ...cand.data, id, name, documentId: docId, email: `candidate.${c}.o${o}@load.invalid`, status: c % 5 === 0 ? "shortlisted" : "new" }, extracted: cand.extracted ?? {}, version: 1 }; });
  const jobRows = Array.from({ length: jobs }, (_, j) => { const id = randomUUID(), docId = randomUUID(), title = `${job.data.title ?? "Role"} ${j}`; docs.push(doc(jdDoc, docId, id, `load-job-${j}.docx`)); return { id, org_id: orgId, portal_id: portalId, document_id: docId, data: { ...job.data, id, title, documentId: docId }, extracted: job.extracted ?? {}, version: 1 }; });
  for (let i = 0; i < docs.length; i += 200) await sql`insert into documents ${sql(docs.slice(i, i + 200))}`;
  for (let i = 0; i < rows.length; i += 200) await sql`insert into candidates ${sql(rows.slice(i, i + 200) as any)}`;
  if (jobRows.length) await sql`insert into jobs ${sql(jobRows as any)}`;
  people.forEach((p, u) => accounts.push({ email: p.email, org: orgLabel, portal: portalId, role: p.role, ip: `10.${50 + o}.${Math.floor(u / 250)}.${(u % 250) + 1}` }));
});
writeFileSync(out, JSON.stringify({ password: PASSWORD, run: RUN, accounts }), { mode: 0o600 });
console.log(`Seeded ${orgs} organisations, ${accounts.length} people, ${orgs * candidates} candidates, ${orgs * jobs} jobs in ${Math.round((Date.now() - t0) / 1000)} s; run ${RUN}.`);
await sql.end({ timeout: 5 });
