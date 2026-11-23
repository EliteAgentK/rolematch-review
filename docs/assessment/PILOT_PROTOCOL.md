# Formula A pilot and pre-production evaluation protocol (PROPOSED: decision D10)

Nothing in this protocol runs until the owner approves it and supplies the documents. No document is used unless the owner hands it over, and every document needs a lawful basis for its use.

Everything runs on our own infrastructure, with local, permissively licensed tools only. Nothing is sent to an external AI service, and nothing incurs external cost. Originals and labels stay outside Git, in the organisation's private storage. A pass at any stage permits the next evaluation. It never releases anything.

## 1. Pilot scope

* **Jobs and organisation.** One organisation, two jobs from different job families.
* **Size.** About 80 applications per job.
* **Formula.** Formula A only. Rules 2.2.0 runs beside it on the same inputs.
* **Ordering.** P1, P2 and P3 are all computed on the same inputs.
* **Review budgets reported.** The top 10%, 20% and 30% of applicants. Each budget includes the whole exact tie at its cut-off, and the flagged applications are listed beside the review set.

## 2. Reference labels, made before anyone sees any system output

These labels take research time, which is recorded separately from ordinary workflow time.

1. **Rubric.** A written labelling rubric per job, approved by the job owner, covering what counts as relevant and what each evidence state means. Reviewers practise on fictional CVs first.
2. **Relevance.**
   * Two recruiters independently review every application against the approved criteria, recording "would progress to interview: yes / no / unsure" and a reason.
   * A third adjudicates disagreements under the rubric. The result is the **common reference relevance set** that every policy is judged against.
3. **Evidence.** Two labellers mark each criterion for a stratified sample: every adjudicated-relevant application plus a random draw of the rest, about 30 per job.
   * They record the state, the supporting quote, months for experience, and qualification completion, level and field.
   * Disagreements are adjudicated.
   * Agreement is reported as Cohen's kappa with a bootstrap interval clustered by CV.
4. **Reading problems.** For every application, a reviewer compares the original with the extracted record and lists what was lost or garbled.

## 3. The assisted workflow, measured fairly

* **Reviewers.** A recruiter who did **not** make the reference labels, so has never seen these documents, works each job from the system's list. If only the reference recruiters are available, half the jobs are worked manually first and half assisted first, and the effect of having seen the documents before is reported rather than ignored.
* **What is timed.** Everything the recruiter does: opening applications, reading explanations, resolving flags and opening extra applications.
* **Baseline.** Each recruiter's experience is recorded. Manual time comes from the reference reviewers' own first pass, timed per application, and is reported alongside.

## 4. What is reported, per job and in total

* **Counts.** Applicants, and adjudicated-relevant applicants.
* **Recall.** Relevant applicants found at each review budget, under P1, P2 and P3 on the same inputs. A paired comparison is made per job.
* **Misses.** Every relevant applicant outside the review set is listed with its cause: reading loss (flagged or not), assessment error, ordering policy, or not documented in the CV.
* **Workload.** Review-set size, flag count, and minutes spent resolving flags.
* **Consequential interpretation errors.** Assessment errors that move an application across a cut-off.
* **Assessment quality.** Unsupported positives, relevant evidence missed, the state confusion table, qualification-status errors, association errors, months errors, and justified and unjustified abstentions.
* **Two inputs, separately.** Matching is run on the verified structured inputs (the labels) **and** on the actual extraction output, so extraction defects are not counted as matching defects.
* **Reading integrity.** Recall and precision.
* **Time.** Manual against assisted minutes.
* **Processing.** End-to-end processing time, failures, and reproducibility. Two runs must be identical.

## 5. Success criteria, fixed before the run (proposed)

| # | Criterion | Pass if |
|---|---|---|
| S1 | Missed relevant applications at the 20% budget | ≤ 1 across both jobs, and none caused by an unflagged reading loss |
| S2 | Assisted minutes | ≤ 50% of manual minutes, for each job |
| S3 | Consequential interpretation errors | ≤ 2 across both jobs, each explained and entered in the error register |
| S4 | Reading-integrity false alarms | ≤ 10 per 100 CVs |
| S5 | Reproducibility | two runs identical |
| S6 | Boundaries | no data leaves our infrastructure, no cross-tenant access, no unsupplied document used. A breach stops the pilot immediately |

**What a pass means.** With about 20 relevant applicants, "0 missed" still allows a true miss rate of up to about 14% (exact binomial, one-sided 95%). A pass shows the approach does not fail grossly on two real jobs. It does not show a low miss rate, fairness or production readiness.

## 6. Broader pre-production evaluation (after a pilot pass, separately approved)

* **Coverage.** At least 6 job families, at least 3 seniority levels, and every organisation that authorises it. It spans:
  * document types: native PDF, Word, scans and photographs;
  * CV shapes: short, long, sparse and complex;
  * the supported languages only;
  * incomplete, contradictory and adversarial documents;
  * unseen layouts, candidates and jobs.
* **Splits.** Every document is assigned to development, regression or protected evaluation by **group**: candidate, near-duplicate cluster and layout family. Related documents and variants therefore never cross splits.
* **Protected evaluation set.**
  * It is never used to choose a change.
  * A change selected after examining its failures needs a fresh protected set, or a documented separation between development and evaluation.
  * A new protected batch is drawn each quarter, and the old batch retires into the regression collection.
* **Sample sizes** are chosen per metric from the precision needed, the prevalence and clustering.
  * Example: to estimate a 5% unsupported-positive rate to ±2 points, at about 7 criteria per CV with an intra-cluster correlation of 0.2, needs about 456 independent criteria. The clustering correction is 2.2, so that becomes about 1,000 criteria, or about 145 CVs.
  * Rare states such as "contradicted" need enriched sampling, weighted back.
  * Slices with too little evidence are reported as such, not averaged away.
* **Intervals.** Every result carries an interval: Wilson for independent proportions, a cluster bootstrap otherwise, and paired comparisons for policies.
* **Synthetic data** may supplement the evaluation. It never substitutes for authorised real documents.

## 7. The efficiency trade-off, without hiding misses

The trade-off curve reports relevant-applicant recall against applications reviewed, minutes, clarification workload and consequential errors, at every review budget.

* No time saving may come from hiding applicants or from weakening uncertainty thresholds.
* Everyone stays in the list.
* Random and targeted quality sampling outside the review set has a named owner, and its misses go to the error register.
