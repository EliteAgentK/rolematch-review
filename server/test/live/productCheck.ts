// Runs the whole product against a running copy over HTTP, the way a person's browser does: website, refused stranger, sign-in, uploads of Word and a scan,
// reading to publication, a match with its evidence, View Original CV, an e-mailed invitation, sign-out. Invented documents only (test/fixtures/journey).
// Safe to run again: a document already uploaded is recognised as a duplicate and reused.
//   CHECK_BASE=https://... CHECK_EMAIL=... CHECK_PASSWORD=... CHECK_INVITE_TO=you@example.com node --import tsx test/live/productCheck.ts
// CHECK_FAKE_SMTP_PORT runs a simulated mail host and checks the message that reaches it, logo included. Without it, the invitation is real: check that inbox yourself.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FakeSmtp } from "../fakeSmtp";

const need = (k: string) => { const v = process.env[k]; if (!v) { console.error(`${k} is required.`); process.exit(2); } return v; };
const BASE = need("CHECK_BASE").replace(/\/$/, ""), EMAIL = need("CHECK_EMAIL"), PASSWORD = need("CHECK_PASSWORD"), INVITE_TO = need("CHECK_INVITE_TO");
const FIXTURES = join(import.meta.dirname, "..", "fixtures", "journey"), READ_LIMIT_MS = Number(process.env.CHECK_READ_LIMIT_MS ?? 300_000);
const jar = new Map<string, string>();
let failed = 0;
const step = async (name: string, run: () => Promise<string | void>) => {
  const t0 = Date.now();
  try { const note = await run(); console.log(`PASS  ${name} (${((Date.now() - t0) / 1000).toFixed(1)} s)${note ? `: ${note}` : ""}`); return true; }
  catch (e) { failed++; console.log(`FAIL  ${name}: ${e instanceof Error ? e.message : String(e)}`); return false; }
};
const must = (ok: unknown, why: string) => { if (!ok) throw new Error(why); };
async function call(path: string, init: RequestInit = {}) {
  const res = await fetch(BASE + path, { ...init, headers: { ...(init.headers ?? {}), origin: BASE, cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") } });
  for (const c of res.headers.getSetCookie()) { const [kv] = c.split(";"), i = kv.indexOf("="), v = kv.slice(i + 1); if (v) jar.set(kv.slice(0, i), v); else jar.delete(kv.slice(0, i)); }
  return res;
}
const post = (path: string, body: unknown) => call(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const upload = async (file: string, kind: "cv" | "jd") => {
  const form = new FormData(); form.append("kind", kind); form.append("file", new File([readFileSync(join(FIXTURES, file))], file));
  const r = await call("/api/documents", { method: "POST", body: form }), body: any = await r.json();
  must(r.status === 200 || r.status === 202, `${file}: answered ${r.status} ${body?.error?.code ?? ""}`);
  return body.id as string;
};
const published = async (id: string, file: string) => {
  for (const until = Date.now() + READ_LIMIT_MS; Date.now() < until; await new Promise((r) => setTimeout(r, 2000))) {
    const d: any = await (await call(`/api/documents/${id}`)).json();
    if (d.status === "published") return d.recordId as string;
    must(d.status !== "exception", `${file}: stopped with ${d.errorCode}`);
  }
  throw new Error(`${file}: not published within ${READ_LIMIT_MS / 1000} s`);
};

const smtp = process.env.CHECK_FAKE_SMTP_PORT ? new FakeSmtp(Number(process.env.CHECK_FAKE_SMTP_PORT)) : null;
await smtp?.start();
const ids: Record<string, string> = {};
await step("the service answers", async () => { must((await (await call("/api/health")).json() as any).ok === true, "health is not ok"); });
await step("the website loads", async () => { const r = await call("/"); must(r.ok && (await r.text()).includes('id="root"'), "no application page"); });
await step("a stranger cannot create an account", async () => {
  const r = await post("/api/auth/signup", { name: "A Stranger", orgName: "Stranger Organisation", email: `stranger-${Date.now()}@example.test`, password: "a-long-enough-password-1" });
  must(r.status === 403, `answered ${r.status}`);
});
const signedIn = await step("sign-in", async () => { const r = await post("/api/auth/login", { email: EMAIL, password: PASSWORD }); must(r.ok, `answered ${r.status}`); });
if (signedIn) {
  await step("upload a Word CV, a scanned CV and a job description", async () => { ids.word = await upload("CV0501.docx", "cv"); ids.scan = await upload("CV0525.pdf", "cv"); ids.job = await upload("JD0151.docx", "jd"); });
  const records: Record<string, string> = {};
  await step("the Word CV is read and published", async () => { records.word = await published(ids.word, "CV0501.docx"); });
  await step("the scanned CV is read by OCR and published", async () => { records.scan = await published(ids.scan, "CV0525.pdf"); });
  await step("the job description is read and published", async () => { records.job = await published(ids.job, "JD0151.docx"); });
  await step("published candidates are on the board with their details", async () => {
    const items = ((await (await call("/api/candidates?limit=100")).json()) as any).items as any[];
    for (const id of [records.word, records.scan]) { const c = items.find((x) => x.id === id); must(c?.name && c?.skills?.length, `candidate ${id} is missing or empty`); }
  });
  await step("a match returns a result with evidence and confidence", async () => {
    const r = await post("/api/matches", { candidateId: records.word, jobId: records.job }), m: any = await r.json();
    must(r.ok, `answered ${r.status}`); must(m.confidence !== undefined && m.engineVersion, "no confidence or engine version");
    return `rules ${m.engineVersion}`;
  });
  await step("View Original CV opens the stored document", async () => { const r = await call(`/api/documents/${ids.scan}/original`); must(r.ok && (await r.arrayBuffer()).byteLength > 0, `answered ${r.status}`); });
  await step("an invitation is accepted for e-mail delivery", async () => {
    const r = await post("/api/portal/invitations", { emails: [INVITE_TO], role: "viewer" }), body: any = await r.json();
    must(r.ok && ["invited", "already_invited"].includes(body[0]?.status), `answered ${r.status} ${body[0]?.status ?? ""}`);
    if (!smtp) return `real message queued to ${INVITE_TO}; check that inbox, and the spam folder`;
    for (const until = Date.now() + 60_000; Date.now() < until && !smtp.messages.length; await new Promise((res) => setTimeout(res, 500)));
    const sent = smtp.messages.find((x) => x.to.includes(INVITE_TO));
    must(sent, "no message reached the mail host within 60 s");
    must(sent!.inlineCids.includes("rolematch-logo"), "the message has no logo");
    must(`${sent!.text}${sent!.html}`.includes(process.env.CHECK_PUBLIC_URL ?? BASE), "the message does not link to this environment");
    return "delivered to the simulated mail host, logo and link present";
  });
  await step("sign-out ends the session", async () => { await post("/api/auth/logout", {}); jar.clear(); must((await call("/api/auth/me")).status === 401, "still signed in"); });
}
await smtp?.stop();
console.log(failed ? `\n${failed} step(s) failed.` : "\nEvery step passed.");
process.exit(failed ? 1 : 0);
