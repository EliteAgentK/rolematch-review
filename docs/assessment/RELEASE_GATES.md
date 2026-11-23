# Formula A release gates (readiness tracker)

This table tracks evidence. It does not grant approval. **Production approval is the owner's decision**, informed by this evidence and by independent review.

* **Thresholds are proposed** until the owner approves them (decision D15), and they are never lowered after results are seen.
* **A pass on a finite test set is not a guarantee of zero errors in production.**

Status values:

* **met**: the evidence exists and is linked;
* **partial**;
* **not started**;
* **blocked**: waiting on the named item.

Last updated: 2026-10-28, branch `rolematch/formula-a-offline`.

## 1. Mathematical correctness

| Gate | Risk addressed | Test or evaluation | Dataset and unit | Proposed threshold | Why that threshold | Evidence | Reviewer | Status | Blocker / next action |
|---|---|---|---|---|---|---|---|---|---|
| M1 | Formula behaves as specified | unit tests on leaves, criteria, tiers, rounding and zero denominators | fictional; per case | all pass | they are exact specifications | `server/test/assessment/formulaA.test.ts` | engineering + independent code reviewer | partial: passing; independent review pending | an independent review |
| M2 | Nested AND/OR, ordering or equivalent wording changes results | property tests: normal form against direct evaluation; monotonicity; order-freedom; ordering consistency | 2,000 random expressions and 500 random jobs; per case | 0 failures | properties hold for every input | `properties.test.ts` | engineering | met (fictional) | — |
| M3 | Document and code drift apart | the generated specification block is compared with the code | — | identical | the document is the specification | `spec-drift.test.ts` | engineering | met | — |
| M4 | A fixed mistake comes back | the regression collection | every confirmed mistake; per case | 0 failing; no case edited to pass | a confirmed mistake must stay fixed | `regressions.test.ts`, `regressions/REG-*.json` | engineering | met (8 cases) | grows with every confirmed mistake |
| M5 | Results not reproducible | run the same inputs twice, and on a second machine | the evaluation sets; per run | identical outputs and hashes | determinism is a design property | runner report (stage 4) | engineering | not started | the offline runner |

## 2. Extraction and evidence-assessment quality

| Gate | Risk addressed | Test or evaluation | Dataset and unit | Proposed threshold | Why that threshold | Evidence | Reviewer | Status | Blocker / next action |
|---|---|---|---|---|---|---|---|---|---|
| Q1 | Credit given without support | assessor states against adjudicated labels | owner-supplied documents, stratified; per criterion, clustered by CV | unsupported positives ≤ 2% of positive states, with the 95% upper bound ≤ 5% | a false credit moves candidates up silently | evaluation report | two independent labellers plus an adjudicator | blocked | owner documents and the labelling protocol (D10) |
| Q2 | Relevant evidence missed | the same | the same | missed relevant evidence ≤ 10% of labelled-present criteria | a miss can be clarified, but it costs relevant candidates | the same | the same | blocked | the same |
| Q3 | Qualification status wrong | completion, level and field against labels | per qualification | errors ≤ 5% | completion feeds essential criteria directly | the same | the same | blocked | the same |
| Q4 | Employer, role and duty association wrong; months wrong | months against labels; association errors counted | per role | median absolute months error ≤ 2, and ≥ 90% within ±6 months | a year matters for "3+ years" | the same | the same | blocked | the same |
| Q5 | Abstention misuse | justified and unjustified abstentions | per criterion | unjustified abstention ≤ 5%; no forced guesses | abstaining is safer than guessing | the same | the same | blocked | the same |
| Q6 | Reading losses go undetected | reading-integrity recall, precision and false alarms | every pilot CV; per document region | recall ≥ 90%, precision ≥ 70%, ≤ 10 false alarms per 100 CVs | undetected loss looks like silence (spec §11) | the same | the reviewer of the original | not started | build the integrity check (stage 4) |
| Q7 | Matching defects confused with extraction defects | run matching on verified structured inputs **and** on actual extraction output | the same documents; per pair | report both; consequential errors attributed by stage | separates where fixes belong | runner report | engineering | not started | the offline runner |
| Q8 | Prompt injection and hostile documents | instructions, hidden text, hostile layouts and decompression bombs in fictional documents | fictional hostile set; per document | no state change from injected text; limits respected | text is data | existing `hostile-input.test.ts` and `hidden.test.ts`, plus assessor cases (to add) | security reviewer | partial | add assessor-level cases; no resistance claimed beyond the tests |

## 3. Ranking and recruiter usefulness

| Gate | Risk addressed | Test or evaluation | Dataset and unit | Proposed threshold | Why that threshold | Evidence | Reviewer | Status | Blocker / next action |
|---|---|---|---|---|---|---|---|---|---|
| U1 | Relevant candidates missed | relevant candidates outside the review set, against a common adjudicated relevance set, each with its cause | pilot then broader evaluation; per application, clustered by job | pilot: ≤ 1 missed across two jobs, none from an unflagged reading loss | the pilot can only detect gross failure: 0 of 20 still allows up to about 14% | pilot report | reference recruiters plus an adjudicator | blocked | D10 and documents |
| U2 | No real time saving | assisted minutes against manual minutes, including explanations, flags and extra opens | pilot; per job | ≤ 50% of manual minutes | "materially reducing" needs a defined bar | pilot report | owner | blocked | the same |
| U3 | Consequential interpretation errors | errors that move an application across the cut-off | pilot; per application | ≤ 2 across two jobs, each explained and registered | errors that change who is reviewed matter most | pilot report | the same | blocked | the same |
| U4 | Ordering policy chosen by assumption | P1, P2 and P3 compared on the same inputs, paired | pilot then broader evaluation | no choice before paired results | D1 | report | owner | blocked | the same |
| U5 | Recruiters misread the outputs | usability tasks: documented alignment, unknowns, conditional bounds, ties, warnings, B statuses, limits of recommendations | 5 to 8 recruiters; per task | ≥ 80% of tasks correct per concept | below that the display misleads | usability report | an independent UX reviewer | not started | after the pilot |
| U6 | Lower-priority candidates forgotten | random and targeted quality sampling outside the review set, with a named owner | live jobs (later); per sampled application | the sampling process exists and its misses are registered | quality is measured, not assumed | process + error register | job owner | not started | — |

## 4. Privacy and tenant isolation

| Gate | Risk addressed | Test or evaluation | Dataset and unit | Proposed threshold | Why that threshold | Evidence | Reviewer | Status | Blocker / next action |
|---|---|---|---|---|---|---|---|---|---|
| T1 | Cross-tenant access | every API route checked from a second organisation; database row-level security | test organisations; per route | 0 leaks; the route-coverage guard passes | any leak is unacceptable | `isolation.test.ts`, `tenant-separation.test.ts` | security reviewer | partial: API and database met; storage, queues, exports and logs to verify | extend to the new assessment tables when they exist |
| T2 | Candidate preferences overexposed | visibility tests for Formula B inputs | — | visible to recruiters with access to that candidate only | needs are personal | — | privacy reviewer | not started | Formula B is disabled |
| T3 | Retention and deletion miss derived data | deleting a candidate removes documents, records, matches, the error register, assessments and evaluation copies | test organisation; per record kind | nothing remains except the audit stub | POPIA principles; legal review needed | `deletion.test.ts` (partial) | privacy reviewer + legal | partial | add assessments and evaluation sets |
| T4 | Legal basis unclear | review of the actual processing and jurisdictions | — | a written opinion | **no compliance is claimed** without it | — | lawyer | not started | the owner to engage |
| T5 | Training-data pooling across tenants | technical check that no export or evaluation set mixes organisations without approval | — | none | the owner's rule | — | privacy reviewer | not started | — |

## 5. Security and operational reliability

| Gate | Risk addressed | Test or evaluation | Dataset and unit | Proposed threshold | Why that threshold | Evidence | Reviewer | Status | Blocker / next action |
|---|---|---|---|---|---|---|---|---|---|
| S1 | Slow or failing workflow | end-to-end benchmark from upload to list, **including extraction and assessment** | agreed workload; per document and per job | targets until benchmarked: median and 95th percentile agreed first | "1,000 users" is not a workload until its activity pattern is defined | — | engineering | blocked | **the owner to define the workload pattern and the deployment hardware** |
| S2 | One tenant starves others | queue fairness and backpressure under concurrent uploads | load test; per tenant | the agreed bound on any tenant's wait | per-tenant fairness | partial evidence in `scale.test.ts` and `several-servers.test.ts` | engineering | partial | define the bound |
| S3 | Crashes, retries, duplicates, stale jobs | kill workers mid-job; restart; resubmit; cancel | fault injection; per event | no lost or duplicated results; failures visible, never a low score | the product rule | heartbeat and requeue tests (partial) | engineering | partial | add assessment-stage faults |
| S4 | Backups do not restore | restore drill | staging copy | a successful restore within the agreed time | untested backups are not backups | — | operations | blocked | the dev project has no point-in-time recovery; needs a production project |
| S5 | Secrets leak | secret scanning; environment-only keys | repository and CI | 0 findings | — | (to add) | security reviewer | not started | — |
| S6 | Model or runtime supply chain | pinned versions, hashes, licences | model registry | every model and runtime recorded with its licence | owner rule | `ml-models.json` (incomplete: R9) | engineering | partial | complete the registry |
| S7 | **Malicious uploads** | options (D12): isolated scanner service; compensating controls (type sniffing, size and decompression limits, parse timeouts, worker isolation, never executing content) | — | an approved option, with the residual risk written down | previously deferred, **not** an accepted risk | limits in `limits.ts` and the hostile-input tests | security reviewer + owner | not started | **decision D12** |
| S8 | Monitoring misses incidents | alerts delivered to a named owner | staging | an alert test reaches its owner | — | — | operations | not started | — |

## 6. Human oversight and candidate safeguards

| Gate | Risk addressed | Test or evaluation | Dataset and unit | Proposed threshold | Why that threshold | Evidence | Reviewer | Status | Blocker / next action |
|---|---|---|---|---|---|---|---|---|---|
| H1 | The system decides instead of recommending | no automatic rejection, shortlisting or hiding; everyone stays accessible | code review + end-to-end tests | none of these exist | product rule 10 | `review.ts` lists everyone; incomplete applications are listed with their status | independent reviewer | partial | end-to-end test once the panel is built |
| H2 | Overrides and corrections are not audited | every override has a reason; history is kept | — | all audited | product rule 4 | change reasons (milestone 1) | the same | partial | extend to assessments |
| H3 | Fairness claimed without evidence | no fairness claim; counterfactual tests are diagnostics only | — | **no claim** | excluding names is not fairness | — | owner + legal | n/a | — |

## 7. Formula B readiness

| Gate | Risk addressed | Test or evaluation | Dataset and unit | Proposed threshold | Why that threshold | Evidence | Reviewer | Status | Blocker / next action |
|---|---|---|---|---|---|---|---|---|---|
| B1 | Assumed preferences | B uses confirmed needs only; disabled outside evaluation | — | enforced in code | product rule | `formulaB.test.ts` | engineering | met (in code) | — |
| B2 | Boundary errors (pay, location, notice) | the boundary tests | fictional; per case | all pass | exact rules | `formulaB.test.ts`, REG-0005 to REG-0007 | engineering | met (fictional) | — |
| B3 | B is useful and understood | candidate-confirmed needs, recruiter evaluation | real confirmed needs; per candidate | to be proposed | no data exists yet | — | owner | blocked | collecting confirmed needs is a separate, approved stage |

## Release sequence

Each step needs the owner's approval. Passing a gate allows the next evaluation, not release.

1. Offline gates.
2. The two-job pilot.
3. A broader pre-production evaluation ([`PILOT_PROTOCOL.md`](PILOT_PROTOCOL.md), section 6).
4. A separately approved production-shadow phase, in which new outputs do not affect decisions and any live document needs explicit authorisation.
5. One approved organisation, behind a tenant-scoped flag, monitored.
6. Wider release.

Throughout, the incumbent stays runnable for rollback (D14).
