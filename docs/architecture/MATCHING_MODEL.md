# The matching and scoring model (rules 2.2.0)

Status: implemented in `server/src/scoring.ts` (the arithmetic), `server/src/match.ts` (reading evidence into the arithmetic), `server/src/ruleset.ts` (every number), `server/src/logistics.ts` and `geo.ts` (logistics, kept apart from the score) and `server/src/jobReview.ts` (wording review of job requirements). The mathematics is checked by `server/test/scoring.test.ts` and `server/test/match.test.ts`. No language model is involved anywhere in the score, by design: a language model may later *explain* a result, never produce one.

## 1. What went wrong with rules 1.0.0 (found on real matches)

On the owner's own data, the Cloud Platform Engineer job scored a hands-on engineer 91 and a head of technology with 20 years of experience 39, with the ceiling at 100 for both. Reading the evidence behind the 39 found four defects of arithmetic and one of meaning.

| # | Defect | Effect |
|---|---|---|
| 1 | **Credit ignored how much evidence there was.** A requirement naming four tools earned half credit whether one or three were evidenced (`partial` = 0.5). | Not monotone in evidence: 3 of 4 and 1 of 4 scored the same. |
| 2 | **"Bash or Python" was treated as "Bash and Python".** A candidate who used Python lost half the credit. | Alternatives were punished. |
| 3 | **Years were counted from any role sharing one word with the requirement.** A head of technology "counted" as cloud operations (8.8 years) because the word "operations" appeared. | Relevance was far too generous. |
| 4 | **The headline score was the lower bound** (anything unmentioned counted as zero) shown as if it were an estimate, beside a ceiling of 100. | A CV that says little looked like a poor candidate. The width of the range, which is the real information, was hidden. |
| 5 | **Meaning:** the score measures fit to *this job's stated requirements*, not "how qualified a person is". Years beyond the requirement earn nothing extra and the job's level (senior, head of) is not a requirement the engine can see. | A 20-year executive can score below a specialist on a technical role, correctly by the evidence, and read as "less qualified". |

### Rules 2.1.0 (2026-10-22): found by the framework review (ADR-002) and a second probe of the engine

| # | Defect | Fix |
|---|---|---|
| 6 | **Location was part of the score** (weight 4). A strong engineer in another city scored lower than a weaker one nearby, and place can stand in for race and income in South Africa. | Removed from the score. Logistics is a separate line (section 2a). |
| 7 | **A profile summary counted as described use.** "Experienced Kubernetes engineer" in a summary earned the same full credit as a described role. | A skill named only in the summary is *named* (half credit), like a skills list. |
| 8 | **Qualification status was ignored.** A degree in progress, or stated as not completed, earned full credit. | Status decides (section 2). A degree stated as not completed is the first real `contradicted` state. |
| 9 | **Certificates were not read for skills.** "AWS Certified Solutions Architect" earned nothing against an AWS requirement. | Certificate and qualification titles count as naming the skill (half credit). |
| 10 | **Level and recency were invisible.** A two-year junior scored 100% on a "Senior Developer" job; Java last used in 2008 read like Java used today. | Both are shown as context beside the result. They are not scored until a rule is agreed from recruiter data. |

### Rules 2.2.0 (2026-10-23): found by twelve invented four-to-five-page CVs, six evidence-rich and six weak (`npm run eval:extensive`)

Under 2.1.0 a weak marketing CV made of bare lines ("Did SEO.", "Social media.") scored 74 against its job, above two evidence-rich CVs (an engineering lead and a chartered accountant, both 63).

| # | Defect | Fix |
|---|---|---|
| 11 | **A bare line counted as described use.** "Did SEO." earned the same full credit as a sentence saying what was done. | A line counts as described use only if, after removing the skill names and empty words ("did", "used", "worked with", "various", "exposure to"…), at least two content words remain (`evidence.describedLineMinContentWords`). A shorter line counts as named, and the result says so. |
| 12 | **A degree's field was read as a skill.** "A degree in Marketing or Communication" was read as the skill Communication. | Qualification requirements are read as qualifications only, through the capability graph (below). |
| 13 | **The qualification check ignored the graph.** A BSc plus Honours earned half credit; level, field and completion were judged by words. | Qualification requirements use the capability graph's level, knowledge coverage and completion ladder (`docs/architecture/CAPABILITY_GRAPH.md`), and every verdict carries what the recruiter should verify or ask. |
| 14 | **Professional designations were not recognised.** CA(SA) earned nothing against "CA(SA) required". | A fixed list of designations (CA(SA), Pr.Eng, Pr.Tech, CFA, ACCA, CIMA, PMP, SAIPA, CCNA, CISA, CISSP) is searched for. A stated designation earns named credit (to verify with the body); one "in progress" or "working towards" earns nothing yet. |
| 15 | **The rules fingerprint did not cover the graph.** A change to a knowledge profile could change a result without changing the fingerprint. | The fingerprint includes the graph version, knowledge areas, qualification profiles, completion credits and the unjudged-field factor. |

Re-run on the same twelve CVs (with parser 2.6.0, which fixed the reading faults the same CVs exposed): the six rich CVs prove 74 to 89, the six weak ones 29 to 44, with no overlap (the marketing CV falls from 74 to 44; the engineering lead and the accountant rise to 74 and 76; the sales CV rises from 15 to 44 once its paragraph-style roles are read; the teacher's unfinished BEd is now read as not completed, a contradiction that caps that match at 40). Personal details (date of birth, gender, ID number and the like) still never change a score.

Re-run on the same data, rules 2.0.0 gives the head of technology 42 (the documents prove 42%, up to 100%; relevant years fall from 8.8 to 5.1; "Bash or Python" is fully met; the four-tool requirement earns a quarter) and the engineer 94.

## 2. The model

A job is a set of **requirements** with weights `w_i` (mandatory 10, preferred 4). Location is not a requirement weight (from 2.1.0; see section 2a). A requirement is a list of **parts** joined by AND. A part is either a **group of alternatives** (joined by OR) or a **years requirement**.

For an alternative, the evidence has one of three levels: `direct` (a job title names it, or a role, project or noteworthy line describes the skill being used, with at least two content words besides the skill names; from 2.2.0), `listed` (it is only named: a skills list, the profile summary, a certificate or qualification title) or `absent` (it is not mentioned; this is not proof the person lacks it). Each is credited three ways:

| Level | low (proved) | exp (expected) | high (possible) |
|---|---|---|---|
| direct | `d` = 1 | `d` | 1 |
| listed | `l` = 0.5 | `l` | 1 |
| absent | 0 | `ρ` (prior, currently 0) | 1 |

* **Qualifications (from 2.2.0):** a requirement for a degree, diploma, matric or similar is judged by the capability graph, never by word matching. Credit = completion credit × (level met) × knowledge coverage of the required field, using the best qualification only. Completion credit by the ladder: stated or implied completed 1; dates fit the normal length 0.75 (up to 1); a year only 0.5 (up to 1); no status, in progress, or a span shorter than normal 0 (up to 1, to ask); stated as not completed 0 in every view, which is **contradicted** unless the requirement also accepts equivalent experience (then `not demonstrated`, ceiling open). A field nobody has approved a list for ("any relevant degree") earns half (`UNJUDGED_FIELD` = 0.5) of the proved credit and leaves the rest possible. Knowledge profiles are drafts awaiting review, and every verdict lists what to verify (with the institution or SAQA) and what to ask.
* **Professional designations:** see defect 14. Credit is `listed` (named, to verify with the professional body).
* **Group (OR):** `g = max` over its alternatives, per view.
* **Years:** with `y` relevant dated years and `N` required, `low = exp = min(1, y / N)`; `high = 1` if a relevant role has no dates (it could close the gap), else `low`.
* **Requirement:** the mean of its parts' credits (so "AWS, Linux, Terraform and Docker" is four parts, each worth a quarter).
* **Match:** the weighted power mean `(Σ w_i r_i^p / Σ w_i)^(1/p)`, in three views. With `p = 1` (the configured value) it is the ordinary weighted mean `Σ w_i r_i / Σ w_i`; `p < 1` would let a weak requirement pull the total down harder, so balanced coverage beats lopsided coverage. `p` stays at 1 until recruiter data justifies another value. `score` is `exp`, `scoreFloor` is `low`, `scoreCeiling` is `high`. With `ρ = 0`, `score` equals what the documents prove.
* **Relevance of a role to a years requirement:** at least half of the requirement's subject words appear in the role, or the role uses a skill the requirement itself names.
* **Points out of 100:** requirement `i` is worth `100 · w_i / Σw` points and the documents prove `100 · w_i · low_i / Σw` of them, so the proved points add up to the proved score. This is presentation only: the weights stay relative.
* **Coverage:** `Σ w_i c_i / Σ w_i`, where `c_i` is the share of requirement `i`'s parts the documents say anything about (described, named or some relevant years). It measures how much of the job the documents speak to. It is separate from the score (a CV that names everything and describes nothing has coverage 100% and proves 50%) and from confidence.
* **Reference date:** "Present" in a CV is read as the reference date given to the engine, which is recorded in the result. The same inputs with the same date always give the same result.
* **Ranking:** candidates are ordered by a fixed total order: higher proved score, then higher expected, then the narrower range, then higher confidence, then the id. Ties are never broken by chance or arrival order.
* **Confidence:** `(1 − (high − low)) × min(1, q / 0.6)`, times 0.85 while the job's requirements are unapproved. `q` is the average extraction quality of the two documents; 0.6 is the best a rule-based read can reach. It measures how tightly the evidence pins the score down and how well the documents were read, never how good the candidate is.

## 2a. Logistics and context: shown beside the score, never in it

* **Logistics** (`logistics.ts`) is checked whenever a job is on-site or hybrid, or names a place without saying it is remote. It reports compatible, to confirm, or a conflict to resolve. Inputs are the job's place and arrangement, the candidate's town or city, and explicit statements in the CV ("willing to relocate", "remote only"), which are quoted back. Places are compared by level using a local table (`geo.ts`; no outside mapping service is called): same city or same province is compatible (confirm the commute); another province or country is to confirm, never a mismatch, because people move for jobs. Only an explicit statement that conflicts with the job is a conflict, and that still only asks a person to confirm. An on-site or hybrid job without a location shows a notice on the job; it is never blocked.
* **Context** (shown, not scored): the level a job title implies (junior to head of) beside the candidate's related years and latest title, and "last shown in use: year" for a skill or subject last evidenced at least 5 years before the reference date. Neither moves a score until a rule is agreed from recruiter data.
* **Wording review** (`jobReview.ts`): each requirement is checked against a versioned list of wording that may be unfair (age, sex, family, health, language, origin, religion, appearance), that needs a job reason (licence, own car, record checks, citizenship), or that is unclear or excessive. Flags appear on the job and on each match row. A flagged requirement is still assessed as written: the recruiter decides whether to keep, reword or remove it.

## 3. Properties, with proofs

Let `D(a) ≥ L(a) ≥ A(a)` be the credits of the levels, with `0 ≤ A ≤ L ≤ D ≤ 1` (the configuration is checked to satisfy this). Every view is built from `max`, an arithmetic mean and a weighted mean.

* **P1 Bounds** (`0 ≤ low ≤ exp ≤ high ≤ 1`). Per level the three views are ordered and within [0, 1] by the table. `max`, mean and weighted mean of ordered values stay ordered and within [0, 1], because each is monotone in every argument and idempotent on constants. So it holds for groups, requirements and the whole match.
* **P2 Monotone in evidence.** Raising an alternative from absent to listed to direct raises each view (`A ≤ L ≤ D`, `high` constant). `max`, mean and weighted mean with non-negative weights are non-decreasing in each argument, so no view of the group, requirement or match can fall. Years credit is non-decreasing in `y`.
* **P3 Symmetric.** `max`, sum and mean do not depend on order, so reordering requirements, parts or alternatives changes nothing.
* **P4 Homogeneous in the weights.** Multiplying every `w_i` by `k > 0` multiplies numerator and denominator of the weighted mean by `k`; the ratio is unchanged. Only relative weights matter.
* **P5 OR semantics.** A group's credit is the maximum of its alternatives, so adding an alternative cannot lower it, and one satisfied alternative satisfies the group.
* **P6 Proportional.** For `n` independent single-alternative parts of which `k` are direct, `low = kD/n`: credit grows linearly with the evidence, never in jumps.
* **P7 Honest about the unknown.** Absence moves only the gap between `low` and `high`; it never lowers `low`, and it never raises it. A document that says nothing has `low = 0` and `high = 1`, and confidence near zero.
* **P9 Repetition earns nothing.** Evidence is a level per distinct skill (direct, listed, absent), not a count, so repeating a word, a skill, a sentence or a whole role cannot raise any view; overlapping months are a union, so duplicated roles add no years.
* **P10 Power mean is a proper aggregate.** For every `p > 0` it is between the smallest and largest value, symmetric, homogeneous in the weights and monotone in every value, so P1 to P4 survive; for `p < 1` it never exceeds the ordinary mean (Jensen's inequality).
* **P11 Total order.** The ranking comparison is reflexive-equal, antisymmetric and transitive (it is a lexicographic order on a fixed list of keys ending in the unique id), so the same candidates always sort the same way.
* **P8 No outside inputs.** The functions take only evidence levels, years, weights and the configured credits. Name, email, phone, photo, rating and every protected trait are not arguments (a test checks the results do not move when they change).

These are algebraic facts, but they are also tested: `scoring.test.ts` checks P1 to P6 on thousands of seeded random cases, `match.test.ts` checks the whole-match versions (ordering, shuffled requirements, more evidence never lowers a score, identity fields have no effect).

## 4. Never counting the same thing twice

A scoring system that can be inflated, or that quietly splits a person in two, cannot be trusted. Five places where something could be counted twice, and what stops each:

1. **A requirement repeated in the job description.** "TypeScript and JavaScript experience" written three ways would triple a demand. Each requirement has a *signature* (its skill groups, sorted, and its years figure); a requirement whose signature has already appeared is shown but carries no weight ("counted once"). Mandatory requirements come first, so a repeat can never outrank the original.
2. **A word, skill, sentence or role repeated in a CV.** Evidence is a level per distinct skill, never a count of mentions; roles are a union of months. Tested: stuffing a CV with the same skills forty times and duplicating the role entries changes no score.
3. **The same evidence under two headings.** A skill, its certification and the course that taught it are separate demands only if a requirement asks for each; within one requirement, one credit per distinct skill group. The points catalogue marks which points are different views of the same evidence so they are counted once.
4. **The same person as two records.** An identical file is already caught by its checksum. A different file of the same person (a re-saved PDF, a newer version) is caught by identity keys (the same email, or the same phone number by its last nine digits, or, as a weaker signal, the same name in any order and spelling of accents). It raises a review reason naming the existing record. Nothing is merged: two people can share a name and a household phone.
5. **The same match run twice.** Identical inputs give identical outputs, down to every evidence line (tested), with the rules version and fingerprint stored, so a repeat is a reproduction, not a new opinion.

The full list of what the engine judges, what it only shows, and what it must never use, with the guard for each, is in [`POINTS_CATALOGUE.md`](POINTS_CATALOGUE.md) (generated from `server/src/points.ts`, 102 points in 8 families).

## 5. The configuration

Every number that shapes a score lives in `server/src/ruleset.ts` and nowhere else: the weights, the credits `D`, `L`, the prior `ρ`, the relevance share, the score bands, the confidence thresholds and factors. It is frozen at run time, versioned (`rules 2.0.0`), and fingerprinted together with the skill dictionary on every stored match, so it can be proved later that two matches used identical rules. Recruiters and client administrators cannot change it: there is no setting, screen or route. A change is a code review, a version bump and, from now on, a **calibration run** (section 6).

## 6. How it will be proven correct against reality

Algebra shows the arithmetic is consistent, not that the numbers mean what recruiters mean. That needs data:

1. A set of real, consented pairs (CV, job) with a recruiter's judgement **per requirement** (met, partly, not shown) and an overall shortlist decision. About 150 pairs gives roughly plus or minus 5 points.
2. Measure: agreement per requirement (Cohen's kappa), the rate of false `verified` (must be near zero), rank agreement between the score and the recruiters' ordering, and calibration (of candidates the model rates 70%, about how many do recruiters shortlist).
3. Fit only what the data supports: the credits `L` and `ρ` can be estimated from the judgements (for example, how often a skill that is only listed turned out to be real use). Until then `ρ = 0` and `L = 0.5` are stated assumptions, not discoveries.
4. Keep any new rules in shadow beside the live ones until they beat them.

## 7. What is not in this version, and the plan

The points marked *planned* in the catalogue are designed but not built; the next ones to build are a scored job level (E07, once a level table is agreed), breadth of use (E03) and the qualification level (Q01). Level and recency are already shown as context (E19, E02).

* **The job's level.** "Senior", "Lead" and "Head of" in a title are implicit requirements. Today the level is shown as context with the evidence. Plan: read the level from the title and compare it to the candidate's evidenced years and titles, as an explicit, displayed requirement with a stated table (not a hidden multiplier). This is the honest version of the blueprint's progression pillar.
* **Recency.** Using a skill in 2015 and in 2025 earns the same; the last year of use is shown when it is 5 or more years old. Decide from data whether it should weigh.
* **Vocabulary.** Skills come from a fixed dictionary, so a requirement outside it falls back to word overlap or "needs recruiter judgement". Plan: a versioned synonym table, then meaning-based retrieval of supporting sentences (never deciding credit on its own).
* **`contradicted`.** Set today only by a qualification stated as not completed against a requirement for it (caps a mandatory requirement's score at 40). Other explicit contradictions can be added one rule at a time.
* **Seniority beyond the requirement earns nothing extra.** That is deliberate for "does the person meet it", but it means a 20-year executive and a 4-year specialist can tie on a "3+ years" requirement.

## 8. Where a language model attaches

After the numbers. The input is the stored result (every requirement, its three credits, its quotes, the range and the confidence); the output is plain-language text that must be checkable against that input. The model never changes a number, never sees anything the engine did not record, and runs on our own infrastructure.
