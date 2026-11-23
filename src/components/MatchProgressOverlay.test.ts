import { describe, expect, it } from "vitest";
import { errorLine, failedRunNote } from "./MatchProgressOverlay";

// Code review, 16 Nov 2026, E-M5: when a matching run failed part-way (say, one candidate deleted meanwhile), the window said "Nothing was changed" while
// every match already handed to the AI carried on being scored and charged, and became a recorded match. After the AI's own time-out message ("The
// scoring carries on") it contradicted itself.
describe("what a failed matching run says", () => {
  it("never says nothing was changed on its own account", () => {
    expect(errorLine({ error: "That candidate is no longer in this portal." })).toBe("That candidate is no longer in this portal.");
    expect(errorLine({})).toBe("Something went wrong.");
  });
  it("says matches already with the AI carry on and use credits, and that what it finishes is kept", () => {
    expect(failedRunNote(3)).toBe("3 matches were already with the AI. They carry on and use usage credits; each one it finishes is kept and opens at once the next time.");
    expect(failedRunNote(1)).toBe("One match was already with the AI. It carries on and uses usage credits; when it is finished it is kept and opens at once the next time.");
  });
  it("says no credits were used when nothing had gone to the AI", () => {
    expect(failedRunNote(0)).toBe("Nothing had been sent to the AI, so no usage credits were used.");
  });
  it("says that matches still being sent when it failed are withdrawn, and claims no saving of credits then", () => {
    expect(failedRunNote(0, 2)).toBe("2 more that were being sent are withdrawn as they arrive.");
    expect(failedRunNote(1, 1)).toBe("One match was already with the AI. It carries on and uses usage credits; when it is finished it is kept and opens at once the next time. One more that was being sent is withdrawn as it arrives.");
  });
  it("puts the two together", () => {
    expect(errorLine({ error: "The server could not be reached.", afterError: failedRunNote(0) })).toBe("The server could not be reached. Nothing had been sent to the AI, so no usage credits were used.");
  });
});
