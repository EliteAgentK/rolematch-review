// Independent audit, 20 Nov 2026: when the shared sign-out list could not be read, a session was let through on this server's own list, so a session
// signed out on another server could still read records for as long as an outage lasted; and a copy older than a sign-out or a removal showed the person as still
// signed in. A sign-in confirmed within the last five minutes now rides out a short outage; anything else is refused with "cannot confirm".
import { afterEach, expect, test, vi } from "vitest";

const UNREACHABLE = "postgres://" + "u:p@127.0.0.1:1/d";   // nothing listens on port 1: every query fails at once
const load = async () => {
  vi.resetModules(); vi.stubEnv("DATABASE_URL", UNREACHABLE); vi.stubEnv("READ_FALLBACK_DATABASE_URL", "");
  return { so: await import("../src/signedOut"), db: await import("../src/db") };
};
afterEach(() => { vi.unstubAllEnvs(); });

test("a sign-out list that cannot be read does not let the session through: the request is answered 'cannot confirm', not 'signed out'", async () => {
  const { so } = await load();
  await expect(so.signedOutAnywhere("session-a", Math.floor(Date.now() / 1000) + 3600)).rejects.toBeInstanceOf(so.SignInUnconfirmed);
});

test("a session this server signed out is refused without asking the database at all", async () => {
  const { so } = await load(), tokens = await import("../src/tokens");
  tokens.forgetSession("session-b", Math.floor(Date.now() / 1000) + 3600);
  expect(await so.signedOutAnywhere("session-b", Math.floor(Date.now() / 1000) + 3600)).toBe(true);
});

test("a copy taken more than two minutes ago cannot vouch for a sign-in; a live replica (no copy time) and a fresh copy can", async () => {
  const { so, db } = await load();
  Object.assign(db.dbMode, { readOnly: true, copyAt: new Date(Date.now() - 10 * 60_000).toISOString() });
  expect(so.signInStateKnown()).toBe(false);
  await expect(so.signedOutAnywhere("session-c", Math.floor(Date.now() / 1000) + 3600)).rejects.toBeInstanceOf(so.SignInUnconfirmed);
  Object.assign(db.dbMode, { copyAt: new Date(Date.now() - 30_000).toISOString() });
  expect(so.signInStateKnown()).toBe(true);
  Object.assign(db.dbMode, { copyAt: "" });
  expect(so.signInStateKnown()).toBe(true);
  Object.assign(db.dbMode, { readOnly: false, copyAt: "" });
  expect(so.signInStateKnown()).toBe(true);
});

test("what was confirmed within the last five minutes rides out a short outage; anything older is refused, so a sign-out or removal holds within five minutes", async () => {
  const { so } = await load();
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    const seen = so.confirmations();
    seen.confirm("session-d");
    vi.setSystemTime(Date.now() + 4 * 60_000);
    expect(() => seen.orRefuse("session-d", "test")).not.toThrow();
    vi.setSystemTime(Date.now() + 2 * 60_000);                                   // six minutes after it was confirmed
    expect(() => seen.orRefuse("session-d", "test")).toThrow(so.SignInUnconfirmed);
    expect(() => seen.orRefuse("never-confirmed", "test")).toThrow(so.SignInUnconfirmed);
  } finally { vi.useRealTimers(); }
});
