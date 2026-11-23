import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// Read from the file itself: imported with "?raw", the test runner handed over an empty string, so these checks passed without looking at anything
// (found 10 Nov 2026). The first check below fails if the file is not really read.
const source = readFileSync(new URL("./overview.css", import.meta.url), "utf8");

// R196 (10 Nov 2026), twice in one day: a style written for "every span" in a card also caught the avatar's initials (turned grey, then pushed into the
// corner) and the Needs attention count (hidden). Every span rule in the Overview's styles names its span: a direct child (`div > span`), a class
// (`span.av`), or an exception (`span:not(.score)`).
describe("the Overview's styles", () => {
  it("are really read", () => { expect(source).toContain(".ov .card"); });
  it("never style every span inside a card", () => {
    const css = source.replace(/\/\*[\s\S]*?\*\//g, "");
    const broad = [...css.matchAll(/[\w)\]-]\s+span(?=[\s,{:])(?!:not\()/g)].map((m) => css.slice(Math.max(0, m.index! - 40), m.index! + 12).replace(/\s+/g, " "));
    expect(broad).toEqual([]);
  });
  // Owner, 10 Nov 2026: "why do these buttons not hover". Every kind of button the Overview draws answers the pointer.
  it("give every kind of button a hover", () => {
    const css = source.replace(/\/\*[\s\S]*?\*\//g, "");
    const kinds = [".ov .seg button", ".ov .tabs button", ".ov .chip", ".ov .refresh", ".ov .evdetail button", ".ov .att", ".ov .kpi", ".ov .ev.clickable"];
    const missing = kinds.filter((k) => !new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+") + "[^{,]*:hover").test(css));
    expect(missing).toEqual([]);
  });
});
