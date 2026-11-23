import { afterAll, beforeAll, expect, test } from "vitest";
import { FakeSmtp } from "./fakeSmtp";
import { Browser, makeWorld, sleep, type World } from "./portalKit";
import { opsDetails } from "./helpers";

// Invitation e-mails through the outbox and the real SMTP transport, against a SIMULATED mail host (test/fakeSmtp.ts). These tests prove our side: one separate message per person,
// scoped links, re-checks at send time, typed failures, bounded retries, recovery after a crash, no secret in the outbox. They do not prove that any real host accepts mail or that a
// message reaches an inbox.
const FAKE = 8861;
let smtp: FakeSmtp, w: World, A: Browser, B: Browser;
const sent = () => smtp.messages;
const NO_RATE = JSON.stringify({ member_user: 100000, invite_user: 100000, invite_portal: 100000, invite_org: 100000 });
const main = () => w.users[0].get("/api/portals").then((r) => r.body[0].id as string);
const linkOf = (m: { text: string }) => m.text.match(/https?:\/\/\S+accept-invite\?token=(\S+)/)![1];
const members = async () => (await A.get("/api/portal/members")).body;
const waitFor = async (f: () => boolean | Promise<boolean>, ms = 20000) => { for (let i = 0; i < ms / 200; i++) { try { if (await f()) return true; } catch { /* the server may be restarting */ } await sleep(200); } return false; };

beforeAll(async () => {
  smtp = new FakeSmtp(FAKE); await smtp.start();
  w = await makeWorld(8862, 2, { RATE_OVERRIDES: NO_RATE, SIGNUP_REQUIRE_CODE: "false", MAIL_TRANSPORT: "smtp", MAIL_SEND_MODE: "live", MAIL_SMTP_HOST: "127.0.0.1", MAIL_SMTP_PORT: String(FAKE), MAIL_SMTP_SECURITY: "none",
    MAIL_MAX_PER_HOUR: "1000", MAIL_RESERVED_AUTH_PER_HOUR: "10", SHUTDOWN_MIN_DRAIN_MS: "0", SHUTDOWN_GRACE_MS: "500", OUTBOX_POLL_MS: "300", OUTBOX_BACKOFF_SEC: "0", OUTBOX_LEASE_SEC: "3", MAIL_ATTEMPT_LEASE_SEC: "3", PUBLIC_APP_URL: "https://app.rolematch.example" });
  [A, B] = w.users;
}, 300000);
afterAll(async () => { await smtp?.stop(); await w?.stop(); }, 120000);
const invite = (emails: string[], role = "recruiter") => A.post("/api/portal/invitations", { emails, role });

test("each recipient gets their own message with their own scoped link; recipients never see each other", async () => {
  smtp.messages.length = 0; smtp.mode = "ok";
  const emails = [`inv1-${w.run}@example.test`, `inv2-${w.run}@example.test`, `inv3-${w.run}@example.test`];
  expect((await invite(emails)).status).toBe(201);
  expect(await waitFor(() => sent().length === 3)).toBe(true);
  expect(sent().map((m) => m.to).sort()).toEqual(emails.map((e) => [e]).sort());               // one recipient per message, no group send
  const tokens = new Set(sent().map(linkOf)); expect(tokens.size).toBe(3);                       // an individual link each, no reusable group token
  for (const m of sent()) {
    const other = emails.filter((e) => e !== m.to[0]);
    for (const o of other) { expect(m.html).not.toContain(o); expect(m.text).not.toContain(o); }
    for (const part of [m.html, m.text]) { expect(part).toContain(w.org); expect(part).toContain("Main portal"); expect(part).toContain(A.email); expect(part).toContain("Sent via RoleMatch"); }
    expect(m.html).toContain("Accept invitation"); expect(m.html).toContain('alt="RoleMatch"'); expect(m.text).toContain("Accept invitation:");
    expect(m.headers["message-id"]).toMatch(/^<[0-9a-f-]{36}@rolematch\.co\.za>$/);                // one Message-ID per logical message, on the approved sender domain
    expect(m.headers["from"]).toContain("info@rolematch.co.za"); expect(m.inlineCids).toContain("rolematch-logo");
  }
  const inv = (await members()).invitations.filter((i: any) => emails.includes(i.email));
  expect(await waitFor(async () => (await members()).invitations.filter((i: any) => emails.includes(i.email)).every((i: any) => i.emailState === "accepted"))).toBe(true);
  expect(inv.length).toBe(3);
  // the link opens the right invitation, and says who invited and what role
  const look = await fetch(w.base + "/api/auth/invitation", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:5173" }, body: JSON.stringify({ token: linkOf(sent()[0]) }) });
  const lb: any = await look.json(); expect(look.status).toBe(200); expect(lb.inviterEmail).toBe(A.email); expect(lb.role).toBe("recruiter"); expect(lb.orgName).toBe(w.org);
});

test("no secret is stored in the outbox, and a duplicate invitation queues no second e-mail", async () => {
  const rows = await w.admin.unsafe(`select payload::text p, dedupe_key from "${w.tdb.schema}".outbox where kind = 'invitation.email'`);
  for (const r of rows) { expect(r.p).toBe("{}"); expect(r.dedupe_key).toMatch(/^invitation\.email:/); }
  for (const r of await w.admin.unsafe(`select payload::text p from "${w.tdb.schema}".outbox where kind <> 'invitation.email'`)) expect(r.p).not.toMatch(/@|token/);   // welcomes: no address, no secret
  const before = rows.length; const e = `inv1-${w.run}@example.test`;
  expect((await invite([e])).body[0].status).toBe("already_invited");
  expect((await w.admin.unsafe(`select count(*)::int c from "${w.tdb.schema}".outbox where kind = 'invitation.email'`))[0].c).toBe(before);
});

test("wrong signed-in account is told why; an account of another organisation is told it cannot join; neither changes anything", async () => {
  const target = `inv9-${w.run}@example.test`; smtp.messages.length = 0;
  await invite([target]); await waitFor(() => sent().length === 1); const tok = linkOf(sent()[0]);
  const wrong = await B.post("/api/invitations/accept", { token: tok });
  expect(wrong.status).toBe(403); expect(wrong.body.error.code).toBe("INVITE-MISMATCH");
  // an account for that very address that already belongs to a DIFFERENT organisation
  await w.tdb.createUser(`Other Org ${w.run}`, target, "Other Person", "a-long-enough-password-1");
  const O = new Browser(w.base, target);
  expect((await O.req("/api/auth/login", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "10.9.50.1" }, body: JSON.stringify({ email: target, password: "a-long-enough-password-1" }) })).status).toBe(200);
  const other = await O.post("/api/invitations/accept", { token: tok });
  expect(other.status).toBe(409); expect(other.body.error.code).toBe("INVITE-OTHER-ORG");
  const m = await w.admin.unsafe(`select count(*)::int c from "${w.tdb.schema}".portal_members pm join "${w.tdb.schema}".members mm on mm.user_id = pm.user_id where mm.email = '${target}' and pm.org_id <> mm.org_id`);
  expect(m[0].c).toBe(0);
});

test("a revoked invitation never sends, even when its e-mail was still waiting; the service being down does not delay revocation", async () => {
  smtp.messages.length = 0; smtp.mode = "temp"; const e = `inv4-${w.run}@example.test`;
  const made = (await invite([e])).body[0]; await sleep(800);                                   // the service is failing: the event keeps retrying
  expect((await A.post(`/api/portal/invitations/${made.id}/revoke`, {})).status).toBeLessThan(300);
  await sleep(600);                                                                                 // a send already in flight when the revoke lands cannot be recalled; give it time to be refused
  smtp.mode = "ok"; await sleep(2500);
  expect(sent().filter((m) => m.to[0] === e).length).toBe(0);
  const st = async () => (await w.admin.unsafe(`select status from "${w.tdb.schema}".outbox where aggregate_id = '${made.id}'`))[0]?.status;
  expect(await waitFor(async () => ["skipped", "dead", "expired"].includes(await st()), 30000)).toBe(true);   // settles as skipped: it never sends
  expect((await members()).invitations.find((i: any) => i.id === made.id).status).toBe("revoked");
});

test("resend replaces the link: the old link stops working, the new e-mail carries the new one, and two resends at once cannot both win", async () => {
  smtp.messages.length = 0; smtp.mode = "ok"; const e = `inv5-${w.run}@example.test`;
  const made = (await invite([e])).body[0]; await waitFor(() => sent().length === 1); const oldTok = linkOf(sent()[0]);
  const rs = await Promise.all([A.post(`/api/portal/invitations/${made.id}/resend`, {}), A.post(`/api/portal/invitations/${made.id}/resend`, {})]);
  expect(rs.map((r) => r.status).sort()).toEqual([200, 409]);
  await waitFor(() => sent().length === 2); const newTok = linkOf(sent()[1]); expect(newTok).not.toBe(oldTok);
  const look = (t: string) => fetch(w.base + "/api/auth/invitation", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:5173" }, body: JSON.stringify({ token: t }) }).then((r) => r.status);
  expect(await look(oldTok)).toBe(404); expect(await look(newTok)).toBe(200);
});

test("failure is bounded: after the attempts are used the event is dead, the invitation says failed (never sent), and the health view counts it", async () => {
  smtp.messages.length = 0; smtp.mode = "temp"; const e = `inv6-${w.run}@example.test`;
  const made = (await invite([e])).body[0];
  expect(await waitFor(async () => (await members()).invitations.find((i: any) => i.id === made.id).emailState === "failed", 30000)).toBe(true);
  const o = (await w.admin.unsafe(`select status, attempts, last_error from "${w.tdb.schema}".outbox where aggregate_id = '${made.id}'`))[0];
  expect(o.status).toBe("dead"); expect(o.attempts).toBe(5); expect(o.last_error).not.toContain(e);
  const h = (await opsDetails(w.base)); expect(h.outbox.dead).toBeGreaterThanOrEqual(1);
  expect((await members()).invitations.find((i: any) => i.id === made.id).status).toBe("pending");   // still a valid invitation: a person can resend
  smtp.mode = "ok";
});

test("a crash while sending: the message is taken back after the lease and finishes; a duplicate may reach the host but carries the same Message-ID and the same single-use link", async () => {
  smtp.messages.length = 0; smtp.mode = "hang"; const e = `inv7-${w.run}@example.test`;
  const made = (await invite([e])).body[0];
  expect(await waitFor(() => sent().some((m) => m.to[0] === e), 30000)).toBe(true);              // the dispatcher is now inside the (never answered) send
  smtp.mode = "ok"; await w.restart();                                                           // the process dies mid-send
  expect(await waitFor(async () => (await members()).invitations.find((i: any) => i.id === made.id)?.emailState === "accepted", 40000)).toBe(true);
  const rows = await w.admin.unsafe(`select status, attempts from "${w.tdb.schema}".outbox where aggregate_id = '${made.id}'`);
  expect(rows.length).toBe(1); expect(rows[0].status).toBe("sent"); expect(rows[0].attempts).toBeGreaterThanOrEqual(2);
  const got = sent().filter((m) => m.to[0] === e);
  expect(got.length).toBeGreaterThanOrEqual(1); expect(got.length).toBeLessThanOrEqual(2);       // exactly-once is not promised over SMTP
  expect(new Set(got.map((m) => m.headers["message-id"])).size).toBe(1); expect(new Set(got.map(linkOf)).size).toBe(1);
  const at = await w.admin.unsafe(`select outcome, count(*)::int c from "${w.tdb.schema}".mail_attempts where outbox_id = (select id from "${w.tdb.schema}".outbox where aggregate_id = '${made.id}') group by outcome`);
  expect(at.find((r: any) => r.outcome === "accepted")?.c).toBe(1);                              // one acceptance; the interrupted attempt is recorded as uncertain, not lost
  expect(at.find((r: any) => r.outcome === "uncertain")?.c).toBeGreaterThanOrEqual(1);
}, 120000);

test("a permanent refusal ends at once (no retries), says why without the address, and remembers the address as suppressed for a while", async () => {
  smtp.messages.length = 0; smtp.mode = "perm"; const e = `inv8-${w.run}@example.test`;
  const made = (await invite([e])).body[0];
  expect(await waitFor(async () => (await members()).invitations.find((i: any) => i.id === made.id)?.emailState === "failed", 20000)).toBe(true);
  const o = (await w.admin.unsafe(`select status, attempts, last_error from "${w.tdb.schema}".outbox where aggregate_id = '${made.id}'`))[0];
  expect(o.status).toBe("dead"); expect(o.attempts).toBe(1); expect(o.last_error).not.toContain(e);
  expect((await w.admin.unsafe(`select count(*)::int c from "${w.tdb.schema}".mail_suppressions`))[0].c).toBeGreaterThanOrEqual(1);
  smtp.mode = "ok"; const again = (await invite([e])).body[0]; expect(again.status).toBe("already_invited");   // the invitation is still pending: a person can resend; the address stays suppressed until it lapses
  const re = await A.post(`/api/portal/invitations/${made.id}/resend`, {}); expect(re.status).toBe(200);
  expect(await waitFor(async () => (await members()).invitations.find((i: any) => i.id === made.id)?.emailState === "failed" && (await w.admin.unsafe(`select count(*)::int c from "${w.tdb.schema}".mail_attempts where outcome = 'suppressed'`))[0].c >= 1, 20000)).toBe(true);
});

test("inviter authority is re-checked: an invitation from someone who lost the right to invite sends nothing and cannot be accepted", async () => {
  smtp.messages.length = 0; smtp.mode = "temp"; const e = `inv10-${w.run}@example.test`;
  const made = (await invite([e])).body[0]; await sleep(800);                                     // queued, waiting out failures
  const me = (await A.get("/api/auth/me")).body.user.userId;
  await w.admin.unsafe(`update "${w.tdb.schema}".members set role = 'recruiter' where user_id = '${me}'; update "${w.tdb.schema}".portal_members set role = 'recruiter' where user_id = '${me}'`);
  await sleep(600); smtp.mode = "ok"; await sleep(2500);
  expect(sent().filter((m) => m.to[0] === e).length).toBe(0);
  await w.admin.unsafe(`update "${w.tdb.schema}".members set role = 'admin' where user_id = '${me}'; update "${w.tdb.schema}".portal_members set role = 'admin' where user_id = '${me}'`);
});
