# Baseline v1: how well the reader and matcher do today, on invented documents only

Frozen 2026-10-28 (milestone 1 of [`TRAINING_AND_IMPROVEMENT_PLAN.md`](TRAINING_AND_IMPROVEMENT_PLAN.md)). Every later change is compared with these figures. Versions: parser **2.8.0**, rules **2.2.0**, `tesseract.js` 7.0.0 with `eng`+`afr` `4.0.0_best_int`, Node 24, Apple M5 (16 GB), repository at `d64945a` plus the milestone-1 changes.

**What this is not.** Every document here is invented and was written by our own code or for it; the answer keys come from our own generators or from the same author as the rules. These figures say how the reader does on documents it was shaped on. They are **not** an estimate of real-world accuracy. The only honest estimate of unfamiliar layouts we have is the messy corpus's first-look rate: **45 to 50% of CVs read perfectly on each unseen round before fixes** (`server/test/messy/README.md`). No CV or job pack outside the repository was used (owner rule).

Intervals are Wilson 95% intervals: the range in which the true rate plausibly lies given the sample size. A field right in 3 of 3 cases has an interval of 44 to 100%, so it proves very little.

## Reproducibility

Every evaluation was run twice in a row (11:06 to 11:10). All accuracy figures were identical; only timings differed (OCR seconds per CV 1.2 against 1.3 and 4.5 against 4.6; one extensive read time 0.1 against 0.2 s). Re-run with:

```bash
cd server && npm run eval:ocr && npm run eval:extensive && npm run factory:eval && npm run eval:jobs && npm run eval:panels && npm run eval:parser
```

**Caveat on rebuilding.** The messy corpus files (`server/test/messy/files`, 368) are generated locally by `npm run build:messy` from committed code and are not tracked. The factory documents' content (`server/test/factory/content`, 95 answer keys and texts) is **untracked and was written with a local language model**, so a fresh clone cannot rebuild it byte for byte. Earlier work kept it uncommitted on purpose; whether to commit it (it is invented, no personal data) is an owner decision. Until then this baseline is reproducible on this machine, not from the repository alone.

## Fix made before freezing (defect R4)

The messy-corpus evaluation computed "expected years of experience" from **today's date** while the reader counted from the CV's own latest year, and its date helper turned "Hede" (present) into today's month. The check drifted with the calendar and read **0%**. Now the whole corpus is read as if uploaded on one fixed date (`CORPUS_AS_OF` = 2026-10-01 in `test/messy/panels.ts`), the same date given to the reader and the answer key, as the live pipeline reads each document as of its upload date. Result: card "years" **99%** (349 of 352 dated CVs; the 3 misses are Portuguese CVs where the reader undercounts, a real limit); every other field unchanged.

## 1. OCR (`npm run eval:ocr`)

3 invented CVs (`cv03`, `cv06`, `cv09`), each rendered and degraded 6 ways, read by OCR, then by the same parser. Words = share of the original's words recovered. Fields compare with what the parser reads from the original text. **n = 3 per cell.**

| Degradation | Words | Name | Email | Phone | Roles | Companies | Skills | Education | Reported confidence | s/CV |
|---|---|---|---|---|---|---|---|---|---|---|
| clean scan | 99% | **0/3** | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 93% | 1.2 |
| skewed 2° | 99% | 3/3 | 3/3 | 3/3 | 3/3 | 83% | 3/3 | 3/3 | 93% | 1.1 |
| faded copy | 99% | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 92% | 1.8 |
| phone, good light | 99% | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 92% | 1.2 |
| phone, poor light | 95% | 3/3 | 3/3 | 3/3 | 2/3 | 2/3 | 3/3 | 3/3 | 89% | 1.9 |
| worst case | **1%** | 1/3 | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 | **91%** | 4.5 |

Intervals: 3/3 is 44 to 100%; 2/3 is 21 to 94%; 0/3 is 0 to 56%. Two findings stand regardless of the small sample: **names are lost on the cleanest scans in all three CVs** (register R3), and **the engine reported 91% confidence while recovering 1% of the words**, so engine confidence cannot be used to route or label documents.

## 2. Long CVs, reading and matching (`npm run eval:extensive`)

12 invented four-to-five-page CVs (6 evidence-rich, 6 weak), each against a job in its own field.

| Reading | Result | 95% interval |
|---|---|---|
| Name, email, phone | 12 of 12 each | 76 to 100% |
| Roles found (and titles) | 54 of 62 | 77 to 93% |
| Qualifications found / completion right | 25 of 25 / 25 of 25 | 87 to 100% |
| Skills found | 31 of 33 | 80 to 98% |

| Matching (rules 2.2.0) | Proved score |
|---|---|
| Rich CVs (6) | 74, 76, 79, 84, 87, 89 |
| Weak CVs (6) | 29, 35, 40, 44, 44, 44 |

No overlap between the groups; 6 of 6 rich CVs score above every weak one (6 of 6 has an interval of 61 to 100%, and the same author wrote the rules, the CVs and the keys). Personal details (date of birth, gender, ID number, marital status, nationality, health, home language) left in or removed: identical scores for the 3 CVs that carry them.

## 3. Factory documents (`npm run factory:eval`)

95 invented documents in 8 layouts and 2 formats (47 Word, 48 PDF, including 12 scans). Counts now printed in the report.

| Field | Result | 95% interval |
|---|---|---|
| Contact (name, email, phone) | 285 of 285 | 98.7 to 100% |
| Roles found | 477 of 495 | 94.3 to 97.7% |
| Job titles | **424 of 495 (86%)** | 82.3 to 88.5% |
| Companies | 465 of 495 | 91.5 to 95.7% |
| Dates | 473 of 495 | 93.4 to 97.0% |
| Qualifications | 207 of 207 | 98.2 to 100% |
| Completion status | 206 of 207 | 97.3 to 99.9% |
| Skills | 920 of 928 | 98.3 to 99.6% |

By slice, the weak spots: **PDF titles 198 of 268 (74%, 68 to 79%)** against Word 226 of 227; the **sidebar layout reads 0 of 64 job titles** (0 to 5.7%) and 53 of 64 roles, companies and dates; the header-band layout 91% of roles. Full slices: `server/data/factory/report.md`.

## 4. Job descriptions (`npm run eval:jobs`)

130 invented job files: title, company, location, department, type, arrangement, description, responsibilities, mandatory and preferred requirements, no mix-up, skills: **130 of 130 every field right** (97.1 to 100%). Written alongside the parser by the same author.

## 5. Messy CV corpus (`npm run eval:panels`, `npm run eval:parser`)

368 invented CVs in 33 layouts (336 PDF, 32 Word), with the reference date fixed (above).

| Measure | Result | 95% interval |
|---|---|---|
| Parser: every field right | 366 of 368 | 98.0 to 99.9% |
| Panels: every panel field right | 351 of 368 | 92.7 to 97.1% |
| Card years (dated CVs) | 349 of 352 | 97.5 to 99.7% |
| Panel summary | 96% | |
| Panel certifications | 94% | |
| All other card and panel fields | 100% (dates 100%) | |

By round (rounds 1 to 3 were tuned on after being seen; round 4 was fresh when first measured): 144 of 144, 94 of 96, 64 of 64, 64 of 64 perfect. The first-look rates before tuning were 48%, 50% and 45%.

## What this baseline says

1. On documents like those it was shaped on, the reader is near its ceiling; on unfamiliar layouts the only measurement we have says about half need a fix or a check.
2. The clear, measured weak spots are **job titles in PDFs, the sidebar layout, names on clean scans, Portuguese experience years, and the worst-quality photos**; each is a register entry.
3. OCR confidence is not a usable signal of quality.
4. Nothing here measures matching against human judgement: there are no requirement-level labels yet.

Next measurements, per the plan: real consented documents once supplied by the owner, and the error register's verified corrections.
