import { createHash, createSign, generateKeyPairSync, randomBytes, type KeyObject } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { assertionUserVerified, attestationUserVerified, recentEnough, requireVerification } from "../src/passkeys";
import { sleep } from "./helpers";
import { Browser, makeWorld, type World } from "./portalKit";

// Optional passkey sign-in, against the REAL sign-in service (Supabase Auth) on the disposable local stack, using a software authenticator below: real keys and real signatures in the
// real WebAuthn format, so the provider's own checks are what is being exercised. This proves the protocol and RoleMatch's rules. It does NOT prove Face ID on a real device.
// The hosted development project does not have passkeys switched on, so against it these tests say they were skipped.
const b64 = (b: Uint8Array | string) => Buffer.from(b).toString("base64url");
const sha256 = (b: Uint8Array | string) => createHash("sha256").update(b).digest();
const cbBytes = (b: Uint8Array) => (b.length < 24 ? Buffer.from([0x40 + b.length]) : b.length < 256 ? Buffer.from([0x58, b.length]) : Buffer.from([0x59, b.length >> 8, b.length & 255]));
const cbText = (s: string) => Buffer.concat([Buffer.from([0x60 + s.length]), Buffer.from(s)]);
const ORIGIN = "http://localhost:8861", RP_ID = "localhost";

class SoftAuthenticator {
  id = randomBytes(32); keys = generateKeyPairSync("ec", { namedCurve: "P-256" }); count = 0; userHandle = "";
  constructor(public uv = true) {}
  private flags(attested: boolean) { return 0x01 | (this.uv ? 0x04 : 0) | (attested ? 0x40 : 0); }
  private client(type: string, challenge: string, origin: string) { return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false })); }
  create(options: any, o: { origin?: string; rpId?: string } = {}) {
    this.userHandle = options.user.id;
    const jwk = (this.keys.publicKey as KeyObject).export({ format: "jwk" }) as { x: string; y: string };
    const x = Buffer.from(jwk.x, "base64url"), y = Buffer.from(jwk.y, "base64url");
    const cose = Buffer.concat([Buffer.from([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21]), cbBytes(x), x, Buffer.from([0x22]), cbBytes(y), y]);
    const authData = Buffer.concat([sha256(o.rpId ?? RP_ID), Buffer.from([this.flags(true)]), Buffer.alloc(4), Buffer.alloc(16), Buffer.from([0, this.id.length]), this.id, cose]);
    const attestation = Buffer.concat([Buffer.from([0xa3]), cbText("fmt"), cbText("none"), cbText("attStmt"), Buffer.from([0xa0]), cbText("authData"), cbBytes(authData), authData]);
    return { id: b64(this.id), rawId: b64(this.id), type: "public-key", clientExtensionResults: {}, response: { clientDataJSON: b64(this.client("webauthn.create", options.challenge, o.origin ?? ORIGIN)), attestationObject: b64(attestation), transports: ["internal"] } };
  }
  get(options: any, o: { origin?: string; rpId?: string } = {}) {
    this.count++;
    const counter = Buffer.alloc(4); counter.writeUInt32BE(this.count);
    const authData = Buffer.concat([sha256(o.rpId ?? RP_ID), Buffer.from([this.flags(false)]), counter]);
    const clientData = this.client("webauthn.get", options.challenge, o.origin ?? ORIGIN);
    const signature = createSign("SHA256").update(Buffer.concat([authData, sha256(clientData)])).sign(this.keys.privateKey as KeyObject);
    return { id: b64(this.id), rawId: b64(this.id), type: "public-key", clientExtensionResults: {}, response: { clientDataJSON: b64(clientData), authenticatorData: b64(authData), signature: b64(signature), userHandle: this.userHandle } };
  }
}

test("user verification is read from the signed data, on sign-in and on enrolment, and damaged data is refused", () => {
  const options = { challenge: b64(randomBytes(32)), user: { id: b64("user") } };
  expect(assertionUserVerified(new SoftAuthenticator(true).get(options))).toBe(true);
  expect(assertionUserVerified(new SoftAuthenticator(false).get(options))).toBe(false);
  expect(attestationUserVerified(new SoftAuthenticator(true).create(options))).toBe(true);
  expect(attestationUserVerified(new SoftAuthenticator(false).create(options))).toBe(false);
  for (const bad of [undefined, {}, { response: {} }, { response: { authenticatorData: "AAAA" } }]) expect(() => assertionUserVerified(bad)).toThrow();
  for (const bad of [undefined, { response: { attestationObject: "AAAA" } }]) expect(() => attestationUserVerified(bad)).toThrow();
  const asked = requireVerification({ challenge_id: "c", expires_at: 1, options: { challenge: "x", userVerification: "preferred", authenticatorSelection: { userVerification: "preferred", residentKey: "required" } } });
  expect(asked.options.userVerification).toBe("required"); expect(asked.options.authenticatorSelection).toMatchObject({ userVerification: "required", residentKey: "required" });
  const now = 1_000_000_000_000;
  expect(recentEnough(now / 1000 - 60, now)).toBe(true); expect(recentEnough(now / 1000 - 16 * 60, now)).toBe(false);
});

const available = await fetch(`${process.env.SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "" } }).then((r) => r.json()).then((b: any) => b.passkeys_enabled === true).catch(() => false);

describe.skipIf(!available)("passkeys against the real sign-in service", () => {
  const PASSWORD = "a-long-enough-password-1";
  let w: World, one: Browser, two: Browser;
  const signIn = () => new Browser(w.base);
  const options = async (b: Browser) => (await b.post("/api/auth/passkey/options")).body;
  const verify = (b: Browser, challengeId: string, credential: unknown) => b.post("/api/auth/passkey/verify", { challengeId, credential });
  const enrol = async (b: Browser, a: SoftAuthenticator) => { const o = (await b.post("/api/auth/passkeys/options")).body; expect(o.options?.challenge, JSON.stringify(o).slice(0, 200)).toBeTruthy(); return b.post("/api/auth/passkeys/verify", { challengeId: o.challengeId, credential: a.create(o.options) }); };
  const auditCount = async (action: string) => (await w.admin.unsafe(`select count(*)::int c from "${w.tdb.schema}".audit_events where action = $1`, [action]))[0].c;
  const age = async (b: Browser) => { const raw = b.jar.get("th_access")!; return JSON.parse(Buffer.from(raw.split(".")[1], "base64url").toString()); };

  beforeAll(async () => {
    w = await makeWorld(8861, 2, { PASSKEYS_ENABLED: "true", RATE_OVERRIDES: JSON.stringify({ passkey_fail_ip: 1000, passkey_options_ip: 10000 }) });
    [one, two] = w.users;
  }, 200000);
  afterAll(async () => { await w?.stop(); }, 120000);

  test("the page is told passkeys are on; asking the browser for user verification", async () => {
    expect((await new Browser(w.base).get("/api/auth/methods")).body).toEqual({ passkey: true });
    const o = await options(new Browser(w.base));
    expect(o.options.userVerification).toBe("required"); expect(o.options.rpId).toBe("localhost");
    expect(o.options.allowCredentials ?? []).toEqual([]);   // nothing about who has an account is given to a stranger
  });

  test("enrol, then sign in with no e-mail or password: the same session as a password sign-in, and it reaches the same organisation", async () => {
    const a = new SoftAuthenticator();
    const added = await enrol(one, a);
    expect(added.status).toBe(201); expect(added.body.id).toBeTruthy();
    expect(await auditCount("passkey.added")).toBe(1);
    const list = (await one.get("/api/auth/passkeys")).body.passkeys;
    expect(list.length).toBe(1); expect(list[0]).toMatchObject({ id: added.body.id }); expect(list[0].label).toBeTruthy(); expect(list[0].createdAt).toBeTruthy();
    for (const item of list) expect(Object.keys(item).join()).not.toMatch(/public|key|credential/i);   // no key material leaves

    const original = await one.get("/api/auth/me");
    const fresh = signIn();
    const o = await options(fresh);
    const res = await verify(fresh, o.challengeId, a.get(o.options));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(fresh.jar.get("th_access")).toBeTruthy(); expect(fresh.jar.get("th_refresh")).toBeTruthy();   // real cookies from the sign-in service, not a flag in the browser
    const me = await fresh.get("/api/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.user.userId).toBe(original.body.user.userId); expect(me.body.user.orgId).toBe(original.body.user.orgId);
    expect(me.body.portals.map((p: any) => p.id)).toEqual(original.body.portals.map((p: any) => p.id));
    expect((await age(fresh)).amr?.[0]?.method).toBeTruthy();
    // one device at a time (owner, 16 Nov 2026): the passkey sign-in ended the password one; the new browser is now this person's
    expect((await one.get("/api/auth/me")).status).toBe(401);
    one = fresh;
    expect(await w.admin.unsafe(`select 1 from "${w.tdb.schema}".audit_events where action = 'auth.login' and detail->>'via' = 'passkey'`)).toHaveLength(1);
    const text = JSON.stringify(await w.admin.unsafe(`select detail from "${w.tdb.schema}".audit_events where action like 'passkey.%' or detail->>'via' = 'passkey'`));
    expect(text).not.toMatch(/signature|attestation|clientData|public/i);
  }, 60000);

  test("a challenge works once, an expired one is refused, and the wrong origin or site is refused", async () => {
    const a = new SoftAuthenticator(); expect((await enrol(two, a)).status).toBe(201);
    const b = new Browser(w.base);
    const o1 = await options(b);
    const assertion = a.get(o1.options);
    expect((await verify(b, o1.challengeId, assertion)).status).toBe(200);
    two = b;   // one device at a time: this sign-in ended the earlier one
    expect((await verify(new Browser(w.base), o1.challengeId, assertion)).status).toBe(401);                                  // replayed
    const o2 = await options(new Browser(w.base));
    await w.admin.unsafe(`update auth.webauthn_challenges set expires_at = now() - interval '1 minute' where id = $1`, [o2.challengeId]);
    expect((await verify(new Browser(w.base), o2.challengeId, a.get(o2.options))).status).toBe(401);                          // expired
    const o3 = await options(new Browser(w.base));
    expect((await verify(new Browser(w.base), o3.challengeId, a.get(o3.options, { origin: "https://evil.example" }))).status).toBe(401);   // wrong origin
    const o4 = await options(new Browser(w.base));
    expect((await verify(new Browser(w.base), o4.challengeId, a.get(o4.options, { rpId: "evil.example" }))).status).toBe(401);             // wrong relying party
    const o5 = await options(new Browser(w.base));
    expect((await verify(new Browser(w.base), "00000000-0000-4000-8000-000000000000", a.get(o5.options))).status).toBe(401);   // a challenge that does not exist
    const o6 = await options(new Browser(w.base));
    expect((await verify(new Browser(w.base), o6.challengeId, new SoftAuthenticator().get(o6.options))).status).toBe(401);     // a key nobody enrolled
  }, 60000);

  test("no user verification: refused at sign-in and at enrolment, with a reason", async () => {
    const weak = new SoftAuthenticator(false);
    const o = (await two.post("/api/auth/passkeys/options")).body;
    const added = await two.post("/api/auth/passkeys/verify", { challengeId: o.challengeId, credential: weak.create(o.options) });
    expect(added.status).toBe(400); expect(JSON.stringify(added.body)).toMatch(/AUTH-PASSKEY-VERIFICATION/);
    const a = new SoftAuthenticator(); expect((await enrol(two, a)).status).toBe(201);
    a.uv = false;
    const oo = await options(new Browser(w.base));
    const res = await verify(new Browser(w.base), oo.challengeId, a.get(oo.options));
    expect(res.status).toBe(401); expect(JSON.stringify(res.body)).toMatch(/AUTH-PASSKEY-VERIFICATION/);
  }, 60000);

  test("cross-account: a challenge issued to one person cannot enrol on another, and nobody can list or remove another person's passkey", async () => {
    const o = (await one.post("/api/auth/passkeys/options")).body;
    const res = await two.post("/api/auth/passkeys/verify", { challengeId: o.challengeId, credential: new SoftAuthenticator().create(o.options) });
    expect(res.status).toBe(400);
    const mine = (await one.get("/api/auth/passkeys")).body.passkeys;
    const theirs = (await two.get("/api/auth/passkeys")).body.passkeys;
    expect(mine.length).toBeGreaterThan(0);
    for (const p of mine) expect(theirs.map((x: any) => x.id)).not.toContain(p.id);
    expect((await two.del(`/api/auth/passkeys/${mine[0].id}`)).status).toBeGreaterThanOrEqual(400);
    expect((await one.get("/api/auth/passkeys")).body.passkeys.length).toBe(mine.length);
    expect((await new Browser(w.base).get("/api/auth/passkeys")).status).toBe(401);
    expect((await new Browser(w.base).post("/api/auth/passkeys/options")).status).toBe(401);
  }, 60000);

  test("the same authenticator twice is refused as a duplicate", async () => {
    const a = new SoftAuthenticator(); expect((await enrol(one, a)).status).toBe(201);
    const o = (await one.post("/api/auth/passkeys/options")).body;
    const again = await one.post("/api/auth/passkeys/verify", { challengeId: o.challengeId, credential: a.create(o.options) });
    expect(again.status).toBeGreaterThanOrEqual(400);
  }, 30000);

  test("adding or removing needs a recent sign-in; the password restores it; a wrong password counts as a failed attempt", async () => {
    const email = `recent-${w.run}@example.test`;
    await w.tdb.createUser(w.org, email, "Recent One", PASSWORD);
    const b = new Browser(w.base, email);
    expect((await b.post("/api/auth/login", { email, password: PASSWORD })).status).toBe(200);
    const a = new SoftAuthenticator(); expect((await enrol(b, a)).status).toBe(201);
    const id = (await b.get("/api/auth/passkeys")).body.passkeys[0].id;
    // a server that says a sign-in is only recent for no time at all
    const strict = await makeWorldOn(b);
    expect((await strict.post("/api/auth/passkeys/options")).status).toBe(403);
    expect((await strict.del(`/api/auth/passkeys/${id}`)).status).toBe(403);
    expect((await strict.post("/api/auth/reauthenticate", { password: "not-the-password-at-all" })).status).toBe(401);
    expect((await w.admin.unsafe(`select count(*)::int c from "${w.tdb.schema}".audit_events where action = 'auth.reauthenticated'`))[0].c).toBe(0);
    expect((await b.post("/api/auth/reauthenticate", { password: PASSWORD })).status).toBe(200);
    expect((await b.del(`/api/auth/passkeys/${id}`)).status).toBe(200);
    expect((await b.get("/api/auth/passkeys")).body.passkeys).toEqual([]);
    expect(await auditCount("passkey.removed")).toBeGreaterThanOrEqual(1);
    // removed means removed: it no longer signs in
    const o = await options(new Browser(w.base));
    expect((await verify(new Browser(w.base), o.challengeId, a.get(o.options))).status).toBe(401);
  }, 120000);

  test("lost device: the password still works and can remove the old passkey, so losing a device never locks anyone out", async () => {
    const email = `lost-${w.run}@example.test`;
    await w.tdb.createUser(w.org, email, "Lost Device", PASSWORD);
    const b = new Browser(w.base, email);
    expect((await b.post("/api/auth/login", { email, password: PASSWORD })).status).toBe(200);
    const lost = new SoftAuthenticator(); expect((await enrol(b, lost)).status).toBe(201);
    const later = new Browser(w.base, email);
    expect((await later.post("/api/auth/login", { email, password: PASSWORD })).status).toBe(200);
    const list = (await later.get("/api/auth/passkeys")).body.passkeys;
    expect((await later.del(`/api/auth/passkeys/${list[0].id}`)).status).toBe(200);
    const o = await options(new Browser(w.base));
    expect((await verify(new Browser(w.base), o.challengeId, lost.get(o.options))).status).toBe(401);
  }, 60000);

  test("a passkey proves who you are, not that you belong: someone removed from the organisation is refused and gets no session, and it does not accept an invitation", async () => {
    const email = `gone-${w.run}@example.test`;
    await w.tdb.createUser(w.org, email, "Gone Person", PASSWORD);
    const b = new Browser(w.base, email);
    expect((await b.post("/api/auth/login", { email, password: PASSWORD })).status).toBe(200);
    const a = new SoftAuthenticator(); expect((await enrol(b, a)).status).toBe(201);
    const { userId } = (await b.get("/api/auth/me")).body.user;
    await w.admin.unsafe(`update "${w.tdb.schema}".members set left_at = now() where user_id = $1`, [userId]);
    await sleep(10_500);   // the membership cache
    const fresh = new Browser(w.base);
    const o = await options(fresh);
    const res = await verify(fresh, o.challengeId, a.get(o.options));
    expect(res.status).toBe(403); expect(JSON.stringify(res.body)).toMatch(/AUTH-NO-ORGANISATION/);
    expect(fresh.jar.size).toBe(0);
    expect((await w.admin.unsafe(`select count(*)::int c from "${w.tdb.schema}".members where user_id = $1 and left_at is null`, [userId]))[0].c).toBe(0);
  }, 60000);

  test("switched off, as it is everywhere until an environment turns it on: the page is told so and the routes do nothing", async () => {
    const { spawnProc } = await import("./helpers");
    const port = 8863, off = spawnProc(["tsx", "src/index.ts"], { env: { ...w.env, PORT: String(port), PASSKEYS_ENABLED: "false", ROLE: "api" }, stdout: "ignore", stderr: "ignore" });
    for (let i = 0; i < 200; i++) { try { if ((await fetch(`http://localhost:${port}/api/health`)).ok) break; } catch {} await sleep(100); }
    const b = new Browser(`http://localhost:${port}`);
    expect((await b.get("/api/auth/methods")).body).toEqual({ passkey: false });
    expect((await b.post("/api/auth/passkey/options")).status).toBe(401);   // not a passkey route: treated like anything else that needs signing in
    b.jar = one.jar;
    expect((await b.get("/api/auth/passkeys")).status).toBeGreaterThanOrEqual(400);
    off.kill(); await off.exited;
  }, 60000);

  async function makeWorldOn(b: Browser): Promise<Browser> {
    // the access token's sign-in time is what is judged; a token whose sign-in is old cannot be minted from outside, so the same server is asked with the setting at zero via a second process
    const port = 8862;
    const { spawnProc } = await import("./helpers");
    const s = spawnProc(["tsx", "src/index.ts"], { env: { ...w.env, PORT: String(port), PASSKEY_RECENT_MINUTES: "-1", ROLE: "api" }, stdout: "ignore", stderr: "ignore" });
    for (let i = 0; i < 200; i++) { try { if ((await fetch(`http://localhost:${port}/api/health`)).ok) break; } catch {} await sleep(100); }
    const c = new Browser(`http://localhost:${port}`, b.email); c.jar = b.jar;
    return c;
  }
});
