// Round numbers on a chart's axis (owner, 12 Nov 2026: the Overview's activity chart read 0, 43, 87, 130, 174, a quarter of the tallest day each).
// The step is 1, 2 or 5 times a power of ten, never below 1 (these are counts), chosen so about `about` lines cover the tallest value with a little
// headroom; the top of the axis is the first step at or above that, so the peak never touches the top edge and every label is a round number.
const NICE = [1, 2, 5, 10];

export function axisSteps(tallest: number, about = 4): { top: number; step: number; ticks: number[] } {
  const want = Math.max(0, Number.isFinite(tallest) ? tallest : 0) * 1.1;
  const raw = Math.max(1, want / about), power = 10 ** Math.floor(Math.log10(raw));
  const step = Math.max(1, (NICE.find((m) => m * power >= raw) ?? 10) * power);
  const top = Math.max(step, Math.ceil(want / step) * step);
  const ticks: number[] = [];
  for (let v = 0; v <= top + step / 2; v += step) ticks.push(v);
  return { top, step, ticks };
}
