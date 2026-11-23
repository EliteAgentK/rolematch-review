import { lazy, Suspense, useEffect, useState, type ComponentType } from "react";
import type { AnimationProps } from "./AnimationPlayer";

// The animation player and its rendering engine (about 1.2 MB) load on their own, once the page is showing and the browser is idle, never before the
// page (owner, 11 Nov 2026, PageSpeed: the engine was the slowest item on the sign-in page). Until then the animation's place is held at its size, so
// nothing moves when it appears.
// If the player cannot be fetched (a release replaced it while this page was open), its place stays empty: an animation never takes a page down with it.
const Player = lazy<ComponentType<AnimationProps>>(() => import("./AnimationPlayer").catch(() => ({ default: () => null })));
const whenIdle = (fn: () => void) => { const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }; if (w.requestIdleCallback) w.requestIdleCallback(fn, { timeout: 1500 }); else setTimeout(fn, 300); };

export default function Animation(props: AnimationProps) {
  const [ready, setReady] = useState(false);
  useEffect(() => { let on = true; whenIdle(() => { if (on) setReady(true); }); return () => { on = false; }; }, []);
  const hold = <div style={{ ...props.style }} aria-hidden />;
  return ready ? <Suspense fallback={hold}><Player {...props} /></Suspense> : hold;
}
