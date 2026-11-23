import { useEffect, useState } from "react";

/** Keeps a panel on screen while its closing animation plays (src/theme/motion.css). `mounted` says whether to render it; `closing` selects the closing
 * animation. With reduced motion the closing animation does not run, so the wait is skipped and the panel goes at once. */
export function usePresence(open: boolean, exitMs = 380) {
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) { setMounted(true); return; }
    const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduced) { setMounted(false); return; }
    const t = window.setTimeout(() => setMounted(false), exitMs);
    return () => window.clearTimeout(t);
  }, [open, exitMs]);
  return { mounted: open || mounted, closing: !open && mounted };
}
