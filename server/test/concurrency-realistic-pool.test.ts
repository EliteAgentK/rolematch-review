import { afterAll, beforeAll, expect, test } from "vitest";
import { Browser, cvFile, makeWorld, sleep, type World } from "./portalKit";

// The 12-uploads-at-once responsiveness gate (the same 4 s bound as e2e.test.ts CONCURRENCY), run with a connection pool of a realistic size (10) instead of the
// test suite's usual 3. Added, not substituted: e2e.test.ts keeps its original conditions and bound. Evidence for why both exist: docs/learning/investigations/INV-001-upload-latency.md.
let w: World; let U: Browser;
beforeAll(async () => { w = await makeWorld(8815, 1, { DB_POOL_SIZE: "10", WORKER_CONCURRENCY: "6", PER_ORG_CONCURRENCY: "6", RATE_OVERRIDES: JSON.stringify({ upload: 100000, upload_portal: 100000 }) }); U = w.users[0]; }, 200000);
afterAll(async () => { await w?.stop(); }, 120000);

test("12 uploads at once all publish and ordinary requests stay under the 4 s bound with a pool of 10 connections", async () => {
  for (let rep = 0; rep < 2; rep++) {   // the first repetition after a start is slower for every version; the bound must hold on both
    const files = await Promise.all(Array.from({ length: 12 }, (_, i) => cvFile(500 + rep * 20 + i)));
    const latencies: number[] = []; let done = false;
    const ups = await Promise.all(files.map((f) => U.upload(f)));
    expect(ups.every((u) => u.status === 202)).toBe(true);
    const watcher = (async () => { while (!done) { const t = performance.now(); await U.get("/api/health"); await U.get("/api/candidates?limit=1"); latencies.push(performance.now() - t); await sleep(100); } })();
    const ids = ups.map((u) => u.body.id);
    for (let s = 0; s < 120; s++) { const list = (await U.get("/api/documents")).body as any[]; if (!list.some((d) => ids.includes(d.id) && d.status === "processing")) break; await sleep(250); }
    done = true; await watcher;
    const published = await w.admin.unsafe(`select count(*)::int c from "${w.tdb.schema}".documents where id = any($1) and status = 'published'`, [ids]);
    expect(published[0].c).toBe(12);
    expect(latencies.length).toBeGreaterThan(0);
    expect(Math.max(...latencies), `repetition ${rep}`).toBeLessThan(4000);
  }
}, 300000);
