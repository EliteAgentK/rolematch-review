# Candidate pipeline: readiness and evidence

**Latest results: `RESULTS_2026-11-04.md` (candidate-5, commit `74cf905`, rules 2.4.0). Criteria for the next runs: `ACCEPTANCE_2.md`. The sections below are the candidate-3 record, kept as written.**

The candidate reading pipeline (`server/src/candidatePipeline.ts`, version label `candidate-3`, frozen at commit `96f1145`) replaces how a CV is read when an organisation's `reading.candidatePipeline` setting is on. `CANDIDATE_PIPELINE=off` stops it for everyone. The running parser stays as its fallback.

## Acceptance criteria, written before the frozen run (2026-11-03)
The nine untouched real CVs have no answers from a person, and the owner has asked not to label another batch, so **this run cannot state accuracy**. It can show whether the frozen pipeline behaves on documents nobody tuned it on. Each criterion is checked by machine on this computer, and only counts leave it.

Run once, by `npm run eval:real:candidate <run> -- --acceptance`, on a committed candidate. The lock in `server/data/real-cvs/acceptance-run.lock` refuses a second run. **If its failures inform any change, those nine become development material and a fresh set is needed; they may not be called held out again.**

| # | Criterion | Pass |
|---|---|---|
| A1 | Nothing crashes; every document is read or refused with a stated reason | 9 of 9 |
| A2 | A name is published, and its words appear in the file name, where the file name has any | at least 7 of 9 |
| A3 | No published name disagrees with a file name that holds a person's name | 0 |
| A4 | Candidate and agency details stay apart | 9 of 9 |
| A5 | On agency documents, each value appears in the line it cites, and no second reader disagrees | all |
| A6 | Roles found are at least half the date ranges in the text | at least 7 of 9 |
| A7 | Sent for review | at most 5 of 9 |
| A8 | Median time per document, excluding OCR documents | under 5 seconds |

A file name is not an answer key: A2 and A3 are diagnostics, and A6 is a suspect count. Passing shows no gross failure; it does not show 90% accuracy.

For every field, with denominators and with a known answer, the synthetic packs are scored: `npm run eval:fields`. They are synthetic, from one author, so they are regression evidence and **not independent validation**.

## The one acceptance run: failed, and spent
`acceptance-1`, commit `269f8f3`, 9 untouched real CVs, 2026-11-03. Read 9 of 9. **A1, A2 (8), A4, A5, A6 (9), A7 (2), A8 (242 ms) passed. A3 failed: one published name was wrong**, a phrase stitched from separate lines on page 2 (R66). That failure led to a change, so **those nine are now development material. No held-out real set exists.** A fresh one is needed from the owner.

## Results on frozen candidate-3 (`96f1145`), matching rules 2.3.0
Right / wrong / missing. A refused document counts as missing for everything it should have given.

**Long-form pack, 43 fictional people never looked at while tuning (`lf-fresh-3`, ids with remainder 3 when divided by 7).** The closest thing to a clean test, and still synthetic. Earlier groups of the same pack shaped the code, so the pack's layouts are not new to it.

| Field | Word | Searchable PDF | Scan |
|---|---|---|---|
| Name | 43/0/0 | 43/0/0 | 36/3/4 |
| E-mail | 43/0/0 | 40/2/1 | 29/6/8 |
| Phone | 43/0/0 | 43/0/0 | 41/1/1 |
| Location | 43/0/0 | 43/0/0 | 39/2/2 |
| Current title | 43/0/0 | 38/5/0 | 35/6/2 |
| Roles found | 129/0/0 | 120/0/9 | 112/0/17 |
| Role's employer | 128/1/0 | 115/5/0 | 103/5/4 |
| Role's start date | 129/0/0 | 117/0/3 | 108/0/4 |
| Every listed duty under its role | 116/13/0 | 98/22/0 | 86/26/0 |
| Skills | 330/0/14 | 273/0/71 | 242/0/102 |
| Qualifications | 71/0/1 | 71/0/1 | 72/0/0 |
| Certifications | 129/0/0 | 115/0/14 | 121/0/8 |
| Certification status | 97/32/0 | 83/32/0 | 87/34/0 |
| Languages | 86/0/0 | 86/0/0 | 86/0/0 |

The certification status errors are the same 32: the CV says "Expired" and the record says completed (R76, a decision for the owner). Photos are not in this pack.

**Visual Variety pack, all 300 files, used throughout development (`cand-f3`); the current parser first (`d2-1046`), on the same files.**

| Field | Word | Searchable PDF | Scan | Photo |
|---|---|---|---|---|
| Name | 59/1/0 > 60/0/0 | 54/2/4 > 60/0/0 | 48/6/6 > 57/1/2 | 30/13/17 > 51/1/8 |
| E-mail | 60/0/0 > 60/0/0 | 52/4/4 > 59/1/0 | 45/3/12 > 52/4/4 | 19/12/29 > 37/10/13 |
| Phone | 60/0/0 > 60/0/0 | 55/0/5 > 59/0/1 | 47/4/9 > 55/1/4 | 37/3/20 > 57/1/2 |
| Location | 39/0/21 > 60/0/0 | 33/0/27 > 59/1/0 | 32/1/27 > 57/1/2 | 21/1/38 > 51/1/8 |
| Roles found | 145/0/4 > 145/0/4 | 121/0/28 > 145/0/4 | 119/0/30 > 142/0/7 | 68/0/81 > 136/0/13 |
| Skills | 75/0/346 > 421/0/0 | 62/0/359 > 399/0/22 | 61/0/360 > 302/0/119 | 61/0/360 > 280/0/141 |
| Qualifications | 75/0/0 > 75/0/0 | 52/0/23 > 75/0/0 | 42/0/33 > 69/0/6 | 20/0/55 > 66/0/9 |
| Certifications | 69/0/0 > 69/0/0 | 52/0/17 > 65/0/4 | 41/0/28 > 61/0/8 | 22/0/47 > 51/0/18 |

Sent for review: 211 of 273 published before; 42 of 300 now (Word 0, PDF 1, scan 7, photo 34). Of 19 documents with a wrong name, e-mail or phone, 10 were sent for review (R81).

**Real CVs (30, all development now). Machine run `cand-final`.** Name, e-mail and phone against the owner's answers, on 21: 20/0/1 each, on documents the code was tuned on, so not independent. Read 30 of 30; sent for review 11. No person's answers exist for any other real field.

**Agency values on real CVs: machine-checked only.** 11 agency documents. Every value is in the line it cites. A second reader (OCR of the rendered page) agrees on 8 of 11 agency and recruiter names, disagrees on none, and could not be used on 3. Recruiter's name in their own e-mail 6 of 6; agency's name in its domain 11 of 11. **No person has verified them and no AI model read them**: real values stayed on this machine.

**Headings.** 60 invented text CVs, every heading replaced with a meaningless one: roles 145/149, skills 421/421, qualifications 75/75, languages 117/117, all as printed; certifications 68/69 against 69/69.

**Matching, 60 invented pairs (test relationships, not hiring decisions).** Same-role median on checked records 56; Word 60, PDF 60, scan 60, photo 50 (before, on the current parser and rules 2.3.0: 43). Same-role ranks above adjacent 1.00 on all four formats; adjacent above unrelated 0.78 to 0.85. Largest drift from the checked record: 15 on Word and PDF, 22 on scan, 34 on photo. **No checked answers exist for whether a match verdict is right.**

**Time and resources, median per document (`cand-f3`, machine otherwise idle):** Word 53 ms, PDF 17 ms, scan 2.8 s (slowest 3.9 s), photo 3.2 s (slowest 4.8 s). Long-form scans of 3 to 4 pages ran beside another batch: 11.5 s median, 20 s slowest. Peak memory 1.8 GB for one process doing OCR. A match call: 11 to 22 ms.

**Running application (`test/candidate-e2e.test.ts`, local stack, invented documents):** upload to saved candidate; invisible until finished; refresh, sign out and in, restart; other portal and other organisation cannot see it; crash during OCR picked up and published once; malformed files refused and the next document unaffected; a job over the page limit refused and a long CV read; flag on, off and on; 24 at once with at most 4 running. The interface was also driven by hand: board, panels, agency card, Name not confirmed, the Match button only when both slots are filled, the explained result. **Files were uploaded through the API in that check, not by clicking the file picker.**

## Rollout and rollback
Off everywhere. On for one organisation by setting `reading.candidatePipeline`, versioned and audited. `CANDIDATE_PIPELINE=off` stops it for everyone on restart; a setting change can take up to the settings cache's life on another server. Stored records stay readable either way. No migration is needed: new details are in the record's JSON. **Matching rules 2.3.0 are not behind the flag**: they apply to every new match wherever this code runs, and each result records its rules version. Nothing is deployed.
