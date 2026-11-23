# Requirement-to-evidence assessment: the first model-assisted capability

* **Status:** offline experiment.
* **Live behaviour:** nothing in the application calls this code. The OCR and parser are fixed at 2.9.0, so they cannot confound the result.
* **Register:** experiment EA1 in [`../assessment/experiments.json`](../assessment/experiments.json).
* **Audit:** what exists today is in [`ML_LAYER_AUDIT.md`](ML_LAYER_AUDIT.md).

## 1. The job, precisely

**Input** (`AssessmentRequest`, `server/src/assessment/evidence/contract.ts`):

* one leaf of one approved criterion, of kind skill, role relevance or qualification;
* the approved wording;
* the candidate's evidence passages, each with a stable source id and section;
* any approved transfer mappings;
* the candidate, criteria and rubric versions.

**Output** (`Answer`):

* the criterion id;
* one state from rubric 0.1.0;
* the supporting passage ids and counterevidence passage ids;
* a rationale of at most two sentences, with no numbers or scores;
* an abstention reason, or none.

The model id, its digest and the prompt version are recorded by the runner.

**What the assessor may not do:**

* invent facts;
* credit a transfer that no approved mapping supports;
* combine leaves, since the normal form does that;
* compute months, since code does that from dates;
* produce a percentage, since Formula A does that.

**Validation** (tested code; it fails closed):

* every cited id must exist;
* the state must be allowed for the kind;
* "described" needs a duty or project passage;
* "negated" needs a negating passage;
* "desired" needs a passage that expresses a wish;
* "transferable" needs an approved mapping;
* "ambiguous" needs counterevidence.

A refused or abstaining answer becomes `unresolved`, never silence and never credit. **Source facts** (passages and quotes) stay separate from **derived interpretations** (the state and rationale).

## 2. Baseline and candidates

| | What | Licence | Resource | Why |
|---|---|---|---|---|
| A | rules assessor `rules-evidence-0.1.0` (the batch assessor's logic behind the same contract) | own code | negligible | the incumbent behaviour, including its known faults (no negation or wish handling: R1, R2) |
| B | `qwen3:4b-instruct-2507` at 4-bit, through Ollama | Apache-2.0, checked with `ollama show --license`; Ollama is MIT | 2.5 GB on disk, about 3 to 4 GB in memory; already installed | an instruction-tuned, schema-capable model that fits beside the server on 16 GB |
| B8 | `qwen3:8b` | Apache-2.0 | 5.2 GB; already installed | the same prompt and rubric: only the model size changes |

**No download, no training and no external service.** Selection was by fit to the task, licence and hardware. It is to be confirmed by measurement, not by size.

## 3. Data: what exists and what is missing

* **Available.** The annotation set v0.1: 47 **invented** items, frozen with a manifest hash (`server/test/assessment/evidence/`), across 11 categories:
  * direct evidence;
  * partial fulfilment;
  * named only;
  * approved transfer;
  * negation;
  * wishes;
  * missing information;
  * contradictions;
  * similar titles with different duties;
  * qualification completion;
  * AND/OR leaves.

  21 items were reserved for evaluation by stratified hash **before any model ran**.
* **The labels are proposals.** The assistant wrote them, and none has been reviewed by a person, so **no result here can support acceptance**.
* **Also available, not yet used here:** the Visual Variety 60 batch's checked structured records, which can supply realistic passages for a later round.
* **Missing:**
  * human-reviewed labels for these 47 items;
  * a second, independently labelled set from real-looking documents, to test generalisation;
  * any criterion labels made by two independent people with adjudication.

## 4. Fine-tuning

**Not justified yet**, and not possible to judge until the pretrained comparison shows which failures recur and whether they are task-definition, prompting or retrieval problems.

**Hardware.** On this machine (Apple M5, 16 GB, no discrete GPU), a LoRA fine-tune of the 4B model is the most that would be practical: hours, and close to the memory limit. A model would never be trained on its own outputs.

## 5. What is needed from the owner

1. **Review of the 47 proposed labels** (about 30 to 45 minutes), especially the judgement calls:
   * "views Tableau reports" as named only;
   * using a cluster as not administering it;
   * conflicting skills-list and statement as ambiguous;
   * a wish next to shown use still counting as described.
2. **A small independently labelled set: 15 to 20 candidate–job pairs from fictional documents you supply.** Two people label each criterion leaf separately, using `PILOT_PROTOCOL.md` section 2; a third resolves disagreements.

   **No new real CVs are needed for this stage.**

## 6. Results of EA1

All figures come from `server/data/evaluations/evidence-ea/ea1-r2/metrics.json`.

**Run ea1-r1 is invalid.** It had a harness defect: the runtime schema's nullable "abstain" field was always filled, so every model answer counted as an abstention. The defect was diagnosed on a development item; answer schema 0.2.0 fixes it, and the prompt and rubric are unchanged.

**Results on the 21 evaluation items, against unreviewed labels:**

| | States agreeing | Unsupported positives | Evidence missed | Consequential (credit gap ≥ 0.5) | Repeatable | Time per leaf (median / max) |
|---|---|---|---|---|---|---|
| A: rules | 14 | 5 | 2 | 6 | yes (deterministic) | under 1 ms |
| B: qwen3 4B | 15 | 1 | 2 | 2 | 21 of 21 | 4.6 s / 5.7 s |
| B8: qwen3 8B | 11 | 1 | 7 | 6 | 21 of 21 | 7.1 s / 10.8 s |

**Decision: rejected against the pre-registered gates.**

* B needed at least 3 more agreeing states than the rules and achieved 1 more.
* B8 failed on agreement and on latency.
* This is not reinterpreted after the result.

**What the 4B model does:** it reads one requirement and its passages, and returns a rubric state with cited passages. Code validates the answer.

**Better than the rules:**

* it does not credit "I have no experience with AWS" or a wish to learn as a skill;
* it does not count a role as relevant from its title alone (title-only roles: 2 of 2, against 0 of 2 for the rules);
* overall, 1 unsupported positive against 5.

**Worse than the rules:**

* it credited "reconciled customer accounts" as customer service, a false positive the rules did not make;
* it abstained on one clear negation;
* it reads a contradiction as a negation;
* it costs 4.6 seconds per leaf on this laptop, where the rules are instant. At about 7 leaves per candidate–job pair, 1,000 pairs take about 9 hours single-threaded.

**Training:** none. **Prompt tuning:** none.

**What remains unproven:**

* everything, until a person reviews the 47 labels;
* generalisation beyond invented passages;
* behaviour on real extraction output;
* throughput at scale.

## 7. Precise verdict

**EA1 failed its pre-registered agreement gate against unreviewed proposed labels. It is not eligible for promotion.**

* The reduced false credit is a promising exploratory finding, not independently verified improvement: 1 unsupported positive against 5, and 2 consequential errors against 6.
* The gate is not changed retrospectively.

## 8. Annotation version 0.2 (AI-assisted, supplied by the owner)

* **Files:** `server/test/assessment/evidence/annotations-v0.2.jsonl`, with a manifest and difference list in `MANIFEST-v0.2.json`.
* **Provenance:** "AI-assisted external review, supplied by owner". It is **not** independently human-verified and **not** the owner's manual review.
* **Preserved:** v0.1, its manifest and the EA1 results are unchanged. Each v0.2 item keeps its v0.1 label as `previousLabel`.

**What changed**, against the 47 items:

| | Items |
|---|---|
| State changed | ea-007 named → no evidence (viewing is not dashboard development); ea-008 named → no evidence (deploying is not administering); ea-030 ambiguous → named ("not in production" does not contradict a listed skill) |
| Evidence references corrected | ea-033, ea-035, ea-037: the duties are now the supporting passages, and the title is no longer recorded as counterevidence; ea-025: the career objective is no longer counterevidence |
| Flagged for adjudication (not undisputed truth) | ea-007, ea-008, ea-025, ea-030, ea-031 |
| Fixture flags | ea-027: a licence is a credential, not a skill; ea-039: "met in progress" reads as "matching qualification, in progress", and a clearer name is proposed for a later rubric version |

* **Examined passages are recorded separately.** Every v0.2 label records the passages examined (`examinedIds`) apart from its supporting passages. Negative and missing-evidence labels carry no invented supporting passage.

**Exploratory re-score** (not an acceptance result). The **frozen** EA1 predictions (run ea1-r2) were scored against v0.2:

* These items are **exposed** and the labels are AI-assisted.
* On the 21 former evaluation items: rules 15 agree, 4 unsupported positives, 6 consequential; the 4B model 15 agree, 1 unsupported positive, 3 consequential; the 8B model 11 agree.
* No model was re-run, and no prompt was changed.

**Schema audit** (does the contract conflate things it should keep apart?):

* **Mentioning a tool versus a specific responsibility.** The rubric's "named" covers "a duty that names it without the required activity". That invites credit for scope it does not show, which was the original ea-007 and ea-008 labels.
  * **Defect:** a scope-limited requirement needs "no evidence" plus a separate note of related exposure, not "named".
  * Proposed for rubric 0.2.0, not applied silently.
* **A listed qualification versus its completion.** These are kept apart: completion is a separate state, and attendance dates give "completion not stated". "Met in progress" is badly named (it is not "met"); a rename is proposed for rubric 0.2.0.
* **No production experience versus no experience.** These were conflated: the original ea-030 was labelled "ambiguous". The rubric's "negated" is defined as "states they do not have it". A limited claim needs a scope-limited reading, to be defined in rubric 0.2.0.
* **Career ambition versus contradictory evidence.** These were conflated in v0.1 (ea-025 listed the objective as counterevidence). The validator only requires counterevidence for "ambiguous"; it does not stop a wish being cited as counterevidence. This is an annotation-convention fix, now applied in v0.2.

## 9. What the validator checks, and what it cannot

**Deterministic checks (tested code):**

* the answer parses against the schema;
* the criterion id matches the request;
* the state is in the rubric for that kind;
* every cited passage id exists;
* the rationale is present, contains no scoring language, and is within its length;
* "described" cites a duty or project passage;
* "negated" cites a passage with a negation word;
* "desired" cites a passage with a wish word;
* "transferable" requires a supplied mapping;
* "ambiguous" cites counterevidence;
* a refusal or abstention becomes "unresolved", never credit.

**Not checked, and still dependent on model interpretation or human annotation:**

* whether a cited passage actually supports the state (a duty can be cited for "described" while showing something else);
* whether the requirement's scope is met (viewing versus building);
* whether a negation word in the passage negates **this** skill (a negation word anywhere in the passage satisfies the check);
* whether an abstention was justified;
* whether the rationale is true.

**A schema-valid answer with valid passage ids is not a correct interpretation.**

## 10. Time per criterion and per candidate–job comparison

* **Conditions.**
  * Measured on Apple M5, 16 GB, with Ollama 0.35.1 on Metal.
  * Requests ran **serially**, one at a time, two repeats per item, on 47 items.
  * Model loading was not measured separately. The 4B model was already loaded, so its first call took 3.2 s, under its 4.6 s median. The 8B model's first call took 10.2 s against a 7.2 s median, which suggests about 3 s of loading.
* **Per criterion (one leaf), qwen3 4B:** median 4.6 s, 90th percentile 5.7 s, maximum 6.3 s. qwen3 8B: median 7.2 s, maximum 11.5 s. The rules take under 1 ms.
* **Per candidate–job comparison.** This was **not measured end to end.** A Visual Variety job has 4 essential skills, 2 preferred skills and a qualification. Experience adds one role-relevance judgement per role, so a comparison needs roughly 8 to 10 model calls, about 40 to 45 s serially with the 4B model on this laptop.
* **No capacity claim.** This says nothing about production capacity: no concurrency, batching, server hardware or caching was tested.

## 11. Fresh examples needed for the next acceptance experiment

All 47 current items are now development items. The 21 "evaluation" items are exposed, because their EA1 errors were inspected.

**What an acceptance test needs:**

* **New items,** 40 to 60 of them, never seen by the prompt author, covering the same 11 categories plus the scope cases above. These should be passages from fictional CVs the owner supplies, not written by Claude.
* **Labels made blind** by two people independently, on the page's Blind labelling mode or an equivalent, with a third adjudicating disagreements under rubric 0.2.0.
* **Gates fixed before the run.** The primary metrics should be consequential errors and unsupported positives, with per-state agreement as a secondary measure.
