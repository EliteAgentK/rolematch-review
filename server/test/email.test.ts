import { createHmac } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import postgres from "postgres";
import { renderVerificationEmail, renderWelcomeEmail } from "../src/email";
import { adminDeleteUser } from "../src/supabase";
import { setupTestDb, type TestDb, sleep, spawnProc, type Proc } from "./helpers";
import { FakeSmtp, type Captured } from "./fakeSmtp";

// ---------------------------------------------------------------- the template
test("the email carries the RoleMatch brand, the code, the expiry and a plain-text version", () => {
  const m = renderVerificationEmail({ code: "12345678", name: "Jordan Example", expiryMinutes: 60 });
  expect(m.subject).toBe("12345678 is your RoleMatch verification code");
  for (const colour of ["#007BA7", "#F55F3C", "#FFD600", "#3DB58C", "#5F3FD1", "#FF5555"]) expect(m.html).toContain(colour); // the wordmark colours
  expect(m.html).toContain('src="cid:rolematch-logo"');
  expect(m.html).toContain(">12345678<");
  expect(m.html).toContain("Hi Jordan,");
  expect(m.html).toContain("expires in <strong>1 hour</strong>");
  expect(m.text).toContain("12345678");
  expect(m.text).toContain("expires in 1 hour");
  expect(m.html).not.toMatch(/supabase/i); // nobody sees another company's name
  expect(m.text).not.toMatch(/supabase/i);
});

test("both code e-mails say the right closing line in both parts, never a template placeholder (review 16 Nov 2026: every sign-up e-mail showed \"${words.ignore}\")", () => {
  const verify = renderVerificationEmail({ code: "12345678" }), reset = renderVerificationEmail({ code: "12345678", purpose: "reset" });
  for (const m of [verify, reset]) for (const part of [m.html, m.text]) expect(part).not.toMatch(/\$\{|words\./);
  for (const part of [verify.html, verify.text]) expect(part).toContain("Didn't create a RoleMatch account?");
  for (const part of [reset.html, reset.text]) { expect(part).toContain("Didn't ask to reset your password?"); expect(part).not.toContain("Didn't create a RoleMatch account?"); }
});
test("by default the e-mail tells people the code is valid for 15 minutes", () => {
  const m = renderVerificationEmail({ code: "123456", name: "Jordan" });
  expect(m.html).toContain("expires in <strong>15 minutes</strong>"); expect(m.text).toContain("expires in 15 minutes");
});

test("names are escaped so a hostile name cannot inject markup", () => {
  const m = renderVerificationEmail({ code: "123456", name: '<script>alert(1)</script> "Eve"', expiryMinutes: 30 });
  expect(m.html).not.toContain("<script>");
  expect(m.html).toContain("expires in <strong>30 minutes</strong>");
});

test("only digits can ever appear as the code", () => {
  expect(() => renderVerificationEmail({ code: "12<b>34", name: "x" })).toThrow();
  expect(() => renderVerificationEmail({ code: "", name: "x" })).toThrow();
});

test("the welcome e-mail: three variants, escaped names, no provider name, a plain-text twin, and only statements the product can stand behind", () => {
  const base = { name: '<b>Ann</b> "Lee"', orgName: "Acme & <Co>", portalName: "Main portal", link: "https://app.rolematch.example/dashboard", joinedAt: new Date("2026-10-30T05:00:00Z") };
  const admin = renderWelcomeEmail({ ...base, variant: "admin" });
  expect(admin.subject).toBe('Welcome to RoleMatch, <b>Ann</b>: Acme & <Co> is ready');                // the subject is plain text (not HTML); line breaks are refused elsewhere
  expect(admin.html).not.toContain("<b>Ann</b>"); expect(admin.html).toContain("&lt;b&gt;Ann&lt;/b&gt;"); expect(admin.html).toContain("Acme &amp; &lt;Co&gt;");
  expect(admin.html).toContain("Bring in your team"); expect(admin.text).toContain("Happy hunting. May your shortlists be short and your matches well evidenced.");
  expect(admin.text).toContain("never rejects, shortlists or hires anyone on its own"); expect(admin.html).toContain('src="cid:rolematch-logo"');
  for (const m of [admin.html, admin.text]) expect(m).not.toMatch(/supabase|guarantee|compliant|AI-powered/i);
  const member = renderWelcomeEmail({ ...base, variant: "member", inviterEmail: "boss@acme.example", role: "recruiter" });
  expect(member.subject).toBe("Welcome to RoleMatch, <b>Ann</b>: you have joined Main portal"); expect(member.text).toContain("boss@acme.example added you to Main portal at Acme & <Co>");
  expect(member.html).not.toContain("Bring in your team");
  const viewer = renderWelcomeEmail({ ...base, variant: "hiring_manager", role: "hiring_manager", localOnly: true });
  expect(viewer.html).toContain("Read the evidence"); expect(viewer.html).not.toContain("Add candidates"); expect(viewer.text).toContain("LOCAL TEST LINK");
  expect(renderWelcomeEmail({ ...base, name: "Ann\r\nBcc: x@y.z", variant: "admin" }).subject).not.toMatch(/[\r\n]/);
});

// ---------------------------------------------------------------- real sending path (nodemailer) against a SIMULATED mail host and real Supabase Auth
const API = 8795, FAKE = 8796, base = `http://localhost:${API}`;
const run = crypto.randomUUID().slice(0, 8);
const addr = (n: string) => `em-${run}-${n}@example.test`;
let tdb: TestDb, server: Proc, smtp: FakeSmtp;
const sent = (): Captured[] => smtp.messages;

const post = (path: string, body: unknown) => fetch(base + path, { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:5173", "x-forwarded-for": "10.1.1.1" }, body: JSON.stringify(body) });
const codeOf = (mail: Captured) => String(mail.text).match(/\b(\d{6,10})\b/)![1];
const good = (n: string) => ({ name: "Email Tester", orgName: `Email Org ${n} ${run}`, email: addr(n), password: "a-long-enough-password-1" });

beforeAll(async () => {
  smtp = new FakeSmtp(FAKE); await smtp.start();
  // No SIGNUP_DEV_CODE here: this is the production path, with only the mail host replaced by a local simulation.
  tdb = await setupTestDb({ PORT: String(API), TRUST_PROXY: "true", SIGNUP_DEV_CODE: "false", MAIL_TRANSPORT: "smtp", MAIL_SEND_MODE: "live", MAIL_SMTP_HOST: "127.0.0.1", MAIL_SMTP_PORT: String(FAKE), MAIL_SMTP_SECURITY: "none", MAIL_REPLY_TO: "support@rolematch.test", RESEND_COOLDOWN_SECONDS: "6", PUBLIC_APP_URL: "https://app.rolematch.example" });   // live mode refuses local-only links (welcome, invitation)
  server = spawnProc(["tsx", "src/index.ts"], { env: { ...tdb.env, RATE_OVERRIDES: JSON.stringify({ signup_ip: 500 }) }, stdout: "ignore", stderr: "ignore" });
  for (let i = 0; i < 300; i++) { try { if ((await fetch(base + "/api/health")).ok) break; } catch {} await sleep(100); }
}, 120000);
afterAll(async () => {
  server?.kill(); await smtp?.stop(); await tdb?.teardown();
  const admin = postgres(process.env.DATABASE_URL!, { max: 1 });
  try { for (const u of await admin.unsafe(`select id from auth.users where email like 'em-${run}-%@example.test'`)) await adminDeleteUser(u.id); } finally { await admin.end(); }
}, 90000);

test("sign-up sends exactly one branded message over SMTP from the approved sender with the logo inline and a plain-text part, and the code in it works", async () => {
  expect(await (await fetch(base + "/api/health")).json()).toEqual({ ok: true }); // the public answer reveals nothing about how this server is set up
  expect((await post("/api/auth/signup", good("one"))).status).toBe(202);
  expect(sent().length).toBe(1);
  const mail = sent()[0];
  expect(mail.to).toEqual([addr("one")]);
  expect(mail.headers["from"]).toContain("info@rolematch.co.za");   // the approved sender identity
  expect(mail.headers["reply-to"]).toBe("support@rolematch.test");
  expect(mail.headers["subject"]).toContain("is your RoleMatch verification code");
  expect(mail.html).toContain("cid:rolematch-logo"); expect(mail.inlineCids).toContain("rolematch-logo");
  expect(mail.text).toMatch(/\d{6,10}/);
  const ok = await post("/api/auth/verify", { email: addr("one"), code: codeOf(mail) });
  expect(ok.status).toBe(200);
  expect(((await ok.json()) as any).user.role).toBe("admin");
});

test("a new code can be requested; it replaces the old one, and the cooldown is enforced", async () => {
  const email = addr("again");
  // Only this address's code e-mails are counted: a welcome for an earlier test's sign-up can arrive at any moment (seen on a disposable local stack, 2026-11-02).
  const codesTo = () => sent().filter((m) => m.to[0] === email && /verification code/.test(m.headers.subject ?? ""));
  await post("/api/auth/signup", good("again"));
  const first = codeOf(codesTo().at(-1)!);
  const before = codesTo().length;
  expect((await post("/api/auth/resend", { email })).status).toBe(429); // too soon after the first email
  expect(codesTo().length).toBe(before);
  await sleep(6500); // the test server uses a 6-second cooldown
  expect((await post("/api/auth/resend", { email })).status).toBe(202);
  expect(codesTo().length).toBe(before + 1);
  const second = codeOf(codesTo().at(-1)!);
  expect(second).not.toBe(first);
  expect((await post("/api/auth/verify", { email, code: first })).status).toBe(401); // the old code no longer works
  expect((await post("/api/auth/verify", { email, code: second })).status).toBe(200);
});

test("resending never emails strangers or people who already have a confirmed account", async () => {
  const codes = () => sent().filter((m) => /verification code/.test(m.headers.subject ?? "")).length;   // welcomes for earlier sign-ups may still arrive meanwhile
  const before = codes();
  await sleep(6500);
  expect((await post("/api/auth/resend", { email: addr("nobody") })).status).toBe(202); // same answer, nothing sent
  expect((await post("/api/auth/resend", { email: addr("one") })).status).toBe(202); // confirmed in the first test
  expect(codes()).toBe(before);
});

test("an address that already has an account is told so, plainly, and gets no email (owner, 8 Nov 2026)", async () => {
  const before = sent().length;
  const res = await post("/api/auth/signup", good("one"));
  expect(res.status).toBe(409);
  expect((await res.json()).error?.message ?? "").toMatch(/already exists.*Sign in/);
  expect(sent().length).toBe(before);
});

test("if the mail host refuses the message, the person is told clearly and nothing is created", async () => {
  smtp.mode = "temp";
  const res = await post("/api/auth/signup", good("fail"));
  smtp.mode = "ok";
  expect(res.status).toBe(503);
  expect(((await res.json()) as any).error.code).toBe("INT-001");
});

test("every send is recorded as an attempt with no readable address and no code, and the health view shows mail state to administrators only", async () => {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    const all = await sql.unsafe(`select class, template, outcome, recipient_hash, recipient_domain, response from "${tdb.schema}".mail_attempts order by started_at`);
    for (const r of all.filter((x: any) => x.template === "welcome")) { expect(r.class).toBe("notification"); expect(JSON.stringify(r)).not.toMatch(/em-[0-9a-f]{8}-/); }
    const rows = all.filter((x: any) => x.template !== "welcome");
    expect(rows.length).toBeGreaterThanOrEqual(4);
    for (const r of rows) { expect(r.class).toBe("authentication"); expect(r.template).toBe("verification"); expect(String(r.recipient_hash)).toMatch(/^[0-9a-f]{64}$/); expect(r.recipient_domain).toBe("example.test"); expect(JSON.stringify(r)).not.toMatch(/em-[0-9a-f]{8}-/); }
    expect(rows.some((r: any) => r.outcome === "accepted")).toBe(true); expect(rows.some((r: any) => r.outcome === "temporary_failure")).toBe(true);
  } finally { await sql.end(); }
  expect((await fetch(base + "/api/health/details")).status).toBe(404);   // not even confirmed to exist to anyone but the platform operator
});

test("a code works exactly once: six simultaneous attempts with the right code create exactly one account and one organisation, and the used code is refused afterwards", async () => {
  const email = addr("single");
  await post("/api/auth/signup", good("single"));
  const code = codeOf(sent()[sent().length - 1]);
  const results = await Promise.all(Array.from({ length: 6 }, () => post("/api/auth/verify", { email, code })));
  const statuses = results.map((r) => r.status).sort();
  expect(statuses.filter((x) => x === 200).length).toBe(1);                           // one winner
  // everyone else is told the code is not valid (no new information about why), or, past the five guesses that may be checked at once, to wait: each
  // guess is counted before it is checked (ratelimit.ts guess; security review, 23 Nov 2026), so a sixth at the same moment is held back
  expect(statuses.filter((x) => x !== 200).every((x) => x === 401 || x === 429)).toBe(true);
  expect((await post("/api/auth/verify", { email, code })).status).toBe(401);          // and it stays used
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    expect((await sql.unsafe(`select count(*)::int c from "${tdb.schema}".members where email = '${email}'`))[0].c).toBe(1);
    expect((await sql.unsafe(`select count(*)::int c from "${tdb.schema}".orgs where name = 'Email Org single ${run}'`))[0].c).toBe(1);
  } finally { await sql.end(); }
});

const S = () => `"${tdb.schema}"`;
const q = async <T,>(f: (sql: ReturnType<typeof postgres>) => Promise<T>) => { const sql = postgres(process.env.DATABASE_URL!, { max: 1 }); try { return await f(sql); } finally { await sql.end(); } };
const latestTo = (email: string) => sent().filter((m) => m.to[0] === email && /verification code/.test(m.headers.subject ?? "")).at(-1)!;   // codes only: a welcome may follow
const welcomesTo = (email: string) => sent().filter((m) => m.to[0] === email && /^Welcome to RoleMatch/.test(m.headers.subject ?? ""));

test("a code lives 15 minutes, judged on ITS OWN issue time: after that it is refused even though the provider would still accept it, and a new code can always be requested", async () => {
  const email = addr("expiry");
  await post("/api/auth/signup", good("expiry"));
  const old = codeOf(latestTo(email));
  // SIMULATED time: this code's issue time is moved back (the provider's own lifetime is still 1 hour, so only RoleMatch's 15-minute rule can refuse it)
  await q((sql) => sql.unsafe(`update ${S()}.signup_challenges set issued_at = now() - interval '16 minutes' where email = '${email}'`));
  expect((await post("/api/auth/verify", { email, code: old })).status).toBe(401);
  await sleep(6500);                                                                       // the 6-second test cooldown
  expect((await post("/api/auth/resend", { email })).status).toBe(202);                    // resending is available even though the code had expired
  const fresh = codeOf(latestTo(email)); expect(fresh).not.toBe(old);
  expect((await post("/api/auth/verify", { email, code: old })).status).toBe(401);          // the old one stays dead
  expect((await post("/api/auth/verify", { email, code: fresh })).status).toBe(200);        // the new one works
});

test("requesting a new code never extends an older one: the older code keeps its own issue time and is refused the moment it is replaced", async () => {
  const email = addr("noextend");
  await post("/api/auth/signup", good("noextend"));
  const a = codeOf(latestTo(email));
  await q((sql) => sql.unsafe(`update ${S()}.signup_challenges set issued_at = now() - interval '14 minutes' where email = '${email}'`));   // still inside ITS 15 minutes
  await sleep(6500);
  expect((await post("/api/auth/resend", { email })).status).toBe(202);
  const b = codeOf(latestTo(email)); expect(b).not.toBe(a);
  const rows = await q((sql) => sql.unsafe(`select superseded_at is not null as superseded, now() - issued_at > interval '13 minutes' as still_old from ${S()}.signup_challenges where email = '${email}' order by issued_at`));
  expect(rows.length).toBe(2); expect(rows.find((r: any) => r.still_old)?.superseded).toBe(true);   // the old row is superseded and its issue time was not moved
  expect((await post("/api/auth/verify", { email, code: a })).status).toBe(401);            // refused although it is only 14 minutes old
  expect((await post("/api/auth/verify", { email, code: b })).status).toBe(200);
});

test("replaying a code that was already used is refused every time but is not a failed guess: it never leads to a lock-out, and wrong codes still do", async () => {
  const email = addr("replay");
  await post("/api/auth/signup", good("replay"));
  const code = codeOf(latestTo(email));
  expect((await post("/api/auth/verify", { email, code })).status).toBe(200);
  for (let i = 0; i < 8; i++) expect((await post("/api/auth/verify", { email, code })).status).toBe(401);   // more than the 5-attempt limit, all still 401
  const wrong = code === "000000" ? "111111" : "000000";
  const answers: number[] = []; for (let i = 0; i < 6; i++) answers.push((await post("/api/auth/verify", { email, code: wrong })).status);
  expect(answers).toEqual([401, 401, 401, 401, 401, 429]);   // the owner's limit: 5 wrong guesses, then refused
});

test("a code the provider refuses is not left spent: the claim is released and the real code still works", async () => {
  const email = addr("released");
  await post("/api/auth/signup", good("released"));
  const real = codeOf(latestTo(email));
  // A challenge RoleMatch recorded but the provider does not recognise, as when the provider has already replaced the code.
  const other = real === "123456" ? "654321" : "123456";
  const hash = createHmac("sha256", process.env.SUPABASE_SERVICE_ROLE_KEY!).update(`signup:${email}:${other}`).digest("hex");
  await q((sql) => sql.unsafe(`insert into ${S()}.signup_challenges (id, email, code_hash) values ('${crypto.randomUUID()}', '${email}', '${hash}')`));
  expect((await post("/api/auth/verify", { email, code: other })).status).toBe(401);
  expect((await q((sql) => sql.unsafe(`select consumed_at from ${S()}.signup_challenges where code_hash = '${hash}'`)))[0].consumed_at).toBeNull();
  expect((await post("/api/auth/verify", { email, code: real })).status).toBe(200);
});

test("resend and verify at the same instant: exactly one of the two codes can ever confirm the account, never both and never an extended old one", async () => {
  const email = addr("race");
  await post("/api/auth/signup", good("race"));
  const a = codeOf(latestTo(email));
  await q((sql) => sql.unsafe(`update ${S()}.signup_challenges set issued_at = now() - interval '10 minutes' where email = '${email}'`));
  await sleep(6500);
  const [resend, verifyA] = await Promise.all([post("/api/auth/resend", { email }), post("/api/auth/verify", { email, code: a })]);
  expect(resend.status).toBe(202); const b = codeOf(latestTo(email));
  const verifyB = await post("/api/auth/verify", { email, code: b });
  const wins = [verifyA.status, verifyB.status].filter((x) => x === 200).length;
  expect(wins).toBe(1);                                                                    // A before the resend landed, or B after: one account, one winner
  expect(await q(async (sql) => (await sql.unsafe(`select count(*)::int c from ${S()}.members where email = '${email}'`))[0].c)).toBe(1);
});

// ---- recovery: the code is correct and the address is confirmed, but creating the organisation / joining the portal fails. Faults are injected in this test's own schema.
const fault = async (table: string, on: boolean) => q(async (sql) => {
  await sql.unsafe(`create table if not exists ${S()}.test_fail (x int);
    create or replace function ${S()}.fail_now() returns trigger language plpgsql as $f$ begin if exists (select 1 from ${S()}.test_fail) then raise exception 'injected failure'; end if; return new; end $f$;
    drop trigger if exists fail_${table} on ${S()}.${table}; create trigger fail_${table} before insert on ${S()}.${table} for each row execute function ${S()}.fail_now();`);
  await sql.unsafe(on ? `insert into ${S()}.test_fail values (1)` : `delete from ${S()}.test_fail`);
});
const count = (sqlText: string) => q(async (sql) => (await sql.unsafe(sqlText))[0].c as number);

test("RECOVERY (organisation): the code works but setting up fails: nothing is half-made, the person is told to sign in, signing in finishes it once, and four simultaneous sign-ins still make exactly one organisation", async () => {
  const one = addr("rec1"), two = addr("rec2"), pw = "a-long-enough-password-1";
  for (const [email, n] of [[one, "rec1"], [two, "rec2"]] as const) await post("/api/auth/signup", good(n));
  const c1 = codeOf(latestTo(one)), c2 = codeOf(latestTo(two));
  await fault("orgs", true);
  const failed = await post("/api/auth/verify", { email: one, code: c1 });
  expect(failed.status).toBe(503); expect(((await failed.json()) as any).error.code).toBe("ONB-001");
  expect(await count(`select count(*)::int c from ${S()}.orgs where name = 'Email Org rec1 ${run}'`)).toBe(0);      // all or nothing: no orphan organisation
  expect(await count(`select count(*)::int c from ${S()}.members where email = '${one}'`)).toBe(0);
  expect((await post("/api/auth/verify", { email: one, code: c1 })).status).toBe(401);                               // the code is spent: the way forward is signing in
  const failed2 = await post("/api/auth/verify", { email: two, code: c2 }); expect(failed2.status).toBe(503);
  await fault("orgs", false);
  const login = await post("/api/auth/login", { email: one, password: pw });
  expect(login.status).toBe(200); expect(((await login.json()) as any).user.role).toBe("admin");
  expect(await count(`select count(*)::int c from ${S()}.orgs where name = 'Email Org rec1 ${run}'`)).toBe(1);
  expect((await post("/api/auth/login", { email: one, password: pw })).status).toBe(200);                           // again: still one
  expect(await count(`select count(*)::int c from ${S()}.orgs where name = 'Email Org rec1 ${run}'`)).toBe(1);
  const racing = await Promise.all(Array.from({ length: 4 }, () => post("/api/auth/login", { email: two, password: pw })));
  expect(racing.map((r) => r.status)).toEqual([200, 200, 200, 200]);
  expect(await count(`select count(*)::int c from ${S()}.orgs where name = 'Email Org rec2 ${run}'`)).toBe(1);
  expect(await count(`select count(*)::int c from ${S()}.members where email = '${two}'`)).toBe(1);
  expect(await count(`select count(*)::int c from ${S()}.portals p join ${S()}.members m on m.org_id = p.org_id where m.email = '${two}'`)).toBe(1);   // one Main portal, not four
});

const cookieOf = (res: Response) => res.headers.getSetCookie().map((c) => c.split(";")[0]).filter((c) => !c.endsWith("=")).join("; ");
test("RECOVERY (invitation): the invited person's code works but joining fails: nothing is half-done, signing in finishes it with one membership, and a withdrawn invitation is explained and can be replaced", async () => {
  const pw = "a-long-enough-password-1", admin = addr("iadm"), invitee = addr("iinv"), invitee2 = addr("iinv2");
  await post("/api/auth/signup", good("iadm")); const av = await post("/api/auth/verify", { email: admin, code: codeOf(latestTo(admin)) }); expect(av.status).toBe(200);
  const cookie = cookieOf(av);
  const invite = (emails: string[]) => fetch(base + "/api/portal/invitations", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:5173", cookie, "x-forwarded-for": "10.1.1.9" }, body: JSON.stringify({ emails, role: "recruiter" }) }).then(async (r) => ({ status: r.status, body: (await r.json()) as any[] }));
  const inv = await invite([invitee]); expect(inv.status).toBe(201);
  // the invited person registers (the invitation is bound to this address), then the join step fails once
  const tok = inv.body[0].token as string;
  expect((await post("/api/auth/signup", { name: "Invited One", email: invitee, password: pw, inviteToken: tok })).status).toBe(202);
  const code = codeOf(latestTo(invitee));
  await fault("portal_members", true);
  const failed = await post("/api/auth/verify", { email: invitee, code }); expect(failed.status).toBe(503); expect(((await failed.json()) as any).error.code).toBe("ONB-001");
  expect(await count(`select count(*)::int c from ${S()}.members where email = '${invitee}'`)).toBe(0);                   // the membership was rolled back with the failed redemption
  expect(await count(`select count(*)::int c from ${S()}.portal_invitations where email = '${invitee}' and accepted_at is not null`)).toBe(0);
  await fault("portal_members", false);
  const login = await post("/api/auth/login", { email: invitee, password: pw }); expect(login.status).toBe(200);
  expect(await count(`select count(*)::int c from ${S()}.members where email = '${invitee}'`)).toBe(1);
  expect(await count(`select count(*)::int c from ${S()}.portal_members pm join ${S()}.members m on m.user_id = pm.user_id where m.email = '${invitee}'`)).toBe(1);
  expect(await count(`select count(*)::int c from ${S()}.portal_invitations where email = '${invitee}' and accepted_at is not null`)).toBe(1);
  expect((await post("/api/auth/login", { email: invitee, password: pw })).status).toBe(200);
  expect(await count(`select count(*)::int c from ${S()}.portal_members pm join ${S()}.members m on m.user_id = pm.user_id where m.email = '${invitee}'`)).toBe(1);   // still one
  // an invitation withdrawn between registering and confirming: explained, never stuck for good
  const inv2 = await invite([invitee2]); const tok2 = inv2.body[0].token as string, id2 = inv2.body[0].id as string;
  await post("/api/auth/signup", { name: "Invited Two", email: invitee2, password: pw, inviteToken: tok2 });
  const code2 = codeOf(latestTo(invitee2));
  await q((sql) => sql.unsafe(`update ${S()}.portal_invitations set revoked_at = now() where id = '${id2}'`));
  const gone = await post("/api/auth/verify", { email: invitee2, code: code2 }); expect(gone.status).toBe(409); expect(((await gone.json()) as any).error.code).toBe("INVITE-INVALIDATED");
  expect((await post("/api/auth/login", { email: invitee2, password: pw })).status).toBe(401);                            // nothing valid to join yet
  const again = await invite([invitee2]); expect(again.body[0].status).toBe("invited");                                   // a fresh invitation for the same address
  expect((await post("/api/auth/login", { email: invitee2, password: pw })).status).toBe(200);                            // signing in now finishes the join
  expect(await count(`select count(*)::int c from ${S()}.members where email = '${invitee2}'`)).toBe(1);
}, 300000);

test("DIRECT PROVIDER CONFIRMATION: the provider's verify endpoint needs no key, but an address confirmed there (outside our expiry and attempt limits) never gets an organisation or a portal", async () => {
  const email = addr("direct"), pw = "a-long-enough-password-1";
  expect((await post("/api/auth/signup", good("direct"))).status).toBe(202);
  const code = codeOf(latestTo(email));
  const supa = String(tdb.env.SUPABASE_URL ?? process.env.SUPABASE_URL).replace(/\/$/, "");
  const direct = await fetch(`${supa}/auth/v1/verify`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "signup", email, token: code }) });   // no apikey header at all
  expect(direct.status).toBe(200);                                                                                     // proven: the bypass path is open, not key-protected
  expect((await post("/api/auth/login", { email, password: pw })).status).toBe(401);                                   // confirmed, but not through us: no onboarding
  expect(await count(`select count(*)::int c from ${S()}.orgs where name = 'Email Org direct ${run}'`)).toBe(0);
  expect(await count(`select count(*)::int c from ${S()}.members where email = '${email}'`)).toBe(0);
  expect((await post("/api/auth/verify", { email, code })).status).toBe(401);                                          // the provider has spent the code
  expect(await count(`select count(*)::int c from ${S()}.members where email = '${email}'`)).toBe(0);
});

test("WELCOME: every completed set-up sends exactly one welcome by itself (after a failed set-up finished by signing in, and after four sign-ins at once too); an invited person gets the member version; a confirmation outside RoleMatch gets none", async () => {
  const wait = async (f: () => boolean) => { for (let i = 0; i < 120 && !f(); i++) await sleep(250); return f(); };
  for (const n of ["rec1", "rec2", "iadm"]) expect(await wait(() => welcomesTo(addr(n)).length >= 1)).toBe(true);
  for (const n of ["iinv", "iinv2"]) expect(await wait(() => welcomesTo(addr(n)).length >= 1)).toBe(true);
  await sleep(3000);                                                                                                       // a duplicate would have had time to arrive
  for (const n of ["rec1", "rec2", "iadm", "iinv", "iinv2"]) expect(welcomesTo(addr(n)).length).toBe(1);
  expect(welcomesTo(addr("rec2"))[0].headers.subject).toMatch(/Email Org rec2 .* is ready$/);
  expect(welcomesTo(addr("iinv"))[0].headers.subject).toMatch(/you have joined/); expect(welcomesTo(addr("iinv"))[0].text).toContain(`${addr("iadm")} added you to`);
  expect(welcomesTo(addr("direct")).length).toBe(0);
  expect(await count(`select count(*)::int c from ${S()}.outbox where kind = 'welcome.email'`)).toBe(await count(`select count(*)::int c from ${S()}.members`));   // one per member, no more
});

test("a resend is refused inside the 60-second wait and allowed after it (the wait is the configured one; the test server shortens it to 6 seconds)", async () => {
  const email = addr("wait");
  await post("/api/auth/signup", good("wait"));
  const before = sent().length;
  expect((await post("/api/auth/resend", { email })).status).toBe(429); expect(sent().length).toBe(before);
  await sleep(6500);
  expect((await post("/api/auth/resend", { email })).status).toBe(202); expect(sent().length).toBe(before + 1);
});
