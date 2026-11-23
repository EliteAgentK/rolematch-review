import { describe, expect, it } from "vitest";
import { boardAccess } from "./portalRole";

const mine = [{ id: "p1", name: "Head office", role: "recruiter" }, { id: "p2", name: "Branch", role: "hiring_manager" }];

// Code review, 16 Nov 2026, E-M4: view-only (a hiring manager) was worked out from a separate request whose failure was swallowed, and until it answered
// (or for good, if it failed) the board offered uploads, Match, Select, Delete, Edit and the notepad, every one of which the server then refused.
describe("what the board offers in a portal", () => {
  it("changes only where the person's role is known and allows them", () => {
    expect(boardAccess(mine, "p1")).toBe("change");
    expect(boardAccess([{ id: "p3", name: "Admin", role: "admin" }], "p3")).toBe("change");
  });
  it("viewing only for a hiring manager", () => {
    expect(boardAccess(mine, "p2")).toBe("view");
  });
  it("nothing to change while the role is not known: not loaded yet, failed to load, or a portal not in the list", () => {
    expect(boardAccess(null, "p1")).toBe("unknown");
    expect(boardAccess([], "p1")).toBe("unknown");
    expect(boardAccess(mine, "elsewhere")).toBe("unknown");
    expect(boardAccess([{ id: "p1", name: "x", role: "" }], "p1")).toBe("unknown");
  });
  it("with no portal chosen, the first portal (as the portal selector shows it)", () => {
    expect(boardAccess(mine, null)).toBe("change");
  });
});
