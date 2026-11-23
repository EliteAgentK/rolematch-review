# What is worth building into the RoleMatch parser and OCR

Written 2026-10-21 from the research notes ([`RESEARCH_NOTES.md`](../research/RESEARCH_NOTES.md)). This is the short list that earned its place. Everything else in the notes stays as reference. Nothing here is built yet. Each item says what it is, how we build it on our own stack (permissive, local, no fees), what it gives the platform, and the honest unknowns.

Order = recommended build order. "Size" is a rough effort guess (S under a day, M 1 to 3 days, L longer).

## A. Read more of what the file really says

### 1. Font name, bold, italic and size on every text piece (size S)
* **What:** Each text piece knows its real font (for example `Optima-Bold`), whether it is bold or italic, and its size.
* **How:** Open PDFs with the setting `fontExtraProperties` (verified: it returns real font names). Read bold and italic from the name (Bold, Black, Heavy, Semibold, Italic, Oblique). Add `font`, `bold`, `italic` to the layout item. Never trust one signal alone: combine name, size and weight.
* **Platform use:** Headings found by look (bold or larger) as well as by wording, which fixes the "all caps", "unusual heading wording" and size failures in the stress run. Panel sections (Summary, Experience, Education) start in the right place more often.
* **Unknowns:** Word and Chrome PDFs name fonts clearly; some tools use meaningless names, so the fallback stays the current wording-based detection.

### 2. Hidden, covered and stale text is detected and flagged (size M)
* **What:** Text that is invisible (render mode 3, zero opacity, white on white, covered by a later shape), stored replacement text that differs from what is shown, and old text left behind by edits.
* **How:** Read the PDF.js operator list, track draw order and fill colour, compare each text box with later shapes. Read the file trailer for edit history (incremental updates) and encryption.
* **Platform use:** Protects the recommendation. Keyword-stuffed CVs cannot score by hidden words; the recruiter sees "hidden text found". Fits CLAUDE.md rules 3 and 8 (never manufacture facts; evidence must be real).
* **Unknowns:** Needs a decision (below) on exclude versus just flag. False alarms are possible on legitimate OCR layers, so the first version flags and never deletes.

### 3. Read fillable PDF forms (size M)
* **What:** Many HR application forms are fillable PDFs; the answers live in form fields, not in the page text, so today they read as empty.
* **How:** Read form fields (name, value, group), skip password fields, label values by field name, feed them into the same text stream with a marker.
* **Platform use:** A whole class of real CVs that currently fail silently starts working.
* **Unknowns:** Needs a real fillable CV to test on (we only have generated ones). Flag any JavaScript inside; never run it.

### 4. Struck-through text and page lines/boxes (size M to L)
* **What:** Strike-through is a drawn line, not a font style. Lines, filled panels and boxes also mark table cells, sidebars and section dividers.
* **How:** Collect drawn lines and rectangles from the operator list; match a horizontal line through a text box to mark it struck; use boxes and filled panels as extra column and table signals.
* **Platform use:** A crossed-out qualification is not extracted as a fact; sidebars and tables are found more reliably (our biggest remaining PDF failures).
* **Unknowns:** Largest effort and most uncertain payoff; do after 1 to 3 and measure with the stress run.

## B. Scans and photos (our weakest area: 10% perfect)

### 5. Region-level hybrid read (size L)
* **What:** Use the PDF's own text where it is legible; OCR only the regions that have none or are garbled (outlined text, images, damaged glyphs). Record which source each region came from.
* **How:** Compare text boxes with page area; send uncovered regions to the existing OCR with position logic already built; merge in reading order.
* **Platform use:** Better accuracy on mixed files and faster processing; the evidence trail can say "this line came from OCR".
* **Unknowns:** Merge ordering is the hard part. Needs measuring against the scan and photo stress variants before it ships.

### 6. OCR tuning measured, not guessed (size M)
* **What:** Measure accuracy against render resolution (150, 200, 300 dpi), automatic orientation (read a small render at 0/90/180/270 degrees and keep the one with most real words), and multi-page TIFF, BMP and GIF input.
* **How:** Extend `eval:ocr` and the stress scan variant; add formats to `formats.ts`.
* **Platform use:** Sideways phone photos and office scanner output (TIFF) work; the resolution choice is based on numbers.
* **Unknowns:** Whether higher resolution helps enough to pay for the extra time; the measurement answers it.

### 7. DocTR trial as a second OCR engine (size L, optional)
* **What:** An open (Apache-2.0) OCR system that reads layout and text together.
* **How:** Plug in behind the existing OCR interface (`OcrEngine`), run both on the scan variants, keep the better.
* **Platform use:** Only if it clearly beats Tesseract; consistent with the owner rule of local open models only.
* **Unknowns:** Needs a Node route (ONNX) or a small separate service and a licence check on every model file. Do not commit to it until step 6 is measured.

## C. Infrastructure and safety (what keeps the platform up)

### 8. Per-page time budget, worker recycling, unique temp files (size M)
* **What:** One bad page cannot hang a document; a worker that runs for days does not leak; two documents never share a temporary file.
* **How:** Time limit per page with a partial result and a report line; restart a worker after N documents or a memory ceiling; unique temp names per job; a long-run memory test.
* **Platform use:** Meets CLAUDE.md "bounded retries, observable queues, manual recovery". Real files do make readers loop.
* **Unknowns:** Today we only have a document-level timeout, so first measure how often a page hangs.

### 9. Reader sandbox and attack tests (size M)
* **What:** The PDF reader is an attack surface. No network, minimum rights, never write to a path taken from the document, a ZIP renamed `.pdf` refused, decompression bombs capped.
* **How:** Run the reader in a restricted worker; add tests for each case; keep the dependency audit gate we already have.
* **Platform use:** Security and tenant isolation for a multi-tenant product; ties to the deferred malware scan.
* **Unknowns:** The restriction method depends on hosting (process, container); decide with the infrastructure plan.

### 10. A richer processing report (size S to M)
* **What:** Say "repaired on open" (amber) versus "could not read" (red), list what hidden content exists (metadata, attachments, JavaScript, annotations, form fields), record the PDF engine version, page size, producer and creation tool.
* **How:** Capture reader warnings and metadata already available; add fields to the report the recruiter sees.
* **Platform use:** Honest status to the recruiter (CLAUDE.md "be candid"), and an audit trail for why a document read badly.
* **Unknowns:** None significant; mostly wiring.

## D. Test coverage (so every fix is proven)

### 11. New stress cases (size M)
* Letter-per-line text, missing spaces in justified lines, ligature characters, fake bold (text drawn twice), rotated pages, a nested PDF page, a fillable form, hidden text, a ZIP renamed `.pdf`, extreme shapes (50 MB single page, 3,000 pages, 12-page limit).
* **Platform use:** Each new reader feature is measured before and after (same method as `npm run stress`).

## Owner decisions (answered 2026-10-21)

1. A PDF whose permissions forbid copying or extraction: **read it and flag it**.
2. Hidden text: **leave it out of the evidence and flag it**.
3. Comments other people left inside a CV: **never put into the candidate record; only count and flag**.

## What we are deliberately NOT building

* PyMuPDF (AGPL licence; Python).
* Hosted OCR or AI services (breaks the no-fees, no-external-API rule).
* Page generation or editing, annotation writing, blend-mode analysis, rich-media playback, anything about creating PDFs.

## How each build is delivered

Stress run before and after, then: golden outputs reviewed, `PARSER_VERSION` bumped, [`EXTRACTION_CONTRACT.md`](EXTRACTION_CONTRACT.md) change log updated, full suites, local commit only (no push without approval).

## Batch uploads (owner asked 2026-10-21 how all of this applies)

Today the drop zone takes one file (`DropZone.tsx` reads `files[0]`); batch upload is a "Later" item in PRODUCTION_READINESS.md. Existing per-organisation limits: 300 documents per day, 100 in progress, 12 pages, 50 MB. Batch is where the infrastructure items matter most: one bad file must never hold up or damage the other 99.

* **Item 8 (time budget, worker recycling, unique temp files):** one looping file cannot stall the batch; workers survive a 100-file run; parallel files never share a temp file.
* **Item 9 (sandbox and attack tests):** a hostile file (ZIP renamed .pdf, bomb) is refused alone while the rest continue.
* **Item 10 (richer report):** per file: read OK, read with warnings (repaired, hidden text, copy-forbidden, OCR regions) or could not read, each with a plain reason.
* **Items 2 and 3 plus the copy-permission flag:** flags roll up into the batch summary ("4 files had hidden text") so a recruiter reviews flagged files first.
* **Items 1 and 5 (font-aware headings, hybrid read):** better first-pass accuracy means fewer files land in "needs review".
* **Item 6 (OCR tuning, TIFF):** bulk scanner output and phone photos are accepted and oriented automatically.
* **New, not from the research:** duplicate detection (same person twice in one batch, by e-mail and file hash); per-tenant concurrency cap and oldest-first ordering so one organisation's batch cannot starve others; idempotent retry (a failed file can be retried alone; re-sending a file does not create a second candidate).
* **Already planned:** one summary pop-up when the batch finishes (succeeded, failed with reason, flagged) and an upload-history view of past failures.
* **Rule 1 of CLAUDE.md still holds per file:** each file shows as processing and enters the candidate panel only when extraction and validation are complete.

Open questions: maximum files per batch (proposed 50, a per-organisation setting); whether a ZIP of CVs is accepted (proposed: not in the first version); whether flagged files appear with a flag (proposed) or wait for a recruiter.

## Build status (updated 2026-10-21, parser 2.1.0)

**Built and tested** (`src/inspect.ts`, `test/hidden.test.ts`, Settings tab "Reading"):
* Per-organisation settings `reading`: hidden text (exclude and flag, or flag only), copy-forbidden PDFs (read and flag, or hold: refused with a plain reason), seconds per page, batch file limit. Versioned and audited like the other settings.
* Item 2 (part): hidden text detected from the PDF's draw operations: white on a page that paints no colour, fully transparent, invisible (render mode 3), tiny. A scanner's invisible text over a page image is recognised as an OCR layer. White on a dark panel is not flagged. Zero false positives on 120 generated PDFs including dark-page and dark-sidebar themes. NOT yet: text covered by a later shape, stored replacement text (ActualText), edit history.
* Item 10 (part): stored inspection summary on every PDF (producer, creator, dates, page size, encryption, copy permission, form, scripts, attached files, note and mark counts, scanner layer pages, hidden-text samples) and plain review notes. Annotation text is never read; scripts never run; attachments never opened.
* Item 8 (part): per-page time budget. NOT yet: worker recycling, unique temp-file audit, long-run memory test.
* Test tooling: colour themes in the stress generator (dark sidebar, dark page, coloured headings, low contrast, tinted page); `npm run stress:headings`.

**Measured and NOT adopted:** item 1 (bold and size for headings). On 120 generated PDFs, weight and size alone flag headings with precision 0.66 and recall 0.74: bold job titles and dates look like headings. Using it to split sections would cut roles apart. Kept as a supporting signal only, never a splitter. Reproduce with `npm run stress:headings`.

**Not started:** forms (3), strike-through and page graphics (4), region-level hybrid read (5), OCR tuning and TIFF (6), DocTR trial (7), reader sandbox (9), more stress cases (11), batch upload itself.

## Build status update (2026-10-22, parser 2.3.0)

**2.2.0 scans:** faint-text strengthening block by block with a soft ramp (pale-text scans 52% to 17% character error, photos 26% to 17%; trigger level 160 chosen on a mixed sample), TIFF (multi-page), BMP and GIF, page-number lines, repeated header blocks and duplicated pages removed before reading.
**2.3.0 integrity:** hidden, white-on-plain-page and one-point text in Word files left out and reported (same policy setting as PDFs; skipped when the file has shapes, pictures, shading or highlights, since white text can then sit on colour); zero-width, direction-control and other shapeless characters removed from every document; ligature characters written out; Word files that unpack past 80 MB are not expanded; a photo with almost no text is refused as a photo problem.
**Test tooling:** per-theme scan and photo error rates; `stress:ocrtune`; the Word, RTF and ODT stress variants now render dark text on a light page, because the converter drops backgrounds and would otherwise produce white-on-white files no person could read (Word stress 81% of 120 CVs fully correct).
**Research:** [`FIELD_RESEARCH_REPORT.md`](../research/FIELD_RESEARCH_REPORT.md) (sourced, confidence-tagged) and [`RESEARCH_PROMPTS.md`](../research/RESEARCH_PROMPTS.md) (prompts for Gemini and Codex).
**Open:** the quality gate (read well, uncertain, unreadable), resolution and rotation measurements, a neural OCR trial, region-level hybrid read, fillable forms, reader sandbox and worker recycling.
