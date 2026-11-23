// Moving between the Overview and the Matching Board (owner, 10 Nov 2026: "nice appearing animations ... purposeful, corporate level, nothing tacky"):
// the browser's View Transitions draw the old page out and the new page in (src/theme/motion.css, the "page" rules), with the header held still. Where the
// browser has no View Transitions, or the person asks for less motion, the page simply changes. The route change is flushed inside the transition so
// the browser captures the new page as it really is.
import { flushSync } from "react-dom";
import type { NavigateFunction } from "react-router-dom";

export function navigateWithTransition(navigate: NavigateFunction, to: string) {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  const still = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!doc.startViewTransition || still) { navigate(to); return; }
  // A transition the browser skips (a hidden tab, say) still changes the page; its promises are settled here so a skip leaves no error behind.
  const t = doc.startViewTransition(() => flushSync(() => navigate(to))) as { ready?: Promise<unknown>; finished?: Promise<unknown>; updateCallbackDone?: Promise<unknown> } | undefined;
  for (const p of [t?.ready, t?.finished, t?.updateCallbackDone]) p?.catch(() => {});
}
