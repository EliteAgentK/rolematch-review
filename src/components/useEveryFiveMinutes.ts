import { useEffect, useRef } from "react";

// Team and history refresh every five minutes (owner's decision, 2026-11-05), only while the page is on screen, and once on coming back to it if the last look is older than that.
// A small random spread stops a whole organisation asking in the same second. The server counts someone as in the portal for six minutes, which this stays inside.
const FIVE_MINUTES = 5 * 60_000, SPREAD = 20_000;
export function useEveryFiveMinutes(refresh: () => void) {
  const latest = useRef(refresh); latest.current = refresh;
  useEffect(() => {
    let last = Date.now(), timer: number | undefined;
    const plan = () => { window.clearTimeout(timer); if (!document.hidden) timer = window.setTimeout(run, FIVE_MINUTES + Math.random() * SPREAD); };
    const run = () => { last = Date.now(); latest.current(); plan(); };
    const onVisible = () => { if (document.hidden) { window.clearTimeout(timer); return; } if (Date.now() - last >= FIVE_MINUTES) run(); else plan(); };
    document.addEventListener("visibilitychange", onVisible); plan();
    return () => { window.clearTimeout(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, []);
}
