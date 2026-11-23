import { beforeAll, expect, it } from "vitest";
import { createElement as h } from "react";
import { renderText, stubWindow } from "../testing/ssr";

// The page's code is loaded once, before the tests, with time of its own: loaded inside the first test, its compile counted against that test's
// five seconds and failed it on a busy machine (independent audit, 20 Nov 2026), though nothing it checks was wrong.
let page: typeof import("./Dashboard");
beforeAll(async () => { stubWindow(); page = await import("./Dashboard"); }, 60_000);

// Code review, 16 Nov 2026, E-M10: what the board says above a list that stopped at the client's cap of 5,000 records (src/api/client.ts, listCapped).
it("a list cut short says how many are loaded, how many there are, and what that leaves out", async () => {
  stubWindow();
  const { ListCapNotice } = page;
  const text = await renderText(h(ListCapNotice, { cap: { shown: 5_000, total: 6_200 }, noun: "candidates" }));
  expect(text).toBe("Only the newest 5,000 of 6,200 candidates are loaded on this board. Search, filters, Select all and Match all cover these 5,000 only.");
});

// Code review, 16 Nov 2026, E-M4: in place of the upload boxes, what a person sees when the board offers no changes.
it("a role not confirmed yet says so and offers to check again; a hiring manager reads the read-only note", async () => {
  stubWindow();
  const { AccessNotice } = page;
  expect(await renderText(h(AccessNotice, { access: "unknown", onRetry: () => {} }))).toBe("Checking your role in this portal. Until it is confirmed, uploads and changes are not offered here. Check again");
  expect(await renderText(h(AccessNotice, { access: "view", onRetry: () => {} }))).toMatch(/^Read-only: you see shortlisted candidates/);
});
