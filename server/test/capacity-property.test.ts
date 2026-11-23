import { afterAll, beforeAll, expect, test } from "vitest";
import { Browser, makeWorld, type World } from "./portalKit";

// Arbitrary batch sizes, not just the illustrative 5x100 and 10x30: rounds of simultaneous reservations of random sizes (1 to 180, both document types, random
// people) with random batches closed between rounds, from fixed seeds so a failure can be reproduced. Invariants, checked after EVERY round:
//   (1) the portal never holds more than its ceiling;  (2) the reserved figure equals exactly the admitted sizes minus the closed ones;
//   (3) the admission counter equals the sum of the held batches (no leak, no double release);
//   (4) every refusal was right: nothing is released inside a round, so a refused size must be larger than what is free at the end of the round;
//   (5) every refusal is CAPACITY-001 with the real figures, never a rate-limit or other error.
let w: World; let U: Browser[];
const NO_RATE = JSON.stringify({ reserve_user: 1e6, reserve_portal: 1e6, reserve_org: 1e6, status_user: 1e6, status_portal: 1e6, batch_action_user: 1e6, api_portal: 1e6, api_org: 1e6 });
beforeAll(async () => { w = await makeWorld(8816, 6, { RATE_OVERRIDES: NO_RATE }); U = w.users; }, 400000);
afterAll(async () => { await w?.stop(); }, 120000);
const S = () => `"${w.tdb.schema}"`;
const rng = (seed: number) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };

for (const seed of [11, 202, 3033]) {
  test(`random reservation sizes obey the shared ceiling and release exactly once (seed ${seed})`, async () => {
    const rand = rng(seed);
    await w.admin.unsafe(`update ${S()}.upload_batches set reservation_state = 'released', cancelled_at = coalesce(cancelled_at, now()), released_at = now(), finished_at = now() where reservation_state = 'held'`);
    await w.admin.unsafe(`update ${S()}.portal_capacity set reserved = 0`);
    const held = new Map<string, { size: number; owner: number }>();
    let admitted = 0, refused = 0;
    for (let round = 0; round < 10; round++) {
      const asks = Array.from({ length: 7 }, () => ({ size: 1 + Math.floor(rand() * 180), who: Math.floor(rand() * U.length), kind: rand() < 0.5 ? ("cv" as const) : ("jd" as const) }));
      const rs = await Promise.all(asks.map((a) => U[a.who].post("/api/batches", { kind: a.kind, files: a.size, bytes: a.size * 1000 })));
      const ok = rs.map((r, i) => ({ r, a: asks[i] })).filter((x) => x.r.status === 201), no = rs.map((r, i) => ({ r, a: asks[i] })).filter((x) => x.r.status !== 201);
      for (const x of ok) { held.set(x.r.body.id, { size: x.a.size, owner: x.a.who }); admitted++; }
      refused += no.length;
      const cap = (await U[0].get("/api/capacity")).body;
      const sum = [...held.values()].reduce((n, h) => n + h.size, 0);
      expect(cap.reserved, `round ${round}: ceiling`).toBeLessThanOrEqual(500);
      expect(cap.reserved, `round ${round}: reserved equals the admitted sizes`).toBe(sum);
      expect((await w.admin.unsafe(`select reserved from ${S()}.portal_capacity limit 1`))[0].reserved, `round ${round}: counter`).toBe(sum);
      for (const x of no) {
        expect(x.r.status, `round ${round}: refusal kind`).toBe(409); expect(x.r.body.error.code).toBe("CAPACITY-001");
        expect(x.r.body.error.requested).toBe(x.a.size);
        expect(x.a.size, `round ${round}: a refused ${x.a.size} must not have fitted in the ${500 - cap.reserved} left`).toBeGreaterThan(500 - cap.reserved);
      }
      // close a random subset (by their owners): their slots return, once
      for (const [id, h] of [...held]) if (rand() < 0.45) { expect((await U[h.owner].post(`/api/batches/${id}/cancel`)).status).toBe(200); held.delete(id); }
      const after = (await U[1].get("/api/capacity")).body, sum2 = [...held.values()].reduce((n, h) => n + h.size, 0);
      expect(after.reserved, `round ${round}: after closing`).toBe(sum2);
      expect((await w.admin.unsafe(`select reserved from ${S()}.portal_capacity limit 1`))[0].reserved).toBe(sum2);
    }
    expect(admitted).toBeGreaterThan(10); expect(refused).toBeGreaterThan(0);   // the run really did hit the ceiling, not only fit under it
    const closes = await w.admin.unsafe(`select entity_id, count(*)::int c from ${S()}.audit_events where action = 'batch.finished' group by entity_id having count(*) > 1`);
    expect(closes).toEqual([]);   // no batch was released twice
  }, 600000);
}
