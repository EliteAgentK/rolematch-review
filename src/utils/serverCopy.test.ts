import { describe, expect, it } from "vitest";
import { followServer } from "./serverCopy";

// Review 16 Nov 2026 (E-H1): while a batch runs the board reloads every 2 s, and the open notepad was reset to the server's copy each time,
// so whatever a recruiter was typing vanished. A field follows the server only while the person has not changed it.
describe("followServer: an open field and the server's copy arriving again", () => {
  it("keeps what the person is typing when the same record arrives again", () => {
    expect(followServer("", "", "Called her, wants")).toBe("Called her, wants");
  });
  it("keeps their words even when a colleague saved different notes meanwhile (their save then meets the conflict check)", () => {
    expect(followServer("old", "colleague's", "mine")).toBe("mine");
  });
  it("follows the server when the person has not touched the field", () => {
    expect(followServer("old", "new from a colleague", "old")).toBe("new from a colleague");
  });
});
