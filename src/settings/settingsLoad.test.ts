import { describe, expect, it } from "vitest";
import { afterLoad } from "./SettingsContext";
import type { SettingsResponse } from "./types";

const good = { orgName: "Acme" } as unknown as SettingsResponse;

// Code review, 16 Nov 2026, G-M5: a failed settings load looked like a healthy page with no settings (raw status keys in grey, an empty status picker,
// only notes and status editable, nothing said), and a failed reload after a save replaced settings that had loaded with nothing.
describe("the organisation's settings after a load", () => {
  it("a successful load is used", () => {
    expect(afterLoad({ response: null, failed: false }, { ok: true, response: good })).toEqual({ response: good, failed: false });
  });
  it("a failed first load is marked as failed, so the page can say so", () => {
    expect(afterLoad({ response: null, failed: false }, { ok: false })).toEqual({ response: null, failed: true });
  });
  it("a failed reload keeps the settings that had loaded", () => {
    expect(afterLoad({ response: good, failed: false }, { ok: false })).toEqual({ response: good, failed: false });
  });
});
