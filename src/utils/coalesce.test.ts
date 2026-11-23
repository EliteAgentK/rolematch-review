import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { coalesce } from "./coalesce";

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

// Code review, 16 Nov 2026, G-M9: every change saved in the browser (each file of a 200-file batch is one) made the Overview fetch its figures again and
// re-warm every period at once: hundreds of recomputations from one browser. Changes close together are now one refresh.
describe("changes close together are one refresh", () => {
  it("200 changes in a second are one refresh, shortly after the last", () => {
    let runs = 0;
    const c = coalesce(() => { runs++; }, 1500, 10_000);
    for (let i = 0; i < 200; i++) { c.call(); vi.advanceTimersByTime(5); }
    expect(runs).toBe(0);
    vi.advanceTimersByTime(1500);
    expect(runs).toBe(1);
  });
  it("changes that never stop still refresh at least every ten seconds, never more often than that while they keep coming", () => {
    let runs = 0;
    const c = coalesce(() => { runs++; }, 1500, 10_000);
    for (let t = 0; t < 30_000; t += 500) { c.call(); vi.advanceTimersByTime(500); }
    expect(runs).toBe(3);
  });
  it("one change on its own refreshes once", () => {
    let runs = 0;
    const c = coalesce(() => { runs++; }, 1500, 10_000);
    c.call(); vi.advanceTimersByTime(60_000);
    expect(runs).toBe(1);
  });
  it("stopping cancels a refresh not yet run", () => {
    let runs = 0;
    const c = coalesce(() => { runs++; }, 1500, 10_000);
    c.call(); c.cancel(); vi.advanceTimersByTime(60_000);
    expect(runs).toBe(0);
  });
});
