// The one conversion from an assessment's alignment percentage to stars (owner, 2026-10-30). Stars describe ONE candidate–job assessment: they are
// worked out when shown, never stored, and never a rating of the person. One star is 20 percentage points and half a star is 10 (owner, 2026-11-04), so 90% is 4.5 stars.
// The one rounding rule: exact value = percentage ÷ 20, shown to the nearest half star, and a value exactly between two halves goes up (85% shows 4.5). The
// percentage is always shown beside them. Ranking never uses the stars: it stays on the server's approved order (server/src/scoring.ts compareRank).

export interface StarValue { percent: number; exact: number; shown: number }

/** null when there is no valid assessment to show (missing, not a number, or outside 0–100): the display says "Assessment unavailable", never 0 stars. */
export function alignmentStars(percent: unknown): StarValue | null {
  if (typeof percent !== "number" || !Number.isFinite(percent) || percent < 0 || percent > 100) return null;
  // Halves are counted on the percentage itself (one half star per 10%), so 85% is exactly 8.5 halves and rounds up to 4.5 stars, with no floating-point drift.
  return { percent, exact: percent / 20, shown: Math.round(percent / 10) / 2 };
}

/** "4.5 of 5 stars (90%)": the words a screen reader hears, and the tooltip. */
export const describeStars = (v: StarValue) => `${String(v.shown).replace(/\.0$/, "")} of 5 stars (${v.percent}%)`;
