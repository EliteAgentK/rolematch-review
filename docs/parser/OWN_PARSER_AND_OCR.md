# Our own parser and OCR: design

**Status: an isolated prototype of the name and contact slice exists (`server/src/docmodel/`); see "Prototype results". The running parser is unchanged, and nothing beyond this slice is committed to.** It replaces fixing faults one rule at a time with a structure in which whole classes of fault cannot recur. The owner's direction: "dont just think about let me fix this, i need you thinking about how does this not happen again", and "think of it as developing our own parser and ocr".

## Why faults keep recurring (found in the code)
| Root cause | Evidence | What it produces |
|---|---|---|
| **The layout is thrown away.** Every reader, including OCR, ends in one flat string. | `parse.ts` knows each piece's position and height, then joins lines of text. Font size, bold and block never reach the parser. | The largest text on the page is usually the name, and the parser cannot see that. Columns and tables become bars and broken lines |
| **The first match wins.** Nothing competes. | `cvPlan.ts` `runStep` returns the first way of looking that finds anything; `parseName` returns the first line that fits a shape. 181 regex checks in 1,114 lines of `rules.ts`. | "Office based", "Hr Business Partner" and "East London" as people. It cannot say "unsure" |
| **Word lists stand in for judgement.** | E4 needed a new word or rule per failure, and each new rule made a new error | A job title not on the list ("Supply Chain Planner") becomes a name |
| **Values rarely carry where they came from.** | Most fields are plain strings; nothing checks them afterwards | A wrong value looks exactly like a right one |
| **No idea of what kind of document this is.** | Agency forms and letterheads were read as if they were personal CVs | 8 of 21 real CVs gave the agency's contact as the candidate's |
| **The test corpus shares our blind spots.** We wrote it. | The invented sets contain no agency form; real CVs showed it on the first run | 12% refused on invented, 29% on real, and wrong names nobody counted |
| **The measure rewards the wrong thing, and the gate is manual.** | A wrong name and a refusal each count as one error; regression checks are run by hand | Accepting more looks like progress even when it publishes wrong people |

## The design
```
 File (PDF, Word, scan, photo)
   │
 1 READERS ──────── one DOCUMENT MODEL: pages → blocks → lines → words, each with position, size, bold, source and reading certainty
   │                (native PDF, Word and OCR all produce the same model, so nothing downstream cares where it came from)
 2 LAYOUT ───────── columns, reading order, sections, and the document's family (personal CV, agency form, letterhead, table form, ...)
   │                an unknown family is flagged, not guessed
 3 CANDIDATES ───── for each field, every possible value with where it came from (rules, and later a local model, are only proposers)
   │
 4 DECISION ─────── evidence scored from versioned configuration; a value wins only if clearly ahead. Otherwise blank, and sent for review
   │
 5 CHECKS ───────── what can truly be checked: a value exists where it cites. Everything else is evidence (corrected below): conflicts are kept and shown
 6 RECORD ───────── each value keeps its source location, so a recruiter and the tests can check it
```

**Correction (owner, 2026-11-03): signals are not guarantees.** The first version of this document said a name "can't be a place, company or label". That is wrong. A person can be called Paris or Morgan Stanley; the largest heading can be an agency's; an address need not resemble its owner; an agency document legitimately holds several people. So these are weighted evidence, never exclusions, and the conflicting evidence stays with the value. Counterexamples C-001 to C-012 in the library hold this.

**How this addresses the faults above, using the name:** instead of "the first line that fits", every candidate is scored. Largest text on page one, near the top, confirmed by the e-mail address, used again in the body, directly above a job title: for. Found in the employment block, a known place or organisation, the answer to a label, in an agency block: against. "Supply Chain Planner" loses because of where and how it appears, not because someone remembered to list "planner". A close call gives a blank and a review, not a guess.

**Our own OCR.** The OCR pipeline becomes ours, around replaceable recognition engines (Tesseract and PaddleOCR are already here):
1. Clean the image, then find the page's layout and regions.
2. Read region by region.
3. **Re-read what matters:** the top band at several scales, because large headings are lost today (R3, R42), and contact lines.
4. Compare two engines word by word.
5. Our own quality measure, tested against known answers. Engine confidence is not trusted: it said 91% with 1% of words recovered (R13).

**Training our own recognition model comes last, and only if measurement shows recognition is the failing layer.** On the invented batch only 157 of 4,227 errors were attributed to recognition, and that attribution is still to be verified. It would need many documents and separate permission for any real ones.

**The local LLM** becomes one more proposer at step 3, under the same decision and guards, kept only where measured better. It cannot publish anything by itself, including an invented fact.

## The system that keeps it from coming back
1. **Failure library.** Every confirmed failure becomes a permanent, invented document of the same shape, in Git, with counterexamples. A generator grows a layout family from it, so one agency form becomes many variants.
2. **One gate, run automatically.** `npm run parser:gate` runs the library, the frozen outputs, the invented batch and the guards, and compares with the last accepted version. It runs in CI, so nobody has to remember it.
3. **Wrong counts worse than missing.** The score reports separately: right, missing, and **wrong and published**. Wrong and published is the main figure, and it may not rise. Acceptance rate cannot hide it.
4. **Real answers.** A private local page shows the original beside what was read; a person confirms or corrects. Disagreements are recorded. The 9 untouched CVs stay untouched until a final check.
5. **The ledger.** Every accepted change: what failed → why → what changed → measured gain → regressions → remaining limits.

## How we get there without breaking what works
Field by field. The current parser stays the working baseline. Each new slice runs beside it and is compared on the same documents, and it only takes over when the gate says it is better. Then the rules it replaces are removed, not left disabled. Platform structure and the database are untouched, because the output record stays the same shape.

| Next deliverable | Active work | Depends on |
|---|---|---|
| A. Failure library, one gate, the wrong-first score | about half a day | nothing |
| B. Document model for native PDF and Word | about 1 day | A |
| C. Identity on the new structure (name, contact, agency), with E4 and E5's tests as its specification | about 1 day | B |
| D. Private review page for real answers | about half a day | then about 2–3 hours of a person's time for the 21 CVs |
| E. OCR on the same model, with targeted re-reading | about 2 days | more real scans and photos: only 1 of the 21 needed OCR |
| F. Employment, then education and certifications, skills, location | about 1 day each | C, D |

**No date is given for reaching 90%.** It depends on what real answers reveal. Estimates cover the work, not the outcome.

## Prototype results (2026-11-03)
Not accepted for use. An offline comparison on checked answers, not the running system. Reproduce with `npm run eval:proto`, `npm run eval:real:proto` and `npm run parser:gate`.

**Invented Visual Variety 60 CVs, 300 files from 60 people, with the pack's checked answers. Right / wrong / missing:**

| Format | Field | Current parser | Prototype |
|---|---|---|---|
| All | **Name** | 251 / 22 / 27 | **276 / 7 / 17** |
| All | **E-mail** | 236 / 19 / 45 | **243 / 19 / 38** |
| All | **Phone** | 259 / 7 / 34 | **283 / 4 / 13** |
| Word | Name | 59 / 1 / 0 | 60 / 0 / 0 |
| Searchable PDF | Name | 54 / 2 / 4 | 57 / 0 / 3 |
| Scanned PDF | Name | 48 / 6 / 6 | 54 / 0 / 6 |
| Scanned PDF | E-mail | 45 / 3 / 12 | 47 / 3 / 10 |
| Phone photo | Name | 30 / 13 / 17 | 45 / 7 / 8 (6 of the 7 are the right words reversed, with no e-mail to give the order) |
| Phone photo | E-mail | 19 / 12 / 29 | 20 / 12 / 28 |
| Text | Name | 60 / 0 / 0 | 60 / 0 / 0 |

No field in any format is worse. **Review burden:** the prototype abstains on the name for 17 of 300, where the current parser refuses 27 and flags 211 of its 273 accepted for review. Refusals and review states are different things, so these are not directly comparable.

**Does the document model help?** Same run with size, height and bold evidence switched off: names 272 / 9 / 19, against 276 / 7 / 17 with them. **A real but modest gain on this pack (4 more right, 2 fewer wrong, all on photos).** Most of the gain comes from competing candidates and weighted evidence, which could be built on flat text. In the library, F-029 (a large name under a line ending in a colon) passes only with layout. On the real CVs, the true name's line, judged by file name, was the tallest on page one in 13 of 18 and in the top three in all 18. So layout is useful evidence, not a guarantee, and this does not yet prove the model is worth extending to every field.

**Time (median per file, ms, Word / searchable PDF / scan / photo):** prototype 2 / 7 / about 2,100 / about 2,400. Current full pipeline as recorded in its run: 96 / 25 / 5,870 / 6,212. **Not a like-for-like comparison:** the current figure includes all extraction and came from a different run, and the prototype only does identity. Running both would add the prototype's time, including a second OCR pass, which is why it is not run in live use.

**Real development CVs (21), against the owner's checked answers. Right / wrong / missing:**

| Field | Current parser | Prototype |
|---|---|---|
| Name | 9 / 6 / 6 | **20 / 0 / 1** |
| Candidate's own e-mail | 12 / 4 / 5 | **20 / 0 / 1** |
| Candidate's own phone | 12 / 4 / 5 | **20 / 0 / 1** |

**These are not independent accuracy.** The prototype was changed while looking at these same 21 CVs, and 20 of 21 has a 95% interval of about 77 to 99% even before that. The missing name is a scan where the evidence was too weak; the missing contact is on a CV whose e-mail and phone are not in its text layer. The 9 untouched CVs have not been read or run.

**Agency documents (run `proto-7`):** the owner ticked 8, the prototype reads 8, and they agree on 7.
- One ticked CV has no contact details at all, and nothing in it the prototype recognises as an agency's. It is reported as "none found", not guessed.
- One CV the owner did not tick has a labelled consultant block and the candidate's own contact as well. It is read as an agency document the candidate can be reached on directly. **This is a disagreement between a person and the prototype, recorded and not settled.**

| On the 9 documents either side calls an agency's | Found | Checked by a person |
|---|---|---|
| Agency's name | 8 | not yet |
| Recruiter or consultant | 8 | not yet |
| Recruiter's own e-mail / phone | 5 / 5 | not yet |
| Agency's general e-mail / phone | 3 / 3 | not yet |

**"Found" is not "right".** The answers for these fields do not exist yet; `npm run review:real` now asks for them on these 9 documents. Three real documents give only an office line for the agency and no direct line for the consultant, and the prototype reports exactly that.

**Limits:**
- The weights were set by looking at this library and the development material. These results show improvement on development material, not independent accuracy.
- The held-back set was reduced by moving every exposed case and its family to development (`splits-v3.json`): **only 6 people (30 files) remain, and one abstained case among them was seen too.** A fresh acceptance set is needed. The 9 untouched real CVs are reserved for that.
- OCR is measured on simulated scans plus 1 real document. That says nothing reliable about real scanning.
- The local LLM has not been added. It is planned as one more source of candidates; nothing here measures it.

**Failure library and gate:** invented cases rendered in up to four variants: 615 checks. Current parser 254 right / 172 wrong / 189 missing (it has no agency or recruiter reading at all, so those count as missing); prototype 605 / 4 / 6. The 10 open variants are recorded in the ledger: F-029 without layout, C-020 (an ordinary-word name with nothing confirming it, left for a person), and "Northwind Staffing" and "Page One" still published as people. Those figures are not evidence of accuracy, because the prototype was built with these cases in view; they are regression protection. The gate was tested with deliberately bad candidates in unit tests and by deliberately breaking the prototype's weights and refusing everything: it failed each time.

## Experiment E6: a heading is not a person (pre-registered 2026-11-03, before the change)
**Found:** on 20 invented documents with no person's name, the prototype published 18 headings as people ("Application Form", "Northwind Staffing"). Being tallest, first and bold said "this is a headline", and with no rival that was enough. The real CVs did not show it because all 21 contain a name. Of names picked correctly, 177 of 177 invented (without OCR) and 18 of 20 real also had evidence that was about a person, not about layout.

**Change:** evidence against a line made up only of ordinary words or places, from a general English word list without the proper names (`src/docmodel/ordinaryWords.txt`, Webster's Second, out of copyright; no CV goes into it). It is a weight: a person called Lucky Green still wins when the e-mail confirms it. A first attempt, building the list from the invented documents, was dropped: at 1,073 words it missed "form", "job" and "career".

**Accepted only if all of these hold:**
1. Headings published as people, on the list used while building it: from 18 of 20 to at most 2.
2. On a list of 20 not used while building it: at most 3. The second list written for this was seen while measuring the word list, so a third was written after the change and run once.
3. Real development CVs: name stays at 20 or more right, 0 wrong.
4. Invented 300 files: no fewer than 273 right names, no more than 8 wrong, and no field in any format worse than the current parser.
5. A counterexample: an ordinary-word name with a matching e-mail is still selected; without one it is left for a person.

**Not a criterion:** a percentage. All the heading lists were written by the developer, so they are regression protection and not independent evidence.

**Outcome, 2026-11-03: all five hold, for the prototype only.**
1. First list: 18 of 20 → 2 of 20 (Northwind Staffing, Page One). Second list: 0 of 20.
2. Third list, run once: 1 of 20 (Shortlist Entry).
3. Real development CVs: name 20 right, 0 wrong.
4. Invented: 276 right, 7 wrong, 17 missing; no field in any format worse than the current parser.
5. Lucky Green with a matching e-mail is selected in all four formats; without one it is left blank.

**The cost:** a real person whose whole name is ordinary words, with no address or link to confirm it, is left for a person. None of the 21 real names or 60 invented names is in that position, which is a small sample.

## What E4 and E5 leave us
They stay **off by default and are not accepted**: they are the last of the patching approach, and useful as the figure to beat.

| Measure | Default parser | With E4 and E5 |
|---|---|---|
| Invented batch, CV files: wrong names published | 22 | 13 |
| Invented, held-back set: CVs accepted | 119 of 135 | 127 of 135 |
| Invented, development set: CVs accepted | 154 of 165 | 156 of 165 |
| Real, development set: accepted | 15 of 21 | 18 of 21 |
| Real: name disagrees with file name | 5 | 0 |
| Right to wrong on the invented batch | | 1 still open |

**Caveats:**
- The real figures are signals, not verified accuracy.
- Failures from the held-back invented set were inspected while developing E4, so that set is no longer clean for these rules.
- Their tests, `test/parser-identity-forms.test.ts` and `test/extraction-config.test.ts`, carry forward as the specification for deliverable C.
