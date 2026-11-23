# How RoleMatch reads a document: the contract

This is the written behaviour of the reader (parser, layout, OCR clean-up, qualifications). It exists so the reader is **predictable**: the same
document gives the same result every time, it looks for things in the same order every time, and it changes only when someone decides it should.
If the code and this file disagree, that is a bug in one of them; tests check the parts that can be checked.

Current parser version: **2.16.0** (`src/version.ts`). Experimental candidates are off by default and selected only by `PARSER_EXPERIMENTS` in evaluation runs or tests; their outputs carry the experiment in their version label (for example `2.9.0+E2`).

## Candidate 2.10.0, experiment E2: NOT the default (2026-10-28). Failed the predefined photo false-positive gate; retained for investigation behind `PARSER_EXPERIMENTS=E2` (owner decision, 2026-10-28). Pinned in `test/parser-slash-skills.test.ts`

* " / " separates the items of a skill list, including a list that wraps onto the next line; a slash inside a name ("CI/CD", "TCP/IP") is kept. Visual Variety 60, protected split: skill recall 98 → 677 of 832, no check from right to wrong; but two OCR fragments on photos now appear as skill names (unsupported names on photos 7 → 9, total 61 → 55), which breached a criterion set before the run (docs/assessment/EXPERIMENTS.md, E2).

## 2.16.0 changes (2026-11-16): experience months and qualification status (line-by-line code review)
* **Years of experience count every month a role covers.** A role from January to December is 12 months; until now it was 11, so three back-to-back full-year roles came to 2.8 years and were stored as "2". The total now agrees with each role's own line that the AI reads (`src/dates.ts yearsCovered`, `test/match.test.ts`). A match states the total worked out on its own date from the settled roles, not the whole-year figure stored when the CV was read (`src/match.ts`).
* **"Part-time" is how a qualification was studied, not that it is unfinished.** "BCom (part-time), 2012 – 2015" was "in progress"; it is now completed by its past end year. "Currently studying part-time" is still in progress, by its own words.
* **On a certificate, "current" is about validity.** "AWS Certified Solutions Architect – current" and "…, currently registered" were "in progress"; a certificate's bare "current" or "currently" is no longer a progress cue, and dates run to the present only when a date starts the span ("2022 – current", "Feb '22 – present").
* The pattern `\(current\)` never matched (a word boundary before a bracket) and is removed. `test/qualifications.test.ts`.

## 2.15.0 changes (2026-11-10): job descriptions are read by Claude
The reader no longer reads job descriptions. The owner's decision (10 Nov 2026), after the reader refused a job whose first line was "JOB DESCRIPTION" and a 309-job measurement showed it missing pay, work arrangement and employment type three times in four and reports-to every time (`test/collection/aiJobFieldsEval.ts`). Jobs are read by Claude labelling every numbered line, the panel built from the document's own lines (`src/jobReader.ts`, `test/job-reader.test.ts`). Removed, not disabled: `parseJob` and the job sections of `src/rules.ts`, `extractJob`, the job reading plan (`JD_PLAN`), the job section stems in `src/extractionConfig.ts`, the job tests and tools that measured them, and the ten frozen job outputs. Every CV output is unchanged: the re-frozen CV files differ only in this version number.


Measured before release, on the same 309 job descriptions as the decision (150 reference jobs in Word and as PDF, 5 corporate, 4 hand-checked), local database
only, pass criteria written in `server/test/collection/aiJobFieldsEval.ts` before the run. Reader job-ai-3 (each fact is its own words, not its sentence):
all 309 read, no line left unlabelled; title, company, location, work arrangement, employment type, pay and reports-to 100%; summary 99.7% (one job has none
of its own and was given none); requirements, advantageous items and responsibilities 100% found, skills 99.6%; median 3.0 s a job; US$0.24 for the run.
Must-pass: Absa (28 responsibilities under 7 headings) and Hollard CIO read in full. Capacity found: at the account's present tier the platform reads about
29 jobs a minute in all, shared with CV reading; beyond that the speed limit (`src/ai/rateLimit.ts`) makes calls wait rather than be refused.

## 2.10.0 changes (2026-11-04)
Certificates now say whether they still stand: `validity` is current, expired or unknown, with `validityEvidence`. Added to the record, nothing else changes. Owner decision: an expired certificate is history, and it does not satisfy a requirement for a current one.

## 2.9.0 changes (2026-10-28, experiment E1 on the owner's fictional "Visual Variety 60" batch; pinned in `test/parser-split-names.test.ts`)

* A name printed over two or three lines (first name over surname, or an oversized surname first) is now read. Consecutive single-word lines are joined only when every word is in the e-mail address's local part, which also gives the order; without that, nothing is joined. Measured on the batch's protected split: 7 more of 135 CV documents published, all with the right name, and no check changed from right to wrong (docs/assessment/EXPERIMENTS.md, E1).

## 2.8.0 changes (2026-10-27, found on CV0565 of the owner's fictional "RoleMatch 300" pack; pinned in `test/pack300-findings.test.ts`)

CV0565 went from 30 of 35 checks to 35 of 35 in all three of its formats (Word, searchable PDF, scan). Nothing else moved: the frozen outputs, the 95 factory CVs, the twelve four-page CVs, every match score and the OCR benchmark are identical before and after.

* **An employment type is never the employer.** In "Senior Internal Auditor | 2022/01 - Current | Permanent" with the employer on the line above, "Permanent" was read as the company for every role. Employment types (permanent, contract, fixed-term contract, temporary, full-time, part-time, internship, freelance and the like) are now left out when choosing the employer, so the employer line above is used.
* **A section heading in capitals is never the employer.** Looking above a job line for its employer stops at a heading such as "EARLIER EXPERIENCE".
* **A job line ending in an employment type of several words is not a sentence.** "… | 2018/01 - 2021/12 | Fixed term contract" counted as a sentence with dates (three or more words after the dates) and the role was dropped. Separators no longer count as words, and an employment type after the dates never makes a line a sentence.
* **Contact rescue in OCR.** Small grey contact lines next to a dark band can be dropped by the first OCR reading. When page 1 yields no e-mail and no phone number, the top 30% of the page is read again, by PaddleOCR when it is available (it read CV0565's line exactly) and otherwise by Tesseract on a twice-enlarged crop, and only lines that really contain an e-mail address or phone number are kept, with a note asking for a check against the original. Nothing is invented. PaddleOCR is still a development dependency, so in production the rescue falls back to Tesseract until PaddleOCR is made a full dependency.

## 2.7.1 changes (2026-10-27, dependency upgrade, no code change)

* **The image library `@napi-rs/canvas` went from 1.0.11 to 1.0.13**, which changes how photos and scans are cleaned up before OCR, so some OCR readings changed. Judged on the OCR benchmark (`npm run eval:ocr`, one invented CV in six degradations), 1.0.13 is a net gain and 15–40% faster. Gains: skewed scan roles 83% to 100%; faded scan phone 67% to 100% and companies 83% to 100%; poor phone photo words 91% to 95% and skills 97% to 100%; very bad photo name 0% to 33%. Losses: skewed scan companies 89% to 83%; poor phone photo roles 100% to 67%; one-point drops in words on two profiles. The sample is small; the factory scans will measure it more widely.
* The frozen photo outputs now read three saved photos (`test/golden/photos`) instead of rendering them at test time, so these outputs can change only with the reader, never with how a library renders a PDF page.

## 2.14.1 changes (2026-11-05, found on the real CVs)

* What a person can see on a PDF's pages is decided once, for every reader (`src/visibility.ts`). Text a file marks as unseen and the rendered page shows is read: on real CVs this was names, employers and universities.
* A date margin that wraps leads the job beside it. A year alone is never a page number.
* Forms: a position above its company, labelled lines after a role's block, dates above a "title, employer" line. Lines repeated across pages count as furniture only if they are the same words, apart from a page's own number: wrapped duties that differ by a number are work.
* Behaviour with the model is in `src/hybridReader.ts` and is versioned by its own `HYBRID_VERSION` and `READER_PROMPT_VERSION`.

## 2.13.1 changes (2026-11-05, messy documents read the service's way)
Lettering spaced for display takes its word boundary from the person's own address. A section after References ends them. Dates down a margin belong to the rows beside them. A skills table's rows stay rows. A contact line is not a skills list.

## 2.13.0 changes (2026-11-05, one reader)
There is one way a CV is read. The older reading, the switch that chose between them and the experiments that were off in the service are gone (R140). The frozen outputs are now that reader's. Programming languages under a "Languages:" line are skills; a name wrapped after a particle is whole; a surname in capitals is written normally; a sentence is not a name; a note in brackets that wrapped stays together.

## 2.12.0 changes (2026-11-05, widening the measure to all 500 invented people)
A career written as one paragraph keeps its roles, however the page wrapped it (R134). A number with a letter in it in a scanned address is a number (R135).

## 2.7.0 changes (2026-10-27, found by the document factory, `test/factory`; pinned in `test/factory-findings.test.ts`)

* **Word page headers and footers are read.** Many CVs keep the name and contact details in the page header, which the body reader never saw; email and phone came back empty. Header text now comes first and footer text last; bare page numbers are left out; hidden runs are still removed first when the policy says so.
* **White text on a dark band is no longer mistaken for hidden text.** Some exporters (Chrome among them) draw a heading letter by letter. The hidden-text check paired drawing steps with text by letters only, lost its place, and gave the white colour of a headline to a dark job title lower down that began with the same words, which was then left out as hidden. The pairing now follows a piece of text across steps and prefers the longest match. Real hidden white text on a plain page is still found and left out (tested).

## 2.6.0 changes (2026-10-23, faults found by twelve invented four-to-five-page CVs, `npm run eval:extensive`; pinned in `test/parser-long-cvs.test.ts`)

* **A comma inside a job title stays in the title.** "Unit Manager, Adult ICU | Umhlanga Private Hospital" was read as company "Adult ICU". A comma now splits a role header only when the stronger separators (`|`, `@`, `•`, a spaced dash, "at") leave no employer beside the title; a trailing place after a comma ("Acme Ltd, Cape Town") is still split off.
* **Roles written as paragraphs, title first**, are read: "Sales Rep at Border Distributors from Jan 2019 till date. Visited clients." Only when the words before "at" contain an occupation word, start with a capital, and are at most six words, so "Our team at Head Office from 2019 to 2020…" stays a sentence.
* **A status wrapped onto the next line stays with its qualification**: "… 2008 - 2010 (did not" / "complete; left in third year)" is one entry, read as not completed (it was read as completed).
* **Professional designations are qualifications of their own**: "CA(SA), South African Institute of Chartered Accountants, 2014" gave an entry with no name; "PMP (in progress)" was dropped. The list (`DESIGNATIONS` in `src/qualifications.ts`) is shared with matching.
* Out of scope by the owner's decision (2026-10-23): Afrikaans wording is not recognised; the test set no longer expects it.

## 2.5.3 changes (2026-10-22, sidebar and column reading; whole-CV 61 to 63% on 150 PDFs)

* A narrower right-hand column on a page that is followed by another page is read after the last page, so a sidebar on page 1 no longer sits in the middle of jobs that continue on page 2 under no heading.
* A contact line with two or more icons (mail, phone, home) that runs over both columns stays one line, so the location is not cut off.
* A strip that only separates a date column from the text beside it ("Aug 2025 to Present | Unit Manager") is not taken as the gutter between two columns.

## 2.5.2 changes (2026-10-22)

* Experience dates that wrapped mid-way are joined in the working copy: a month at the end of a line with the year on the next ("Nov" / "2016 to Dec 2020"), an open range ("Nov 2011 —" / "Aug 2014"), and the end year under a date column ("May 2017 - April | Forklift Driver" / "2021 | Coastal Private Hospital", "Dec '19 - Aug" / "'22"). Years of experience 84 to 87%, roles 83 to 85%. Whole-CV unchanged at 61% on 150 PDFs.

## 2.5.1 changes (2026-10-22, measured on 150 generated PDFs: whole-CV 57 to 61%)

* Skills: a cell that wrapped inside a table row ("Risk" | "management") is one skill when the halves together are a skill RoleMatch knows; a skill line ending in a connective ("... HEALTH AND") continues on the next line. Top skills 88 to 91%, no-junk 84 to 87%.
* Education: a date range wrapped over two lines ("2014 -" / "2016 (did not complete)") is one range, so "did not complete" is seen; Afrikaans school names (Hoërskool, Laerskool) and secondary/primary school are recognised as institutions. Education type and status 93%, qualification 95%.

## 2.5.0 changes (2026-10-22, extraction improvements, measured on 150 generated PDFs)

* A date range wrapped inside its own column ("January 2026 – | Unit Manager" over "September 2026 | Shoprite Checkers") is read as one role. Only the working copy is joined; the original lines stay the evidence quote.
* Column detection ignores the wide lines among the first six (name, contact, personal details) when deciding whether a page has a gutter, so short two-column pages are no longer read straight across. Measured: employer 84 to 86%, years 83 to 85%, roles 81 to 83%, skills found 90 to 94%; whole-CV 57% unchanged; messy corpus unchanged.

## 2.4.1 changes (2026-10-22, the seven known defects)

* An email address is kept exactly as written: a domain one letter from a well-known one ("gmaii.com") is no longer changed to "gmail.com". Letters in the local part are still repaired, but only towards the candidate's own name on the same page.
* A role gets its employer from a role above it ONLY when the employer stands on its own line above a run of titles. An employer written beside another role's title is never carried down.
* Extraction no longer depends on the clock: the pipeline passes the document's upload date as `asOf`; without one, the latest year the CV itself states is used.
* PDF hidden text: invisible text counts as a scanner layer only over a picture covering a quarter of the page; white text is ordinary only on a coloured panel or large picture it sits on (positions are measured, not assumed). Drawing operations are matched to text items by their letters.
* An image's declared size is read from its header and refused over 60 million pixels before it is decoded; the refusal is final (no raw fallback).
* `withinBudget` can abort work that supports it and release resources; a PDF page that exceeds its budget now releases the document and reports the remaining pages as not read.

## 2.4.0 changes (2026-10-22, from the Codex audit)

* DOCX visibility uses XML namespaces and effective run/paragraph styles rather than regular-expression run matching. Local shading is local, not permission for white text anywhere else. Explicit off-page anchors are excluded. ODT text styles and negative page-anchored frames and RTF direct hidden/white/tiny/absolute-position controls are inspected. Hidden samples have a source part and location; they remain private metadata, not extraction evidence.
* Inspection/decompression failure refuses the Word/ODT read. XML declarations are refused; expanded size, part size, entry count, RTF nesting, Unicode fallback lengths and ODT space runs are bounded. These are platform ceilings, not claims of complete resource isolation.
* `reading.hiddenTinyPoints` is a versioned per-organisation setting (default 1 pt). Existing exclude/flag-only policy applies to all three formats. **Known incomplete visibility support:** VML, theme colours, style-driven graphics/backgrounds, positive ODT off-page geometry, inherited RTF styles and overlapping shapes. This is NOT a complete Word renderer and the gap is not declared closed for arbitrary documents.
* All readDocument routes (including image and scanned PDF replacement text), direct CV/JD rules, and both extractors normalise the agreed zero-width/bidirectional controls; CR-only text becomes lines instead of concatenated words. Raw originals are unchanged. Evidence in this version still refers to normalised source text, not a complete raw-byte offset map.
* Classic TIFF directory graphs are checked before UTIF: cyclic/out-of-range pointers, excessive metadata and invalid page budgets are refused. This does not make the decoder a sandbox or cap native codec memory/CPU.
* Layout date rejoining no longer mutates caller-owned source positions.
* The extraction provider is explicitly built-in only on this branch: legacy API-key presence cannot enable cloud extraction; no local model is enabled without approval/licence/evidence/repeatability validation. The OCR experiment stays test-only.
* Reproducibility requires the same bytes, parser version, policy, language data, hardware/runtime and explicit `asOf`. The existing pipeline still defaults `asOf` to the clock and needs a separate migration/decision to persist it. Confidence is not a validated probability of correctness.

## 1. One fixed plan, top to bottom

The reader works through a CV in one fixed order (`src/cvPlan.ts`), and every step has its place on the candidate panel. Until 10 Nov 2026 that order was also the panel's, top to bottom; the panel now has tabs (Overview, Experience, Education, Skills, Notes) and the reading order is unchanged. It does not skip ahead and it does not improvise an order.

| # | Step | Required | What it is for |
|---|---|---|---|
| 1 | Name and contact details | yes | the header of the panel |
| 2 | Professional summary | no | the Professional Summary section |
| 3 | Skills | yes | the Skills section |
| 4 | Education and certifications | yes | the Education section: degrees, diplomas, school and certifications in ONE list |
| 5 | Work history | yes | the Work History section |
| 6 | Projects | no | Projects and delivery |
| 7 | Worth noting | no | Worth noting |

**A step is not finished until it has found what it is for or has tried every way it knows.** Each step has an ordered list of ways to look
("strategies"). The reader tries them in order and stops at the first that finds something. For every document, the record carries a report
(`meta.sections`): for each step, whether it was found, which way found it, and every way that was tried. When a step finds nothing, the report
lists everything it tried, and that is shown to the person (as a note, or as a flag if the organisation chose to flag it).

Ways of looking, per step (in order):

* **Name and contact**: the header block, then the whole text.
* **Summary**: the Summary heading; the opening paragraph before the first heading; sentences anywhere (only when the CV has no headings at all).
* **Skills**: the Skills heading plus skills recognised in the work history and projects; then skills named anywhere in the text.
* **Education and certifications**: the Education and Certifications headings; then qualification lines outside the work history (no matter what the heading was called); then qualification lines anywhere in the document.
* **Work history**: the Experience heading; then dated roles outside the other sections (only roles whose title reads like a job title); then plain sentences ("I worked for X from 2013 to 2017").
* **Projects, Worth noting**: their own headings only.

## 2. The Education list

Degrees, diplomas, school and certifications are **one list**. Every entry says what it is and whether the CV says it was finished.

* **What it is** (from the entry's own wording): Doctorate, Master's degree, Honours degree, Bachelor's degree, Degree, Advanced diploma, Postgraduate diploma, National diploma, Diploma, Higher certificate, TVET qualification (N1 to N6), High school (matric, National Senior Certificate, Grade 12, A-levels), Trade certificate, National certificate, Certificate. An entry from a Certifications heading that names no degree is a Certificate.
* **Whether it was finished**: `completed`, `in_progress`, `not_completed` or `not_stated`. Only the CV's own words or dates decide it, and the words or year used are kept with the entry (`statusEvidence`):
  * words such as *in progress, currently studying, expected, final year, enrolled* or dates that run to the present or to a year still to come mean **in progress**;
  * words such as *did not complete, incomplete, dropped out, first year only* mean **not completed**;
  * words such as *completed, graduated, obtained, awarded* or an end year that has already passed mean **completed**;
  * a CV that gives no dates and no words is **not stated**. The reader never says "completed" without a reason it can show.
* **Display order**: always degrees, then diplomas, then school, then certifications; within each kind the CV's own order.
* The **card's qualification** is the highest *finished* one. One still being studied is shown only when nothing is finished, and says "(in progress)". One that was not completed is never shown as a qualification.

## 3. Things the reader never does

* It never invents a fact. Every skill, role, qualification and project it reports carries a quote that really appears in the document; anything whose quote cannot be found is dropped and counted (and a person is asked to look).
* It never reports a qualification as completed, a job as current, or a date it cannot read. Absence is "not stated", not a guess.
* It never reads a protected trait (age, gender, race, religion, health, nationality, family status) into a record.
* It never lets the scoring formula or any organisation setting change what it extracts. Settings change what is *flagged* and what is *shown*, never what is *read*.

## 4. It behaves the same every time

* **Same input, same output.** There is no randomness in reading. "Today" is passed in (`asOf`) rather than taken from the clock, and is written into the record, so years of experience and "finished or not" are the same on any day for the same `asOf`.
* **A version.** Every record carries `meta.parserVersion`. The version changes only when the output for the same document changes.
* **Frozen outputs.** `test/golden/` holds the expected output for a fixed set of documents (text, Word, older formats, scans and fixed-seed degraded photos). The test suite fails if the live reader differs from them. `npm run golden:update` re-freezes them, and refuses unless `PARSER_VERSION` was bumped first. A behaviour change therefore shows up as a reviewed diff and a version change, never silently.
* **Same result in every format.** The same CV saved as PDF, Word, `.doc`, `.rtf`, `.odt` or `.txt` gives the same record (tested).
* **Scans and photos** go through the same plan. The image is cleaned the same way every time (EXIF, shadows, tilt, crop), the OCR word positions are put in reading order with the same column logic as PDFs, and OCR below 50% average confidence is refused with a reason instead of being read from guesses.

## 5. How to change the reader

1. Change the code (the strategies live in `src/rules.ts`; the order and which steps are required live in `src/cvPlan.ts`).
2. Run the tests. If `test/contract.test.ts` says the frozen outputs differ, look at *why* before anything else.
3. If the change is intended: bump `PARSER_VERSION`, add a line to the change log below, run `npm run golden:update`, and review the diff of `test/golden/files`.
4. Run `npm run eval:panels`, `eval:variants`, `eval:jobs` and `eval:ocr` and make sure no accuracy figure went down without a reason you can state.

## Change log

* **2.0.0** (2026-10-21): fixed plan with per-step report; Education list unified with certifications, with kind and finished-or-not; positional reading of PDFs whose text is stored out of order; OCR word positions laid out with PDF column logic; deterministic `asOf`; job description header, table and prose handling.
* **2.0.1** (2026-10-21): OCR e-mail repair also fixes a misread letter and a stray space in the name part of an address, using only the candidate's own name from the top of the page.
* **2.0.2** (2026-10-21): the name-and-contact step is a real two-step plan (header block, then whole text) and reports what it tried; more headings count as the Education section ("Academic record", "Educational background", "Qualifications and training"); qualification lines are found anywhere when no heading holds them.
* **2.0.3** (2026-10-21): job descriptions follow a fixed plan as well (job title, company, location, overview, responsibilities, requirements) and report what each step tried.
* **2.0.4** (2026-10-21): informal CVs are read better: headings such as "Where I worked", "School:", "About me:", a city written in capitals in the contact line, a school named "Bellville High", a job line that ends with a full stop; skills outside software; a stray "ME:" is no longer left at the start of a summary.
* **2.0.5** (2026-10-21): scans and photos read much better: automatic page segmentation (a large heading such as the name in capitals was being left out), light writing on a dark panel is turned the right way round, a two-column page is read column by column even when the rows do not line up, a date column is read cell by cell, look-alike letters in skill names (Power Bl) are corrected, and older Word and RTF tables are split back into cells.
* **2.0.6** (2026-10-21): found by a procedural stress campaign (`npm run stress`, seeded CVs with known answers): a sidebar beside a main column whose jobs start with a date cell is two real columns; a header over the columns (name, headline, contact block) is kept together and read first; a row's closing date belongs to the text on its left; date ranges cut in two by a narrow cell ("2014 -" over "2017") are rejoined; justified lines and date cells stored apart from their rows; bullets that wrap flush with the bullet; headings that wrap after "&"/"and"; qualifications cut after "National"; a trailing separator continues on the next line.
* **2.1.0** (2026-10-21): the reader looks at what a PDF contains beyond its visible text (`src/inspect.ts`): text a person cannot see (white on a plain page, fully transparent, invisible, tiny) is left out of the evidence and reported, with the organisation's setting `reading.hiddenText` (default exclude and flag, or flag only); a scanner's invisible text over a page image is recognised as an OCR layer, not hidden text; PDFs whose settings forbid copying are read and flagged (or held, setting `reading.forbiddenCopy`); scripts, attached files, fillable forms and notes or marks added on top are counted and flagged, never run, opened or used; every page has a time budget (`reading.pageSeconds`) after which it is given up and reported. Measured and NOT adopted: font weight and size alone find only about two thirds of headings (bold job titles and dates look like headings), so they are not used to split sections.
* **2.2.0** (2026-10-21): scans and photos with pale writing are read much better: blocks of a page whose ink is faint (light grey on off-white) are smoothed and strengthened before OCR, block by block, so a page with a dark banner and pale body text is handled correctly; pages with ordinary dark ink are untouched. Measured on 150 generated CVs: pale-text scans 52% to 17% character error, pale-text photos 26% to 17%. TIFF (including multi-page), BMP and GIF files are accepted and read like photos (`src/tiff.ts`, utif2, MIT).
* **2.3.0** (2026-10-22): integrity. Text a person cannot see in a Word file (hidden, white on a page with no colour or shading, one point or smaller) is left out of the evidence and reported, following the same organisation setting as PDFs (`reading.hiddenText`); a Word file that unpacks to more than 80 MB is not expanded. Zero-width characters, direction overrides, the soft hyphen and other characters with no visible shape are removed from every document (they hide text between letters and stop skills from matching), and ligature characters are written out as letters. A page printed twice, a running header repeated at the top of later pages, and page-number lines ("Page 1 of 2") no longer enter the text twice or join into one invented line. A photo that yields almost no text is refused as a photo problem, in the same words as a low-confidence photo. Prompted by field research ([`FIELD_RESEARCH_REPORT.md`](../research/FIELD_RESEARCH_REPORT.md)): about 1% of 196,682 real resumes carry hidden instructions, and we confirmed that white and tiny text in a .docx and zero-width characters were both reaching the parser.

## Appendix: the job description plan

Read top to bottom in the order the job panel shows it (`JD_PLAN` in `src/cvPlan.ts`): **Job title** (required), **Company** (required), **Location**, **Overview**, **Responsibilities**, **Requirements** (required). Each step tries its ways of looking in order and reports what it tried, exactly as for a CV. Requirements are kept as *mandatory* or *preferred* only on evidence ("Must have", "Essential", an Essential/Advantageous column, "is a plus"); a requirement is never moved from one side to the other without the document saying so.

## Appendix: decisions backed by measurement

* **No second OCR attempt.** Two alternative image clean-ups (a crisper, higher-contrast pass, and a larger scale) were tried as second attempts for pages the first pass reads badly. On the evaluation set the crisper pass read *worse* (26% of the words against 97% for a poor phone photo) and the larger scale gained nothing, so the reader does one deterministic pass and, when the result is too uncertain to trust, refuses with a reason instead of retrying.
* **Skills outside software.** The skill list (`src/skills.ts`) covers finance, health, trades, education, sales, legal, hospitality, project work, marketing, data and IT operations. A generic word that is also an ordinary noun ("research", "logistics" inside a company name, "budgets") is not an alias, because it produced skills the CV did not claim.


## 2.11.0 (2026-11-05)
Job descriptions: a section now ends at any heading, known or not, read by type where the file has it and by shape otherwise, so application instructions and footers are no longer scored as requirements (register R118). A bullet drawn apart from its text no longer leaves column marks in a duty. The first line of a job is its title unless a colon says otherwise. CVs: role tables, roles run into their duties, unheaded lists, labelled tables and qualifications written with commas (R120). Frozen outputs were reviewed line by line for this change: duties lost their stray marks, and where no heading was known the overview's source now says so.
