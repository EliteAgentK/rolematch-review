# The AI phase: which models, for what, and in what order (plan, 2026-10-22)

Status: a plan. Nothing in it runs in the live platform yet. It builds on [`ML_ARCHITECTURE.md`](ML_ARCHITECTURE.md) (worker contract, settings, promotion gate) and the owner rules: local models only, permissive licences, no outside AI service or key, measure before adopting, and **the platform recommends, a person decides**.

## 0. Licensing rule (owner, 2026-10-22): nothing paid

No paid licences, subscriptions, per-use fees or paid tiers, ever. Every model, library and data source must be free to use commercially at any scale under a permissive licence (Apache-2.0, MIT, BSD, or an open-data licence that asks only for attribution, such as CC BY 4.0). Hugging Face is used only as a free download source: its paid "Inference Providers" (Groq, Together, Fireworks and the others on its site) and paid plans are not used, because they would also send data off our servers. A model whose licence restricts commercial use, caps users or revenue, or asks for payment above a threshold is rejected. Every choice in this plan meets this rule; the only cost is our own hardware.

## 1. The shape: agents work only through our tools

**Agents propose, tools verify, the matching engine decides, a person approves.** Each agent is a narrow job for a model with a fixed set of tools; the conductor is ordinary code, not a model. The same structure serves both halves of the platform: reading CVs and job descriptions, and matching.

| Agent | Job | Tools it may call | Side |
|---|---|---|---|
| Reader | Fill fields the rules left empty; a second reading to compare | document text, quote check, vocabulary lookup | CVs and jobs |
| Job reader | Split a job into requirements; read what each accepts (completed or studying, equivalents, "or", years) | the same | Jobs → matching |
| Normaliser | Map a phrase ("K8s", "BCom", "Snr Dev") to one ID in our vocabulary | embedding search, reranker, cache | Both sides, so matching compares like with like |
| Evidence finder | Find CV sentences that may support a requirement; judge them | text search, reranker, quote check | Matching |
| Explainer | Plain-language summary after the numbers | the stored match result, read only | Matching |
| Reviewer | Check the others against the rules | the checkers, no writing | Both |

Every value an agent returns must have a quote that is in the document, an ID that is in the vocabulary, and pass the answer guards (`modelGuards.ts`). Otherwise it is refused and the rule-based result stands. Every call is logged (model, file hash, tools used, kept or refused). Each agent has a per-organisation switch: `off`, `shadow` (runs and logs, changes nothing) or `on`. Readers of CVs have read-only tools only, because a CV can carry hidden instructions aimed at a model.

## 2. Prefer models that cannot invent text

A generative model (an LLM) writes words, so it can write words that are not in the document. An **extractive** model only points at spans of the input, so whatever it returns is already in the document. For reading CVs and job descriptions, extractive models come first and LLMs only where understanding is needed (what a requirement accepts, whether a sentence shows real use). Scores, rankers and classifiers return numbers or labels, not text, so they cannot invent evidence either.

## 3. The shortlist (licences and sizes from the Hugging Face API on 2026-10-22)

Licences are what each repository declares. Each model card and licence file is read in full before a model is fetched, and the licence, file hash and source go into the model registry. Sizes are parameters.

| Role | First choice | Alternatives | Why |
|---|---|---|---|
| **Extractive reading** (names, employers, titles, dates, qualifications, skills as spans). **Removed 2026-10-27** (owner's decision): the local language model's reading, checked against the text, takes this job; GLiNER's package was old and needed security workarounds. | `fastino/gliner2-base-v1`, Apache-2.0, 0.21B | `urchade/gliner_multi-v2.1` (Apache-2.0, 0.29B, multilingual) | Zero-shot entity and structure extraction that returns spans only. Runs in Node through the `gliner` package (MIT) on ONNX Runtime. A strong second reader beside the rules. |
| **Skill spans** | `jjzha/escoxlmr_skill_extraction`, Apache-2.0, 0.56B | | Trained to mark skill and knowledge phrases (ESCO-aligned, multilingual XLM-R). Extractive. |
| **Embeddings** (normaliser, evidence search) | `intfloat/multilingual-e5-small`, MIT, 0.12B (ONNX port exists) | `BAAI/bge-m3` (MIT, multilingual, ONNX port), `Qwen/Qwen3-Embedding-0.6B` (Apache-2.0), `google/embeddinggemma-2` (Apache-2.0, 0.74B) | Start small and fast; move up only if measurement says so. Multilingual matters for Afrikaans and other South African languages. |
| **Job titles** | `TechWolf/JobBERT-v3`, MIT, 0.28B | `TechWolf/JobBERT-v2` (MIT) | Built for job-title similarity: maps "Snr Dev" and "Senior Software Engineer" close together, for level and title context. |
| **Reranker** (does this sentence support this requirement?) | `BAAI/bge-reranker-v2-m3`, Apache-2.0, 0.57B | `Qwen/Qwen3-Reranker-0.6B` (Apache-2.0), `mixedbread-ai/mxbai-rerank-base-v2` (Apache-2.0) | Returns a relevance score, not text. Used to rank candidate evidence for a person, and to choose among vocabulary IDs. |
| **Zero-shot classification** (section types, requirement types) | `MoritzLaurer/mDeBERTa-v3-base-xnli-multilingual-nli-2mil7`, MIT, 0.28B | `MoritzLaurer/ModernBERT-large-zeroshot-v2.0` (Apache-2.0) | Labels without training data, multilingual. |
| **Language model** (job reader, judgement, explanation; tool calling) | `Qwen/Qwen3-4B-Instruct-2507`, Apache-2.0, 4B | `Qwen3-8B` (installed), `microsoft/Phi-4-mini-instruct` (MIT, 3.8B), `ibm-granite/granite-4.0-micro` (Apache-2.0, 3.4B), `HuggingFaceTB/SmolLM3-3B` (Apache-2.0) | Small enough for one modest server; several origins, for buyers with procurement rules. |
| **Turned pages** (classic ML) | `PaddlePaddle/PP-LCNet_x1_0_doc_ori`, Apache-2.0 | | Detects 0, 90, 180, 270 degrees. Our own measurement: a sideways page has 77 to 81% character error against 26% upright, so this is the quickest certain win. |
| **Layout and tables** | `docling-project/docling-layout-heron`, Apache-2.0, 0.04B | `PaddlePaddle/PP-DocLayout_plus-L` (Apache-2.0), `microsoft/table-transformer-*` (MIT) | Finds headings, columns, tables in scans; helps the column logic. |
| **OCR, later** | PaddleOCR (trial engine built) | `PaddleOCR-VL` (Apache-2.0), `zai-org/GLM-OCR` (MIT), `deepseek-ai/DeepSeek-OCR` (MIT), `numind/NuExtract-2.0-2B` (MIT, reads images to structured data) | Vision models only with a second reader, because they can write fluent text that is not on the page. |

**Runtimes, all inside our own infrastructure.** Small models run in the Node server itself through `@huggingface/transformers` (Apache-2.0, ONNX) and `gliner` (MIT); `onnxruntime-node` (MIT) is already a dependency. Language models run in Ollama (MIT) on the same machine or a model server on our network, reachable only by the API. No model calls out to the internet.

## 4. What we will not use, and why

* **CV-specific and "job matching" fine-tunes on Hugging Face** (for example resume parsers and resume-job matchers with a few hundred downloads). Unknown training data (often scraped CV collections), no evaluation we can check, and a matcher trained on past hiring decisions learns whatever bias those decisions held. The scoring stays our own, documented maths.
* **Non-permissive licences**: `jinaai/jina-reranker-v2-base-multilingual` (CC BY-NC: no commercial use), `mistralai/Ministral-8B-Instruct-2410` (Mistral research licence), `google/embeddinggemma-300m` (Gemma terms), Marker (GPL code, restricted weights).
* **Community ONNX ports without a licence tag** (several `onnx-community/*` and `Xenova/*` copies): usable only after confirming they carry the original's licence; otherwise we convert the original ourselves.
* **Very large models** (hundreds of billions of parameters): no need for a few pages of text, and the hardware cost is out of proportion.

## 5. The vocabulary all of this rests on

Both sides need the same canonical vocabulary, or the matching compares different things. Candidate sources, each to be checked for licence and attribution before import:
* **ESCO** (European Skills, Competences, Qualifications and Occupations): about 13,900 skills and 3,000 occupations with synonyms in many languages, published by the European Commission for reuse.
* **O\*NET** (United States occupations and skills, published under CC BY 4.0 by the US Department of Labor).
* **OFO** (South Africa's Organising Framework for Occupations) and **SAQA's NQF levels**, for local occupations and qualifications.
Our 199-skill dictionary becomes the first slice, mapped to these IDs, versioned and fingerprinted like the rules.

## 6. Order of work

1. **Tool layer and conductor** (no model needed): vocabulary with stable IDs and a cache; a local model client that can reach only this machine and only listed tools; the agent log; the per-organisation switches.
2. **Consistency harness for both sides**: CV side (field agreement with the rules and with frozen outputs; the same CV as PDF, Word and two columns gives the same record; the same file read ten times gives the same result), job side (agreement with hand labels on the sample job descriptions), matching side (model-assisted evidence levels against rules-only for every pair; every invariance and determinism test still passes).
3. **Turned-page classifier** in shadow (quick, measured win on scans).
4. **Normaliser** (embedding + reranker + vocabulary) on both CVs and jobs, in shadow.
5. ~~**Extractive second reader** (GLiNER2) on CVs and jobs, in shadow.~~ Removed 2026-10-27; see above.
6. **Job reader** (language model with tools): requirement semantics, so the degree question is answered from the job's own words and approved by a recruiter.
7. **Evidence finder** for requirements the dictionary cannot check, shown as possible evidence for a person.
8. **Explainer**, after the numbers.
9. **Learning from recruiters**, once labelled real data exists: fit only the few stated credits in the rules (for example the half credit for a named skill), never a black-box ranker.

A step goes from `shadow` to `on` for an organisation only through the promotion gate in `ML_ARCHITECTURE.md`: no worse than the rules on every field it touches, better overall, no value without a matching quote, repeatable on the production hardware, licence recorded, rollback ready.

## 7. Hardware

The small models (under 1B) run on an ordinary CPU server. A 4B to 8B language model runs on this 16 GB Mac for testing; a real organisation's batch uploads need a server, ideally with one GPU. Owner's decision.

## 8. Downloads needed (owner's approval, each confirmed by file, source and size first)

Approximate (GLiNER2 no longer needed): multilingual-e5-small about 0.5 GB (or about 0.12 GB quantised); bge-reranker-v2-m3 about 2.3 GB; JobBERT-v3 about 1.1 GB; PP-LCNet orientation a few MB; Qwen3-4B-Instruct about 2.5 GB through Ollama. Plus `@huggingface/transformers` and `gliner` from npm.

## 9. First measurements in shadow (2026-10-23, `npm run ai:harness`)

Built: the tool layer (`server/src/ai/`: shared vocabulary with stable IDs and canonicalisation, a model client that refuses any address but this machine, the ONNX model wrappers, the agent log) and three agents (job reader, evidence finder, extractive reader), each checked before anything is kept. Data: the 19 invented sample CVs (including scans) and 10 job descriptions, every CV against every job (190 pairs). Nothing changes a record or a score; the full report is written to `server/data/ai-harness/report.md` (git-ignored, it quotes CV text).

| Side | Agent | Result | What it means |
|---|---|---|---|
| CV | Extractive reader (GLiNER, since removed) | Agrees with the rules on names 100%, employers 99%, job titles 83%, qualifications 57%. Identical spans on a repeat run, and identical spans for the same CV in five file formats (docx, doc, odt, rtf, txt) and in PDF and Word. Every span is the document's own words (checked). | A good second reader for names, employers and titles; weak on qualifications. The employers only it saw were mostly wrong ("AWS", "Google Ads", "HR Generalist"), so it may confirm or question the rules, never add on its own. Two fixes were needed to get here: reading line by line (whole blocks made the result depend on the file format) with the previous line as context (lines alone dropped titles to 3%). |
| Job | Job reader (Qwen3 4B and 8B) | 8 qualification requirements in the samples plus 8 hand-labelled ones. Both models: 0 refused, quotes always genuine, 100% identical on a second run, "equivalent accepted" right 7 of 8. Completion right: 8B 5 of 8, 4B 2 of 8. About 2 to 4 s a requirement on this Mac while other models were loaded. | Not better than the rules on this set yet. Most disagreements are one policy question: does "a BCom Accounting degree" (no word about completion) mean a completed degree? The models say yes; the labels said "not specified". The rules scoring 8 of 8 means little: the same person wrote the rules and the labels. This needs the owner's policy and recruiter-labelled requirements. |
| Matching | Evidence finder (embeddings + reranker, aliases canonicalised) | Where the engine said "verified", the finder's best sentence scored 0.5 or more in 24% of 37 requirements. Where the engine said "not demonstrated", it pointed at a sentence scoring 0.5 or more in 1 of 833 requirements, and that one is genuine (a graduate's "year and a half of experience in a platform team" against a four-year requirement). Reversing the sentence order or replacing the candidate's name changed nothing. About 0.2 s a requirement. | The cut-off of 0.5 is not calibrated (scores for skill-list requirements run low), so the finder is a ranking aid for a person, not a judge. Headings ("Work experience", "Werkservaring") were wrongly scored as evidence until they were left out of the search; that removed 15 false leads. The sample CVs were written alongside the dictionary, so few gaps are expected here; real CVs are the real test. |

**The reranker's low score, explained.** The model card's own example scores 0.995 (matching the published value), so the model and its 8-bit file work. It did not know the abbreviation: "Managed production K8s clusters" scored 0.004 against "Kubernetes administration", the same sentence with "Kubernetes" 0.58. Text is now canonicalised through our vocabulary before any model compares it; quotes still come from the original.

**Next, in order.** (1) The owner's policy on a qualification named without a word about completion, and 30 to 50 requirements labelled by a recruiter. (2) Calibrate the evidence finder's cut-off from labelled pairs instead of choosing a number. (3) The normaliser: embedding search over the vocabulary for phrases the dictionary does not know, both sides. (4) Real, consented CVs: until then every number above is on invented documents.

## 10. The capability graph's first slice and the teaching loop (2026-10-23)

Built (see `CAPABILITY_GRAPH.md`): knowledge areas with depths, qualification levels and lengths, draft knowledge profiles for common South African qualifications (for review), the ladder of completion tells, the job side of a qualification requirement, and graded credit (completion x level x knowledge coverage, the best qualification only) with reasons and a recruiter's checks on every verdict. Deterministic and tested (12 tests), including the owner's example: actuarial degree > BCom with statistics majors > general BCom. A harness run caught one recruiter-level mistake (a nursing diploma "meeting" an electrician's trade test) and it was fixed: a named credential is matched as that credential.

**Teaching loop.** `server/teaching/` holds labelled examples per agent, each either *teach* (shown to the agent with each question; later the fine-tuning set) or *test* (only for grading), never both. Every harness run is appended to `server/data/ai-harness/history.jsonl`. Measured on the test examples only (8 per agent, labelled by the assistant, so a signal, not proof):

| Agent | Model | Untaught | Taught |
|---|---|---|---|
| Job reader (completion) | Qwen3-4B | 2/8 | 7/8 |
| Job reader (completion) | Qwen3-8B | 5/8 | 8/8 |
| Meaning reader (recall / precision) | Qwen3-4B | 60% / 100% | 80% / 100% |
| Meaning reader (recall / precision) | Qwen3-8B | 80% / 85% | 90% / 83% |

Every answer was identical on a repeat run; no quote failed its check.

**The loop working, and its limits.** Reading real sample CVs, the meaning reader over-reached twice: "Built a booking platform used by 200 hotels" as hospitality knowledge, and "mentored two junior developers" as HR. Two lessons (examples) and two stated principles fixed the mentoring case; the hotels case persisted on the 8B and 4B models and was right on Qwen3-14B, which in turn missed statistics in the insurance-pricing sentence and is 5 to 15 times slower on this Mac. Next options for that error: a reviewer pass that asks, for each claimed area, whether the sentence shows the person doing work in it or only who the work was for; more lessons; and fine-tuning once the teaching set reaches a few hundred examples per agent.
