// Whether two stored values are the same, whatever order their keys are in. PostgreSQL's jsonb keeps an object's keys in its own order (shorter keys
// first), not the order they were written in, so comparing JSON text finds a "change" where there is none: on 10 Nov 2026 a job read again reported its
// requirement groups as changed when every value was the same. Compare stored values with this, never by their JSON text (test/same-json.test.ts
// keeps every file to that).

/** The value with every object's keys in one order, so equal values give equal text. Arrays keep their order: a list's order is part of what it says. */
function ordered(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(ordered);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, ordered((v as Record<string, unknown>)[k])]));
  return v;
}

export const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(ordered(a)) === JSON.stringify(ordered(b));
