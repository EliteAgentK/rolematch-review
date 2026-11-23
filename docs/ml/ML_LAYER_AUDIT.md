# The local model layer: what actually exists (audit, 2026-10-28)

Traced from code, not from plans. A dependency, an interface or a model file on disk is not working integration.

Reader work (OCR and parser) is **paused** for this task.

* The parser stays at 2.9.0.
* E2 and E3 stay off.
* E4 exists only as a proposal, in [`../assessment/batches/visual60-b1/DECISION_PACKAGE.md`](../assessment/batches/visual60-b1/DECISION_PACKAGE.md) under "Next targeted experiment". No E4 code was written.

## 1. What runs in the application

| Function | What does it | Learned model involved? |
|---|---|---|
| Document reading | `parse.ts` (native text), `ocr.ts`: tesseract.js 7.0.0 LSTM recognition (Apache-2.0) | **yes: Tesseract's pretrained LSTM**, the only learned model in the live path. PaddleOCR (`paddleOcr.ts`, `@gutenye/ocr-node`, MIT) is wired as an optional engine (`OCR_ENGINE=paddle`), **not the default** |
| CV and job extraction | `rules.ts`, called by `extract.ts`, which always records `method: "rules"` | no |
| Matching and evidence assessment | `match.ts` and `scoring.ts` (rules 2.2.0); offline, `src/assessment/` (Formula A, inactive) | no |
| Learning from uploads | none. Recruiter corrections write unverified rows to the organisation's error register (migration 015); nothing trains on them | no |

**RoleMatch does not learn from uploads.** No training job, no model release path and no promotion mechanism exist.

## 2. What exists outside the application path (experimental, shadow only)

**Ollama** 0.35.1 (MIT) on 127.0.0.1. `src/ai/localModel.ts` refuses any non-loopback address, asks for schema-constrained JSON at temperature 0 with a fixed seed, and passes answers through `modelGuards.ts`. Installed models:

| Model | Licence | Size | Status |
|---|---|---|---|
| `qwen3:4b-instruct-2507-q4_K_M` | Apache-2.0 (`ollama show --license`) | 2.5 GB | smoke-tested |
| `qwen3:8b` | Apache-2.0 | 5.2 GB | smoke-tested |

**ONNX models** (`src/ai/onnx.ts`, through `@huggingface/transformers` 4.x, Apache-2.0, on `onnxruntime-node`, MIT), loaded only from `server/data/models` with remote loading off:

| Model | Licence | Size | Status |
|---|---|---|---|
| `intfloat/multilingual-e5-small` (embeddings) | MIT | 470 MB | smoke-tested |
| `bge-reranker-v2-m3` ONNX, quantised (reranker) | Apache-2.0 | 571 MB | smoke-tested |

**Agents** (`src/ai/agents/`):

* **job reader:** a language model reads a degree requirement's completion and "equivalent" wording;
* **evidence finder:** embeddings plus the reranker rank a CV's sentences against a requirement, as suggestions only;
* **meaning reader:** embeddings shortlist knowledge areas, and the language model picks which ones a sentence shows.

**Nothing in `server/src/` outside `src/ai/` imports these agents.** They run only from `npm run ai:harness` (`test/ai/harness.ts`), `test/extensive/eval.ts` and the document factory (`test/factory/write.ts`, which uses the language model to write invented CVs).

**Teaching store** (`server/teaching/`):

* 18 job-reader and 22 meaning-reader examples, split into "teach" and "test";
* **labelled by the assistant**, so they are proposals, not independent ground truth;
* they are used as in-context examples; nothing has been fine-tuned.

**Merely planned:**

* GLiNER: named in the harness header and in planning documents; no code and no model file;
* JobBERT-v3, the ESCO skill extractor and the Paddle document-orientation model: listed under `not_yet_fetched`;
* any fine-tuning, training dataset, training script, model registry promotion gate or release mechanism.

**Licence gaps:**

* the registry `ml-models.json` omits the Tesseract and PaddleOCR models in use (error register R9);
* `sharp` brings `libvips` (LGPL-3.0, dynamically linked) in development dependencies.

## 3. Hardware available for local inference

Apple M5, 16 GB unified memory, macOS. Ollama runs on Metal. A 4B model at 4-bit fits comfortably beside the server. The 8B model fits, but leaves little memory for parallel work. There is no discrete GPU, so fine-tuning larger than a small LoRA on the 4B model is not practical on this machine (section 4 of [`EVIDENCE_ASSESSMENT_EXPERIMENT.md`](EVIDENCE_ASSESSMENT_EXPERIMENT.md)).

## 4. Is requirement-to-evidence assessment the right first capability?

**Yes**, with one prerequisite added first.

* **Why this capability.** It is the step the specification already reserves for a model (assessment under an approved rubric, validated, then points by tested code). Errors there are consequential: they move candidates across the review cut-off. And the batch showed the rules assessor's limits: credit for duty lines that only name a skill, title-word relevance, and no negation handling (R1, R2).
* **The missing prerequisite** is a fixed contract around it:
  * evidence **passages with stable source identifiers**, built from the canonical record;
  * a **written rubric**;
  * a **validator** that checks every model claim against the passages before a state counts.

  Without these, the model's output cannot be checked or compared. They are built in this task (`server/src/assessment/evidence/`).
* **What the model judges, and what code does.** The model judges one leaf at a time, for example whether the passages show SQL in use. It does not combine leaves (the normal form does that), compute months (code does that from dates), or produce scores (Formula A does that).
