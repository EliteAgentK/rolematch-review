// The console's Database page (docs/database/21_PLATFORM_V1.md, B1): the judgement in plain words, tested without a server, and the database function
// against a real database: it returns numbers and table names only, never the text of a query, and only the console role may call it.
import postgres from "postgres";
import { afterAll, beforeAll, expect, test } from "vitest";
import { judgeDatabase, whereIs, type DbRaw } from "../src/console/database";
import { setupTestDb, type TestDb } from "./helpers";

const now = new Date("2026-11-08T10:00:00Z"), iso = (secAgo: number) => new Date(now.getTime() - secAgo * 1000).toISOString();
const healthy = (over: Partial<DbRaw> = {}): DbRaw => ({ version: "17.6", sizeBytes: 48 * 1024 ** 2, startedAt: iso(3 * 86400), connections: 12, maxConnections: 100, activeNow: 1, longestActiveSec: 0.2,
  idleInTransaction: 0, waitingOnLocks: 0, cacheHitPct: 99.6, deadlocks: 0, archiveMode: "on", archiver: { archived: 900, lastArchivedAt: iso(40), failed: 0, lastFailedAt: null },
  tables: [{ name: "candidates", bytes: 9e6, rows: 1200, dead: 10, lastVacuum: iso(3600), lastAnalyze: iso(3600) }], migrations: { applied: 2, latest: "002_b.sql" }, appliedNames: ["001_a.sql", "002_b.sql"], ...over });
const ok = (v: DbRaw) => ({ ok: true as const, value: v, ageSec: 0 });

test("a healthy database says so in plain words, with every line good", () => {
  const v = judgeDatabase(ok(healthy()), ["001_a.sql", "002_b.sql"], "Our PostgreSQL on the PC", now);
  expect(v.tone).toBe("good");
  expect(v.headline).toBe("The database is healthy");
  expect(v.lines.find((l) => l.label === "Connections in use")?.value).toBe("12 of 100");
  expect(v.lines.find((l) => l.label === "Change log copied for recovery")?.value).toBe("40 s ago");
  expect(v.lines.find((l) => l.label === "Changes applied")?.value).toBe("all 2");
  expect(v.tables[0]).toMatchObject({ name: "candidates", upkeep: "tidied 60 min ago", tone: "good" });
});

test("each problem is named, with what it means: near the connection limit, a long query, a failed change-log copy, a change not applied", () => {
  expect(judgeDatabase(ok(healthy({ connections: 80 })), ["001_a.sql", "002_b.sql"], "x", now)).toMatchObject({ tone: "warn", detail: expect.stringContaining("Close to the limit") });
  expect(judgeDatabase(ok(healthy({ longestActiveSec: 400 })), ["001_a.sql", "002_b.sql"], "x", now).tone).toBe("bad");
  const failed = judgeDatabase(ok(healthy({ archiver: { archived: 9, lastArchivedAt: iso(900), failed: 1, lastFailedAt: iso(30) } })), ["001_a.sql", "002_b.sql"], "x", now);
  expect(failed.tone).toBe("bad");
  expect(failed.headline).toBe("The database needs attention now");
  const behind = judgeDatabase(ok(healthy()), ["001_a.sql", "002_b.sql", "003_c.sql"], "x", now);
  expect(behind).toMatchObject({ tone: "warn", pending: ["003_c.sql"] });
  expect(judgeDatabase(ok(healthy({ tables: [{ name: "queue", bytes: 1e5, rows: 100, dead: 900, lastVacuum: null }] })), ["001_a.sql", "002_b.sql"], "x", now).tables[0].tone).toBe("warn");
});

test("what cannot be seen says unknown and why, never a zero: an unreadable database, a provider's own change log, an unreadable release", () => {
  expect(judgeDatabase({ ok: false, why: "the database did not answer (ECONNREFUSED)" }, [], "x", now)).toMatchObject({ tone: "unknown", headline: "The database cannot be seen", detail: expect.stringContaining("ECONNREFUSED") });
  const hosted = judgeDatabase(ok(healthy({ archiveMode: "off", cacheHitPct: null })), null, "x", now);
  expect(hosted.lines.find((l) => l.label === "Change log copied for recovery")).toMatchObject({ value: "managed by the host", tone: "unknown" });
  expect(hosted.lines.find((l) => l.label === "Reads served from memory")).toMatchObject({ value: "unknown", tone: "unknown" });
  expect(hosted.lines.find((l) => l.label === "Changes applied")?.tone).toBe("unknown");
  expect(hosted.tone).toBe("good");   // unknowns are shown as unknown, not counted as problems or as health
});

test("the page always says whose database live is on", () => {
  expect(whereIs("postgres://x@aws-0-eu-west-1.pooler.supabase.com:6543/postgres")).toBe("Supabase (hosted in Ireland)");
  expect(whereIs("postgres://rm_app@127.0.0.1:5433/rolematch")).toBe("Our PostgreSQL on the PC");
});

let tdb: TestDb, db: postgres.Sql, other: postgres.Sql;
beforeAll(async () => { tdb = await setupTestDb(); db = postgres(process.env.DATABASE_URL!, { max: 2, connection: { search_path: tdb.schema }, onnotice: () => {} }); other = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} }); }, 120_000);
afterAll(async () => { await db?.end(); await other?.end(); await tdb?.teardown(); });

test("the database function gives the console numbers and table names only: a running query's text never comes back, and nobody else may call it", async () => {
  const marker = `secret-${crypto.randomUUID()}`;
  const slow = other.unsafe(`select pg_sleep(3), '${marker}'`);
  await new Promise((r) => setTimeout(r, 700));
  const [{ d }] = await db.begin(async (q) => { await q`set local role rolematch_console`; return q`select console_database() as d`; });
  await slow;
  expect(JSON.stringify(d)).not.toContain(marker);
  for (const k of ["sizeBytes", "connections", "maxConnections", "longestActiveSec", "waitingOnLocks", "archiver", "tables", "migrations", "appliedNames"]) expect(d, k).toHaveProperty(k);
  expect(d.appliedNames).toContain("039_console_database.sql");
  expect(d.tables.map((t: any) => t.name)).toContain("candidates");
  for (const t of d.tables) expect(Object.keys(t).sort()).toEqual(["bytes", "dead", "lastAnalyze", "lastVacuum", "name", "rows"]);
  await expect(db.begin(async (q) => { await q`set local role rolematch_tenant`; return q`select console_database()`; })).rejects.toThrow(/permission denied/);
});
