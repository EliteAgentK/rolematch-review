// Allowances, always PER PORTAL (owner, 16 Nov 2026: "it is per portal at all times, no matter how many people are in that portal"; every portal
// is paid for). An organisation's administrator sets the numbers once and each of its portals has them in full; what one portal uses never touches
// another's. The counting is the database's: quota_take holds and counts inside the portal in scope, and refuses without one (migration 030); the
// usage figures below run as the portal, whose row rules show only its own documents and matches.
import { dbMode, sql } from "./db";
import { getSettings } from "./settings";

export class LimitError extends Error { constructor(public code: string, message: string) { super(message); } }

export interface Usage { documentsToday: number; storageBytes: number; inProgress: number; matchesLastHour: number }

export async function usageOf(orgId: string): Promise<Usage> {
  // ONE statement, not three: each query used to take its own turn at a connection from the small pool, and a measurement showed that waiting for a connection
  // (not the work itself) is where upload time goes (docs/learning/investigations/INV-001-upload-latency.md).
  const [r] = await sql`select
    (select count(*) filter (where created_at > now() - interval '24 hours')::int from documents where org_id = ${orgId}) as today,
    (select coalesce(sum(size), 0)::bigint from documents where org_id = ${orgId}) as bytes,
    (select count(*)::int from queue where org_id = ${orgId} and status in ('queued', 'running') and (type not like 'model-%' or type = 'model-audit')) as in_progress,
    (select count(*)::int from matches where org_id = ${orgId} and created_at > now() - interval '1 hour') as matches`;
  return { documentsToday: r.today, storageBytes: Number(r.bytes), inProgress: r.in_progress, matchesLastHour: r.matches };
}

/** The allowance each portal of this organisation has: the platform default unless an administrator changed it (always below the platform ceilings). */
export async function limitsOf(orgId: string) {
  const { limits } = (await getSettings(orgId)).settings;
  return { documentsPerDay: limits.documentsPerDay, storageBytes: limits.storageMb * 1024 * 1024, storageMb: limits.storageMb, inProgress: limits.inProgress, matchesPerHour: limits.matchesPerHour, maxPages: limits.maxPages, maxFileMb: limits.maxFileMb, processFileMb: limits.processFileMb };
}

export interface Hold { release: () => Promise<void> }
const NOTHING_HELD: Hold = { release: async () => {} };
const holdOf = (id: string): Hold => ({ release: async () => { await sql`delete from quota_holds where id = ${id}`; } });
const take = async (kind: "document" | "match", units: number, bytes: number, maxUnits: number, maxBytes: number, maxWaiting: number) =>
  (await sql`select hold, refused, used_units, used_bytes, waiting from quota_take(${kind}, ${units}, ${bytes}, ${maxUnits}, ${maxBytes}, ${maxWaiting})`)[0] as { hold: string | null; refused: string | null; used_units: number; used_bytes: string; waiting: number };

const uploadRefusal = (code: string, l: Awaited<ReturnType<typeof limitsOf>>, waiting: number) => {
  if (code === "QUOTA-001") return new LimitError(code, `This portal has reached today's limit of ${l.documentsPerDay} uploads. It resets within 24 hours.`);
  if (code === "QUOTA-002") return new LimitError(code, `This portal's storage allowance of ${l.storageMb} MB is full. Remove documents you no longer need.`);
  return new LimitError(code, `You already have ${waiting} documents waiting to be processed. Please wait for some to finish before uploading more.`);
};
const matchRefusal = (l: Awaited<ReturnType<typeof limitsOf>>) => new LimitError("QUOTA-004", `This portal has reached its limit of ${l.matchesPerHour} matches per hour. Please try again shortly.`);

/** Takes room for one upload, or refuses. Whatever the number of people at the same moment, what is admitted stays within the limit. Release it once the document's record exists, or the upload has failed. */
export async function takeUpload(orgId: string, bytes: number): Promise<Hold> {
  const l = await limitsOf(orgId);
  if (dbMode.readOnly) {   // saving is paused and nothing can be held: the upload route holds the file itself until the database is back, and counts it then
    const u = await usageOf(orgId);
    if (u.documentsToday >= l.documentsPerDay) throw uploadRefusal("QUOTA-001", l, u.inProgress);
    if (u.storageBytes + bytes > l.storageBytes) throw uploadRefusal("QUOTA-002", l, u.inProgress);
    if (u.inProgress >= l.inProgress) throw uploadRefusal("QUOTA-003", l, u.inProgress);
    return NOTHING_HELD;
  }
  const r = await take("document", 1, bytes, l.documentsPerDay, l.storageBytes, l.inProgress);
  if (r.refused) throw uploadRefusal(r.refused, l, r.waiting);
  return holdOf(r.hold!);
}

/** Takes room for `count` matches, or refuses. Release it once they are saved. */
export async function takeMatch(orgId: string, count: number): Promise<Hold> {
  const l = await limitsOf(orgId);
  if (!count) return NOTHING_HELD;
  if (dbMode.readOnly) { if ((await usageOf(orgId)).matchesLastHour + count > l.matchesPerHour) throw matchRefusal(l); return NOTHING_HELD; }
  const r = await take("match", count, 0, l.matchesPerHour, Number.MAX_SAFE_INTEGER, 0);
  if (r.refused) throw matchRefusal(l);
  return holdOf(r.hold!);
}
