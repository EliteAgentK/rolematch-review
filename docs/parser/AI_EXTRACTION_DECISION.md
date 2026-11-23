# Should AI be part of extraction? The decision record

> **Superseded, 8 and 9 November 2026.** The owner decided to use a hosted AI service for reading and matching: see [`docs/architecture/ADR-005-claude-in-the-platform.md`](../architecture/ADR-005-claude-in-the-platform.md) and [`docs/architecture/ADR-006-ai-only-matching.md`](../architecture/ADR-006-ai-only-matching.md). This record is kept as the history of the earlier decision; nothing below describes what runs today.

> **Direction from the owner (2026-10-21, on his father's advice): NO external paid AI API and no API key in RoleMatch. Only local / open models on our own infrastructure, with permissive licences (Apache-2.0 / MIT), and no per-document vendor fee.** Everything below that mentions a cloud model describes what was considered and NOT chosen. The Anthropic code path in `src/extract.ts` stays OFF and should be removed rather than enabled.

Written 2026-10-21. Read this before adding or switching on any AI in reading a CV or a job description.

## How a document flows today
upload (original stored privately) -> queue -> read (text, or OCR for scans and photos) -> extract (rules; the same step has an optional AI path that
fills the SAME fixed schema, every item with a quote from the document) -> validate (items whose quote is not in the document are dropped; qualification
type, finished-or-not and dates are worked out by our code) -> review flags -> panels. The panels only display the finished record. The fixed schema and
the fixed plan (`src/cvPlan.ts`, [`EXTRACTION_CONTRACT.md`](EXTRACTION_CONTRACT.md)) are the contract that rules, OCR and any AI must all meet.

## Where AI genuinely helps
* Unusual layouts, informal CVs and mixed languages: the long tail the rules did not foresee.
* Judgement calls: company or job title, project or role, "studying part-time" meaning in progress.
* Photos and scans: a vision model reading the page IMAGE could beat OCR on poor photos (OCR sees characters, not the page).

## Where it does not help, or makes things worse
* **Determinism.** The reader must not be volatile. A model can differ between runs and, above all, between model updates; the frozen-output tests cannot pin that.
* **Bad OCR text.** If OCR misread an e-mail, an AI can only guess, and a guess is an invented fact. (A model reading the image itself is a different thing.)
* **Wrong but quoted.** The quote check stops invented facts; it does not stop a real quote attached to the wrong thing (the wrong date on a role).
* **Cost and delay** per document.
* **Privacy.** CVs are personal data (POPIA). A cloud model sends them out of our infrastructure; a local model (Ollama) does not, and is weaker.
* **Fairness.** Matching stays rule-based and fixed. AI belongs in extraction only, never in scoring.

## Recommended design: rules first, AI only for gaps
The parser already reports, per section, whether it was found and everything it tried (`meta.sections`). Use that as the trigger: only when a required
section is not found, or OCR confidence is low, send just that part of the document to the AI, under the same schema and the same quote check.
Record per field whether rules or AI produced it. Cache AI results by file hash so the same file always gives the same answer. Pin the model version and
use temperature 0. A frozen-output test cannot cover the AI path, so it needs contract tests instead (schema, quotes found, no protected traits, same
answer from cache).

## The path that follows from the direction above (local only)
1. Measure open document readers (layout-aware OCR such as PaddleOCR, docTR, Docling, olmOCR) against Tesseract in the existing harness (`npm run eval:ocr`, `eval:variants`). Check each licence first; some popular models are non-commercial or revenue-limited.
2. Pilot an open vision-language model on a local server (the code already has a local-model path through Ollama), in SHADOW mode, on real consented CVs.
3. Collect recruiter corrections (already audited) as the training data for a later fine-tune of a small open model.
Costs: hardware or rented GPUs and someone to maintain it, not licence fees. Benefits: nothing leaves our infrastructure (POPIA), fixed weights give repeatable answers, and no vendor can change or withdraw the model.

## Before deciding: measure
Run the AI in SHADOW on real, consented CVs: it extracts, nothing changes, and we compare it with the rules field by field. That gives real accuracy and
shows where AI would actually help. With a local model there is no API bill; it needs downloads of model files, which the owner approves first.

## State of play (2026-10-21)
* The AI path exists in the code (Anthropic tool-use or local Ollama) but is OFF: no key is configured. By the owner's direction only the local path is acceptable.
* It has NOT been measured with the current evaluation harness (`npm run eval:panels`, `eval:variants`, `eval:jobs`, `eval:ocr`).
* Every accuracy figure we have comes from INVENTED documents. Real-world accuracy is unmeasured; the gap between the two is the real question.
* The old Anthropic key that leaked from the earlier backend repos must be revoked.

## Guards on model output (2026-10-22, from the LlamaIndex "DIY document parsing agent" walkthrough)

The walkthrough's model step uses a paid hosted API, which our owner rule forbids, so none of that is used. Its failure handling is model-independent and applies to any LOCAL model, so it is built now as `src/modelGuards.ts` (tested in `test/model-guards.test.ts`, no model involved):

* **Repetition loops**: an answer that ends in the same text repeated 50 or more times is refused (`detectRepetitionLoop`).
* **Truncation**: an answer whose finish reason is "length", or whose closing tag never arrives, is refused (`wasTruncated`).
* **Tagged output**: only a complete `<tag>...</tag>` pair is read (`extractTagged`); the model is told to wrap its whole answer in the tag.
* **One verdict, bounded attempts**: `judgeModelAnswer` returns usable or the reason it is not; `MAX_ATTEMPTS = 3` is a platform ceiling. After that the rule-based record stands and the document says a model could not help.
* A refused answer is never "fixed" by guesswork, and any value a model proposes must still pass the evidence check (`keepSupported`) before it reaches a record.
