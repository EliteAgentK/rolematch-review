// How a CV is read: ONE fixed plan, top to bottom; every step has its place on the candidate panel (under its tabs since 10 Nov 2026). The parser never improvises an order and never
// moves past a step before it has either found what the step is for or run out of ways to look. What it did is written down per step, so a
// person can see "Education: found under the Certifications heading" or "Education: not found (checked: ...)" for every document.
//
// To change how a section is read, change its strategies where the parser defines them. To change WHICH sections exist or which are required,
// change this file (and the panel). The contract this implements is written out in docs/parser/EXTRACTION_CONTRACT.md.
export type StepId = "identity" | "summary" | "skills" | "education" | "experience" | "projects" | "notable";

export const CV_PLAN: readonly { id: StepId; label: string; /** a document without this is flagged for a person to look at */ required: boolean }[] = [
  { id: "identity", label: "Name and contact details", required: true },
  { id: "summary", label: "Professional summary", required: false },
  { id: "skills", label: "Skills", required: true },
  { id: "education", label: "Education and certifications", required: true },
  { id: "experience", label: "Work history", required: true },
  { id: "projects", label: "Projects", required: false },
  { id: "notable", label: "Worth noting", required: false },
];

export interface StepReport {
  step: StepId;
  status: "found" | "not_found";
  /** the first way of looking that produced something, or "" when none did */
  via: string;
  count: number;
  /** every way of looking that was tried, in order */
  tried: string[];
}

/** Tries each way of looking, in order, and stops at the first that finds something. Always records what happened. */
export function runStep<T>(id: StepId, reports: StepReport[], strategies: [name: string, run: () => T][], count: (found: T) => number): T {
  const tried: string[] = [];
  let last!: T;
  for (const [name, run] of strategies) {
    tried.push(name);
    last = run();
    const n = count(last);
    if (n > 0) { reports.push({ step: id, status: "found", via: name, count: n, tried }); return last; }
  }
  reports.push({ step: id, status: "not_found", via: "", count: 0, tried });
  return last;
}
