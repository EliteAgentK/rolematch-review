import { beforeAll, describe, expect, it } from "vitest";
import { createElement as h } from "react";
import { renderHtml, stubWindow } from "../testing/ssr";

// The page's code is loaded once, before the tests, with time of its own: loaded inside the first test, its compile counted against that test's
// five seconds and failed it on a busy machine (independent audit, 20 Nov 2026), though nothing it checks was wrong.
let page: typeof import("./OverviewPage");
beforeAll(async () => { stubWindow(); page = await import("./OverviewPage"); }, 60_000);

// Code review, 16 Nov 2026, G-M8: the Candidates, Open jobs and Shortlisted blocks, the chart's legend chips and the phone's Strongest matches list answered
// only a mouse (no role, no Tab stop, no keys), and the chart's daily figures could only be read by pointing at them.
describe("the Overview's blocks work from the keyboard", () => {
  it("a pressable block is a named button reached with Tab, pressed with Enter or Space, and other keys are left alone", async () => {
    stubWindow();
    const { pressable } = page;
    let pressed = 0;
    const p = pressable(() => { pressed++; }, "Open jobs: 12. Open them on the Matching Board");
    expect(p).toMatchObject({ role: "button", tabIndex: 0, "aria-label": "Open jobs: 12. Open them on the Matching Board" });
    const key = (k: string) => { const e = { key: k, prevented: false, preventDefault() { this.prevented = true; } }; p.onKeyDown(e); return e.prevented; };
    expect(key("Enter")).toBe(true); expect(key(" ")).toBe(true); expect(key("Tab")).toBe(false);
    expect(pressed).toBe(2);
    expect(pressable(() => {}, "Show CVs read on the chart", false)["aria-pressed"]).toBe(false);
  });
  it("each pair in the phone's Strongest matches list is a named button", async () => {
    stubWindow();
    const { Strongest } = page;
    const items = [{ candidateId: "c1", candidateName: "Ann Dube", candidateRole: "Analyst", jobId: "j1", jobTitle: "Data Analyst", jobLocation: "Durban", score: 91 }];
    const html = await renderHtml(h(Strongest, { items, days: 7, open: () => {} }));
    const pair = html.match(/<div[^>]*class="pair clickable"[^>]*>/)?.[0] ?? "";
    expect(pair).toContain('role="button"');
    expect(pair).toContain('tabindex="0"');
    expect(pair).toContain("aria-label=\"Open Ann Dube&#x27;s saved assessment for Data Analyst, score 91\"");
  });
  it("the activity chart takes focus and says how to read each day", async () => {
    stubWindow();
    const { ActivityChart } = page;
    const data = { dates: ["2026-11-14", "2026-11-15", "2026-11-16"], cv: [1, 2, 3], jobs: [0, 0, 1], match: [2, 0, 1], sl: [0, 1, 0] };
    const html = await renderHtml(h(ActivityChart, { data, on: { cv: true, match: true, sl: true } }));
    const chart = html.match(/<div[^>]*class="chart"[^>]*>/)?.[0] ?? "";
    expect(chart).toContain('tabindex="0"');
    expect(chart).toMatch(/aria-label="[^"]*arrow keys/);
  });
});
