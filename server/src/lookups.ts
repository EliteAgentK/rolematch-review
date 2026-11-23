// People whose sign-in checks arrive together share one trip to the database (experiment X4): a thousand open pages otherwise spend most of the connections asking who each person is, one at a time. Each caller receives only the answer for their own key. Always runs as the platform, never inside the scope of whichever request happened to come first.
import { asSystem } from "./db";

const WINDOW_MS = 4, MOST = 200, AT_ONCE = 1;
export function batched<K, V>(load: (keys: K[]) => Promise<Map<K, V>>, missing: V): (key: K) => Promise<V> {
  let waiting = new Map<K, { resolve: (v: V) => void; reject: (e: unknown) => void }[]>(), timer: ReturnType<typeof setTimeout> | null = null, out = 0;
  // Trips at a time are capped: whoever arrives while they are all out waits a moment and shares the next one. So the database sees a steady few trips however many people are asking, and the wait is at most one trip.
  const flush = () => {
    timer = null;
    if (out >= AT_ONCE || !waiting.size) return;
    const keys = [...waiting.keys()].slice(0, MOST), now = new Map(keys.map((k) => [k, waiting.get(k)!])); for (const k of keys) waiting.delete(k);
    out++;
    const done = () => { out--; if (waiting.size && !timer) flush(); };
    Promise.resolve().then(() => asSystem(() => load(keys))).then(
      (found) => { for (const [k, list] of now) for (const c of list) c.resolve(found.has(k) ? (found.get(k) as V) : missing); done(); },
      (e) => { for (const list of now.values()) for (const c of list) c.reject(e); done(); },
    );
  };
  return (key) => new Promise<V>((resolve, reject) => {
    const list = waiting.get(key);
    if (list) list.push({ resolve, reject }); else waiting.set(key, [{ resolve, reject }]);
    if (waiting.size >= MOST && out < AT_ONCE) { if (timer) clearTimeout(timer); flush(); } else if (!timer && out < AT_ONCE) timer = setTimeout(flush, WINDOW_MS);
  });
}
