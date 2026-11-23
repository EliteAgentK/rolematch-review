// How a person, a job and their details are shown, the same on every page, decided once, here, for every reply (owner, 11 Nov 2026, on a test candidate's name shown in capitals:
// "everything needs to show up the same ... configure consistency through the site"). The record keeps the CV's own wording (owner,
// 9 Nov 2026); what leaves the server is shown by one rule (shownCase in displayCase.ts): a name, title, role, employer, qualification or a job's stated
// fact is shown in its normal written form, in the AI's form where it gave one (the record's displayNames, passed down to its jobs and qualifications).
import { allCaps, displayCase, shownCase } from "./displayCase";

// Names and titles: only a value written in capitals is changed, so a code that shares a key ("role": "admin") is never touched.
const SHOWN = new Set(["name", "title", "role", "company", "position", "institution", "degree", "qualification", "employer", "candidateName", "candidateRole", "jobTitle", "who"]);
// A job's stated facts, shown in their written form whatever the job description's capitals ("reports to department manager"); "location" and "type"
// only on a job (a record with requirements), where they are facts and not codes; and each further fact of its key-facts table ({ label, value }).
const FACTS = new Set(["reportsTo", "workArrangement", "remuneration", "jobLocation"]), JOB_FACTS = new Set(["location", "type"]);
/** A JSON.stringify replacer; `this` is the object holding the value. A record's displayNames reach every object and list inside it. */
function shownForPeople(this: unknown, key: string, value: unknown, names = new WeakMap<object, Record<string, string>>()) {
  const holder = this as { displayNames?: Record<string, string> } | null, from = holder && (holder.displayNames ?? names.get(holder as object));
  if (from && value && typeof value === "object" && !names.has(value)) names.set(value, from);
  if (typeof value !== "string") return value;
  const onJob = !!holder && Array.isArray((holder as { requirements?: unknown }).requirements);
  const fact = FACTS.has(key) || (onJob && JOB_FACTS.has(key)) || (key === "value" && !!holder && typeof (holder as { label?: unknown }).label === "string");
  if (fact) return shownCase(value, from, key === "reportsTo" || key === "location" || key === "jobLocation");   // a job title and a place are written as titles
  return SHOWN.has(key) && allCaps(value) ? displayCase(value, from) : value;
}
/** The replacer for one reply, with its own memory of which displayNames belong where. */
export const shownReplacer = () => { const names = new WeakMap<object, Record<string, string>>(); return function (this: unknown, key: string, value: unknown) { return shownForPeople.call(this, key, value, names); }; };
