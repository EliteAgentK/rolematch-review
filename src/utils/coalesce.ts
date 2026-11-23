/**
 * Turns a burst of calls into one: `fn` runs `quietMs` after the last call, and at least once every `maxWaitMs` while calls keep coming. Used by the
 * Overview, where every change saved in the browser (each file of a batch is one) used to fetch its figures and re-warm every period at once (code review,
 * 16 Nov 2026, G-M9).
 */
export function coalesce(fn: () => void, quietMs: number, maxWaitMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined, first = 0;
  const run = () => { timer = undefined; first = 0; fn(); };
  return {
    call() {
      const now = Date.now();
      if (!first) first = now;
      if (timer) clearTimeout(timer);
      timer = setTimeout(run, Math.max(0, Math.min(quietMs, first + maxWaitMs - now)));
    },
    cancel() { if (timer) clearTimeout(timer); timer = undefined; first = 0; },
  };
}
