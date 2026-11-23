// A database query only runs when it is awaited, and runs again for each await, so what is kept here is always a real promise of one answer.
// Short answers shared by everyone in one portal, so that what a crowd of open pages costs the database follows the number of portals, not the number of people (experiment X4). Each entry belongs to one portal, and is filled inside that portal's own scope; a person's permission is checked before they reach it.
const MAX_ENTRIES = 5000;
let maxBytes = Number(process.env.PORTAL_CACHE_MB ?? 256) * 1024 * 1024;   // a page of a board is about a megabyte: a server with thousands of portals must keep the recent ones, not run out of memory
interface Entry { until: number; value: Promise<unknown>; bytes: number }
const entries = new Map<string, Entry>();
let held = 0;

const drop = (key: string) => { const e = entries.get(key); if (e) { held -= e.bytes; entries.delete(key); } };

export interface CacheOptions<T> {
  /** Someone needs an answer that includes a change they know has happened (a document they saw finish): ask again and keep the new answer. */
  fresh?: boolean;
  /** For large answers: how many bytes this holds, so the oldest answers make room when the limit is reached. */
  sizeOf?: (value: T) => number;
}

/** One answer per portal and kind for `ttlMs`. Callers at the same moment share one query. A failure is not kept. */
export function portalCached<T>(portalId: string, kind: string, ttlMs: number, read: () => Promise<T>, options: CacheOptions<T> = {}): Promise<T> {
  const key = `${portalId}:${kind}`, hit = entries.get(key);
  if (!options.fresh && hit && hit.until > Date.now()) return hit.value as Promise<T>;
  drop(key);
  if (entries.size >= MAX_ENTRIES) { entries.clear(); held = 0; }
  const value = Promise.resolve().then(read), entry: Entry = { until: Infinity, value: value as Promise<unknown>, bytes: 0 };   // the time counts from the answer: under load the asking can outlast it
  entries.set(key, entry);
  value.then((answer) => {
    entry.until = Date.now() + ttlMs;
    if (!options.sizeOf || entries.get(key) !== entry) return;
    entry.bytes = options.sizeOf(answer); held += entry.bytes;
    for (const oldest of entries.keys()) { if (held <= maxBytes) break; if (oldest !== key) drop(oldest); }
    if (held > maxBytes) drop(key);   // larger than the whole limit by itself: it is answered, and not kept
  }, () => { if (entries.get(key) === entry) drop(key); });
  return value;
}

/** A change on this server shows at once to everyone it serves. Another server catches up within the cache time. */
export function forgetPortal(portalId: string) {
  for (const key of entries.keys()) if (key.startsWith(`${portalId}:`)) drop(key);
}

/** For tests and the health of a server under load. */
export const portalCacheHeld = () => held;
export function limitPortalCache(bytes: number) { maxBytes = bytes; }
