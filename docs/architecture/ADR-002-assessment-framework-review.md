# ADR-002: Review of the "Mathematical Assessment Framework" (v1.0 deck and specification)

Status: reviewed 2026-10-22. What we adopted is built in rules 2.1.0; what we did not adopt is explained below. Decisions that are the owner's to make are listed at the end.

Source: `RoleMatch_Mathematical_Assessment_Framework.pdf` (15 slides, made with Gemini Notebook) and the longer specification text it summarises, both produced from the owner's research prompt. This review checks it against that prompt, against the running engine (`server/src/match.ts`, `scoring.ts`, `ruleset.ts`) and against its own arithmetic.

## 1. Verdict

The framework gets the **construct** right: the score is "documented alignment with this job's approved requirements", not worth, performance or hiring probability; missing evidence is not a deficiency; supported by the CV is not the same as independently verified; logistics and preferences are kept apart from the score; the job rubric is frozen and versioned; embeddings never produce the final number. RoleMatch already worked this way in rules 2.0.0, and in a few places more strictly.

Its **mathematics** has four defects that would make results worse than today's, and its **legal statements** go further than the sources allow. It also does not deliver what the prompt asked for: no primary-source references (section K), two worked examples instead of at least six, no configuration table, no fairness and validation plan, and no self-check. Several slide labels are garbled ("Kisted in Tenn", "credencent"), so it was not proof-read.

## 2. What we adopted (built in rules 2.1.0)

| Framework idea | What RoleMatch does now | Where |
|---|---|---|
| Logistics is separate from alignment (§1.3, §4.3 `L_logistic`) | Location and work arrangement are **removed from the alignment score** (they were weighted 4 in 2.0.0) and shown as a separate Logistics line: compatible, to confirm, or a conflict to resolve. Checked whenever a job is on-site or hybrid. | `logistics.ts`, `ruleset.ts` |
| Place for on-site work (owner's request) | Places are compared by level, not kilometres: same city, same province, same country, another country, or unknown. A local table (towns and business districts with their city and province, the nine provinces, common countries) does the lookup, so no outside mapping service is called. Same city or province is compatible (confirm the commute); another province or country is to confirm, never a mismatch, because people move for jobs. | `geo.ts`, `logistics.ts` |
| On-site jobs need a location (owner's request) | An on-site or hybrid job without a location, or with one not in the place list, shows a notice on the job panel. It never blocks the job. | `jobLocationNotice`, job panel |
| Discriminatory-wording flags on the job (§5.2) | Each requirement is read against a versioned list (age, sex, family, health, language, origin, religion, appearance; licences, record checks, citizenship; vague or excessive wording) and flagged with a reason. **Changed:** the framework would block or pause the job; we flag and let the recruiter decide, because many flagged requirements are lawful when inherent to the job (a driver's licence for a driver). | `jobReview.ts` |
| Evidence coverage (§7.3 `C_coverage`) | A coverage figure: the share of the job's requirement weight the documents give *any* evidence for. **Changed:** the framework's coverage measures readability (`1 − U`), so a CV that is silent on a mandatory requirement still shows 80% coverage (its own Scenario Alpha). Ours measures evidence. | `match.ts` |
| Points out of 100 (§7.1) | Each requirement shows "x of y points": its weight as a share of 100, and the points the documents prove. The proved points add up to the proved score. Weights stay relative (10 mandatory, 4 preferred), so nothing has to be re-balanced to sum to 100 by hand. | `match.ts`, match panel |
| Frozen reference date for "Present" (§11 trap 2, reversed) | The framework binds open end dates to the system clock at run time, which makes a result impossible to reproduce later. Each result now records its **reference date**, and the same inputs with the same date always give the same result. | `assess(…, asOf)` |
| Direction invariance (§1.2) | Already true by construction (one pure function per pair, nothing pool-relative); now tested: one candidate against many jobs and one job against many candidates give byte-identical results. | `logistics-and-review.test.ts` |
| Overlapping time counted once (§8.2) | Already true (`yearsCovered` takes the union of months). | `dates.ts` |
| Contradicted state | The first real producer: a qualification the CV states as **not completed**, against a requirement for it, is contradicted (unless the requirement accepts an equivalent). | `match.ts` |
| "Verified" is not "independently verified" (§6) | The match panel now says "Shown in the CV" instead of "Verified", and explanations say a statement has not been checked. | match panel |

The matching review that followed (owner's request) also fixed four defects the framework did not mention: a profile summary counted as described use; qualification status was ignored (an in-progress or abandoned degree earned full credit); certificates were not read for skills; and job level and recency were invisible (now shown as context, not scored). See `MATCHING_MODEL.md` §1 and §2.

## 3. What we did not adopt, and why

1. **The mandatory gate `Q_M = Π⌈E_j⌉` (§7.3).** One undocumented mandatory requirement sets the whole score to 0%.
   * It treats *not mentioned* as *does not have*, which the framework itself forbids (§6, state 3 vs state 5).
   * It makes RoleMatch reject people in effect: a candidate who meets 9 of 10 requirements scores the same 0% as a blank page, and both drop to the bottom of every list.
   * The ceiling function makes it a cliff, not a gate: any trace of evidence (`E = 0.01`) passes it fully, so one keyword mention flips a result from 0% to 68%. That rewards exactly the keyword stuffing §8.3 tries to stop, and breaks monotone, proportional credit.
   * Its own Scenario Alpha shows the damage: the interval is reported as `[0.0% – 0.0%]` although 20 points were unreadable and could not be judged.

   RoleMatch keeps mandatory requirements weighted 2.5 times preferred ones, flags "verify N mandatory requirements before progression", and caps the score at 40 only when the CV **contradicts** a mandatory requirement.
2. **Tier 2 and Tier 3 credit (§8.1).** "PyTorch → TensorFlow = 0.7" and "cosine similarity scaled to 0–0.5" are numbers with no source. Cosine similarity inside the score contradicts §12 ("similarity is NOT the final score"). It also ties the score to a model version, and it lets an opaque model decide credit, which the owner's rule forbids. Related skills are shown as "where to look", for no credit (points catalogue S04). Equivalences belong in the job's approved list of acceptable alternatives, which the recruiter approves.
3. **Substantiation penalty β = 0.25 (§8.3).** It is the same idea as our "named but not described" level, at 0.25 instead of 0.5. Neither number is validated. We keep 0.5 as a stated assumption until recruiter data can estimate it (MATCHING_MODEL §6). Requiring "chronological context" would also penalise skills shown in projects, courses or self-employment.
4. **A recency half-life of 4 years (§5.1 schema).** It is unvalidated, and decaying old experience disadvantages older candidates and people returning from a career break. Recency is shown ("last shown in use: 2008"), not scored.
5. **Bloom's taxonomy proficiency levels (§5.1).** A CV does not evidence cognitive levels, and the result would be false precision. Not adopted.
6. **One decimal place with banker's rounding (§7.5).** Showing 84.3% implies precision the unvalidated constants do not have (CLAUDE.md: avoid false precision). Scores stay whole percentages; ranking uses the stated total order, and ties are explicit.
7. **Zero-vector trap returns 0.0 (§11).** A blank or unreadable CV should be "needs review", not 0% alignment. RoleMatch already sends weak reads to review, and a silent CV shows proved 0% with a ceiling of 100% and near-zero confidence.
8. **"Hard block" of demographic data at ingestion (slide 3).** A CV contains a name, often a photo, sometimes an ID number. The recruiter needs the name, so these cannot be kept out of ingestion. They are kept out of **scoring**: the forbidden-input list is checked by tests, and changing a name, email, phone or location leaves every score unchanged.
9. **"Physical zero-fill overwrite" for retention (§2.1).** Overwriting in place is not meaningful on SSDs or managed object storage. The workable equivalents are deletion with storage-level lifecycle rules, and crypto-shredding (destroying per-tenant keys). Retention periods are a legal and policy decision, not yet made.
10. **WASM/SIMD for scoring, and a custom storage engine (§10, §12; Phase 1).** Scoring a pair is a few hundred arithmetic operations, which takes microseconds in plain TypeScript, so there is nothing to accelerate. A custom engine was reviewed and rejected in ADR-001 in favour of self-hosted PostgreSQL.
11. **"Commutative" `f(C, J) ≡ f(J, C)` (§1.2).** The function is not commutative (C and J are different kinds of thing). The property that matters is direction and pool invariance, which is now tested.
12. **"Invariant over time" (slide 4).** False for a current role: experience accrues. It is reproducible for a fixed reference date, which is what we record.

## 4. Arithmetic check of the worked examples

* Scenario Alpha: `Q_M = 1 × 0 = 0`; S_align = 0; coverage = (30 + 40 + 0 + 10)/100 = 80%. The arithmetic follows the formula; the formula is the problem (§3.1).
* Scenario Beta: E₂ = 3.5/5 = 0.70 → 28 points; S_align = 30 + 28 + 0 + 10 = 68%; S_max = 30 + 28 + 20 + 10 = 88%. Correct. RoleMatch gives the same 0.70 for 3.5 of 5 years (`yearsCredit`, linear to the requirement, then flat), so the "unresolved decay function" the deck flags for founder approval is already defined.

## 5. Legal statements that need qualified review

None of the following is legal advice. Each needs a South African employment and privacy lawyer before it is relied on.

* **Employment Equity Act s6.** The deck lists the grounds correctly in substance, but leaves out that s6(2) allows a distinction based on an *inherent requirement of a job*. That is why wording flags must not block.
* **EEA s8 (psychological testing and other similar assessments).** The deck *concludes* RoleMatch "avoids classification" under s8. That is a legal conclusion with no authority behind it. Whether an automated CV-to-job assessment is an "other similar assessment" is the question to put to counsel, together with the section's current text as amended.
* **POPIA.** s11 lists more grounds for processing than consent and contract. Section 71 (decisions based solely on automated processing) is directly relevant and was not mentioned. RoleMatch's design (a person decides, the evidence is shown, the candidate can clarify) is meant to meet it, but that needs confirming. s14 retention periods are still to be set.

## 6. Decisions for the owner

1. **Qualification completion: settled in principle.** The owner says it depends on the job description. Until a model reads each requirement (does it accept someone still studying? an equivalent?), the default stays: a year alone earns half credit with "confirm completion".
2. **Distance bands: settled.** The owner chose city, province and country levels (only for on-site and hybrid jobs) instead of kilometres, so there are no bands to set.
3. **Place table.** About 90 places and aliases are hand-entered, with the nine provinces and common countries. Approve importing GeoNames (CC BY 4.0, attribution required) to cover every town.
4. **Legal review** of section 5 before the first organisation uses the platform.
