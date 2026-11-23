// Which kind of document is this? A recorded label only: it changes nothing about how the document is read.
// Real CVs arrive in a few very consistent families (LinkedIn's PDF export, Europass, design-tool templates) and in an endless tail of the rest. Knowing which
// family a document belongs to, across many real documents, shows which families deserve a dedicated reader. The label always carries its evidence.

export interface LayoutFamily { family: "linkedin-export" | "europass" | "canva" | "word-template" | "google-docs" | "scanner-or-photo" | "other"; evidence: string[] }

/** `producer` and `creator` are the PDF's own metadata fields (inspect.ts); `kind` is the file type; `text` is what the reader found. */
export function layoutFamily(input: { kind: string; producer?: string; creator?: string; text: string }): LayoutFamily {
  const maker = `${input.producer ?? ""} ${input.creator ?? ""}`.toLowerCase(), t = input.text, evidence: string[] = [];
  if (["jpeg", "png", "webp", "tiff", "bmp", "gif"].includes(input.kind)) return { family: "scanner-or-photo", evidence: [`file type ${input.kind}`] };
  if (/\beuropass\b/i.test(t) || /europass/.test(maker)) return { family: "europass", evidence: ["the word Europass"] };
  // LinkedIn's export: a sidebar headed Contact / Top Skills / Languages, and "Page n of m" at the foot of every page
  const linkedinHeads = ["Contact", "Top Skills", "Languages", "Certifications", "Honors-Awards"].filter((h) => new RegExp(`^${h}$`, "m").test(t));
  if (linkedinHeads.includes("Top Skills") && linkedinHeads.length >= 2 && (/linkedin\.com\/in\//i.test(t) || /Page \d+ of \d+/.test(t))) return { family: "linkedin-export", evidence: [`headings ${linkedinHeads.join(", ")}`] };
  if (/canva/.test(maker)) return { family: "canva", evidence: [`made with ${maker.trim()}`] };
  if (/google docs|skia\/pdf/.test(maker) && /google/.test(maker)) return { family: "google-docs", evidence: [`made with ${maker.trim()}`] };
  if (/microsoft.*word|word/.test(maker) && /word/.test(maker)) { evidence.push(`made with ${maker.trim()}`); return { family: "word-template", evidence }; }
  return { family: "other", evidence: maker.trim() ? [`made with ${maker.trim()}`] : [] };
}
