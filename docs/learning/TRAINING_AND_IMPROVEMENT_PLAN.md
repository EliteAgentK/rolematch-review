# RoleMatch: training and continuous-improvement plan (extraction and matching)

Status: **PROPOSED, awaiting the owner's approval.** Written 2026-10-28 from an inspection of the repository at commit `d64945a` and measurements re-run the same day. Nothing in this document has been built, deployed or trained. Every gate, threshold and dataset size below is a **proposal or a planning estimate**, labelled as such, until approved.

How to read it: section 1 is what is true today, with evidence. Sections 2 to 8 are the design. Section 9 is the ordered backlog. Section 10 is the one small first step asked for approval. Sections 11 and 12 cover the permanent learning loop and the experiment cards.

Labels used throughout: **[fact]** verified in our code, our measurements or a primary source (cited); **[proposal]** a design decision for approval; **[unknown]** not known, with what would settle it; **[estimate]** a planning number, not proven sufficient.

Plain-language terms used once and then relied on:
* **Fine-tuning**: continuing to train an existing model on our own labelled examples so it does one job better.
* **Ground truth / label**: the answer a careful person agreed is correct, against which a reader or model is measured.
* **Split**: which bucket an example belongs to (training, validation, protected evaluation); an example never moves buckets.
* **Leakage**: the same document (or a near copy) appearing in two buckets, so a test secretly measures memory instead of skill.
* **Shadow mode**: running a new version beside the live one, recording what it would have said, changing nothing.
* **Character error rate (CER)**: the share of characters an OCR reading gets wrong against a verified transcription.
* **Precision / recall**: of what the reader claimed, how much was right / of what was really there, how much it found.
* **Calibration**: whether "80% confident" really means right about 80% of the time.
* **Cross-encoder / reranker**: a model that reads a requirement and a sentence together and returns one number for how well the sentence supports it.
* **Embedding**: a list of numbers representing a sentence's meaning, used to find similar sentences quickly; similarity is not proof of anything.

---

## 1. Verified current state

### 1.1 What exists, and what is rules versus models [fact]

| Component | What runs in production today | Model involved? | Evidence |
|---|---|---|---|
| A. Image quality and OCR routing | Fixed rules: render PDFs at about 250 dpi, clean images (`imageprep.ts`), refuse OCR under 50% average confidence, refuse a photo with almost no text, re-read the top of page 1 when no contact details were found | No learned model | `server/src/ocr.ts`, `imageprep.ts`, `EXTRACTION_CONTRACT.md` |
| B. Text detection, recognition, reading order | Tesseract (WebAssembly, `tesseract.js` 7) with `eng` and `afr` `4.0.0_best_int` language data; reading order by our own column logic (`layout.ts`) | **Pretrained model, not fine-tuned** | `ocr.ts` lines 40 to 70, `@tesseract.js-data/eng` |
| | PaddleOCR (PP-OCRv4 detector, recogniser) through ONNX Runtime: a **trial engine**, off unless `OCR_ENGINE=paddle` or `best`; used only for the contact rescue when installed; it is a *development* dependency, so production falls back to Tesseract | Pretrained, trial only | `paddleOcr.ts`, `ocr.ts` 71 to 160, `server/package.json` |
| C. CV extraction | Rule-based parser, version **2.8.0**, fixed plan (`cvPlan.ts`), strategies in `rules.ts` (1,004 lines), qualification status from the CV's own words (`qualifications.ts`, `graph/qualificationReader.ts`), every item must quote the document (`keepSupported`) | None | `extract.ts`, `EXTRACTION_CONTRACT.md` |
| D. Job extraction | Rule-based job plan (`JD_PLAN`), mandatory/preferred only on stated evidence, wording review (`jobReview.ts`), a recruiter approves requirements (job status `open`) | None | `cvPlan.ts`, `jobReview.ts`, `match.ts` |
| E. Retrieval of candidates/jobs | No retrieval model. Bulk match scores up to 50 jobs for a candidate, or up to 50 candidates for a job, in full | None | `index.ts` bulk route |
| F. Requirement-to-evidence | Rules: a 199-skill dictionary with aliases (`skills.ts`), "described use" needs two content words besides the skill (`ruleset.evidence`), qualification requirements through the capability graph, designations list, fallbacks (two shared word stems give "partial") | None | `match.ts` `evalRequirement`, `levelOf` |
| G. Points and percentage | Deterministic weighted mean in three views (proved, expected, possible), frozen and fingerprinted ruleset **2.2.0** (`ruleset.ts`), mathematical properties tested on seeded random cases | None | `scoring.ts`, `MATCHING_MODEL.md`, `test/scoring.test.ts` |

**Built but NOT connected to the live pipeline** (no production file imports `server/src/ai/`; verified by search): a local-model client that refuses any address but this machine (`ai/localModel.ts`, Ollama), an embedding model and a reranker on ONNX (`ai/onnx.ts`), three agents (job reader, evidence finder, meaning reader, `ai/agents/`), a shared vocabulary (`ai/vocabulary.ts`), a teaching store (`server/teaching/`, 40 examples), a benchmark kit (`server/bench/`), output guards (`modelGuards.ts`).

### 1.2 Model files and versions actually present [fact]

| Model | Where | Licence (as recorded) | Used live? | Registry entry? |
|---|---|---|---|---|
| Tesseract `eng`, `afr` traineddata, `4.0.0_best_int` | npm `@tesseract.js-data/*` 1.0.0 (wrapper MIT; the data comes from `tessdata_best`, Apache-2.0) | MIT wrapper / Apache-2.0 data | **Yes** | **No** |
| PP-OCRv4 detector + Chinese-English recogniser + angle classifier | npm `@gutenye/ocr-models` (wrapper MIT; PaddleOCR models Apache-2.0) | as stated | Trial only | **No** |
| `en_PP-OCRv3_rec_infer.onnx` + `en_dict.txt` | `server/data/ocr-models/` (git-ignored) | **[unknown] provenance and converter not recorded** | Trial only | **No** |
| `intfloat/multilingual-e5-small` (ONNX, sha256 `ca456c06…`) | `server/data/models/` | MIT (model card) | No | Yes (`ml-models.json`) |
| `onnx-community/bge-reranker-v2-m3-ONNX` (8-bit, sha256 `912fc121…`) | `server/data/models/` | Apache-2.0 **inferred from the base model**; the port declares none | No | Yes, with that caveat |
| `qwen3:4b-instruct-2507-q4_K_M`, `qwen3:8b` | Ollama on this Mac | Apache-2.0 | No | Yes |

Licence scan of all 358 installed npm packages (2026-10-28): no AGPL or GPL-only package. Needs a decision, not a fix: **`libvips` (LGPL-3.0)** arrives through `sharp`, pulled in by the PaddleOCR wrapper and `@huggingface/transformers` (development dependencies today; it would ship if either were promoted); `lightningcss` (MPL-2.0) is a website build tool, not shipped; `jszip` is MIT-or-GPL, used under MIT.

### 1.3 Training infrastructure [fact]

**None for training.** There is no trainer, no dataset manifest, no split assignment, no experiment record, no checkpoint registry and no training worker. What exists is evaluation and prompting infrastructure: frozen outputs (`test/golden`, enforced by `contract.test.ts`), evaluation scripts (`eval:ocr`, `eval:panels`, `eval:variants`, `eval:jobs`, `eval:extensive`, `factory:eval`, `stress`; `eval:pack300` exists but needs a pack the owner supplies), the AI harness and benchmark kit (shadow measurements on invented text), the teaching store (in-context examples, not training data, labelled by the assistant), 54 backend test files (399 tests passing on 2026-10-27).

### 1.4 Corrections and history [fact]

* Every edit is audited as `{ field: { from, to } }` (`store.ts`), **with no reason**. A genuine extraction correction, a candidate updating their details, a recruiter's preference and a disagreement all look the same. This is the most important gap for training: every label would come through it.
* The original extraction is kept (`candidates.extracted` is never overwritten); `data` holds the edited record. Matches are immutable snapshots with rules version, fingerprint and record versions.
* There is **no re-processing**: a published document is never re-read under a newer parser, so there is no versioned re-extraction and no visible comparison yet.
* Deleting a record scrubs personal detail from its edit history (`deletion.ts`).
* Tenant isolation is enforced in code and by PostgreSQL row rules (migration 014), proven on every endpoint (`test/isolation.test.ts`, `tenant-separation.test.ts`). There are no training tables yet, so nothing is pooled.

### 1.5 Which accuracy claims reproduce (re-run 2026-10-28, parser 2.8.0, rules 2.2.0) [fact]

**Every figure below is on invented documents.** No real CV has ever been measured (`sample-documents/real/` is empty).

| Claim (where written) | Re-run result | Sample | Reproduces? | Caveat |
|---|---|---|---|---|
| OCR benchmark: poor phone photo words 91 to 95% (`EXTRACTION_CONTRACT` 2.7.1) | phone-poor words 95% | 3 CVs × 6 degradations | Yes | 3 CVs; a field at 3 of 3 has a 95% interval of 44 to 100% |
| OCR: clean scans read names | **name 0 of 3 on clean scans**, 3 of 3 on poorer photos | 3 | **New defect found** | interval 0 to 56% |
| OCR confidence means something | the worst image: **1% of words recovered at 91% reported confidence** | 3 | — | proves engine confidence cannot route documents |
| Extensive: rich CVs 74 to 89, weak 29 to 44, no overlap (`MATCHING_MODEL` 2.2.0) | identical: rich 74 to 89, weak 29 to 44 | 12 | Yes | written by the same author as the rules |
| Personal details never change a score | identical with and without (3 CVs) | 3 | Yes | small |
| Factory: 95 invented documents | contact 100%, roles 96%, titles 86%, companies 94%, dates 96%, qualifications 100%, completion 100%, skills 99% | 95 | Yes (as committed) | keys generated by our own code |
| Messy corpus: 99% perfect | 99% of 368 files fully right; **card "years" 0%** | 368 | Mostly | **the evaluation computes expected years from today's date** (`panels.ts` line 26) while the reader counts from the CV's latest year, so this check drifts with the calendar: a measurement defect |
| Messy corpus first-look rate (`test/messy/README.md`) | 45 to 50% of CVs perfect on each **unseen** round before fixes; 98 to 100% after | about 64 to 96 per round | Recorded, not re-run | **the honest estimate of unfamiliar layouts**: expect about half to need a fix or a check |
| Jobs: 100% of fields (`eval:jobs`) | 100% on 130 files | 130 | Yes | written alongside the parser |

### 1.6 Documents available to this work [fact]

**Only invented documents already committed in the repository are used** (messy corpus, factory, extensive, golden, stress, samples: about 500 documents, all written by our own code, answer keys from our own generators). **No other CV or job pack is used until the owner hands it over**; packs found on disk are not inputs to this plan. No real CV has been supplied (`sample-documents/real/` is empty). The teaching store's 40 examples were labelled by the assistant, so they are prompts and grading signals, not ground truth.

Consequence: **we have no requirement-level match labels, no human-adjudicated extraction labels and no real documents.** Training anything responsibly is not possible yet; the first stages are annotation, baselines and rule fixes, and the documents for them are **to be supplied by the owner**.

### 1.7 Defects confirmed by experiment while writing this plan [fact]

| # | Defect | Measured | Class |
|---|---|---|---|
| R1 | A **negated** skill earns credit: "I have no experience with Kubernetes yet" → Kubernetes requirement **partial (50)** | `probe-match`, 2026-10-28 | rule fix (F) |
| R2 | A **wish in a career objective** earns credit: "I would love to learn Kubernetes" → **partial (50)** | same | rule fix (F) |
| R3 | Clean scans lose the candidate's name (0 of 3) while noisier photos keep it | `eval:ocr` | OCR/reading-order investigation (B) |
| R4 | The panels evaluation's "years" check uses today's date | `test/messy/panels.ts` | evaluation fix |
| R5 | Any requirement the engine cannot check gets "partial" when two word stems are shared ("Related wording appears") | code reading (`match.ts`) | precision unmeasured; needs labelled units (F) |
| R6 | OCR language data defaults to `eng+afr` (`OCR_LANGUAGES`); the owner decided not to recognise Afrikaans wording (2026-10-23), and the code notes more languages cost accuracy and time | code reading | owner decision, then measure |
| R7 | `CLAUDE.md` still says extraction "without `ANTHROPIC_API_KEY` is rule-based"; the cloud path no longer exists in the code (0 matches) | search | documentation |
| R8 | No test proves a pair scores identically whether reached from the candidate or from the job (it does by construction: both call `assess`) | test search | missing test |
| R9 | Model registry omits the OCR models in live and trial use | `ml-models.json` | registry gap |

Checked and correct: Java required against a JavaScript-only CV is "not demonstrated" (0); a Python short course counts as "named, not described" (labelled honestly); the same pair assessed twice is identical.

---

## 2. Recommended architecture [proposal]

```
                 ┌──────────── live path (changes only through release gates) ────────────┐
 upload ─► A route ─► B read (native text | Tesseract) ─► C/D extract (rules) ─► records + evidence pointers + versions
                │                                                   │
                │                                          E retrieve (lexical + synonym)  ─► F assess each requirement (rules)
                │                                                                                │
                │                                                                       G deterministic points ─► human review
                ▼                                                                                │
        refused / review queue ◄──────────── uncertainty, refusals, low evidence ◄───────────────┘

                 ┌──────────── learning path (offline, never touches live records) ──────────────┐
 recruiter edit with a REASON ─► error register ─► annotation queue ─► 2 reviewers + adjudicator
        ─► verified labels ─► dataset manifest (splits fixed by group) ─► readiness check
        ─► experiment (training worker, offline) ─► validation ─► protected evaluation ─► owner approval
        ─► shadow run ─► staged release (per organisation, opt-in) ─► monitoring ─► (back to register)
```

### 2.1 Each component: what it needs [proposal]

| Component | Conventional rule | Pretrained model | Fine-tuned model | Human review | Recommendation now |
|---|---|---|---|---|---|
| A. Quality and routing | **Yes**: keep the gates; add measured routing rules | Page orientation classifier (`PP-LCNet_x1_0_doc_ori`, Apache-2.0, to fetch and register) | Only if routing errors stay costly after rules; labels from **measured** errors, never engine confidence (R3 evidence) | Refused and low-evidence documents | Baseline per input type; orientation trial in shadow |
| B. Detection, recognition, order | Reading order stays our column logic | Tesseract (live) vs PaddleOCR English model (trial) | Tesseract fine-tune from `eng` best **only if** recognition errors dominate on real scans and enough verified line crops exist | Lines below a measured quality | Compare engines and preprocessing first; no training now |
| C. CV extraction | **Yes**: parser 2.8.0 plus register fixes | Local language model reading line pointers, in shadow, to fill gaps only | Later, if shadow shows rules plateau and thousands of verified labels exist | Fields flagged by review rules | Rule fixes and annotation; shadow comparison |
| D. Job extraction | **Yes** | Job reader (Qwen3, built) in shadow | Not justified yet | **Always**: a recruiter approves requirements | Owner policy on bare qualifications; 50 labelled requirements |
| E. Retrieval | **Yes**: dictionary and approved synonyms | Embeddings (e5-small) to *suggest* evidence lines and candidates | Only with reviewed positive and negative pairs | Suggestions are shown, never scored | Lexical baseline first; embeddings in shadow |
| F. Requirement evidence | **Yes**: fix R1, R2; keep levels | Reranker as a suggestion with abstention | Cross-encoder on requirement-level labels, much later | Uncertain or contradicted units | Label 300 to 500 units; measure rules first |
| G. Points and percentage | **Yes, only rules** | Never | Never (learned weights would be a separate governed project) | Overrides recorded | No change; add tests R8 and exact weight-change tests |

---

## 3. Annotation schemas and examples [proposal]

One record per labelled unit, stored as JSON lines in an access-controlled store on our infrastructure, **one store per organisation**, never in the repository. Invented examples may live in the repository.

### 3.1 Common envelope (every label)

```json
{
  "label_id": "lab_01J…",                       "schema_version": "1.0.0",
  "org_id": "uuid",                              "document_id": "uuid",
  "document_sha256": "hex",                      "document_version": 1,
  "record_id": "uuid", "record_version": 3,
  "task": "ocr_line | cv_field | jd_requirement | requirement_evidence",
  "location": { "page": 1, "bbox": [x0, y0, x1, y1], "text_offsets": [start, end] },
  "crop_ref": "private object key or null",      "crop_sha256": "hex or null",
  "original_extracted": "…",                     "verified": "…",
  "field_path": "workHistory[1].endDate",
  "original_value": "…",                         "corrected_value": "…",
  "error_category": "image_quality | detection | recognition | reading_order | field_extraction | association | normalisation | requirement_split | evidence_level | none",
  "change_kind": "extraction_correction | candidate_update | recruiter_preference | disputed_interpretation",
  "reviewer_id": "uuid", "second_reviewer_id": "uuid|null", "adjudicator_id": "uuid|null",
  "verification_status": "draft | single_reviewed | double_agreed | adjudicated | rejected",
  "versions": { "ocr": "tesseract.js 7.0.0 eng 4.0.0_best_int", "parser": "2.8.0", "rules": "2.2.0", "model": null, "config_fingerprint": "hex" },
  "permitted_uses": ["regression_test", "evaluation", "training"],
  "consent_ref": "org agreement id + purpose wording version",
  "retention": { "status": "active | deletion_requested | deleted", "delete_after": "date" },
  "created_at": "…", "notes": "free text, no extra personal data"
}
```

Rules: `change_kind` other than `extraction_correction` never becomes an extraction training label (a candidate update is a new fact; a preference is not truth; a dispute stays unresolved until adjudicated). Only `verification_status` of `double_agreed` or `adjudicated` may be used for training or protected evaluation; `single_reviewed` may be used for development and regression. Agreement between two models is never verification.

### 3.2 Realistic examples (invented people)

**OCR line correction**
```json
{ "task": "ocr_line", "location": { "page": 1, "bbox": [112, 340, 980, 372] },
  "original_extracted": "Thabo Nkosi | 082 55S 0199 | thabo.nkosi@exarnple.test",
  "verified": "Thabo Nkosi | 082 555 0199 | thabo.nkosi@example.test",
  "error_category": "recognition", "change_kind": "extraction_correction", "verification_status": "double_agreed" }
```

**Qualification status (CV field)**
```json
{ "task": "cv_field", "field_path": "education[0].status",
  "original_value": "completed", "corrected_value": "not_completed",
  "verified": "BCom Accounting, University of the Free State, 2014 - 2016 (did not complete)",
  "error_category": "field_extraction", "change_kind": "extraction_correction", "verification_status": "adjudicated",
  "notes": "status phrase wrapped onto the next line" }
```

**A candidate update (not a training label)**
```json
{ "task": "cv_field", "field_path": "phone", "original_value": "082 555 0199", "corrected_value": "083 111 2233",
  "change_kind": "candidate_update", "permitted_uses": [], "notes": "candidate phoned with a new number" }
```

**Job requirement split**
```json
{ "task": "jd_requirement", "verified": "Python or Bash scripting, and experience with Terraform.",
  "corrected_value": { "groups": [["Python", "Bash"], ["Terraform"]], "mandatory": true, "years": null,
                       "ambiguity": null, "raw": "Python or Bash scripting, and experience with Terraform." } }
```

**Requirement evidence (the matching unit)**
```json
{ "task": "requirement_evidence", "requirement_id": "jdreq_…", "requirement_text": "3+ years managing a team",
  "evidence": [{ "document_id": "…", "page": 2, "text_offsets": [880, 951], "quote": "Led a team of four analysts on the 2022 audit" }],
  "assessment": "partially_supported",
  "reason": "leads a team on a project; no statement of people-management accountability or of duration",
  "open_questions": ["Line management or project lead?", "For how long?"] }
```

### 3.3 Annotation handbook (summary; the full handbook is versioned at `docs/learning/ANNOTATION_HANDBOOK.md` once approved)

1. Label only what the document shows; never what is likely. A missing field is `not_stated`, never a guess.
2. Quote exactly; record offsets or a box. If you cannot point to it, it is not evidence.
3. Five states for any fact: **not stated**, **stated but unreadable**, **stated and uncertain**, **explicitly contradicted**, **verified evidence present**.
4. Classify every edit with one `change_kind` before saving.
5. Consequential labels (qualification status, dates, mandatory requirements, any `contradicted` or `supported` matching label) need **two independent reviewers**; disagreement goes to an **adjudicator** whose decision and reason are recorded.
6. Routine labels: one reviewer, with a **random 10% double-labelled** [proposal] to measure agreement (Cohen's kappa reported per task).
7. Never record or infer protected traits; never copy personal data into notes.
8. A reviewer never labels their own organisation's disputed case alone.
9. The handbook has a version; every label records the version it was made under; a handbook change triggers re-checking of affected labels.

---

## 4. Dataset preparation and splitting [proposal]

### 4.1 Buckets

| Bucket | Purpose | Who may see it | Changes when |
|---|---|---|---|
| Training | fit models | experiment worker | each data release |
| Validation | choose settings, early stopping, thresholds | experiment worker | each data release |
| Regression fixtures | every known failure, fast tests in CI | developers (invented only in the repo) | every fixed register entry adds one |
| **Protected release evaluation** | the go/no-go measurement | release process only, never during development | **frozen per quarter**; retired into regression afterwards |
| Fresh time-separated batches | check drift: documents received after the model was frozen | release process | monthly or quarterly |

### 4.2 Assignment by group, never by row

* The **group** is the source person or source document lineage: all pages, formats, scans, photos, re-saves, revisions and augmentations of one CV share a group; all versions of one vacancy share a group.
* For matching, a pair belongs to the split of **both** its documents: pairs are built only inside a split. Separate test slices: **unseen candidates**, **unseen jobs**, **both unseen**.
* Near duplicates (same email or phone, text similarity above a measured threshold, reused templates) are merged into one group before assignment.
* **Template families held out**: for generated packs, whole layout families go to evaluation only. For real documents, the producer tool and layout family (`templates.ts`) are recorded and a share of families is held out.
* Employer wording styles: vacancies from the same employer stay in one split; a share of employers is held out.
* Assignment is deterministic: `split = bucket(sha256(group_id + manifest_salt))`, written into a **manifest** (one row per file: path key, sha256, group, family, split, labels version). The manifest is versioned and never edited in place; a new manifest is a new version.

### 4.3 What the generated packs are, and are not

* Use them as **regression fixtures and development data**. Never report a release claim from them.
* A pack is used only after the owner hands it over; its reference records are then inspected before use (who generated the keys, whether keys were human-checked, which templates and vocabulary it shares with other packs) and the findings are written into the manifest. Packs that share generation templates are never used to test each other.
* None of them has requirement-level match labels.

### 4.4 Initial sizes [estimate]

From the binomial intervals we computed (90% true rate: ±10 points at 30 documents, ±5 at 140, ±3 at 385; zero errors in 150 bounds the true rate only below 2.5%):

| Purpose | First target | Why |
|---|---|---|
| Failure discovery on real CVs | 30 to 50 consented CVs | finds failure types, does not support an accuracy claim |
| Extraction accuracy claim per format | about 140 CVs per slice (native PDF, Word, scan, photo) | ±5 points |
| Requirement-level policy pilot | 50 requirements labelled by a recruiter | settle label definitions and the bare-qualification policy |
| Evaluate rules versus reranker on evidence | 300 to 500 adjudicated requirement-evidence units | enough to see large differences |
| Train a cross-encoder | 2,000 to 3,000 units, including hard negatives | literature-free guess; **learning curves decide** |
| OCR fine-tune pilot | 1,000 to 3,000 verified line crops | Tesseract's docs give no minimum; learning curves decide |

Learning curves: train on 25%, 50%, 75%, 100% of the training bucket, measure on validation; if the last doubling gives less than the noise margin, more labels of that kind are not the bottleneck.

### 4.5 Approved data use before any real CV [proposal; legal wording is the owner's and a lawyer's]

* Separate, explicit opt-in per organisation for **(a) testing** and **(b) training**; processing a CV for recruitment does not imply either.
* Data stays on our infrastructure (POPIA section 72 for transfers abroad, `FIELD_RESEARCH_REPORT.md` 4.3). Annotation tooling runs locally; no outside labelling service.
* Access: named annotators and adjudicators only; every view of a document or label is audited.
* Retention: a training copy lives no longer than the source's retention; when a candidate's record is deleted, every label and crop from it is deleted, and the next scheduled model release is trained without it (models already released are retired on schedule, not "unlearned"; state this to clients).
* **No pooling by default**: each organisation's labels sit in its own store. A platform-wide model is trained only on (1) invented data and (2) data from organisations that opted in to platform training under contract. Corrections never flow into a shared set automatically.

---

## 5. OCR and extraction runbook

### 5.1 OCR: baseline first (Stage 1) [proposal]

1. Split inputs into **native text**, **scans** and **phone photos**; measure each separately. Never average them.
2. For each page, keep a verified transcription (line level) and categorise every error: image quality, text detection, character recognition, reading order, downstream field extraction.
3. Compare **before any training**: preprocessing variants (current pipeline, no faint-text strengthening, higher render scale), `eng` versus `eng+afr` (R6), Tesseract versus PaddleOCR with an English recogniser of recorded provenance, orientation classifier on/off.
4. Report per slice: CER, critical-field accuracy (name, email, phone, dates), share refused, seconds and memory per page, with sample sizes and intervals.

### 5.2 OCR fine-tuning, only if justified [proposal]

Trigger: on real scans/photos, **character recognition** is the dominant error category after the best preprocessing and engine are chosen, and at least the pilot number of verified line crops exists.

If the engine stays Tesseract (verified in the tesstrain README, Apache-2.0):
* Data: line images (`.tif` or `.png`) each with a same-named single-line `.gt.txt` transcription, in `GROUND_TRUTH_DIR`.
* Start from `eng` best (`START_MODEL=eng`, `TESSDATA` pointing at the best data), `MODEL_NAME=rolematch_eng_vN`; the documented default learning rate when fine-tuning is 0.0001; the documented split is `RATIO_TRAIN` 0.90 (we override with our own manifest so splits are by group).
* Requirements stated by the tool: Tesseract ≥ 5.3 with training tools, matching Leptonica, GNU make ≥ 4.2, Python 3, Pillow. This is a **separate training worker** (Linux container), not the Node backend; the resulting `.traineddata` is loaded by `tesseract.js` (whether a fine-tuned `best` model must be converted to `best_int` for `tesseract.js` is **[unknown]**, to check at Stage 4).
* The exact command is written and tested at Stage 4 against the pinned tesstrain commit; the documented form is `make training MODEL_NAME=… START_MODEL=…`. Nothing beyond that is claimed here.
* Steps: validate every crop and transcription (non-empty, decodable, the text fits the crop); include hard and ordinary lines; **training-only** augmentation (rotation ±3°, JPEG quality 35 to 90, contrast, shadow, blur) applied to images only, with the transcription unchanged and a check that augmentation never crops text; a small pilot (10% of data, a few hours) to confirm the loop works; choose iterations and learning rate on validation CER; early stopping when validation CER stops improving for a fixed number of checkpoints; record the chosen checkpoint and why; evaluate the locked model once on the protected set; compare CER, critical-field errors, speed, memory and installed size against the incumbent.
* Hardware [estimate]: CPU training (Tesseract's LSTM training is CPU-based); hours to a day for a few thousand lines on a multi-core server. Measure on the pilot.

If PaddleOCR wins the comparison, its fine-tuning tool is inspected at that point; no command is given here because it has not been inspected.

A separate **quality/routing model** is trained only if routing rules leave measurable cost, with labels from measured CER per page (e.g. "would OCR CER exceed the threshold"), never from engine confidence (R3: 91% confidence at 1% recovery).

### 5.3 Structured extraction (CVs and jobs) [proposal]

1. **Evaluate the current parser first** (Stage 1): per field, per format, per layout family, on the committed invented fixtures (development), on packs only once the owner supplies them, and on real consented CVs once supplied (evaluation).
2. **Fix through the register**: each failure becomes a regression fixture before the fix (R1 to R5 first).
3. Only when the rules plateau on real data, compare two learned approaches in shadow:

| | Span labelling (token classifier marks spans) | Constrained structured extraction with line pointers (local LLM returns field → line ids, text re-read from the document) |
|---|---|---|
| Fits | flat fields: names, contact, dates, titles, skills | relations: which duties belong to which role, overlapping dates, status phrases on the next line |
| Our documents | many layouts, relations matter (our known failures are association errors) | same |
| Infrastructure | ONNX in Node, small | Ollama already integrated, 4B runs on this Mac (about 20 s per CV measured) |
| Invention risk | none (spans only) | none if values are re-extracted from pointed lines (Zhu et al., arXiv 2510.09722) |
| Labels needed to fine-tune | thousands of span-annotated CVs [estimate] | the cited work used 15,500 labelled resumes; untuned small models scored far lower |

   Recommendation: **pointer-based constrained extraction in shadow, untuned, for gap-filling only**, because our errors are mostly association errors and the integration exists; fine-tune only if shadow results justify it and labels exist. GLiNER was removed by the owner (2026-10-27), so span labelling would need a new candidate.
4. Hard cases in every evaluation set: several employers on one page; overlapping dates; qualifications not completed; similar institution and employer names; skills only in an advertisement pasted into a CV; negation; missing fields; corrupted OCR; reordered sections and columns.
5. Output is validated against the record schema (zod); invalid output fails safely: the rule-based value stands and a review reason is added. The five fact states (section 3.3) are carried in the schema. A model may never fill a field from what is typical; every value needs a pointer into the document.
6. CVs and job descriptions are **data, never instructions**: only text that passed hidden-text exclusion reaches a model; it is fenced as inert data in the prompt; the model has no tools that write; output passes `modelGuards.ts` and the evidence check.

---

## 6. Matching runbook

### 6.1 Labels for requirement-level evidence [proposal]

| Label | Meaning | Positive example | Negative example | Boundary |
|---|---|---|---|---|
| **Supported** | the documents show the requirement met, by described use or a stated, specific fact | "Administered production Kubernetes clusters for three years" against "Kubernetes administration" | "Kubernetes" only in a skills list | a certificate title alone is *partially supported* |
| **Partially supported** | some evidence, incomplete in scope, depth, duration or form | skills-list mention; course title; 2 of the 3 years asked | a wish or plan to learn | evidence across two jobs that together meet it is *supported* if both are dated |
| **Not evidenced in the supplied documents** | nothing in the documents speaks to it | no mention | — | **never relabelled "candidate cannot do it"** |
| **Explicitly contradicted** | the documents state the opposite | "BCom (did not complete)" against "completed BCom"; "no experience with Kubernetes" | absence | contradicted only by the candidate's own statement |
| **Uncertain (extraction or wording)** | cannot be judged because the text is unreadable or the requirement is ambiguous | an unreadable OCR line where a date should be; "strong communicator" | — | goes to a person |

Confusable sets labelled deliberately: Java vs JavaScript; tool in a course vs used at work; incomplete vs completed degree; team leadership vs people-management accountability; relevant experience vs unrelated years; a skill in a career objective; evidence spanning several jobs.

Evidence interpretation (these labels) is separate from **scoring policy** (how many points a label earns), which stays in `ruleset.ts`.

### 6.2 Baseline first [proposal]

Measure today's rules on the labelled units: precision and recall per label, **false "supported"** rate (the critical one), missed evidence. Fix R1, R2, R5 as rules if the measurement confirms them.

### 6.3 Retrieval model (component E), only if the lexical baseline misses evidence [proposal]

* Positives: (requirement, evidence sentence) pairs adjudicated **supported** or **partially supported**.
* Negatives: adjudicated **not evidenced** and **contradicted** pairs, plus **hard negatives**: Java/JavaScript, course vs work use, objective statements, same employer different role, same word different meaning.
* Loss: because several candidates can genuinely meet the same requirement, **do not rely on in-batch negatives alone**: the sentence-transformers documentation states that `MultipleNegativesRankingLoss` treats all in-batch alternatives as negatives and its duplicate sampler only prevents identical items. Use labelled-pair losses (`ContrastiveLoss` / `OnlineContrastiveLoss` for 0/1 labels, or `CoSENTLoss` for graded labels) on reviewed pairs, or `GISTEmbedLoss` with a guide model and margin to discard negatives that score above the positive, plus a batch sampler that never places two items from the same requirement equivalence class together.
* Evaluate: recall@k for k = 5, 10, 20 evidence lines; and separately for candidate-across-jobs and job-across-candidates search.
* Start from `multilingual-e5-small` (MIT, registered). Similarity is never converted into a percentage or a credit.

### 6.4 Evidence-assessment model (component F), much later [proposal]

* Input: requirement text (canonicalised), one candidate evidence passage, its section type (work, project, skills list, objective, education), never the candidate's name or contact details.
* Output: one of the five labels, or **abstain**.
* Objective: multi-class cross-entropy (the documented cross-encoder `CrossEntropyLoss` with `num_classes` outputs), or binary cross-entropy for a supported/not split; class weights for rare `contradicted`.
* Abstention: thresholds per class chosen on validation to keep the false "supported" rate under the gate; below threshold → "uncertain", sent to a person.
* It assesses one requirement against one passage. It never sees or outputs a whole-person judgement. Its label feeds the deterministic scorer exactly as the rule's label does, only after release gates.
* Start from `bge-reranker-v2-m3` (Apache-2.0 base; licence of the ONNX port to be confirmed or the original converted ourselves).

### 6.5 Bidirectional matching [proposal]

* The pair score is a function of (candidate version, job version, rules version, reference date) only. Add the invariance test (R8): the same pair reached from either side gives byte-identical evidence and score.
* Retrieval is evaluated separately in each direction; ranking position depends on who else is in the pool and is never confused with the pair's score.
* Candidate preferences (stated work arrangement, relocation) stay in logistics, shown beside the score, never inferred from demographics or career patterns.

---

## 7. Scoring and configuration governance [proposal]

### 7.1 What each requirement keeps (already mostly true in `MatchEvidence`)

Requirement wording and id, approved weight, mandatory/preferred, evidence quote and location, evidence state, awarded and maximum points, rules version and fingerprint, explanation, and **an override record** (who, from, to, why), which does not exist yet.

### 7.2 Unknowns and the denominator [fact, then proposal]

* Today: every assessable requirement stays in the denominator. "Not evidenced" earns 0 in the **proved** view and full in the **possible** view; the headline `score` is the expected view with the prior ρ = 0, so it equals the proved view. Requirements the engine "cannot check automatically" also count as not evidenced (0 proved, 1 possible). Nothing is silently dropped, so the percentage is not inflated.
* Gap: **unreadable** evidence (OCR failure) and **uncertain** requirements are indistinguishable from "not evidenced"; extraction quality only lowers the confidence figure.
* Proposal: add the state **uncertain** for (a) unreadable evidence and (b) requirements flagged ambiguous; keep it in the denominator (no inflation), earn 0 proved and full possible (no treating as failure), and show **assessable share** (weight that could be judged) beside the score. No change to the formula itself without approval and a version bump.
* The proved-to-possible range is a **deterministic bound**, not a statistical confidence interval; the wording must never call it one. The confidence figure is a heuristic (`(1 − width) × quality`, thresholds 0.75/0.5) that has **never been calibrated**; it is reported as such until validation data exists.

### 7.3 Platform safeguards versus organisational preferences

| Platform safeguard (no organisation can weaken it) | Organisational preference (Settings, versioned, audited, within ceilings) |
|---|---|
| evidence/quote check on every value | statuses, wording, panel display |
| scoring formula, weights, credits, bands, equivalence rules | fair-use limits, session length |
| hidden-text exclusion, data-not-instructions fencing | hidden-text policy (exclude+flag or flag-only) |
| no protected traits as inputs | review thresholds (which weak records get a flag) |
| no automatic promotion; release gates | whether a released model is `off`, `shadow` or `on` for them |
| tenant isolation; no pooling without opt-in | opt-in to testing and to training use; retention period within the legal limit |
| reproducibility contract | which fields a model may fill (from the released set) |

---

## 8. Evaluation and release gates

### 8.1 What is measured, always per slice (document type, format, layout family, unseen-candidate/job), with sample size and 95% interval

Extraction: CER; field precision and recall; exact contact and date accuracy; qualification-status accuracy; employer–role–duty association; evidence-pointer correctness; unsupported-value rate; human-review rate; seconds and memory per page.

Matching, run twice (on **verified structured inputs** to isolate matching, and on **actual extraction output** to measure error propagation): retrieval recall at practical list sizes; requirement-label precision and recall; **false "supported"** rate; missed evidence; calibration and abstention where a model is used; ranking quality against independently reviewed relevance labels; score-calculation correctness; bidirectional pair invariance.

Fairness: high overall accuracy is not fairness. No sensitive trait is inferred from names or by a model. If real sensitive attributes are ever needed, they come only from **voluntary self-declaration collected separately**, held apart from matching, under a separately approved evaluation protocol.

### 8.2 Consistency and shortcut tests (to add; several exist) [proposal]

Names, contact details and presentation do not change matching (exists for personal details); reordered sections do not change assessment; repeating a skill earns nothing (exists); duplicate pages and overlapping periods do not double-count (exists in part); hidden or injected text cannot change instructions or scores (exclusion exists; injection test against any model is new); missing evidence differs from contradiction (exists for qualifications; R1 shows a gap); negation and status survive extraction (new); changing approved weights changes the score by exactly the documented amount (new); one organisation's configuration cannot affect another's (isolation tests exist; add settings-specific case); identical locked inputs reproduce the same result (exists for rules; new for any model: three repeated runs on the production hardware class).

### 8.3 Release gates (PROPOSED until approved)

A change ships only if **all** hold, measured on the protected set and recorded in a release report:
1. No unexplained critical regression: critical fields (name, email, phone, dates, qualification status) and critical labels (supported, contradicted, mandatory) show no drop beyond the noise margin of a paired comparison; any individual new critical error is explained.
2. No new false "supported" in the critical regression set, and the measured false-supported rate stays at or below the incumbent's upper interval bound.
3. Measured improvement on the targeted problem, with the paired difference's interval excluding zero.
4. Unaffected formats and tasks evaluated and not worse beyond noise.
5. Review burden (share flagged) not up by more than an approved margin; runtime p95 not up by more than an approved factor [proposal: 10% and 1.25×].
6. Reproducibility: three identical runs on the production hardware class.
7. Evidence check and tenant-isolation suites pass.
8. A rollback was rehearsed.
9. The owner approves.

**Passing a finite test set does not prove there will be no production errors.** The release report states the sample sizes and what the intervals still allow.

Old outputs are preserved: re-processing a document creates a **new record version** with a visible comparison to the old; the historical record and its matches are never silently replaced.

---

## 9. Prioritised backlog [proposal; sizes S < 1 day, M 1 to 3 days, L longer]

| # | Item | Depends on | Size |
|---|---|---|---|
| 1 | **Change reasons on edits** (four `change_kind` values) and an **error register** (versioned file plus table, organisation-scoped) | — | M |
| 2 | Fix the evaluation defect R4 (fixed reference date in the panels evaluation); freeze **baseline v1** (all evals, with sample sizes and intervals, on invented data) | — | S |
| 3 | Regression fixtures for R1, R2, R8 (failing first), then rule fixes for negation and objective statements; bidirectional invariance test | 1 | M |
| 4 | Annotation schema (zod) and validator; handbook v1; manifest format with group-based split assignment | 1 | M |
| 5 | Registry completion (R9): OCR models with provenance; decide LGPL `libvips` and the reranker port licence | — | S |
| 6 | OCR baseline by slice on the committed fixtures, and on any scans or photos the owner supplies; investigate R3; measure `eng` vs `eng+afr` (R6, owner decision) | 2 | M |
| 7 | Owner policy on a bare qualification in a requirement; 50 recruiter-labelled requirements | 4 | S (owner) + M |
| 8 | Consent wording, opt-in settings, retention and deletion propagation for labels (lawyer for wording) | 1, 4 | M + legal |
| 9 | Real consented pilot: 30 to 50 CVs, failure discovery only | 8 | L (mostly people's time) |
| 10 | Requirement-evidence labelling: 300 to 500 adjudicated units; rules baseline; precision of R5 | 4, 7 | L |
| 11 | Re-processing with new record versions and visible comparison | 1 | M |
| 12 | Experiment records, checkpoint registry, release report template, rollback rehearsal | 4, 5 | M |
| 13 | Shadow runs: orientation classifier; PaddleOCR English vs Tesseract; pointer-based extraction for gaps; evidence finder | 6, 9, 12 | L |
| 14 | Continuous-learning scheduler with readiness triggers (section 11) | 12 | M |
| 15 | First fine-tune, only if a readiness trigger fires with approved data | 9 to 14 | L |

Costs, separately: software licences 0 by rule. Infrastructure [estimate]: this Mac suffices for items 1 to 13; training beyond small pilots needs a Linux server (CPU for Tesseract; one GPU for cross-encoders or language models), plus power and maintenance hours; price quotes are not in this document and should be obtained. **The largest cost is people's time for annotation and adjudication** [unknown: minutes per CV and per unit, measured in item 9 and item 10 pilots].

---

## 10. First milestone for approval: "Corrections that can teach" [proposal]

Small, no training, no change to how documents are read or scored for anyone:

1. Backlog 2: fix the date-dependent evaluation (R4); write **baseline v1** (all existing evaluations on the committed fixtures) with sample sizes and intervals, stored as the reference for every later comparison.
2. Backlog 1: recruiters choose a reason when they change a field read from a document (correction / candidate update / preference / disagreement); the reason is audited with the change; nothing else about editing changes. An error register (file in the repo for invented cases, an organisation-scoped table for real ones) records each verified failure with its category and status.
3. Backlog 3 (tests only): failing regression fixtures for R1 (negation), R2 (career objective) and R8 (bidirectional invariance) committed and marked as known failures, so the fix in the next milestone is measured, not assumed.

Done means: the baseline report exists and reproduces on a second run; an edit records its reason end-to-end (database, audit, website), proven by tests including tenant isolation; the three fixtures exist; all suites pass; local commit only. Estimated 3 to 5 working days.

---

## 11. Continuous learning as a permanent capability [proposal]

### 11.1 The loop

Verified error → labelled example → regression test → proposed rule or model change → validation → protected evaluation → owner approval → shadow run → staged release (organisation by organisation, opt-in) → monitoring → back to the register. **No online learning from live recruiter actions, no self-editing rules, no promotion because training finished.** A user correction updates that one record immediately; a global change follows the release process.

### 11.2 Artefacts kept

Error register; versioned annotation handbook; dataset manifests and split assignments; configuration schemas; experiment records (code commit, data manifest version, model and licence, hyperparameters, seed, hardware, metrics, chosen checkpoint and why); model and checkpoint registry; release reports; rollback instructions.

### 11.3 Schedule and readiness triggers (platform configuration, versioned; organisations cannot weaken)

| Setting | Proposed default | Meaning |
|---|---|---|
| `readiness.checkEvery` | weekly | a queue job computes readiness per component; it never trains on its own schedule alone |
| `readiness.minNewVerifiedLabels` | per component, e.g. OCR 500 lines, extraction 100 CVs, evidence 300 units | verified (double-agreed or adjudicated) labels since the last experiment |
| `readiness.minRegisterOccurrences` | 10 in one error category | a recurring weakness, not a one-off |
| `readiness.requireProtectedSetFrozen` | true | no experiment without an untouched evaluation set |
| `experiments.maxConcurrent` | 1 | experiments never compete with live processing |
| `experiments.budget` | e.g. 24 CPU-hours or 8 GPU-hours per week | hard stop; a run over budget is cancelled and recorded |
| `monitoring.randomAuditShare` | 2% of apparently successful documents | checks what nobody flagged |
| `alerts` | critical error found; review rate up by more than 20% relative over 4 weeks; new document type or language share above 5%; runtime p95 up by 25%; drift on the fresh batch beyond the noise margin | each alert names an owner and opens a register entry; **a rising review rate is investigated, never answered by lowering a threshold** |

When readiness is met, the system **starts an offline experiment automatically** in the training worker, against the frozen manifest, inside the budget. The result is a report, never a release. When readiness is not met, the weekly job reports why ("312 of 500 verified OCR lines; register shows 4 recognition errors this month") and what evidence is needed to resume.

### 11.4 Responsible owners [proposal; names are the owner's to assign]

Platform ML owner (experiments, registry); annotation lead (handbook, adjudication, agreement); release approver (the owner); privacy owner (consent, retention, deletion propagation); each client organisation's administrator (opt-ins, their reviewers).

---

## 12. Experiment cards (to be run only when their trigger fires)

### E1. Orientation classifier (component A)
* Learns: whether a page is rotated 0/90/180/270 degrees. Why: our measurement shows a sideways page at 77 to 81% character error against 26% upright (`AI_PHASE_PLAN.md`). Training: **none at first**; use the pretrained `PP-LCNet_x1_0_doc_ori` (Apache-2.0) in shadow. Fine-tune only if its error on our pages exceeds the gate.
* Data: rotated renders of the committed fixtures (development); photos supplied by the owner (evaluation). Metric: orientation accuracy, downstream CER change. Hardware: CPU, minutes. Promotion: improves CER on rotated pages with no regression on upright pages; rollback: switch off.

### E2. OCR engine comparison, then Tesseract fine-tune (component B)
* Learns: character recognition on our document styles. Why: only if recognition dominates errors after the engine and preprocessing comparison.
* Data: 1,000 to 3,000 verified line crops [estimate], grouped by document. Checkpoint: `eng` from `tessdata_best` (Apache-2.0). Loss: Tesseract's own LSTM training objective, which the tool fixes (not a choice we make; to be documented from the pinned version at Stage 4). Hyperparameters: learning rate (documented default 0.0001 when fine-tuning), iterations; chosen on validation CER with early stopping.
* Hardware: CPU server, hours [estimate]. Reproducibility: pinned tesstrain commit, Tesseract version, manifest version, recorded seed. Metrics: CER by slice, critical-field accuracy, speed, memory, size. Promotion: section 8.3; rollback: the previous traineddata stays registered and selectable.

### E3. Pointer-based structured extraction in shadow (component C/D)
* Learns: nothing at first (untuned local model fills gaps by pointing at lines). Why: association errors are our dominant parser failures. Model: Qwen3-4B-Instruct (Apache-2.0, registered). Metrics: per-field agreement with adjudicated labels versus rules, unsupported-value rate (must be 0 by construction), latency. Fine-tune only after shadow shows a ceiling and thousands of verified labels exist (the cited work used 15,500). Reproducibility: model digest, runtime version, threads, seed, cached outputs; repeat-run identity measured (`bench/README.md` found 1 of 16 differing answers on an untaught 8B at temperature 0).

### E4. Evidence retrieval (component E)
* Learns: ranking sentences that may support a requirement. Why: only if the lexical baseline's recall@10 is below the gate on labelled units. Data: reviewed positive and negative pairs plus hard negatives. Checkpoint: `multilingual-e5-small` (MIT). Loss: labelled-pair loss or `GISTEmbedLoss` with a guide model (section 6.3). Hyperparameters: learning rate, epochs, margin; chosen on validation recall@k. Hardware: one GPU or several CPU hours [estimate]. Promotion: recall improves, nothing scored from similarity; rollback: previous embedding version stays.

### E5. Requirement-evidence classifier with abstention (component F)
* Learns: the five-way label for one requirement and one passage. Why: only if rules plus retrieval leave measurable missed evidence or false labels. Data: 2,000 to 3,000 adjudicated units [estimate] across confusable sets. Checkpoint: `bge-reranker-v2-m3` base (Apache-2.0). Loss: multi-class cross-entropy (or binary cross-entropy for supported/not). Hyperparameters: learning rate, epochs, class weights, abstention thresholds; chosen on validation to hold the false-supported rate under the gate. Promotion: section 8.3 with the false-supported gate first; it feeds labels to the deterministic scorer only; rollback: rules only.

**If the data for an experiment does not exist, it is not run.** Until real consented documents and adjudicated labels exist, the work is annotation, baselines, rule fixes and pretrained comparisons in shadow.
