# The capability graph: graded, explainable differentials as the platform's foundation (design, 2026-10-23)

Status: a design decision, not built. It generalises the matching model (`MATCHING_MODEL.md`) and is what the AI phase (`AI_PHASE_PLAN.md`) builds towards.

## 1. The principle

Nothing matches yes or no when reality is graded. An actuarial degree and a general BCom are both "degrees in commerce", but they do not teach the same thing to the same depth; a cloud practitioner and a professional cloud architect hold "AWS certificates" of very different weight; five years as a cashier and five as a branch manager are both "five years in retail". RoleMatch must tell these apart, say why, and stay consistent: the same evidence always earns the same credit.

| Area | Same label, different weight | What decides |
|---|---|---|
| Qualifications | Actuarial Science vs BCom General | What it teaches and how deeply; completion (ladder of tells); level (NQF) |
| Certifications | Cloud Practitioner vs Solutions Architect Professional | Level in the vendor's path; what the higher one implies |
| Tools | PostgreSQL vs MySQL vs "SQL"; SAP FI vs Pastel | More specific (meets it), sibling (related), more general (partly) |
| Experience | Cashier vs branch manager, same years | Scope: team, budget, accountability described |
| Titles | "Senior Developer" at a startup vs a bank | Responsibilities described, not the title word |
| Industries | Retail banking vs insurance vs retail | Distance between industries |
| Languages | Conversational vs professional working proficiency | Stated level and use |

## 2. The graph

One graph of capabilities with stable IDs: skills, knowledge areas, tools, qualifications, certifications, occupations, industries. Typed relations: **is a kind of** (PostgreSQL → relational database), **related to** (PostgreSQL ↔ MySQL), **implies** (Honours → bachelor's; a professional certificate → associate-level knowledge), **teaches at depth** (Actuarial Science → probability: advanced), **needs at depth** (actuarial analyst → probability: advanced). Versioned and fingerprinted like the rules; every entry cites its source.

Sources, each checked for reuse terms before import: ESCO (skills, knowledge, occupations; broader/narrower; essential/optional per occupation), O\*NET (knowledge and skill levels per occupation on a 0 to 7 scale), SAQA's register (qualification content and credits), OFO (South African occupations), ISCED-F and CESM (fields of study), public vendor certification paths. The current 199-skill dictionary is the first slice.

## 3. Both sides in the same terms

* **A job** becomes a profile of needed capabilities with depths, proposed by the job reader from the job's own words (quoted), approved by a recruiter, frozen with the job. Vague phrases ("any relevant degree", "quantitative", "or related field", "STEM") become explicit capability profiles at this step, once, not per candidate.
* **A CV** becomes evidence for capabilities: each with a quote, a depth signal (majors and modules, scope, years, level, stated proficiency) and its source in the document.

### Reading for meaning, not words (owner, 2026-10-23: "we don't just want word matching")

The graph holds concepts, not words, and recognising them in text works on meaning. "Built the motor-insurance pricing model using generalised linear models, presented to the pricing committee quarterly" never says "actuarial", "statistics" or "presentation", yet it shows statistical modelling at an advanced level, insurance pricing, and presenting to senior people. Three steps, for CVs and jobs alike:
1. **Shortlist.** Embeddings compare each sentence with every concept in the graph and keep the closest few.
2. **Judge.** The language model decides which of those the sentence really demonstrates, at what depth and scope, quoting the words that show it.
3. **Check and fix.** The quote must be in the document and the concept in the graph; the judgement is cached per sentence and versions, so the same sentence always reads the same, in anyone's CV.
The skill dictionary becomes one clue among several, not the only way in.

## 4. The arithmetic (extends MATCHING_MODEL.md)

For a required capability `c` and a piece of evidence `e` about capability `c'`:

    credit(c, e) = strength(e) × relation(c, c') × coverage(depth needed, depth shown)

* `strength`: the evidence level already in the model (described use, named only, absent; and the completion ladder for qualifications).
* `relation`: from the graph, 1 for the same capability or a more specific one, a stated partial value for a sibling or a more general one, 0 for unrelated.
* `coverage`: the share of the required depth the evidence shows, capped at 1 (more than asked earns nothing extra).

A requirement takes the **best** evidence for each capability (max, never a sum: nothing is counted twice), then the existing proportional mean over its parts and the weighted mean over requirements. Every factor lies in [0, 1] and each is non-decreasing in the evidence, so the proved properties still hold: bounded, monotone, symmetric, repetition earns nothing, total ranking order. The relation values and depth scale start as stated assumptions in the versioned rules and are calibrated from recruiter decisions, never chosen to look precise.

**Differentials** are the per-capability contributions, shown side by side: "A: probability advanced (Actuarial Science, completed 2015). B: introductory (BCom General)."

### Explaining the candidate, not only the requirements (owner, 2026-10-23)

Today's panel explains requirement by requirement and never says who the person is or how they differ from others. Four explanations, each built from stored facts:
| Explanation | Says |
|---|---|
| The person (no job needed) | Career story (roles, years, growth in scope), strongest capabilities with depth and evidence, qualifications with completion tells, what is unclear. |
| Fit to this job | Why each requirement is met, partly met or open, and what evidence would close each gap. |
| Differences between candidates | Side by side on a shortlist, capability by capability, with the evidence behind each difference. |
| What to ask | Interview questions aimed at gaps and unclear tells. |
Built in two steps: the engine assembles the facts (deterministic), then the explainer writes plain language in which every sentence points to a stored fact; a checker refuses any sentence whose name, number, date or claim is not in those facts. Never personality, never "culture fit", never protected traits: evidence, not character.

## 5. Who does what

| Part | Builds | Kept honest by |
|---|---|---|
| Language model + embeddings | New graph entries, relations, depths | A cited source; human review; versioning |
| Job reader | The job's capability profile | Quotes; recruiter approval; frozen |
| CV readers (extractive + language model) | Evidence per capability with depth signals | Quotes checked against the document |
| Engine | Credit, ranking, differentials | Fixed maths; no model per candidate |
| Machine learning over time | Calibrated relation values and depths | Fairness tests; never protected traits, never institution prestige |

## 6. Guardrails

Depth comes from content, never from an institution's name or ranking. Foreign qualifications compare by content and NQF level. A capability a qualification does not cover is "not demonstrated by the qualification", never a failing (work experience may show it). The graph grows only as fast as it can be reviewed. Every number on screen links to its reason.

## 7. Build order

1. Knowledge areas and field map; graph storage with versions.
2. First slice: qualifications (level, completion ladder, knowledge profiles for the 30 to 50 most common South African qualifications, reviewed).
3. CV reader by meaning (shortlist, judge, check, cache) for capabilities, majors, modules and scope, with quotes.
4. Job reader: capability profiles with depths for each requirement, recruiter approval.
5. Engine: relation and coverage factors; proofs and property tests extended.
6. Further slices: certifications, tools, experience scope, titles, industries, languages.
7. Candidate explanations: the person, fit to the job, differences on a shortlist, what to ask; facts first, then checked plain language.
8. Calibration from recruiter decisions once real data exists.
