/**
 * A page's blocks rise into place from the top of the page to the bottom (owner, 10 Nov 2026: "it appears from top to bottom, pretty quickly, but still
 * with some elegance, but it must still be quick"). What is shown is already loaded, so nothing waits for it: each block rises in 0.3 s, the lowest
 * starting 0.15 s after the highest. Used when the Overview changes period or view and when the Matching Board opens. Left out on a device set to
 * reduce motion.
 */
export function revealTopToBottom(selector: string) {
  if (typeof window === "undefined" || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const blocks = [...document.querySelectorAll<HTMLElement>(selector)].filter((b) => b.offsetParent !== null && typeof b.animate === "function");
  if (!blocks.length) return;
  const tops = blocks.map((b) => b.getBoundingClientRect().top), lo = Math.min(...tops), hi = Math.max(...tops);
  blocks.forEach((b, i) => b.animate([{ opacity: 0.2, transform: "translateY(10px)" }, { opacity: 1, transform: "none" }],
    { duration: 300, delay: hi > lo ? ((tops[i] - lo) / (hi - lo)) * 150 : 0, easing: "cubic-bezier(.16,1,.3,1)", fill: "backwards" }));
}
