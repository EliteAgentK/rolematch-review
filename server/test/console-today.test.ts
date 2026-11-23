// The console's Today judgement and the monitor's alerts, without a server (docs/database/18_CONSOLE_V0.md; 17, section 5): plain words beside every
// colour, "unknown" with its reason rather than a zero, and the monitor's problems raised once, seen while they last, and cleared when they go.
import { expect, test } from "vitest";
import { buildToday } from "../src/console/today";
import { consoleChanges, consoleEvent } from "../src/scripts/monitor";

const now = new Date("2026-11-06T12:00:00Z");
const ai = { state: "healthy", note: "nothing waiting", spentThisMonthUsd: 2.4, monthlyCapUsd: 25 };
const health = { ok: true as const, ageSec: 5, value: { checks: { readiness: { state: "healthy" }, queue: { state: "healthy", queued: 0, oldestQueuedSec: 0 }, ai } } };
const pcv = { diskUsedPct: 41, liveBackupSec: 3600, ownDatabase: { running: true, backups: { ok: true, lastBackupSec: 7200 }, macCopySec: 120, drill: { passed: true, seconds: 14, ageSec: 86400 } }, containers: { tunnel: true, monitor: true } };
const pc = (v: any = pcv, ageSec = 30) => ({ ok: true as const, ageSec, value: v });
const counts = { ok: true as const, ageSec: 0, value: { organisations: 3, people: 7, peopleJoinedToday: 1, organisationsToday: 0, documentsPublished24h: 12, documentsFailed24h: 0, documentsProcessing: 0, correctionsRecorded24h: 0 } };

test("everything well is said in words, with the time checked", () => {
  const t = buildToday(health, pc(), counts, [], now);
  expect(t.tone).toBe("good");
  expect(t.headline).toBe("All well");
  expect(t.detail).toMatch(/^Checked 14:00$/);
  expect(t.needs).toEqual([]);
});

test("a source that cannot be read is unknown with its reason, never a zero", () => {
  const t = buildToday({ ok: false, why: "the API did not answer (ECONNREFUSED)" }, pc(), { ok: false, why: "the database did not answer (timeout)" }, [], now);
  expect(t.tone).toBe("unknown");
  expect(t.lines.find((l) => l.label === "Live")).toMatchObject({ value: "unknown", why: "the API did not answer (ECONNREFUSED)" });
  expect(t.lines.find((l) => l.label === "Failed CVs (24 h)")).toMatchObject({ value: "unknown" });
  expect(t.lines.some((l) => l.value === "0" || l.value === "none")).toBe(false);
  expect(t.detail).toContain("the database did not answer");
});

test("the PC's status older than 2 minutes is not trusted", () => {
  const t = buildToday(health, pc(pcv, 600), counts, [], now);
  expect(t.lines.find((l) => l.label === "Last backup")).toMatchObject({ value: "unknown", why: "the PC's status is 10 min ago, so it may be out of date" });
});

test("problems become what needs the owner, the worst first in the headline", () => {
  const failing = { ...health, value: { checks: { ...health.value.checks, ai: { ...ai, state: "degraded", note: "the AI's calls are failing (check the Anthropic credit and key); the parser and the rules carry on" } } } };
  const t = buildToday(failing, pc({ ...pcv, ownDatabase: { ...pcv.ownDatabase, macCopySec: 3 * 3600 } }), counts, [], now);
  expect(t.tone).toBe("bad");
  expect(t.headline).toBe("Needs you now");
  expect(t.needs.map((n) => n.title)).toEqual(["AI: the AI's calls are failing (check the Anthropic credit and key); the parser and the rules carry on · $2.40 of $25 this month", "Copy on the Mac: 3 h ago"]);
});

test("an open alert needs the owner until it is acknowledged, muted or cleared", () => {
  const e = { id: 1, fingerprint: "monitor:outside", severity: "urgent" as const, source: "monitor", title: "RoleMatch cannot be reached from the internet", meaning: null, action: null,
    first_at: now, last_at: now, times: 3, cleared_at: null, acknowledged_at: null, muted_until: null };
  expect(buildToday(health, pc(), counts, [e], now).needs[0]).toMatchObject({ title: "RoleMatch cannot be reached from the internet (×3)", tone: "bad", href: "/alerts/1" });
  expect(buildToday(health, pc(), counts, [{ ...e, acknowledged_at: now }], now).needs).toEqual([]);
  expect(buildToday(health, pc(), counts, [{ ...e, muted_until: new Date(now.getTime() + 60_000) }], now).needs).toEqual([]);
  expect(buildToday(health, pc(), counts, [{ ...e, cleared_at: now }], now).needs).toEqual([]);
});

test("the monitor raises a new problem once, marks a lasting one as seen, and clears one that has gone", () => {
  const st = { since: { "health:queue": 1, outside: 1 }, lastSent: {} };
  const c = consoleChanges([{ key: "health:queue", text: "queue: degraded. all waiting work is behind", severity: "today" }, { key: "health:mail", text: "mail: unavailable. x", severity: "urgent" }], st);
  expect(c.started.map((p) => p.key)).toEqual(["health:mail"]);
  expect(c.ongoing.map((p) => p.key)).toEqual(["health:queue"]);
  expect(c.cleared).toEqual(["outside"]);
  expect(consoleEvent(c.started[0])).toMatchObject({ fingerprint: "monitor:health:mail", severity: "urgent", title: "E-mail is not going out", meaning: "mail: unavailable. x" });
});
