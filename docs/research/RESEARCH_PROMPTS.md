# Research prompts for Gemini (Deep Research) and Codex

Paste the **shared context** first, then the prompt for the tool. Both tools start with no knowledge of RoleMatch. Ask them to return findings in the format at the bottom, and bring the answers back so they can be checked against [`FIELD_RESEARCH_REPORT.md`](FIELD_RESEARCH_REPORT.md) (do not accept a claim that has no source).

---

## Shared context (paste first)

I am building RoleMatch, a multi-tenant recruitment platform for South African organisations. Recruiters upload CVs (PDF, Word, scans, phone photos) and job descriptions. The platform extracts a structured candidate record (name, contact, summary, skills, work history, education and certifications with completed or not completed, projects), shows the original CV, and helps a recruiter compare candidates with jobs. It recommends for human review and never decides, rejects or shortlists on its own.

Hard rules for any recommendation:
1. **No external or paid AI API, and no API key.** Models must run on our own infrastructure. Open weights with a permissive licence only (Apache-2.0, MIT, BSD, similar). Say clearly if a licence has extra terms (revenue limits, attribution, field-of-use limits).
2. **No licence fees, no per-document vendor fee.** No AGPL or other copyleft that would force us to publish our server code.
3. **Candidate data never leaves our servers.** South Africa, POPIA applies.
4. **Deterministic and auditable.** The same document must give the same output. Every extracted value must be backed by text that really appears in the document (a quote or a pointer to its position). We never invent facts. Output is versioned and frozen against a test set.
5. Backend is TypeScript on Node.js 24 (not Python, not Bun). A separate Python or other worker service is acceptable if there is a strong reason.
6. Nothing an organisation might want different is hard-coded: it must be a per-organisation setting.

Current state, honestly: a rule-based parser reads native PDF text by position (columns, headers, tables), reads Word, RTF, ODT, TXT, and OCR (Tesseract in WASM with image clean-up) for scans and photos. On our own generated test CVs (not real ones), results are roughly: Word 83% of CVs fully correct, normal PDFs about 60%, scans and photos 5 to 10% fully correct, with a typical (median) character error of 7 to 9% on scans and a long tail of badly read files. Pale-text scans were fixed recently. We have no real CVs yet. We already have: hidden-text detection and exclusion in PDFs, per-page time limits, a format registry, frozen test outputs.

Things we have already researched, so do not just repeat them: hidden prompt injection in CVs (about 1% of 196,682 real resumes, arXiv 2605.28999; ResumeShield arXiv 2609.20188), TeleOCR and OmniDocBench scores, PaddleOCR-VL, PP-OCRv5, Alibaba's layout-aware resume parser (arXiv 2510.09722), nondeterminism at temperature 0 (Thinking Machines), POPIA sections 14, 26, 27, 71, 72, EU AI Act Annex III delay, Tesseract language data (no isiZulu or isiXhosa in tessdata_best).

Evidence standard: cite a primary source (paper, model card, statute, official docs, repository) for every claim, with a link. Mark each finding **verified** (read in the primary source), **secondary** (reported by an article), or **unverified**. If you cannot find something, say so instead of guessing. Prefer 2025 to 2026 sources. Report numbers exactly with their units and what dataset they come from. Flag anything that comes from a vendor's own benchmark.

---

## Prompt for Gemini (Deep Research)

Using the shared context, research the following and return a sourced report. Be thorough; breadth and primary sources matter more than polish.

**A. Local OCR and document models for photographed and scanned CVs.** Which open-weight, permissively licensed models or libraries are best for reading phone photos and scans of CVs on our own hardware? Compare at least: Tesseract (current), PP-OCRv5 / PaddleOCR (including ONNX use from Node), PaddleOCR-VL, DocTR, Surya, Docling and Granite-Docling, GOT-OCR, olmOCR, dots.ocr, MinerU components, and any strong 2026 entrant. For each: licence and its exact extra terms, size, CPU-only versus GPU needs and typical speed per page, accuracy on camera-captured or degraded documents (not only clean ones), tables and multi-column layout, handwriting, South African languages (Afrikaans, isiZulu, isiXhosa, Sesotho, Setswana: is there any model, fine-tune or dataset?), and how well it works from Node.js. Give a ranked recommendation for (1) CPU-only server, (2) one GPU server.

**B. Layout understanding for CVs specifically.** What methods give correct reading order for multi-column, sidebar and table-based CVs? Cover layout detection models and datasets for resumes, whether published resume layout datasets exist (with licences), and how much labelled data is needed to fine-tune a small layout model. Include practical heuristics used by production parsers.

**C. Using a small local language model to structure CV text safely.** Which open small models (0.5B to 14B) are best at CV information extraction when run locally (llama.cpp, Ollama, vLLM, ONNX), including quantisation effects? How do grounded or pointer-based extraction methods work, and which libraries support them (LangExtract and alternatives)? What is known about reproducibility of llama.cpp and Ollama output at temperature 0 on the same hardware, across versions, and with different thread counts? How to detect and prevent hallucinated values. What accuracy is reported for fine-tuned small models on resume extraction, and how many labelled CVs were needed. Include any public resume datasets with a permissive licence and their quality problems.

**D. Prompt injection and manipulation of AI screening.** Defences that work when a model reads a CV: fencing, instruction hierarchy, rendering-versus-text comparison (for example PhantomLint), hidden text in Word (.docx) and PDF, zero-width and bidirectional characters, off-page text, metadata and comments. Which attacks are documented in the wild in 2026? Give a checklist of concealment techniques per file format.

**E. Evaluation method.** How do serious resume-parsing evaluations score extraction (field-level F1, strict versus fuzzy matching, handling of lists such as skills and roles, date and name alignment)? Which public benchmarks exist? How many real CVs and how many annotators are needed for a defensible accuracy claim, and how to measure inter-annotator agreement? How to build a representative test set for South African CVs (formats, languages, layouts, qualifications such as matric, NQF levels, SAQA).

**F. South African law and regulation, practical.** POPIA obligations specific to CV parsing and recruitment platforms: processor versus responsible party, section 71 wording and human review, retention defaults for unsuccessful applicants, consent and the purpose notice for uploaded CVs, special personal information (race, health, criminal record, biometric) in CVs and photos, cross-border transfers, data subject access and correction rights, operator agreements. Employment Equity Act: how designated employers collect applicant race, gender and disability data and whether it should come from CVs or from a separate self-declaration. Any Information Regulator guidance or enforcement notices on recruitment or automated screening. Say clearly where only a lawyer can decide.

**G. Anything we are not thinking about.** List the top 15 failure modes, risks and blind spots that experienced builders of CV and document parsers report, which are not covered above (for example: duplicate candidates, CVs in several languages, tracked changes in Word, embedded images of text, password-protected files, huge files, malicious files, timeouts, candidates who send a portfolio instead of a CV).

---

## Prompt for Codex (works on a copy of the repository)

You have access to the RoleMatch repository (`server/` is the TypeScript backend; the parser is `server/src/{parse,layout,rules,ocr,imageprep,inspect,tiff}.ts`; tests and the stress harness are in `server/test/`). Read `CLAUDE.md`, [`EXTRACTION_CONTRACT.md`](../parser/EXTRACTION_CONTRACT.md), [`AI_EXTRACTION_DECISION.md`](../parser/AI_EXTRACTION_DECISION.md), [`PARSER_BUILD_PLAN.md`](../parser/PARSER_BUILD_PLAN.md) and [`FIELD_RESEARCH_REPORT.md`](FIELD_RESEARCH_REPORT.md) first. Do not change reader behaviour on the main branch: work in a branch and keep each change small, tested and measured. Use the shared context above.

1. **Reproduce and report baselines.** Run `npm run stress -- --n 150 --variants pdf,docx,scan,photo` and `npm run stress:headings` and record the numbers. Report what you could not run.
2. **Find bugs by reading the code.** Review `src/inspect.ts`, `src/layout.ts`, `src/rules.ts`, `src/imageprep.ts`, `src/tiff.ts` for correctness problems, unsafe handling of untrusted files (memory, time, path, decompression), and non-determinism. Give file and line for each, a failing test that proves it, and a proposed fix. Rank by severity.
3. **Close two known gaps with tests first.** (a) White, tiny, vanish (`w:vanish`) and off-page text in `.docx`, `.odt` and `.rtf` must be excluded from the extracted text and reported, like the PDF case in `inspect.ts`. (b) Zero-width and bidirectional control characters (U+200B to U+200F, U+2060, U+FEFF, U+202A to U+202E, U+2066 to U+2069) must be removed or normalised everywhere text enters the parser, with tests that "Type​Script" yields the skill "TypeScript".
4. **OCR experiment.** Add a second OCR engine behind the existing `OcrEngine` interface in `src/ocr.ts` using PP-OCRv5 through ONNX Runtime in Node (or the best permissive alternative you can justify). Measure with `npm run stress:ocrtune -- scan` and the photo variant. Report character error rate by colour theme against Tesseract, speed per page on CPU, memory, installed size, and licences of every model file. Keep it only if it clearly beats Tesseract.
5. **Quality gate analysis.** From the scan and photo stress runs, test whether OCR engine confidence and a word-plausibility score predict the character error rate (correlation, and precision and recall of a threshold that separates "read well", "uncertain" and "unreadable"). Report the thresholds and the evidence.
6. **Metamorphic tests.** Add tests that must hold for any input: re-wrapping lines, adding page furniture, changing line endings, duplicating a page, reordering sections must not change the extracted record (or must change it only in documented ways).
7. **Report.** For every change: what, why, measured before and after (with the number of CVs), risk, and what is not done. Do not claim improvements without numbers. Do not commit secrets, real CVs or `data/`.

---

## What each tool should return (paste at the end of either prompt)

1. A one-page summary: the five most important findings and the five most important unknowns.
2. A table: finding, how solid (verified, secondary, unverified), source link, what it means for RoleMatch, suggested next step, effort (S, M, L).
3. A section "Things that contradict what we believed".
4. A section "Could not confirm".
5. No code or advice that breaks the hard rules above. If the best answer breaks a rule, say so and give the best answer that does not.
