// The Database page (docs/database/21_PLATFORM_V1.md, B1): how the database itself is doing, in plain words. Fetching (console_database(), migration
// 039, and the migration files in the image) is kept apart from judging, so every case is tested without a server. Numbers only: no query text, no rows.
import { readdirSync } from "node:fs";
import { config } from "../config";
import { MIGRATIONS_DIR } from "../scripts/migrate";
import type { Read } from "./sources";
import type { Line, Tone } from "./today";

export type DbRaw = Record<string, any>;
interface TableRow { name: string; size: string; rows: number; dead: number; upkeep: string; tone: Tone }
export interface DatabaseView { tone: Tone; headline: string; detail: string; where: string; lines: Line[]; tables: TableRow[]; latest: string; pending: string[] }

/** Where live's database is, from its address: the owner should always know whether it is ours or borrowed. */
export const whereIs = (url = config.databaseUrl, told = config.databaseLocation) => told || (/supabase\.(co|com)|pooler\.supabase/.test(url) ? "Supabase (hosted in Ireland)" : /127\.0\.0\.1|localhost|rm-db/.test(url) ? "Our PostgreSQL on the PC" : "another server");

export function migrationFiles(dir = MIGRATIONS_DIR) {
  try { return readdirSync(dir).filter((f) => f.endsWith(".sql")).sort(); } catch { return null; }
}

const bytes = (n: number) => (n < 1024 ** 2 ? `${Math.max(1, Math.round(n / 1024))} KB` : n < 1024 ** 3 ? `${(n / 1024 ** 2).toFixed(n < 10 * 1024 ** 2 ? 1 : 0)} MB` : `${(n / 1024 ** 3).toFixed(1)} GB`);
const since = (iso: string | null | undefined, now: Date) => {
  if (!iso) return null;
  const s = Math.max(0, Math.round((now.getTime() - Date.parse(iso)) / 1000));
  return s < 90 ? `${s} s ago` : s < 5400 ? `${Math.round(s / 60)} min ago` : s < 48 * 3600 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} days ago`;
};
const forHow = (iso: string, now: Date) => { const d = (now.getTime() - Date.parse(iso)) / 86_400_000; return d < 1 ? `${Math.max(1, Math.round(d * 24))} h` : `${Math.round(d)} days`; };
const worst = (ts: Tone[]): Tone => (ts.includes("bad") ? "bad" : ts.includes("warn") ? "warn" : ts.includes("unknown") ? "unknown" : "good");

export function judgeDatabase(r: Read<DbRaw>, files: string[] | null, where = whereIs(), now = new Date()): DatabaseView {
  if (!r.ok) return { tone: "unknown", headline: "The database cannot be seen", detail: r.why, where, lines: [], tables: [], latest: "", pending: [] };
  const d = r.value, lines: Line[] = [];
  const used = Number(d.connections), max = Number(d.maxConnections), pct = max ? used / max : 0;
  lines.push({ label: "Connections in use", value: `${used} of ${max}`, tone: pct > 0.9 ? "bad" : pct > 0.75 ? "warn" : "good", why: pct > 0.75 ? "Close to the limit: new work may have to wait." : undefined });
  const longest = Number(d.longestActiveSec);
  lines.push({ label: "Longest query running now", value: Number(d.activeNow) ? `${longest < 10 ? longest.toFixed(1) : Math.round(longest)} s` : "none running", tone: longest > 300 ? "bad" : longest > 60 ? "warn" : "good", why: longest > 60 ? "Something is taking unusually long; it may hold others up." : undefined });
  const locks = Number(d.waitingOnLocks), idleTx = Number(d.idleInTransaction);
  lines.push({ label: "Waiting on another query", value: locks ? String(locks) : "none", tone: locks > 3 ? "bad" : locks ? "warn" : "good" });
  lines.push({ label: "Left open mid-change", value: idleTx ? String(idleTx) : "none", tone: idleTx > 2 ? "warn" : "good", why: idleTx ? "A connection began a change and has not finished it." : undefined });
  if (d.cacheHitPct === null || d.cacheHitPct === undefined) lines.push({ label: "Reads served from memory", value: "unknown", tone: "unknown", why: "Not enough reads yet to say." });
  else lines.push({ label: "Reads served from memory", value: `${Number(d.cacheHitPct).toFixed(1)}%`, tone: Number(d.cacheHitPct) < 90 ? "warn" : "good", why: Number(d.cacheHitPct) < 90 ? "Many reads go to disk: the database may need more memory." : undefined });
  lines.push({ label: "Size", value: bytes(Number(d.sizeBytes)), tone: "good" });
  lines.push({ label: "Running for", value: d.startedAt ? forHow(d.startedAt, now) : "unknown", tone: d.startedAt ? "good" : "unknown" });
  // The change log copied off the database: only where archiving is on (our own PostgreSQL); Supabase does its own and does not show it.
  const a = d.archiver ?? {};
  if (d.archiveMode !== "on") lines.push({ label: "Change log copied for recovery", value: "managed by the host", tone: "unknown", why: "This database's provider keeps its own change log; we cannot see it from here." });
  else {
    const failedLater = a.lastFailedAt && (!a.lastArchivedAt || Date.parse(a.lastFailedAt) > Date.parse(a.lastArchivedAt));
    const lastSec = a.lastArchivedAt ? (now.getTime() - Date.parse(a.lastArchivedAt)) / 1000 : Infinity;
    lines.push({ label: "Change log copied for recovery", value: a.lastArchivedAt ? since(a.lastArchivedAt, now)! : "never", tone: failedLater ? "bad" : lastSec > 600 ? "warn" : "good", why: failedLater ? "The last copy failed: recovery to a recent second is at risk." : lastSec > 600 ? "No copy for over 10 minutes." : undefined });
  }
  if (Number(d.deadlocks)) lines.push({ label: "Deadlocks since start", value: String(d.deadlocks), tone: "warn", why: "Two changes blocked each other and one was undone; the app retries these." });
  // Changes (migrations): what the release carries against what the database has.
  const applied = new Set<string>(d.appliedNames ?? []), pending = files ? files.filter((f) => !applied.has(f)) : [];
  if (files === null) lines.push({ label: "Changes applied", value: `${d.migrations?.applied ?? "?"}`, tone: "unknown", why: "The release's list of changes could not be read." });
  else lines.push({ label: "Changes applied", value: pending.length ? `${applied.size}, ${pending.length} waiting` : `all ${applied.size}`, tone: pending.length ? "warn" : "good", why: pending.length ? "This release carries changes the database does not have yet." : undefined });

  const tables: TableRow[] = (d.tables ?? []).slice(0, 12).map((t: any) => {
    const deadShare = t.rows + t.dead > 200 ? t.dead / (t.rows + t.dead) : 0, last = since(t.lastVacuum, now);
    return { name: t.name, size: bytes(Number(t.bytes)), rows: Number(t.rows), dead: Number(t.dead), upkeep: last ? `tidied ${last}` : t.rows + t.dead > 0 ? "not tidied yet" : "empty", tone: deadShare > 0.3 ? "warn" : "good" };
  });
  const tone = worst([...lines.map((l) => l.tone).filter((t) => t !== "unknown"), ...tables.map((t) => t.tone)]);
  const firstIssue = lines.find((l) => l.tone === "bad") ?? lines.find((l) => l.tone === "warn");
  return {
    tone, where, lines, tables, latest: d.migrations?.latest ?? "", pending,
    headline: tone === "good" ? "The database is healthy" : tone === "bad" ? "The database needs attention now" : "The database is working, with something to look at",
    detail: firstIssue ? `${firstIssue.label}: ${firstIssue.value}. ${firstIssue.why ?? ""}`.trim() : `PostgreSQL ${String(d.version).split(" ")[0]}, ${bytes(Number(d.sizeBytes))}, ${used} connections.`,
  };
}
