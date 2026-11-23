# RoleMatch matching specification (superseded: kept as history)

> **Superseded.** The owner decided on 9 Nov 2026 that matching is scored by the AI alone, with no formula (ADR-006, `docs/architecture/ADR-006-ai-only-matching.md`).
> Formula A and B were never run by the live application; their code (`server/src/assessment/`), its tests and the offline batch matching
> (`server/test/batch/matching.ts`) were removed on 16 Nov 2026 after the line-by-line code review. Everything below describes that removed design.

* **Status (before 16 Nov 2026).** Implemented for **offline evaluation only**. Nothing in the running application called it. The live engine was rules 2.2.0 (`server/src/match.ts`, `scoring.ts`).
* **Formula A** may progress towards production on its own.
* **Formula B** is **disabled**. It returns `disabled` unless it is called for offline evaluation.
* **Production approval is the owner's decision.** Readiness is tracked in [`RELEASE_GATES.md`](RELEASE_GATES.md), and the open policy choices are in [`DECISIONS.md`](DECISIONS.md).

**This document replaces** the earlier proposal revisions 1 to 4 (git history up to commit 1144376). Where those revisions differ from this document, this document applies.

The worked calculations in section 10 are generated from the tested code, so the text cannot drift from it. `server/test/assessment/spec-drift.test.ts` fails if the two ever differ. To regenerate them, run this from `server/`:

```bash
npm run spec:assessment
```

Every person, employer and job in this document is fictional.

---

## 1. The chain, and who owns each step

| Step | Owner | Output | May it change scoring policy? |
|---|---|---|---|
| Document | the candidate or employer; stored privately and unchanged | original file | — |
| Extraction | the reader (`server/src/parse.ts` and related) | the canonical JSON records shown in the panels (`Candidate`, `Job` in `server/src/types.ts`), each versioned | no |
| Validation of canonical JSON | existing schema and review checks | `needs_review` or ready | no |
| Requirement approval | a recruiter with the approve permission | `ApprovedRequirement[]`, as one immutable criteria version | no; it decides what the job requires, not how it is scored |
| Evidence assessment, under an approved rubric | the **assessor**: rules today; a local, permissively licensed model only after evaluation | one `LeafEvidence` per leaf, with quotes (section 8) | no |
| Points | tested code: `formulaA.ts`, `formulaB.ts` | `ResultA`, `ResultB` | no; it reads `policy.ts` and never writes it |
| Explanation and prioritisation | `review.ts`, `ordering.ts` | the list, the review set, warnings and flags | no |

* **AI may interpret evidence. Only tested code calculates points.** No step may silently alter the approved policy (`server/src/assessment/policy.ts`, versioned and fingerprinted).
* **Source facts are kept separate from derived assessments:**
  * Quotes, dates and stated completion are **source facts**, copied from the canonical record with their document id and position.
  * States, `d`, `u` and kinds are **derived**.
* Every result records the candidate version, job version, criteria version, rubric version, assessor version, as-of date and policy version, plus a hash of all its inputs (`ResultA.inputs`, `inputHash`).
* **Reprocessing creates a new result. It never overwrites an old one.**

## 2. The two formulas never combine

* **Formula A** compares the candidate's documented evidence with the job's approved requirements.
* **Formula B** compares the job's confirmed offer terms with the candidate's confirmed needs.
* There is no overall percentage that merges A and B.
* B uses only needs the candidate has explicitly confirmed. It never infers, assumes or defaults one.

## 3. Requirements in one normal form

Each approved requirement is an expression of **leaves** joined by AND and OR. The normal form (`criteria.ts`) is:

* **The job** is an AND of criteria. Each criterion is weighted on its own; a top-level AND is never one criterion.
* **A criterion** is an OR of **routes**, its approved alternatives.
* **A route** is an AND of leaves; every part of that alternative is needed.

Consequences, each tested:

* **Equivalent wording scores the same.** "Python and SQL" as one bullet, as two bullets, reordered or repeated gives the same criteria and the same result (W5; regression REG-0002).
* **Any nesting reduces to routes.** "A or (B and (C or D))" becomes the routes {A}, {B, C} and {B, D}.
* **Redundant routes are absorbed.** "A or (A and B)" becomes {A}.
* **The normal form never changes a value.** Its value equals evaluating the original expression, because min and max distribute over each other. This is checked on 2,000 random nested expressions.
* **A requirement repeated across tiers is counted once.** It merges into one criterion that keeps the higher tier and the higher importance, and lists every source requirement.

A leaf's `key` names the concept and its threshold, for example `exp:data-analysis:48`. The same evidence can therefore serve two criteria when the job asks for it twice; each criterion counts it once.

## 4. Leaf values: documented fulfilment `d` and conditional upper bound `u`

**`u` is a scoring bound only.** It is the value `d` would take if every unresolved part were fully supported. It does not predict ability, and it does not predict what clarification will find.

Several rows give `u = 1` for evidence that is only partly shown. That follows the product rule that absence from a CV is not proof that a candidate lacks something.

| Leaf evidence | `d` | `u` | Open reason | Kind shown |
|---|---|---|---|---|
| described in use | 1 | 1 | — | demonstrated |
| named only | 0.5 (rules 2.2.0's `listed`) | 1 | partial | partial |
| course only | 0.4 [proposed, D3] | 1 | partial | partial |
| experience, `M` of `N` months (union of relevant dated roles, computed by code) | `min(1, M/N)` | 1 | silent (`M = 0`) or partial | demonstrated, partial or no evidence |
| qualification | completion × level × field | the same product of upper factors | see below | as below |
| approved transferable | `τ × d(source)`, with `τ ≤ 0.6` [proposed] | 1 | partial | transferable |
| no evidence | 0 | 1 | silent | no evidence |
| unreadable, including after rereading is exhausted | 0 | 1 | unreadable | unreadable |
| ambiguous: the documents conflict or are unclear | 0 | 1 | ambiguous | ambiguous |
| unresolved: the assessor abstained or failed | 0 | 1 | unresolved | unresolved |
| contradicted: the candidate's own statement | 0 | 0 | — | contradicted |

**Qualification factors.**

* **Completion** uses the capability graph's approved credits (`COMPLETION_CREDIT`), each as a pair (`d`, `u`):
  * stated or implied: (1, 1);
  * dates fit: (0.75, 1);
  * year only: (0.5, 1);
  * not stated, in progress or short span: (0, 1);
  * not completed: (0, 0), a contradiction.
* **Level:**
  * meets: (1, 1);
  * below: (0, 0), a documented shortfall;
  * unknown: (0, 1), ambiguous.
* **Field:**
  * covered: (1, 1);
  * partly covered: (0.5, 0.5);
  * not covered: (0, 0);
  * not yet judged: (0.5, 1), unresolved.

Revisions 2 to 4 proposed treating "in progress" as a documented shortfall. That is decision D4 and is not applied: the approved graph value stands.

**Four reasons stay distinct.** Unreadable, absent (silent), ambiguous and assessor-unresolved are separate open reasons; partial depth is a fifth.

* Only **unreadable, ambiguous and unresolved** can make a candidate *consequential* (6.5). The platform or a recruiter can work on those.
* Silence and partial depth are shown on the candidate and never escalated.

## 5. Criteria and tiers

For a criterion with routes `R₁ … Rₖ`:

```
d(criterion) = max over routes of ( min over the route's leaves of d(leaf) )
u(criterion) = max over routes of ( min over the route's leaves of u(leaf) )
```

* A failed route never closes a criterion while another approved route is open (W2; REG-0001).
* A criterion's **open reasons** are the reasons of the leaves that hold back each route that could still raise it.

For each tier `T` (essential or preferred), with importance weights `m` (normal 1, high 2 [proposed]):

```
W_T          = Σ m
documented_T = 100 × Σ m·d / W_T
upper_T      = 100 × Σ m·u / W_T
evidenced_T  = 100 × Σ m over criteria with d > 0 or u = d / W_T
readable_T   = 100 × Σ m over criteria not open because of unreadability / W_T
```

**Denominators.** Every tier percentage uses that tier's own `W_T`. Nothing is ever divided by the other tier's weight. The two tiers are never added together.

**When there is nothing to divide by:**

* `W_T = 0` gives **none**, never 0% or 100%;
* a job with no essential criteria is **not assessable** and is not ordered.

**Display:**

* **Percentages are shown** when `evidenced_E ≥ 50` [proposed, D6]. Otherwise counts are shown ("the documents speak to 1 of 4 essential requirements").
* **Rounding:** every value is an exact fraction. Nothing is rounded before a comparison.
  * Display rounds half up, on the exact value, to whole percentages.
  * Stored values are exact fractions written as `"n/d"`.

## 6. Ordering, review sets, warnings and flags (`ordering.ts`, `review.ts`)

### 6.1 Three policies, none chosen (D1)

Each policy is exact on fractions. A negative result means `x` comes first; 0 means an exact tie.

* **P1, essentials first:** compare essential, then preferred.
* **P2, 70/30 blend:** compare `(70 × essential + 30 × preferred) / 100`, then essential. A job without a preferred tier uses essential alone.
* **P3, essential bands:**
  * The band width is one evidence judgement on the lightest essential: `100 × (described − named) × m_min / W_E`, which is 12.5 with four equal essentials.
  * Band = `floor(essential / width)`. A value exactly on a boundary belongs to the higher band, and 100 has a band of its own.
  * Compare band, then preferred, then essential.

**Comparability.** Only results with the same job id **and** the same criteria version can be compared. Anything else is refused, not ordered.

### 6.2 Ties and the review boundary

* An exact tie is shown as a tie.
* **Administrative display order.** Within a tie, display order is `sha256(job id @ criteria version ‖ record id)`. It is never a name, never arrival order and never reading quality. It reshuffles when the criteria change.
* **The review set** is the first `budget` entries, extended until it includes **every candidate exactly tied with the last one**. Display order therefore never decides who is reviewed (W6; REG-0008).

### 6.3 Incomplete assessments

An application that is still processing, has failed, or is not assessable is **listed with its status**. It is never given a low score and is never ordered among scored candidates.

### 6.4 Warnings: evidence and policy, reported apart

* **Local warning (⚠).** One plausible reassessment reverses a candidate and the one above it. The reassessment set:
  * described ↔ named ↔ course;
  * plus or minus 12 relevant months;
  * a field coverage step;
  * a transfer applied or not.

  Document facts and reading problems are never varied.
* **Policy dependence (†).** The three policies disagree about a candidate and the one above it.

### 6.5 Consequential flag

A candidate is flagged when it is outside the review set but would be inside it if its unreadable, ambiguous or unresolved evidence were resolved in its favour. Flagged candidates are listed beside the review set, never added to it silently. Everyone stays accessible in the full list.

## 7. Formula B, disabled (`formulaB.ts`)

* **Inputs:**
  * the candidate's **confirmed** needs: dimension, importance, value, when confirmed, how, and by whom;
  * the job's confirmed offer terms.
* **Dimensions** come from a fixed platform list. A dimension outside the list, or two needs for one dimension, is refused.
* **Each need has a status:** met / to confirm / not met / unknown. The rules by dimension:
  * **Pay** (same currency, period and basis only; never converted):
    * every stated amount at or above the minimum: met;
    * every stated amount below it: not met;
    * otherwise, including a maximum equal to the minimum, an open-ended "from" below the minimum, or "up to" at or above it: to confirm;
    * a missing minimum, a missing amount or an inconsistent range: unknown.
  * **Location:**
    * remote: needs confirmed acceptance of remote work;
    * an acceptable place: met;
    * a confirmed relocation destination: met if its conditions are offered, otherwise to confirm;
    * any other place: unknown;
    * relocation declined: not met;
    * relocation not confirmed either way, or no place stated: unknown.
  * **Availability:**
    * a confirmed available-from date decides it;
    * otherwise an actual notice-start date plus the notice period decides it, using calendar months clamped to the month's end;
    * otherwise it is unknown, with an optional scenario that is labelled and never scored;
    * the date a notice period was confirmed is **never** used as its start.
  * **Development and responsibilities:** all confirmed items offered is met, none is not met, some is to confirm.
  * **Sets and limits** (role, arrangement, employment type, seniority, hours, travel): met or not met.
* **Whole result:**
  * disabled, outside evaluation;
  * **not available** when there are no confirmed needs;
  * otherwise, in this order: non-negotiable not met, then non-negotiable unknown, then non-negotiable to confirm, then comparable.
* **Optional figure (D8):**
  * only when the result is comparable;
  * weighted needs count 1 (met) or 0 (not met), and to-confirm or unknown widen it to a range;
  * important needs that are not met are listed first.

## 8. The evidence assessor's contract

The assessor produces, for every leaf of the job's approved criteria, exactly one `LeafEvidence` (`formulaA.ts`). It must include:

* the quotes it relied on, with document id and position;
* for experience, the months, recomputed by code from the role dates in the canonical record;
* for qualifications, completion, level and field.

**Validation before a state counts:**

1. Every quote is found verbatim at its position in visible text. Hidden text is excluded under the existing parser policy.
2. The state is consistent with its quotes:
   * "described" needs a passage describing the candidate's own action, not a skills-list entry;
   * "contradicted" needs the candidate's own statement.
3. Passages that conflict give **ambiguous**.
4. An abstention or a failure gives **unresolved**. It never becomes silence, and it never becomes a guess.

**What a quote does and does not establish.** A valid quotation is necessary but not sufficient.

* It shows that the document says something.
* It does not show that the passage supports the criterion; the rubric checks and the labels do that.
* It does not show that the claim is true. "Verified" is reserved for an actual verification process, and none exists.

**Prompt-injection resistance is not claimed** because quotes exist. Instructions inside a document are data. The assessor's outputs are validated by code, and the tests for malicious documents are listed in `RELEASE_GATES.md`.

## 9. Defects resolved in this specification

Earlier proposal defects PD1 to PD22 are recorded in the proposal revisions in git history. The data-expressible ones are regression cases in `server/test/assessment/regressions/`. This version resolves:

| Id | Defect | Resolution |
|---|---|---|
| PD2 | Exact ties ordered by an identifier containing a name; a tie at the cut-off could be split by display order | administrative hash; the whole tie is included in the review set (REG-0008) |
| PD4 | Floating point showed an exact 57.5 as 57 | exact fractions; round half up on display (REG-0003) |
| PD11 | A failed OR route closed the criterion | max over routes for `d` and for `u` (REG-0001) |
| PD12 | Pay as a share of the employer's range | statuses (REG-0005) |
| PD13 | Availability from the confirmation date | separate notice start, available-from and scenario (REG-0006) |
| PD14 | Relocation treated as anywhere | confirmed destinations and conditions (REG-0007) |
| PD16 | Unreadable to become "no evidence" after exhausted rereading | stays unreadable; outcome recorded separately (REG-0004) |
| PD23 | An AND inside one criterion (min) and the same parts as separate criteria (weighted mean) scored differently | a top-level AND always splits into separate criteria; AND survives only inside an OR route |
| PD24 | P1, P2 and P3 had no defined boundaries, ties or treatment of incomplete assessments | section 6 |
| PD25 | "Uncertain" mixed document ambiguity with assessor failure | **ambiguous** and **unresolved** are separate states and reasons |
| PD26 | OR and AND propagation was defined for one level only | normal form; checked against direct evaluation on 2,000 random nested expressions |
| PD27 | Named, course and short experience were closed (`u = d`), treating absent depth as proof of absence and making `u` non-monotonic | `u = 1` until met (section 4) |
| PD28 | The appendix carried superseded text and mismatched identifiers (`not_evidenced` against `no_evidence`; revision 2's decision numbers) | this single document; one set of state names, shared by the types and the tests |
| PD29 | One-sided pay ranges ("from", "up to") were read as single figures | explicit one-sided rules |
| PD30 | Month arithmetic overflowed (31 January + 1 month = 3 March) | clamped to the month's end |
| PD31 | "Settled share" counted partial evidence as not settled, so a CV naming every skill showed no percentage | the display threshold uses the **evidenced** share (`d > 0` or `u = d`) |
| PD32 | The proposal's "in progress = shortfall" contradicted the approved capability-graph value | the graph value applies; the change is decision D4 |

## 10. Worked calculations (generated, do not edit by hand)

<!-- generated:start (npm run spec:assessment) -->
Policy A-0.1.0+B-0.1.0-proposed, fingerprint c434d89e988a. Every figure below is computed by `src/assessment`.

#### W1. Strong documented alignment

| Criterion | Tier | m | Routes and leaf evidence | Kind | d | m·d | u | m·u | Open because |
|---|---|---|---|---|---|---|---|---|---|
| E1 SQL | essential | 1 | SQL: described | demonstrated | 1 | 1 | 1 | 1 | — |
| E2 Python or R | essential | 1 | Python: described **OR** R: no evidence | demonstrated | 1 | 1 | 1 | 1 | — |
| E3 3+ years of data analysis | essential | 1 | 36 months of data analysis: experience 60 of 36 months | demonstrated | 1 | 1 | 1 | 1 | — |
| E4 Bachelor's in statistics, mathematics or CS, or 48 months of relevant experience | essential | 1 | 48 months of data analysis: experience 60 of 48 months **OR** the degree: qualification: completion stated, level meets, field covered | demonstrated | 1 | 1 | 1 | 1 | — |
| P1 Power BI or Tableau | preferred | 1 | Power BI: described **OR** Tableau: no evidence | demonstrated | 1 | 1 | 1 | 1 | — |
| P2 Microsoft Azure | preferred | 1 | Azure: named | partial | 0.5 | 0.5 | 1 | 1 | partial |
| P3 Presenting to stakeholders | preferred | 1 | presenting: described | demonstrated | 1 | 1 | 1 | 1 | — |

* Essential: W = 4; documented = 100 × 4 / 4 = **100** (shown 100%); upper bound = 100 × 4 / 4 = 100; evidenced 100%; readable 100%.
* Preferred: W = 3; documented = 100 × 2.5 / 3 = **83.3333…** (shown 83%); upper bound = 100 × 3 / 3 = 100; evidenced 100%; readable 100%.
* Display: percentages shown. Input hash 79440a8e8f373b08.

#### W2. Degree route a documented shortfall; experience route unresolved (the OR stays open)

| Criterion | Tier | m | Routes and leaf evidence | Kind | d | m·d | u | m·u | Open because |
|---|---|---|---|---|---|---|---|---|---|
| E1 SQL | essential | 1 | SQL: no evidence | no evidence | 0 | 0 | 1 | 1 | silent |
| E2 Python or R | essential | 1 | Python: no evidence **OR** R: no evidence | no evidence | 0 | 0 | 1 | 1 | silent |
| E3 3+ years of data analysis | essential | 1 | 36 months of data analysis: experience 0 of 36 months | no evidence | 0 | 0 | 1 | 1 | silent |
| E4 Bachelor's in statistics, mathematics or CS, or 48 months of relevant experience | essential | 1 | 48 months of data analysis: experience 0 of 48 months **OR** the degree: qualification: completion stated, level below, field covered | no evidence | 0 | 0 | 1 | 1 | silent |
| P1 Power BI or Tableau | preferred | 1 | Power BI: no evidence **OR** Tableau: no evidence | no evidence | 0 | 0 | 1 | 1 | silent |
| P2 Microsoft Azure | preferred | 1 | Azure: no evidence | no evidence | 0 | 0 | 1 | 1 | silent |
| P3 Presenting to stakeholders | preferred | 1 | presenting: no evidence | no evidence | 0 | 0 | 1 | 1 | silent |

* Essential: W = 4; documented = 100 × 0 / 4 = **0** (shown 0%); upper bound = 100 × 4 / 4 = 100; evidenced 0%; readable 100%.
* Preferred: W = 3; documented = 100 × 0 / 3 = **0** (shown 0%); upper bound = 100 × 3 / 3 = 100; evidenced 0%; readable 100%.
* Display: counts only (too little documented for a percentage: the documents speak to 0 of 4 essential requirements). Input hash 1d10a12879cd768c.

#### W3. Career changer: a course, an approved transfer, a partly covered degree

| Criterion | Tier | m | Routes and leaf evidence | Kind | d | m·d | u | m·u | Open because |
|---|---|---|---|---|---|---|---|---|---|
| E1 SQL | essential | 1 | SQL: course | partial | 0.4 | 0.4 | 1 | 1 | partial |
| E2 Python or R | essential | 1 | Python: transferable 0.4 × described (map-vba-python) **OR** R: no evidence | transferable | 0.4 | 0.4 | 1 | 1 | partial, silent |
| E3 3+ years of data analysis | essential | 1 | 36 months of data analysis: experience 0 of 36 months | no evidence | 0 | 0 | 1 | 1 | silent |
| E4 Bachelor's in statistics, mathematics or CS, or 48 months of relevant experience | essential | 1 | 48 months of data analysis: experience 0 of 48 months **OR** the degree: qualification: completion stated, level meets, field partly | documented shortfall | 0.5 | 0.5 | 1 | 1 | silent |
| P1 Power BI or Tableau | preferred | 1 | Power BI: no evidence **OR** Tableau: no evidence | no evidence | 0 | 0 | 1 | 1 | silent |
| P2 Microsoft Azure | preferred | 1 | Azure: no evidence | no evidence | 0 | 0 | 1 | 1 | silent |
| P3 Presenting to stakeholders | preferred | 1 | presenting: described | demonstrated | 1 | 1 | 1 | 1 | — |

* Essential: W = 4; documented = 100 × 1.3 / 4 = **32.5** (shown 33%); upper bound = 100 × 4 / 4 = 100; evidenced 75%; readable 100%.
* Preferred: W = 3; documented = 100 × 1 / 3 = **33.3333…** (shown 33%); upper bound = 100 × 3 / 3 = 100; evidenced 33.3333…%; readable 100%.
* Display: percentages shown. Input hash d90bd0cc33db68e6.

#### W4. Unreadable dates and an ambiguous qualification

| Criterion | Tier | m | Routes and leaf evidence | Kind | d | m·d | u | m·u | Open because |
|---|---|---|---|---|---|---|---|---|---|
| E1 SQL | essential | 1 | SQL: described | demonstrated | 1 | 1 | 1 | 1 | — |
| E2 Python or R | essential | 1 | Python: described **OR** R: no evidence | demonstrated | 1 | 1 | 1 | 1 | — |
| E3 3+ years of data analysis | essential | 1 | 36 months of data analysis: unreadable | unreadable | 0 | 0 | 1 | 1 | unreadable |
| E4 Bachelor's in statistics, mathematics or CS, or 48 months of relevant experience | essential | 1 | 48 months of data analysis: unreadable **OR** the degree: qualification: completion stated, level unknown, field covered | unreadable | 0 | 0 | 1 | 1 | unreadable, ambiguous |
| P1 Power BI or Tableau | preferred | 1 | Power BI: described **OR** Tableau: no evidence | demonstrated | 1 | 1 | 1 | 1 | — |
| P2 Microsoft Azure | preferred | 1 | Azure: named | partial | 0.5 | 0.5 | 1 | 1 | partial |
| P3 Presenting to stakeholders | preferred | 1 | presenting: described | demonstrated | 1 | 1 | 1 | 1 | — |

* Essential: W = 4; documented = 100 × 2 / 4 = **50** (shown 50%); upper bound = 100 × 4 / 4 = 100; evidenced 50%; readable 50%.
* Preferred: W = 3; documented = 100 × 2.5 / 3 = **83.3333…** (shown 83%); upper bound = 100 × 3 / 3 = 100; evidenced 100%; readable 100%.
* Display: percentages shown. Input hash 4c27c62234f2a3a5.

#### W5. Equivalent wording

"Python and SQL" as one bullet: 2 criteria, essential 50. As two bullets: 2 criteria, essential 50. Nested "A or (B and (C or D))" has routes [["A"],["B","C"],["B","D"]].

#### W6. One job's list under each ordering policy (review budget 3)

| Policy | Order (position: record, essential / preferred / P2 key / P3 band) | Review set | Extra from a tie at the cut-off | Flagged |
|---|---|---|---|---|
| P1 essentials first | 1: cand-jaya (100 / 0 / 70 / 8); 2: cand-hana (95.8333… / 66.6667… / 87.0833… / 7) ⚠ †; 3: cand-ivo (87.5 / 83.3333… / 86.25 / 7) =tie ⚠ †; 4: cand-mo (87.5 / 83.3333… / 86.25 / 7) =tie ⚠; 5: cand-kofi (75 / 83.3333… / 77.5 / 6) =tie; 6: cand-lee (75 / 83.3333… / 77.5 / 6) =tie ⚠ | cand-jaya, cand-hana, cand-ivo, cand-mo | 1 | cand-lee |
| P2 70/30 blend | 1: cand-hana (95.8333… / 66.6667… / 87.0833… / 7); 2: cand-ivo (87.5 / 83.3333… / 86.25 / 7) =tie ⚠ †; 3: cand-mo (87.5 / 83.3333… / 86.25 / 7) =tie ⚠; 4: cand-kofi (75 / 83.3333… / 77.5 / 6) =tie; 5: cand-lee (75 / 83.3333… / 77.5 / 6) =tie ⚠; 6: cand-jaya (100 / 0 / 70 / 8) ⚠ † | cand-hana, cand-ivo, cand-mo | 0 | cand-lee |
| P3 essential bands | 1: cand-jaya (100 / 0 / 70 / 8); 2: cand-ivo (87.5 / 83.3333… / 86.25 / 7) =tie ⚠ †; 3: cand-mo (87.5 / 83.3333… / 86.25 / 7) =tie ⚠; 4: cand-hana (95.8333… / 66.6667… / 87.0833… / 7) ⚠ †; 5: cand-kofi (75 / 83.3333… / 77.5 / 6) =tie ⚠; 6: cand-lee (75 / 83.3333… / 77.5 / 6) =tie ⚠ | cand-jaya, cand-ivo, cand-mo | 0 | cand-lee |

=tie: exact tie (administrative display order). ⚠: one plausible reassessment reverses it with the row above. †: the three policies disagree about it and the row above. cand-nia is listed as failed processing, with no score.

#### W7. Formula B boundaries (evaluation mode only; disabled in the application)

| Need | Offer | Status | Why |
|---|---|---|---|
| pay minimum R48,000 | R40,000 to R48,000 | **to confirm** | the stated range includes the minimum: the amount must be confirmed |
| pay minimum R48,000 | up to R50,000 | **to confirm** | an amount up to at least the minimum: the amount must be confirmed |
| pay minimum R48,000 | R45,000 to R55,000 a year | **unknown** | different currency, period or basis: never converted |
| relocate to Johannesburg if assisted | on-site Johannesburg, no assistance | **to confirm** | relocation to Johannesburg is conditional on: relocation assistance |
| relocate to Johannesburg if assisted | on-site Cape Town | **unknown** | relocation was confirmed for Johannesburg, not for Cape Town |
| one month's notice, not yet given | start 2027-03-01 | **unknown** | notice period 1 month; neither a notice-start nor an available-from date is confirmed; if notice were given on 2027-01-31: available 2027-02-28 (a scenario, not scored) |

Called from the application, Formula B returns: **disabled**.
<!-- generated:end -->

## 11. Known limitations

* **Concurrent part-time roles** count as full months, because employment intensity is not modelled. A date shown only as a year counts from January, and the assessor marks it **ambiguous** when two readings differ by more than 6 months [proposed].
* **The ±12-month reassessment** makes most partial-experience neighbours "close". That is honest about dates, but it means warnings are frequent.
* **Named-only credit ties with half-described evidence.** A list of named skills can equal an honest CV that describes half of them. This is the first rung to validate (D3).
* **One importance mark can reorder candidates.** Marks are approved with the criteria, before matching, with a reason and an audit event.
* **The consequential flag depends on detecting reading problems.** A reading loss that goes undetected looks like silence, and nothing in the ordering can recover it. That is why reading-integrity is a release gate.
* **No accuracy, fairness or usefulness claim is made.** Synthetic and fictional fixtures establish mathematical behaviour and regression protection only.
