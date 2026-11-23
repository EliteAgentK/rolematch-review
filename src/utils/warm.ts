// What the next page will need, fetched once and kept while the browser tab is open (owner, 10 Nov 2026: "start loading the actual live portal so that
// it can be appearing when you sign in under the loading screen, but that doesn't mean it should take forever"; "once you're in it should be easy
// toggling"). Signing in starts it, before the Overview has even drawn; the Overview and the Matching Board read from it, so moving between them shows
// what is already here and refreshes it behind. Everything kept is for one person in one portal: another person, another portal or signing out drops it.
import { api, selectedPortal, type Application } from "../api/client";
import type { Candidate, Job } from "../types/records";
import type { OverviewData } from "../overview/types";

export interface KeptBoard { cands: Candidate[]; jobs: Job[]; apps: Application[] }
let who: string | null = null;                                          // `${userId}|${portal}` the kept things belong to
const overviews = new Map<number, { d: OverviewData; at: number }>();   // the Live Overview by period (the Demo is made in the browser, kept by its page)
const asking = new Map<number, Promise<OverviewData>>();                 // a period already being fetched: a second ask waits for the same answer
let board: KeptBoard | null = null, boardAsking: Promise<KeptBoard> | null = null;

const scope = (userId: string) => `${userId}|${selectedPortal() ?? ""}`;
/** Whose things are kept. A different person or portal than before drops everything kept for the last one. */
export function keepFor(userId: string) {
  if (who !== scope(userId)) { forgetAll(); who = scope(userId); }
}
/** Signing out, or a session that ended: nothing of the last person stays in the page. */
export function forgetAll() { who = null; overviews.clear(); asking.clear(); board = null; boardAsking = null; }
export const keptFor = (userId: string) => who === scope(userId);

export const keptOverview = (days: number) => overviews.get(days);
/** The Live Overview for a period: the answer already on its way if there is one, otherwise asked now. Kept once it arrives. */
export function liveOverview(days: number): Promise<OverviewData> {
  const now = asking.get(days);
  if (now) return now;
  const owner = who, p = api.overview(days)
    .then((d) => { if (who === owner) overviews.set(days, { d, at: Date.now() }); return d; })
    .finally(() => { if (asking.get(days) === p) asking.delete(days); });
  asking.set(days, p);
  return p;
}
/** A change on the board makes every kept period out of date except the one about to be fetched again. */
export function staleOverviews(except?: number) { for (const k of [...overviews.keys()]) if (k !== except) overviews.delete(k); }

export const keptBoard = () => board;
export function keepBoard(b: KeptBoard) { if (who) board = b; }
/** The board's records as it opens: the fetch already under way if the Overview or sign-in started one, otherwise a new one. */
export function arrivingBoard(): Promise<KeptBoard> {
  if (boardAsking) return boardAsking;
  const owner = who, p = Promise.all([api.candidates(false), api.jobs(false), api.applications().catch(() => [] as Application[])])
    .then(([cands, jobs, apps]) => { const b = { cands, jobs, apps }; if (who === owner) board = b; return b; })
    .finally(() => { if (boardAsking === p) boardAsking = null; });
  boardAsking = p;
  return p;
}

/**
 * Started by signing in, and again by the Overview: who this is, then the Live Overview's first period (what the person sees first), then the board's
 * records (so a click on Matching Board opens at once), then the other periods. Each step is one request at a time, so the page the person is looking at
 * is never queued behind its own warming. A person with several portals and none chosen yet has no board to warm: the board asks them which. Signing in
 * already knows who it is, so it passes the person and the first figures are asked for at once, beside the check of who is here, not after it.
 */
/** The period the Overview opens on, every time RoleMatch is opened (owner, 11 Nov 2026: "the first days selected should always be last 7 days"). */
export const FIRST_PERIOD = 7;
export async function warmPortal(first = FIRST_PERIOD, signedInAs?: string) {
  try {
    if (signedInAs) keepFor(signedInAs);
    const firstFigures = signedInAs && !overviews.has(first) ? liveOverview(first).catch(() => {}) : null;
    const { user, portals } = await api.me();
    keepFor(user.userId);
    await firstFigures;
    if (!overviews.has(first)) await liveOverview(first).catch(() => {});
    if (!board && ((portals?.length ?? 0) === 1 || selectedPortal())) await arrivingBoard().catch(() => {});
    for (const n of [7, 30, 90]) if (!overviews.has(n)) await liveOverview(n).catch(() => {});
  } catch { /* signed out or unreachable: each page asks again for itself and says what is wrong */ }
}
