export const rolematchConfig = {
  // Owner, 8 Nov 2026: hide the "needs review" and "points to check" prompts for now ("we're ensuring accuracy without need for review"). The server still
  // records every flag and reason; turning this back on shows them again without a release of the data.
  review: { showPrompts: false },
  // Owner, 8 Nov 2026: no Limits tab in Settings for now ("get rid of this limits section"). The fair-use limits still apply, at the platform defaults:
  // they protect the shared service, so only their screen is hidden. The Review rules tab follows review.showPrompts.
  settings: { showLimits: false },
  uploads: {
    acceptedExtensions: ["pdf", "docx"],
    maxSizeMb: 10,
  },
  // These keys match the stages reported by the server for every uploaded document.
  processingStages: [
    { key: "received", label: "Upload received", detail: "The file is stored privately and its checksum recorded." },
    { key: "security", label: "File checks", detail: "The real file type is verified. A malware scanner is not connected yet, so none is claimed." },
    { key: "optimising", label: "Making the file smaller", detail: "Large scans are re-encoded at a reading-quality resolution, and kept only if every word still reads the same." },
    { key: "reading", label: "Reading document", detail: "Text is read from the file. Photos and scans are straightened, cleaned and read by OCR." },
    { key: "extracting", label: "Extracting structured data", detail: "Fields are extracted and each fact must be backed by text in the document." },
    { key: "validating", label: "Validating evidence", detail: "Identity, readable content and supporting evidence are checked before publication." },
    { key: "auditing", label: "Being read by the AI" },   // no description: which AI reads it is never said to a user (owner, 11 Nov 2026)
    { key: "ready", label: "Published", detail: "The validated record is now available for matching." },
  ],
  matching: {
    bands: {
      exceptional: { min: 90, label: "Exceptional documented fit", action: "Priority human review" },
      strong: { min: 80, label: "Strong documented fit", action: "Human review recommended" },
      plausible: { min: 65, label: "Plausible fit with material gaps", action: "Review evidence and gaps" },
      partial: { min: 45, label: "Partial alignment", action: "Use only where context supports it" },
      limited: { min: 0, label: "Limited documented evidence", action: "Not a universal judgement of the candidate" },
    },
    confidenceBands: {
      high: "Most material requirements have direct, recent and internally consistent evidence.",
      medium: "Useful evidence exists, but one or more material requirements rely on partial evidence or remain unknown.",
      low: "The documents do not contain enough reliable evidence to support a comfortable score.",
    },
  },
} as const;
