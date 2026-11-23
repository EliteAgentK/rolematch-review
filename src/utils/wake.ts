/**
 * A pause between two checks on work the server is doing, cut short the moment the person comes back to the page (owner, 10 Nov 2026: "leaving the page
 * and sometimes going to other browsers results in the uploads hanging a bit"). The work never stops: it runs on the server's queue whatever the browser
 * does. But a browser slows the timers of a page out of sight (after a few minutes, to about once a minute), so the page could sit on an old answer for up
 * to a minute after the person returned. Coming back (the tab shown again, or the window focused) ends the pause at once, so the next check is immediate.
 */
/** A pause that ends early the moment the browser says the connection is back, so a paused upload resumes at once (owner, 10 Nov 2026). */
export function pauseUntilOnline(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => { clearTimeout(t); window.removeEventListener("online", done); resolve(); };
    const t = setTimeout(done, ms);
    window.addEventListener("online", done);
  });
}
export function pauseUntilSeen(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => { clearTimeout(t); document.removeEventListener("visibilitychange", seen); window.removeEventListener("focus", done); resolve(); };
    const seen = () => { if (!document.hidden) done(); };
    const t = setTimeout(done, ms);
    document.addEventListener("visibilitychange", seen);
    window.addEventListener("focus", done);
  });
}
