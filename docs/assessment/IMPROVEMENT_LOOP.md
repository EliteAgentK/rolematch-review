# How matching keeps improving after every mistake

Every mistake that is found becomes permanent protection, and every fix is measured before it is trusted. The **loop is automated. Trust is not.**

* Evidence collects itself.
* The checks run themselves.
* People approve every change to scoring.
* Nothing changes the approved policy on its own.

## 1. Where mistakes are found

| Source | How it arrives | Already built? |
|---|---|---|
| A recruiter corrects a field read from a document | the change-reason dialog records why. A correction writes an **unverified** row to the organisation's own error register (database table, migration 015) | yes (milestone 1) |
| A recruiter disagrees with an assessment or a list | an override with a reason, recorded on the assessment | to build with the panel (stage 4) |
| The pilot, an evaluation or quality sampling finds a miss or a consequential error | listed in the evaluation report with its cause | the report format: yes; the runner: stage 4 |
| A test, probe or review finds a defect | an entry in [`docs/learning/ERROR_REGISTER.md`](../learning/ERROR_REGISTER.md) (fictional cases only) | yes |

## 2. What happens to each one

1. **Verified by a person.** An unverified correction can be the candidate's own update rather than our error, so it does not become a label until someone checks it.
2. **Sorted to the layer at fault:**
   * reading (OCR or layout);
   * extraction (fields);
   * requirement approval;
   * evidence assessment (rubric or assessor);
   * policy (a number or a rule).

   The fix goes to that layer, never as a one-off rule somewhere else.
3. **Reproduced as a regression case** before it is fixed. The case is a fictional reproduction in `server/test/assessment/regressions/REG-*.json`, linked to its register entry, and it runs on every test run.
   * The real document behind it, if any, stays in the organisation's protected set, outside Git.
   * A case is never edited to make a change pass.
4. **Fixed, as a new version.** A new parser, rubric, assessor or policy version is created. Old results keep their version and are never rewritten; a re-run creates a new assessment with a visible change record.
5. **Gated** (`server/src/assessment/gates.ts`). The candidate version runs on the **same** inputs as the current one. It is eligible only if:
   * no regression case fails;
   * missed relevant candidates, consequential errors and unsupported positives are not worse;
   * review work grows by no more than the tolerance.

   The tolerances are the release-gate table's, fixed before the run.
6. **Owner approval.** This is needed for any change to scoring policy or ordering, any gate failure that someone wants to override, and any mass change to stored results. It is followed by a shadow comparison and a gradual release, with rollback to the previous version.

## 3. What never happens automatically

* The matching formula and its policy numbers never change by themselves.
* No model is fine-tuned, or replaced, without a measured baseline showing what training needs to fix, and an approved evaluation.
* No candidate data is pooled across organisations for training without explicit approval, consent and a lawful basis.
* No threshold is lowered after seeing a result.

## 4. How it runs over time

* **Every test run:** the regression collection, the property tests and the drift test.
* **Every evaluation:** the gate, comparing the proposed version with the current one, plus a report of what changed and why.
* **Each quarter:** a fresh protected evaluation batch from authorised documents, with the previous batch retired into the regression collection.
* **Continuously, once hosted:** recruiter corrections and overrides arrive in the register; disagreements between the rules assessor and a model (when there is one) are routed to reviewers; and successes are randomly audited, so the system learns from what works as well as from what fails.
