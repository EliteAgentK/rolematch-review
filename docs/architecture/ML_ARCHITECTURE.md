# Machine learning in RoleMatch: architecture (proposal, 2026-10-22)

Status: a design, not built. Nothing here changes how documents are read today. Read with [`AI_EXTRACTION_DECISION.md`](../parser/AI_EXTRACTION_DECISION.md) (the owner rule: no external AI API or key, local open permissive models only) and [`EXTRACTION_CONTRACT.md`](../parser/EXTRACTION_CONTRACT.md).

## Principles

1. **Rules first, the model proposes, the evidence disposes.** The rule-based reader runs first. A model only fills what the rules could not, and every value it offers must pass the existing evidence check (its quote must really be in the document).
2. **Local and permissive only.** Models run on our own servers. Permissive licences (Apache-2.0, MIT, BSD), checked per model. No outside service, no paid API, no key, no network access from the model worker.
3. **Deterministic and versioned.** A document's record is stored once with the exact model, file hash and settings that produced it. Re-reading happens only on a version change, not on every view.
4. **Nothing hard-coded that an organisation may want different.** Whether a model is used, and for which fields, is a per-organisation setting.
5. **A model never decides about a person.** It structures text. It does not rank, reject or shortlist.

## The flow

```
upload -> safety checks -> READ  -> LABEL layout -> RULE extraction -> gaps? -> MODEL structuring -> evidence check -> merge -> review flags -> record
          (type, size,      native text / OCR        family + evidence   fields       (local worker,       (quote must be     (empty fields   (human)
           hidden text)     [ML slot A]              [ML slot B]         empty or      guarded)             in the document)   only, marked
                                                                         doubtful                                              "model")
```

## Where machine learning plugs in

| Slot | Replaces or adds | Interface (already exists or is to add) | Needs |
|---|---|---|---|
| A. Reading | A fine-tuned OCR engine, a page-orientation classifier (0/90/180/270), a read-quality classifier | `OcrEngine` in `src/ocr.ts`; image preparation in `src/imageprep.ts` | Page images with correct text |
| B. Layout family | A learned family classifier beside the rule-based label in `src/templates.ts` | `layoutFamily()` | Real CVs labelled by family |
| C. Structuring | A small local language model that turns the reader's text into fields where the rules left gaps | New worker job type `model-assist`; guards in `src/modelGuards.ts`; evidence check `keepSupported` in `src/extract.ts` | Real CVs for testing; far more for training |

## Services

* **API (Node)** owns state, settings, authorisation and the audit log. It enqueues a `model-assist` job only when the organisation's setting allows it and the rules left gaps.
* **Model worker** is a separate process (a separate runtime is acceptable here: a strong reason is isolation and a killable process). It has no network access, a fixed memory and time budget, and is recycled after N jobs. It reads a job, runs the model, and returns tagged output. It never writes to the database.
* **Guards** (`modelGuards.ts`) judge each answer: loops, truncation, missing tags. A refused answer is retried at most `MAX_ATTEMPTS` (3) times, then the rule-based record stands and the document says a model could not help.
* **Queue**: the existing durable queue, with bounded retries and manual recovery.

## Merge rules (what a model may and may not do to a record)

* It may fill a field the rules left empty, or add an item the rules did not find, only if the quote is in the document.
* A rule-based value always wins over a model value. Conflicts are shown to the reviewer, not resolved silently.
* Every model-supplied value is marked with its source (`model`), the model name, file hash and version, so it is auditable and filterable.
* Identity fields (name, email, phone) and dates are never taken from a model without an exact quote match.

## Per-organisation settings (versioned and audited, like all settings)

`modelAssist`: `off` | `shadow` | `on`. `fields`: which fields a model may fill. `minRuleConfidence`: below this, a model is asked. Default `off`. `shadow` runs the model and stores the comparison with the rules but changes nothing on the record.

## Data and the training loop

* **Real consented CVs** live in private storage (the git-ignored `sample-documents/real/` for development), never in the repository. Consent must cover the purpose: testing is not the same as training. A lawyer confirms the wording (POPIA).
* **Labels** come from careful manual labelling and from recruiter corrections (already audited as from-to edits), used only for organisations that have agreed to this purpose.
* **Evaluation**: the stress harness (generated CVs) plus a held-out set of real CVs that is never trained on. About 140 CVs per format gives roughly plus or minus 5 points.
* **Model registry**: name, licence, licence terms, file hash, quantisation, runtime version, evaluation results.
* **Shadow log**: for every shadow run, rules versus model per field, so promotion rests on numbers.

## Promotion gate (a model goes live for an organisation only if all hold)

1. On the held-out real set, field-level accuracy is no worse than the rules for every field it is allowed to fill, and better overall.
2. Zero values without a matching quote in the document.
3. Repeatable: the same document, model file and settings give the same output on the production hardware class.
4. Licence and provenance of every model file are recorded and permissive.
5. A rollback path exists (setting back to `off`, records keep their source marks).

## Determinism, honestly

Temperature 0 is not a guarantee of identical output across machines, thread counts, versions or batching. So: pin the model file hash, runtime version and quantisation; fix threads, seed and batch size; run on one hardware class; and store the output with the record so a document is never silently re-read.

## Phases

0. **Collect** real consented CVs; build the held-out set.
1. **Classifiers** (page orientation, read quality) in shadow: cheapest and most certain win; fixes turned pages.
2. **OCR engine trial** behind `OcrEngine`, measured against Tesseract on real scans and photos.
3. **Structuring model in shadow** for organisations that opt in.
4. **Gated live** per organisation, field by field.

## Decisions that are the owner's

* The consent and purpose wording for training (lawyer).
* Hardware: CPU only, or one GPU server.
* Which model licences are acceptable beyond Apache-2.0 and MIT.
* Whether recruiter corrections may be used as training labels, and for which organisations.

## APIs (proposal)

Two kinds: the **worker contract** (internal, through the queue; the worker has no network and no database access) and the **application API** (`/api`, owns authorisation, as for everything else). Errors use the existing code style (`PERM-002` and similar); new codes are named `ML-nnn`.

### 1. Worker contract (queue job `model-assist`)

Request (written by the API, read by the worker):

```json
{
  "jobId": "uuid", "documentId": "uuid", "orgId": "uuid",
  "parserVersion": "2.5.3", "attempt": 1,
  "modelId": "registry id (name, file hash, quantisation)",
  "text": "the reader's text, unchanged",
  "fields": ["workHistory", "education"],
  "rulesSnapshot": { "workHistory": [], "education": [] },
  "limits": { "maxSeconds": 60, "maxTokens": 4096 }
}
```

Result (written by the worker, read by the API, which re-checks everything):

```json
{
  "jobId": "uuid", "status": "ok",
  "proposals": [{ "field": "workHistory", "value": { "position": "..", "company": "..", "startDate": "..", "endDate": ".." }, "quote": "text copied from the document" }],
  "model": { "id": "..", "runtime": "llama.cpp b1234", "threads": 1, "seed": 0 },
  "seconds": 12.4
}
```

`status` is `ok`, or `refused` with `why` from `judgeModelAnswer` (`looping`, `truncated`, `untagged`, `empty`) or `timeout`. A refusal after `MAX_ATTEMPTS` leaves the rule-based record in place. The API never trusts `proposals`: each one passes `keepSupported` (its quote must be in `text`) and the merge rules before it touches a record.

### 2. Application API

| Method and path | Purpose | Who |
|---|---|---|
| `GET /api/settings`, `PUT /api/settings` (existing) | New section `modelAssist`: `{ mode: "off" \| "shadow" \| "on", fields: string[], minRuleConfidence: number }`. Versioned and audited like every setting. | admin |
| `GET /api/documents/:id/model-assist` | The shadow comparison for one document: rules versus model, per field, with quotes and the model's identity. Read-only. | reviewer |
| `GET /api/ml/shadow-report?from&to&field` | Aggregate rules-versus-model agreement over a period, per field and per layout family. Basis for the promotion gate. | admin |
| `GET /api/ml/models` | The model registry: name, licence and terms, file hash, quantisation, runtime, evaluation results, state (`candidate`, `shadow`, `enabled`, `retired`). | admin |
| `POST /api/ml/models/:id/enable` | Enable a model for the caller's organisation. Refused (`ML-001`) unless the promotion gate's recorded evidence is attached. | admin |
| `POST /api/ml/models/:id/disable` | Roll back: back to rules only. Records keep their source marks. | admin |
| `POST /api/ml/labels` | Contribute a corrected record as a training label. Refused (`ML-002`) unless the organisation has opted in to this purpose. | admin |

Every call is organisation-scoped (tenant isolation), logged in the audit log with who, what and when, and every model-supplied value on a record carries `source: "model"` with the model id so a reviewer can filter and undo.

## Fit to RoleMatch (how this lands on the code and data we already have)

### Where each piece sits in today's pipeline (`src/pipeline.ts`)

The document stages are `security` -> `optimising` -> `reading` -> `extracting` -> published. Machine learning adds no new stage a recruiter sees; it works inside two existing ones:

| Existing stage | What is added | Existing code it uses |
|---|---|---|
| `reading` | Slot A: orientation and quality classifiers, then a fine-tuned OCR engine, behind `OcrEngine` | `src/ocr.ts`, `src/imageprep.ts`, `readDocument` in `src/parse.ts` |
| `extracting` | Layout family label (built), slot B classifier, the gap check, the model worker job, the merge | `extractCandidate` in `src/extract.ts`, `keepSupported`, `src/templates.ts`, `src/modelGuards.ts` |

The record is still published only when extraction and validation are complete (non-negotiable behaviour 1). A document waiting on a model job stays visibly in `extracting`; if the model is slow or refused, the rule-based record is published, not held.

### Both document kinds

Candidates (CVs) are the first target. Job descriptions go through `extractJob`; a model may structure them under the same gap, evidence and merge rules, but only after the CV path has proved itself. The job's own specification stays editable by the organisation as the edit policy already says.

### The matching engine is not touched

The scoring formula is fixed and not configurable, and matching stays evidence-based (`verified`, `partially evidenced`, `not demonstrated`, `contradicted`, `not applicable`). Machine learning only improves what is **read** (the candidate record and its evidence). It never scores, ranks, shortlists or rejects, and no model output reaches `match.ts` except as ordinary record fields with their quotes. Better reading raises evidence quality and so confidence; it does not change the formula.

### Multi-tenant and per-organisation

* Everything is scoped by `org_id`, as the existing tables are. A model's output for one organisation is never used to answer for another.
* `modelAssist` joins the existing versioned settings in `src/settings.ts` (zod schema, `org_settings_history`), next to `reading`. Default `off`.
* Training use is a separate, explicit opt-in per organisation and purpose (not the same as `modelAssist`), recorded and audited.
* Batch uploads: model jobs go through the same durable `queue`, so `reading.maxBatchFiles`, the rate limits and the bounded retries already apply; model jobs have their own lower concurrency so a large batch cannot starve reading.

### Human control and the edit policy

* Model-supplied values are edit-policy fields like any other: what a CV states stays locked unless the organisation's policy allows edits (`server/src/editPolicy.ts`, 403 `PERM-002`). The panel shows a "read by a model" mark with the model name on each such value, and "View Original CV" stays at the bottom of the candidate panel.
* A document where a model supplied values, or where one was refused, gets a plain-words review reason in `meta.readingIssues` (the same list `src/review.ts` turns into review reasons), for example "Some jobs were filled in by a model from the text of this CV. Check them against the original."
* Original evidence is preserved: the rule-based result is stored alongside, so an auditor can see what the rules read, what the model proposed, and what was kept.

### Data (new migration, same style as `supabase/migrations/`)

* `ml_models`: id, name, licence, licence_terms, file_hash, quantisation, runtime, evaluation (jsonb), state (`candidate`, `shadow`, `enabled`, `retired`). Platform-wide, admin-only.
* `ml_runs`: document_id, org_id, model_id, mode (`shadow` or `on`), proposals (jsonb), refused_why, seconds, created_at. One row per run; this is the shadow log and the audit trail.
* `ml_labels`: org_id, document_id, field, rules_value, corrected_value, quote, consent_ref. Written only for organisations that opted in to training use.
* Tenant isolation as for the other tables; no row is readable across `org_id`.
* `audit_events` records every enable, disable, setting change and label use (who, what, from, to).

### Where it runs, given the move to our own database and hosting

The model worker is a separate process on our own infrastructure with no outside network access, reading jobs from our own `queue` and returning results through it; it never touches the database. This keeps the same shape whether the database stays on the current dev project or moves to infrastructure we own, so it does not add to the Supabase dependency. Hardware (CPU only or one GPU) is the owner's decision.

### What is deliberately not proposed

* No external model service, no API key, no cloud inference.
* No model deciding about a person, and no model-written text that cannot be traced to the CV.
* No change to scoring, to the edit policy, or to the requirement that a candidate stays visibly processing until extraction is complete.
