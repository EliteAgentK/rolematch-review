import { describe, expect, it } from "vitest";
import { demoHistory, demoOverview, historyFromStart } from "./demo";

const MINUTE = 60_000, at = (min: number) => Math.floor(Date.UTC(2026, 10, 16, 6, 0) / MINUTE) + min;
const snapshot = (h: ReturnType<typeof historyFromStart>) => ({ people: h.people.length, jobs: h.jobs.map((j) => [j.id, j.closed]), moves: h.moves, matches: h.matches.length, events: h.events, failed: h.failed });

// Code review, 16 Nov 2026, G-M12: the Demo company was rebuilt from the start every minute: about 108,000 working minutes, each filtering every job, some
// 20 million steps on the main thread (measured 50 to 85 ms a rebuild on a fast Mac before the change; far more on a phone), once a minute while the Demo
// was shown. The history is now kept and lived on only by the minutes since the last look.
describe("the Demo company's history", () => {
  it("a minute later, only that minute is lived, not six months again", () => {
    const first = demoHistory(at(0)).steps;
    const later = demoHistory(at(1)).steps;
    expect(first).toBeGreaterThan(10_000);
    expect(later - first).toBeLessThanOrEqual(1);
  });
  it("the kept history, lived on, is the same company as one built from the start", () => {
    demoHistory(at(0));
    for (const m of [1, 5, 61, 600, 1_000]) expect(snapshot(demoHistory(at(m)))).toEqual(snapshot(historyFromStart(at(m) * MINUTE)));
  });
  it("its figures for a moment do not depend on what was looked at before", () => {
    const now = at(1_440 * 2 + 30) * MINUTE;
    const after = demoOverview(30, now);
    demoHistory(at(0));   // looking at an earlier minute builds it again from the start
    expect(demoOverview(30, now)).toEqual(after);
  });
});

// Code review, 16 Nov 2026, G-M1: the period was "now minus N days" while the chart drew N calendar days, so what happened in the oldest day's hours
// before midnight was counted in the period's figures but drawn on no day, and the Shortlisted headline (the sum of the days drawn) disagreed with the
// period's own count. The Demo is worked out as Live is (server/src/orgOverview.ts): the period is the days drawn, Johannesburg's days.
describe("the Demo's period is exactly the days its chart draws", () => {
  const now = Date.UTC(2026, 10, 16, 13, 0);   // Monday 16 November 2026, 15:00 in Johannesburg
  for (const days of [7, 30]) {
    it(`${days} days: every figure of the period is the sum of its days, and the last day drawn is today in Johannesburg`, () => {
      const o = demoOverview(days, now), sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
      expect(o.series.dates).toHaveLength(days);
      expect(o.series.dates[days - 1]).toBe("2026-11-16");
      expect(sum(o.series.cv)).toBe(o.pipeline.read);
      expect(sum(o.series.cv)).toBe(o.candidates.inPeriod);
      expect(sum(o.series.sl)).toBe(o.pipeline.shortlisted);
    });
  }
  it("a day drawn is Johannesburg's: just after midnight there is already the new day", () => {
    expect(demoOverview(7, Date.UTC(2026, 10, 16, 22, 30)).series.dates[6]).toBe("2026-11-17");   // 00:30 on 17 November in Johannesburg
  });
});
