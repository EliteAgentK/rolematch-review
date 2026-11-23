// Turns a rejected document into words a recruiter can act on: what went wrong and what to try. The server keeps the exact code and
// message in its error log; this is only the short version for the screen.
interface Explained { reason: string; hint: string }

const CATALOGUE: Record<string, Explained> = {
  IDENTITY_UNRESOLVED: { reason: "No candidate name could be found.", hint: "Check the CV shows the person's name and an email or phone number near the top." },
  // Jobs refused for a title before 10 Nov 2026, when the word rules read jobs; a job is no longer refused for one (it waits for a recruiter to add it).
  TITLE_UNRESOLVED: { reason: "No job title could be found.", hint: "Upload it again: jobs are now read by the AI, and a job without a title is added for you to complete." },
  AI_NOT_READ: { reason: "The AI could not read this document after three tries, so it was not added.", hint: "Use Retry. If it keeps failing, the AI service may be busy or out of usage credits: tell your administrator." },
  AI_TOO_LONG: { reason: "The job description is too long for the AI to read, so it was not added.", hint: "Upload the job description on its own, without attachments or appendices." },
  STALLED: { reason: "It stopped while it was being read and could not be restarted.", hint: "Use Retry. Nothing is wrong with the document." },
  AI_NOT_SET_UP: { reason: "Job descriptions are read by the AI, and the AI is not set up for this service.", hint: "Tell your administrator: nothing is wrong with the document." },
  FILE_TYPE: { reason: "It is not a supported document (PDF, Word .docx, or a JPEG/PNG photo).", hint: "Save or export it again as a PDF or .docx." },
  PHOTO_UNREADABLE: { reason: "The photo is too blurry, dark or small to read reliably.", hint: "Retake it flat, in good light and in focus, or upload the PDF or Word file. One page per photo: for several pages, use a PDF." },
  SCAN_UNREADABLE: { reason: "The scan is too faint or blurred to read reliably.", hint: "Try a clearer copy or a text-based PDF." },
  NEEDS_OCR: { reason: "Almost no text could be read, even after scanning it.", hint: "Try a clearer, higher-resolution copy or a text-based PDF." },
  PAGES_LIMIT: { reason: "The job description PDF has more pages than your organisation's limit.", hint: "Send the job description on its own, without attachments, or ask an administrator to raise the limit." },
  FILE_TOO_BIG: { reason: "The file is too large, even after making it smaller.", hint: "Export it again at a lower image quality, or leave out scanned attachments." },
  UNREADABLE: { reason: "The file could not be opened.", hint: "It may be damaged or password-protected. Remove the password and try again." },
};

export function explainFailure(code?: string | null, message?: string | null): Explained {
  if (code && CATALOGUE[code]) return CATALOGUE[code];
  return { reason: message ? message.split(". ")[0].replace(/\.$/, "") + "." : "Something went wrong while reading it.", hint: "Try uploading it again; if it keeps failing, tell your administrator." };
}

/** One notice for one failure; for several at once, one notice that says how many and why the first ones failed. */
export function describeFailures(items: { fileName: string; errorCode?: string | null; errorMessage?: string | null }[]): { title: string; description: string } {
  if (items.length === 1) {
    const { reason, hint } = explainFailure(items[0].errorCode, items[0].errorMessage);
    return { title: `${items[0].fileName} could not be added`, description: `${reason} ${hint}` };
  }
  const shown = items.slice(0, 3).map((i) => `${i.fileName}: ${explainFailure(i.errorCode, i.errorMessage).reason}`).join("\n");
  return { title: `${items.length} files could not be added`, description: shown + (items.length > 3 ? `\n…and ${items.length - 3} more` : "") };
}
