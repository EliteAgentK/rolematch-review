import { spawnSync } from "node:child_process";
import { afterAll, beforeAll, expect, test } from "vitest";
import { onList } from "../src/mail";
import { makeWorld, type World } from "./portalKit";
import { sleep, spawnProc, type Proc } from "./helpers";

// Public registration is the product's intended default. An environment can be restricted on purpose (SIGNUP_MODE=invite): then only an invitation, or an address on the approved list, gets in.
// An invitation still works, because that is how people join. The world's own server is open only to create the inviting administrator.
const PORT = 8961, base = `http://localhost:${PORT}`;
let w: World, closed: Proc;
const signup = (body: unknown) => fetch(base + "/api/auth/signup", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:5173", "x-forwarded-for": `10.78.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200)}` }, body: JSON.stringify(body) });
const modeWith = (env: Record<string, string>) => {
  const r = spawnSync(process.execPath, ["--import", "tsx", "-e", "import('./src/config').then(m => console.log(m.config.signupMode))"], { env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ROLEMATCH_ENV_FILE: "/dev/null", DATABASE_URL: "postgres://x", SUPABASE_URL: "http://x", SUPABASE_SERVICE_ROLE_KEY: "x", ...env }, encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim().split("\n").pop() : "refused";
};

beforeAll(async () => {
  w = await makeWorld(8960, 1, { SIGNUP_REQUIRE_CODE: "false" });
  closed = spawnProc(["tsx", "src/index.ts"], { env: { ...w.env, PORT: String(PORT), SIGNUP_MODE: "invite", SIGNUP_ALLOWED_EMAILS: `listed-RUN@example.test` }, stdout: "ignore", stderr: "ignore" });
  for (let i = 0; i < 300; i++) { try { if ((await fetch(base + "/api/health")).ok) break; } catch {} await sleep(100); }
}, 300000);
afterAll(async () => { closed?.kill(); await w?.stop(); }, 120000);

test("registration stays open unless restricted on purpose, HTTPS or not; a mistyped setting stops the server rather than guessing", () => {
  expect(modeWith({})).toBe("open");
  expect(modeWith({ COOKIE_SECURE: "true" })).toBe("open");
  expect(modeWith({ SIGNUP_MODE: "invite" })).toBe("invite");
  expect(modeWith({ COOKIE_SECURE: "true", SIGNUP_MODE: "closed" })).toBe("refused");
}, 60000);

test("a list entry is an exact address or one mailbox's tagged addresses, nothing wider", () => {
  const list = ["a@x.test", "tests+*@x.test"];
  expect(["a@x.test", "A@X.test ", "tests+run1@x.test"].map((e) => onList(list, e))).toEqual([true, true, true]);
  expect(["b@x.test", "tests@x.test", "tests+run1@y.test", "xtests+run1@x.test", "tests+@x.test"].map((e) => onList(list, e))).toEqual([false, false, false, false, false]);
});

test("a stranger is refused with a plain reason, and no account is created", async () => {
  const email = `stranger-${w.run}@example.test`;
  const r = await signup({ name: "A Stranger", orgName: `Stranger Org ${w.run}`, email, password: "a-long-enough-password-1" });
  expect(r.status).toBe(403);
  const body: any = await r.json();
  expect(JSON.stringify(body)).toContain("PERM-003");
  expect(JSON.stringify(body)).toContain("invitation only");
  expect(await w.admin.unsafe(`select 1 from auth.users where email = $1`, [email])).toHaveLength(0);
});

test("an address on the approved list can start an organisation while everyone else is refused", async () => {
  const email = "listed-RUN@example.test";
  const r = await signup({ name: "Listed Person", orgName: `Listed Org ${w.run}`, email, password: "a-long-enough-password-1" });
  expect(r.status).toBe(200);
  await w.admin.unsafe(`delete from auth.users where email = $1`, [email]);
});

test("someone holding an invitation can still join, and an invalid invitation gets no further", async () => {
  const email = `invited-${w.run}@example.test`;
  const made = (await w.users[0].post("/api/portal/invitations", { emails: [email], role: "recruiter" })).body;
  const joined = await signup({ inviteToken: made[0].token, name: "Invited Person", email, password: "a-long-enough-password-1" });
  expect(joined.status).toBe(200);
  expect(((await joined.json()) as any).status).toBe("signed_in");
  expect((await signup({ inviteToken: "not-a-real-invitation", name: "Invited Person", email: `x-${email}`, password: "a-long-enough-password-1" })).status).toBe(404);
  await w.admin.unsafe(`delete from auth.users where email = $1`, [email]);
});
