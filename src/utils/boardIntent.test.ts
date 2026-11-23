import { describe, expect, it } from "vitest";
import { boardLink, parseFocus, type BoardFocus } from "./boardIntent";

const search = (link: string) => link.slice(link.indexOf("?"));

describe("the link contract between the Overview and the Matching Board", () => {
  it("every kind of link reads back as what it was made from", () => {
    const all: BoardFocus[] = [
      { kind: "new", days: 30 }, { kind: "jobs" }, { kind: "shortlisted" }, { kind: "department", dept: "Risk and compliance" },
      { kind: "match", candidateId: "c-1", jobId: "j-1" }, { kind: "record", candidateId: "c-2" }, { kind: "record", jobId: "j-2" },
      { kind: "attention", rule: "shortlist-waiting", title: "Shortlisted, waiting" },
    ];
    for (const f of all) expect(parseFocus(search(boardLink(f)))).toEqual(f);
  });
  it("an unknown or malformed link asks for nothing", () => {
    for (const s of ["", "?focus=everything", "?focus=new&days=12", "?focus=match&c=a", "?focus=match&c=<x>&j=b", "?focus=department&dept=", "?focus=attention&rule=DROP TABLE", "?focus=record"])
      expect(parseFocus(s)).toBeNull();
  });
});
