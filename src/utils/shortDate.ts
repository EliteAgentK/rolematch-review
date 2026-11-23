/** A date as a recruiter says it on a card: "10 Nov", with the year only when it is not this year. The full date goes in the card's tooltip. */
export const shortDate = (d: string | number | Date) => { const t = new Date(d); return t.toLocaleDateString("en-ZA", { day: "numeric", month: "short", ...(t.getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }) }); };
/** When a record's document was uploaded, for every card and panel (owner, 10 Nov 2026: "at a glance, we need to be able to tell what date each CV or job
 *  description was uploaded"): "Uploaded 10 Nov" to read, and the day with the exact time for the tooltip. `at` is the upload time where the record has it;
 *  `day` is the date older records carry. */
export const uploaded = (at?: string, day?: string) => { const v = at || day || ""; if (!v) return { text: "", title: "" }; const t = new Date(v);
  return { text: `Uploaded ${shortDate(v)}`, title: at ? `Uploaded ${t.toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" })} at ${t.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })}` : `Uploaded ${longDate(v)}` }; };
const longDate = (d: string | number | Date) => new Date(d).toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" });
