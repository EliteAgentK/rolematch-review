import { describe, expect, it } from "vitest";
import { requestOrder } from "./requestOrder";

/** A stand-in for the board: reads that answer in whatever order the test chooses, and saves that put their own result on the board at once. */
function board() {
  const order = requestOrder(), server = { phone: "old" }, shown = { phone: "old" }, pending: (() => void)[] = [];
  let reads = 0;
  const reload = () => {
    const ticket = order.begin(), copy = { ...server }; reads++;
    pending.push(() => {
      if (order.current(ticket)) shown.phone = copy.phone;
      else if (order.overtakenByWrite(ticket)) reload();   // a change was saved here meanwhile: read again rather than show the older copy
    });
  };
  const save = (phone: string) => { server.phone = phone; shown.phone = phone; order.wrote(); };
  const answerOldest = () => pending.shift()!();
  return { reload, save, answerOldest, shown, reads: () => reads, waiting: () => pending.length };
}

// Code review, 16 Nov 2026, E-M1: a batch poll starts a reload, the recruiter saves a corrected phone number, the save answers first, then the older
// reload lands and puts the old record back in the list and the panel; the next edit is then sent against the old version and refused as a conflict.
describe("the board's reloads and saves: the newest wins", () => {
  it("a reload that began before a save never puts the older record back", () => {
    const b = board();
    b.reload();                 // a batch poll asks for the board (the server still has the old number)
    b.save("082 555 0101");     // the recruiter's correction is saved and shown
    b.answerOldest();           // the older reload lands
    expect(b.shown.phone).toBe("082 555 0101");
    expect(b.waiting()).toBe(1);   // and the board is read again, so what changed elsewhere meanwhile still arrives
    b.answerOldest();
    expect(b.shown.phone).toBe("082 555 0101");
    expect(b.reads()).toBe(2);
  });
  it("of two reloads, an older answer arriving last is not shown, and nothing is read again for it", () => {
    const order = requestOrder(), first = order.begin(), second = order.begin();
    expect(order.current(second)).toBe(true);
    expect(order.current(first)).toBe(false);
    expect(order.overtakenByWrite(first)).toBe(false);
  });
  it("a reload that began after the save is shown", () => {
    const b = board();
    b.save("082 555 0101");
    b.reload();
    b.answerOldest();
    expect(b.shown.phone).toBe("082 555 0101");
    expect(b.reads()).toBe(1);
  });
});
