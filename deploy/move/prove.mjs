// The proof that nothing changes for a person when RoleMatch moves (docs/architecture/DESIGN_JOHANNESBURG_MOVE.md, section 7). It acts as a person would,
// through the API only, on a rehearsal never on live:
//   node deploy/move/prove.mjs before <old address> <state file>    (needs CREATE_USER, the command that makes an organisation's first administrator)
//   ... the copy (deploy/move/copy.sh) ...
//   node deploy/move/prove.mjs after <new address> <state file>
// Before: an account with a password, two sessions (one then signed out), an invitation, one CV read and published. After, on the new home, with the
// same browser cookies: still signed in (the session carries over), the signed-out session still out, the same password works, the invitation still
// opens, and the original file is byte for byte the same. The state file holds the test account's password and cookies: it is written readable by its
// owner only, and is for the rehearsal's invented account alone.
import { execFileSync } from "node:child_process";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const [phase, base, stateFile] = process.argv.slice(2);
if (!["before", "after"].includes(phase) || !base || !stateFile) { console.error("usage: prove.mjs before|after <address> <state file>"); process.exit(2); }
if (/rolematch\.co\.za/.test(base) && !process.env.PROVE_ON_NEXT) { console.error("refused: this proof makes accounts and records; it runs on a rehearsal, not on a RoleMatch address"); process.exit(2); }
const sha = (b) => createHash("sha256").update(b).digest("hex");

const jar = (cookies = {}) => ({
  cookies,
  header() { return Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join("; "); },
  take(res) { for (const c of res.headers.getSetCookie?.() ?? []) { const [pair] = c.split(";"); const i = pair.indexOf("="); const k = pair.slice(0, i), v = pair.slice(i + 1); if (v === "" || /max-age=0/i.test(c)) delete this.cookies[k]; else this.cookies[k] = v; } },
});
async function call(j, method, path, body, headers = {}) {
  const init = { method, headers: { ...headers, ...(j ? { cookie: j.header() } : {}) }, redirect: "manual" };
  if (body instanceof FormData) init.body = body; else if (body !== undefined) { init.body = JSON.stringify(body); init.headers["content-type"] = "application/json"; }
  const res = await fetch(base.replace(/\/$/, "") + path, init); j?.take(res);
  const buf = Buffer.from(await res.arrayBuffer()); let json = null; try { json = JSON.parse(buf.toString()); } catch {}
  return { status: res.status, json, buf };
}
const results = []; const check = (what, ok, detail = "") => { results.push({ what, ok: !!ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${what}${detail ? `  (${detail})` : ""}`); };

if (phase === "before") {
  if (!process.env.CREATE_USER) { console.error("CREATE_USER is not set"); process.exit(2); }
  const run = randomBytes(4).toString("hex"), email = `move-proof-${run}@example.test`, password = `Pw-${randomBytes(12).toString("base64url")}-1!`, invitee = `move-invitee-${run}@example.test`;
  execFileSync("sh", ["-c", `${process.env.CREATE_USER} "$1" "$2" "$3" "$4"`, "sh", `Move Proof ${run}`, email, "Move Proof", password], { stdio: "pipe" });
  const a = jar(), b = jar();
  check("an account signs in with its password", (await call(a, "POST", "/api/auth/login", { email, password })).status === 200);
  const me = await call(a, "GET", "/api/auth/me"); const userId = me.json?.user?.userId, portalId = me.json?.portals?.[0]?.id;
  check("it is signed in, in its portal", me.status === 200 && userId && portalId);
  check("a second session signs in", (await call(b, "POST", "/api/auth/login", { email, password })).status === 200);
  await call(b, "POST", "/api/auth/logout");
  check("the second session, signed out, is refused", (await call(b, "GET", "/api/auth/me")).status === 401);
  // Signing out ends every one of the person's sessions with the sign-in service (supabase.ts signOut), so the browser that stays signed in signs in after it.
  a.cookies = {};
  check("a browser signs in again after that sign-out", (await call(a, "POST", "/api/auth/login", { email, password })).status === 200 && (await call(a, "GET", "/api/auth/me")).status === 200);
  const inv = await call(a, "POST", "/api/portal/invitations", { emails: [invitee], role: "recruiter" }, { "x-portal-id": portalId });
  // The link's secret is shown once, to the inviter; where the reply leaves it out, it is rebuilt as the server builds it (the rehearsal's own link secret).
  const id = inv.json?.[0]?.id, secret = process.env.LINK_SECRET_FOR_PROOF;
  const token = inv.json?.[0]?.token ?? (id && secret ? createHmac("sha256", secret).update(`invitation:${id}:1`).digest("base64url") : null);
  check("an invitation is sent", inv.status === 201 && inv.json?.[0]?.status === "invited");
  check("its link opens", !!token && (await call(null, "POST", "/api/auth/invitation", { token })).status === 200);
  const form = new FormData(); form.append("kind", "cv");
  form.append("file", new Blob([`Naledi Proof\nnaledi.proof.${run}@example.test\nJohannesburg\n\nExperience\nData Analyst, Umber Grove Industrial Group, 2019 to 2024\n- Built monthly reporting in SQL and Power BI.\n\nSkills\nSQL, Power BI, Excel\n`], { type: "text/plain" }), "naledi-proof.txt");
  const up = await call(a, "POST", "/api/documents", form, { "x-portal-id": portalId }); const docId = up.json?.id;
  let doc = null; for (const end = Date.now() + 240_000; Date.now() < end; await new Promise((r) => setTimeout(r, 3000))) { doc = (await call(a, "GET", `/api/documents/${docId}`, undefined, { "x-portal-id": portalId })).json; if (doc?.status === "published" || doc?.status === "exception") break; }
  check("a CV is read and published", doc?.status === "published", doc?.status ?? `upload ${up.status}`);
  const orig = await call(a, "GET", `/api/documents/${docId}/original`, undefined, { "x-portal-id": portalId });
  check("its original opens", orig.status === 200 && orig.buf.length > 0);
  check("that browser is still signed in at the end", (await call(a, "GET", "/api/auth/me")).json?.user?.userId === userId);
  writeFileSync(stateFile, JSON.stringify({ email, password, userId, portalId, token, invitee, docId, originalSha: sha(orig.buf), a: a.cookies, b: b.cookies }), { mode: 0o600 });
} else {
  const s = JSON.parse(readFileSync(stateFile, "utf8")); const a = jar({ ...s.a }), b = jar({ ...s.b });
  const me = await call(a, "GET", "/api/auth/me");
  check("the browser signed in before the move is still signed in, as the same person", me.status === 200 && me.json?.user?.userId === s.userId);
  check("its session was renewed by the new home (new sign-in cookies set)", a.cookies.th_access && a.cookies.th_access !== s.a.th_access);
  check("the session signed out before the move stays signed out", (await call(b, "GET", "/api/auth/me")).status === 401);
  check("the same password signs in", (await call(jar(), "POST", "/api/auth/login", { email: s.email, password: s.password })).status === 200);
  check("a wrong password is still refused", (await call(jar(), "POST", "/api/auth/login", { email: s.email, password: s.password + "x" })).status === 401);
  const inv = await call(null, "POST", "/api/auth/invitation", { token: s.token });
  check("the invitation sent before the move still opens, for the same person", inv.status === 200 && inv.json?.email === s.invitee);
  const orig = await call(a, "GET", `/api/documents/${s.docId}/original`, undefined, { "x-portal-id": s.portalId });
  check("the original file is byte for byte the same", orig.status === 200 && sha(orig.buf) === s.originalSha);
  const doc = await call(a, "GET", `/api/documents/${s.docId}`, undefined, { "x-portal-id": s.portalId });
  check("the CV's record is there, published", doc.status === 200 && doc.json?.status === "published");
}
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed} of ${results.length} passed`);
process.exit(failed ? 1 : 0);
