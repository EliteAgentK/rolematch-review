// A job's lists under the job's own headings (server/src/jobReader.ts keeps, beside each list, how many of its items each heading holds, in order).

/** A list under the job's own headings. The groups say how many items each heading holds, in order; if a recruiter's edit changed the list so the counts no
 *  longer add up, the list is shown whole rather than under headings that no longer fit it. */
export function groupsOf(items: string[] = [], groups: { heading: string; count: number }[] = []): { heading: string; items: string[] }[] {
  if (!groups.length || groups.reduce((n, g) => n + g.count, 0) !== items.length) return items.length ? [{ heading: "", items }] : [];
  let at = 0;
  return groups.map((g) => { const part = items.slice(at, at + g.count); at += g.count; return { heading: g.heading, items: part }; });
}
