// Reading work that its caller has stopped wanting, because a time limit ran out. A promise cannot be stopped from outside, so long work (OCR page by page,
// a PDF read page by page, the optimiser) is given an AbortSignal and checks it between pages: at most the page under way is finished, never the rest of the
// document (code review, 16 Nov 2026, B-M3 and B-M7).
export class Stopped extends Error { constructor() { super("The reading was stopped: its time ran out."); } }
/** Throws Stopped once the signal has been aborted; called between pages. */
export const stopIfAsked = (signal?: AbortSignal) => { if (signal?.aborted) throw new Stopped(); };
