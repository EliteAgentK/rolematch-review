/**
 * Keeps an older answer from overwriting newer state (code review, 16 Nov 2026, E-M1). The board reads its records again often (every 2 s while a batch
 * runs) and also puts a save's own answer on screen at once; answers arrive in any order, so whichever landed last used to win, whatever its age.
 *
 * Each read takes a ticket when it starts. Its answer is shown only while it is still the newest thing that happened: no later read has started, and no
 * change has been saved here since. A read overtaken by a later read is simply dropped (the later one shows). A read overtaken only by a saved change is
 * read again, so the save stays on screen and anything else that changed meanwhile still arrives.
 */
export function requestOrder() {
  let latest = 0, lastWrite = 0;
  return {
    /** A read is starting: its ticket. */
    begin: () => ++latest,
    /** A change saved here has just been put on screen: every read already on its way is older than it. */
    wrote: () => { lastWrite = ++latest; },
    /** May this read's answer be shown? */
    current: (ticket: number) => ticket === latest,
    /** Was this read overtaken only by a change saved here (no later read is on its way to replace it)? Then read again. */
    overtakenByWrite: (ticket: number) => ticket !== latest && latest === lastWrite,
  };
}
