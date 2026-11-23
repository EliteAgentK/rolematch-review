# Batch visual60-b1: report

> **Partly superseded (2026-10-28).** E2 is no longer "provisional": the owner decided it **failed a gate and is retained for investigation**. It is off by default, and parser 2.9.0 is the default again. The "579 gains, 0 regressions" figures came from comparators 1.0.0 and 1.1.0, which missed checks present in only one run; comparator 2.0.0 counts them. See [`DECISION_PACKAGE.md`](DECISION_PACKAGE.md) and [`../../EXPERIMENTS.md`](../../EXPERIMENTS.md). This page is kept unchanged below as the record of what was reported then.

* **Batch:** the owner's fictional "RoleMatch Visual Variety 60" pack, supplied 2026-10-28.
* **Status:** extraction baseline plus two experiments complete. **Matching is not yet evaluated on this batch** (section 6).

Figures come from the stored run scores (`server/data/evaluations/visual60-b1/`, git-ignored). The per-field tables, by run and split, are generated in [`../../EXPERIMENTS.md`](../../EXPERIMENTS.md), and the aggregates are in [`results.json`](results.json).

## 1. What was tested

* **Independent records.** 60 candidates (47 groups once shared duties and base roles are joined) and about 38 independent job requirement sets: 22 pairs of jobs have identical requirements.
* **Format variants.** 480 files: 300 CV files (5 formats per candidate) and 180 job files (3 formats per job). Format variants are not independent evidence.
* **Conditions.** Native Word, native PDF and plain text have real text layers. The 120 "scanned" and "photo" PDFs are deterministic simulations with no text layer; they are not real scanner or camera output.
* **Answer key.** The pack's expected records were **checked, not trusted**:
  * every expected value is printed in its canonical text;
  * native PDF text covers at least 98% of the expected tokens;
  * all 480 files match the manifest hashes.
* **Dataset roles.** Assigned by group before results were examined: 33 development and 27 protected candidates; 41 development and 19 protected jobs. CV0501, CV0502 and JD0151 were inspected in the smoke run and are development.
* **The path tested** is the application's own: `src/prepare.ts`, now shared with the live pipeline, run as of 2026-10-28.
  * The steps are type check, native text or OCR (tesseract.js 7.0.0, local, Apache-2.0, eng+afr), extraction, validation and review flags.
  * Pre-populated JSON was not used for extraction.
* **Machine.** Apple M5, 16 GB, Node 24.22.1. A full run takes about 4 minutes 20 seconds.
* **Per-document resources:**
  * median time: 29 ms for Word, 7 ms for PDF, under 1 ms for text, 2.06 s for scans, 2.08 s for photos;
  * slowest document 2.9 s; peak resident memory 1.7 GB;
  * no crashes or timeouts.

## 2. Baseline (commit 7121e61, parser 2.8.0)

* **Refusals.** 48 of 300 CV documents were refused because no name could be confirmed (6 Word, 10 PDF, 11 scan, 21 photo). 13 of 180 job documents were refused because no title could be confirmed.
  * In the application, a refused document goes to exceptions and never reaches the candidate list.
  * This was the most consequential failure.
* **Where field errors come from.** After the measurement correction M1, the baseline had 4,227 field errors:
  * **3,859 (91%)** had the right text already read, and the parser mapped it wrongly;
  * 171 were reading order;
  * 157 were recognition;
  * 40 were text extraction.
* **OCR quality.** Median token recall against the transcription is 0.99. The median character error rate is 0.38, but most of it is reading order in column layouts, not misread characters.
* **Weakest fields:**
  * skill recall: 64 of 376 skills in Word documents;
  * job employer read as the e-mail address;
  * job location missing from every text-file job;
  * application-information lines leaking into requirements;
  * certification issuer never read;
  * duties mis-associated with employers on photos.

## 3. What changed, and by how much (protected split; same inputs)

| | Baseline | After E1 | After E2 |
|---|---|---|---|
| CV documents published | 112 / 135 | **119 / 135** | 119 / 135 |
| Skills found (recall) | 95 / 779 | 98 / 832 | **677 / 832** |
| Unsupported skill names (not in the document) | 52 | 61 | 55 |
| Checks from right to wrong | — | **0** | **0** |

* **Why denominators grow.** Newly published documents add their own checks, so the field denominators grow between runs.
* **E1** is a demonstrated improvement within the evaluated scope:
  * every newly published name is correct;
  * wrong names stayed at 3;
  * the result reproduced exactly from the clean commit.
* **E2** is **provisional**, because one criterion set before the run was breached:
  * unsupported skill names on protected **photos** rose from 7 to 9, from two OCR fragments such as "Pro tection" that are now visible;
  * the protected total fell, from 61 to 55;
  * the criterion did not say per format or in total, and it is not reinterpreted after the result. **The owner decides whether E2 stays.**
* **What became worse.** Only the two photo fragments above. Unsupported names rose from 52 to 61 between the baseline and E1 because 7 more CVs were published, each with its own extracted skills. That is a larger denominator, not a regression of any existing check.
* **Unchanged.** Every job field, location, certification issuer and photo duty association. No experiment targeted them yet.

## 4. Training

**None was performed, and none is justified yet.** 91% of field errors happen after the text has been read correctly, so they are parser and mapping faults. Retraining OCR, or training an extraction model, would not address them.

Recognition errors (157) concentrate on the simulated photos. Before any OCR experiment, they need real photographs: simulations are not evidence of real-camera performance.

## 5. Measurement problems found and corrected (M1)

1. **Certifications.** The scorer expected a separate certification list, but the schema files certifications as education entries.
2. **Comparisons.** Passing checks carried no expected value, so a comparison could not match a check that flipped between right and wrong.
   * The first "0 regressions" figures were therefore not a valid test.
   * Every run was re-scored and every verdict recomputed.
   * The comparator now refuses scores without stable check ids.

## 6. Not yet done on this batch

* **Matching (Formula A).** It needs the rules evidence assessor that turns canonical records into rubric states (next build step).
  * The batch has **no independently checked criterion labels**, and the pairing guide is not a match label.
  * So the first matching measurement can only compare verified structured inputs with actual extraction outputs, showing how extraction errors propagate into assessments. It cannot measure assessment accuracy.
* **Formula B.** It stays disabled. The pack's "notice" and "work preference" lines are CV statements, not confirmed needs, and are not used as preferences.
* **Full backend suite.** It was not re-run after E2. The parser suites were run, and the full suite runs before any merge.

## 7. Remaining risks

* **This batch is not independent.** Its content is adapted from an earlier corpus that was not supplied, and the simulations are not real captures. **No real-world accuracy, fairness or recruiter-efficiency claim follows from it.**
* **Protected results are within this batch only.** If future fixes are chosen by looking at protected failures, those records become development knowledge and are labelled as such.

## 8. Next experiments, in order of consequence

1. **E4: job title under a decorative folio** (13 refusals).
2. **E6: employer read as the e-mail address; location from "Location:" lines.**
3. **E7: application-information lines kept out of requirements.**
4. **E3: whether dictionary renaming of printed skills should be shown as the document's words.** This one is a normalisation question and may be a policy choice, so it waits for the owner.
5. **Certification issuer, status and year split.**

Each follows [`../../IMPROVEMENT_LOOP.md`](../../IMPROVEMENT_LOOP.md), with criteria written per format **and** in total before the run.
