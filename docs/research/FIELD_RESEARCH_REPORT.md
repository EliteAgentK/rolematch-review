# Field research report: what a parser and OCR for CVs must get right

Researched 2026-10-22 from primary sources where possible (papers, statute text, model cards), otherwise secondary sources. Each finding says how solid it is: **[verified]** read in the primary source, **[secondary]** reported by an article or blog, **[our test]** measured on our own code, **[unverified]** could not confirm. Nothing here is legal advice.

## 1. Security: the biggest thing we had not thought about

**1.1 Hidden instructions in CVs are real, common and rising. [verified]**
* Zhang et al. (UNC, Duke, hireEZ, Berkeley), arXiv 2605.28999, May 2026: about **200,000 real resumes** (196,682) from hireEZ. **About 1% contain hidden prompt injections**; prevalence **rose noticeably over the past one to two years**; **more than 90% of injected prompts do not use explicit instructions** (they look like lists of keywords and skills, not "ignore previous instructions"). Source: https://arxiv.org/pdf/2605.28999
* Consequence: a filter that looks for instruction-like wording misses most of them. Detecting the *delivery method* (text a person cannot see) catches them. That is what our 2.1.0 hidden-text exclusion does for PDFs.

**1.2 What stops them when a model reads CVs. [verified, one paper, synthetic data]**
* ResumeShield (Barach), arXiv 2609.20188, Apache 2.0: nine concealment techniques (white text, zero font size, off-canvas text, markup comments, document metadata, **zero-width characters**, and others). On a 104-document synthetic benchmark the undefended pipeline was manipulated in every injected case; a defence that **fences candidate text in a data channel the trusted instructions declare inert** removed all measured attacks. The same filtering stack **without** the fence still let 16.7% of attacks through. Detector precision 1.000, recall 0.944. Source: https://arxiv.org/pdf/2609.20188
* Caveat: synthetic data, a single independent author, small corpus.

**1.3 Two verified gaps in OUR code. [our test]**
* **Word files:** white text and tiny text in a .docx **are extracted into the CV text** (only text hidden with display:none was dropped). Our hidden-text check covers PDFs only.
* **Zero-width characters are not removed:** "Type​Script" stays as written, so a skill is neither matched nor safe. This is also an injection and obfuscation channel.

**1.3a Effectiveness is disputed. [secondary]** A 2026 study found injection can move rankings when few applicants use it and weakens as more do; recruiters argue a human still sees the CV. Duke news summary: https://pratt.duke.edu/news/thwarting-prompt-injection/

**1.4 The PDF reader itself is attack surface. [verified]** CVE-2024-4367 (PDF.js arbitrary JavaScript through font handling, fixed in pdfjs-dist 4.2.67). Our installed PDF.js is **6.4.299**, well past the fix. We do not use the eval-supporting browser path. Advisory: https://github.com/advisories/GHSA-wgrm-67xf-hhpq

## 2. OCR and document models (local, open)

**2.1 Leaderboards disagree and are self-reported. [secondary]** OmniDocBench v1.6 roundups put small open models at the top: PaddleOCR-VL-1.6 (0.9B, Apache-2.0) 96.34, MinerU2.5-Pro (1.2B, Apache-2.0 with extra terms) 95.75, GLM-OCR (0.9B, MIT) 95.22; one roundup adds TeleOCR at 96.91. dots.ocr (3B, MIT with additional terms) is lower on the newer benchmark. Sources: https://roboflow.com/blog/best-open-source-ocr-models and https://www.docsumo.com/blog/best-ocr-models

**2.2 Camera-captured pages score much lower than clean ones, even for the best model. [verified, abstract]** TeleOCR (arXiv 2608.12898) reports 96.87 on OmniDocBench v1.6 but **88.53 on Wild-OmniDocBench and 78.41 on PureDocBench**. Expect phone photos of CVs to be the hard case for any engine, including ours. Source: https://arxiv.org/abs/2608.12898

**2.3 PaddleOCR-VL details. [verified, model card]** Licence **Apache-2.0**; 109 languages; CPU supported by the transformers script (the PaddleX docs say the full pipeline does not support CPU, sources conflict); quantised builds exist for llama.cpp and Ollama; no memory requirement published. Source: https://huggingface.co/PaddlePaddle/PaddleOCR-VL

**2.4 A lighter option: PP-OCRv5 on ONNX. [secondary, self-reported]** Runs in Node through ONNX Runtime. One developer's test of worn print: **5.4% character error (PP-OCRv5 mobile) against 12.3% (Tesseract)** on four hand-transcribed pages; the library author claims Tesseract.js trails by 5 to 15 points on receipts. Not independent; not phone photos. Tesseract's known weak spot: curved text and perspective. Sources: https://github.com/stubbedev/dijo/issues/207 and https://dev.to/awalariansyah/deterministic-ocr-in-javascript-paddleocr-for-node-bun-deno-and-the-browser-2bgn

**2.5 Language coverage for South Africa. [verified, repository listing]** Tesseract's best-quality models (`tessdata_best`) include **Afrikaans (afr) and English; there is no isiZulu, isiXhosa, Sesotho or Setswana model**. Names and words in those languages are Latin script, so English models still read the letters, but there is no language-specific correction. Source: https://github.com/tesseract-ocr/tessdata_best

**2.6 Reading text from the file beats OCR when both exist. [verified]** In the Alibaba resume-parsing paper's ablation, removing the fusion of PDF text with OCR text dropped long-field accuracy from 0.858 to 0.743 (over 10 points). That matches our native-text-first rule.

## 3. Language models for structuring

**3.1 A production-style recipe exists and is published. [verified]** Zhu et al. (Alibaba), arXiv 2510.09722, Oct 2025: (1) fine-tuned layout segmentation (YOLOv10, about 500 annotated resumes), (2) hierarchical reordering, (3) the model outputs **index pointers to lines of the source text, and the text is then re-extracted verbatim from the document**, which removes paraphrase and hallucination, (4) a small model. Results on **100 real resumes** (private test set): fine-tuned **Qwen3-0.6B F1 0.964** vs the untuned same model 0.641, Claude-4 inside their pipeline 0.959, Claude-4 reading OCR text with no layout step 0.919, a commercial parser 0.817. 1.54 s per resume. Training used **15,500 labelled resumes**. Source: https://arxiv.org/abs/2510.09722
* Take-aways for us: the pointer/re-extraction idea is exactly our evidence rule; layout and reading order matter more than model size (naive LLM 0.919 vs layout-aware 0.959); a small fine-tuned model can beat a big one but **needs thousands of labelled CVs we do not have**; their test set is only 100 and private.
* The same paper states there is **no public resume dataset for evaluation**.

**3.2 Temperature 0 is not deterministic by itself. [verified]** Thinking Machines (Sept 2025): 1,000 runs of one prompt at temperature 0 on a 235B model gave **80 different completions**; cause is kernels whose arithmetic order depends on batch size (server load). With batch-invariant kernels all 1,000 were identical at a throughput cost (one test: 26 s default vs 42 to 55 s). A single-user local setup may repeat better, but it must be tested, and results can differ across hardware and versions. We found **no source on llama.cpp's reproducibility**. Source: https://thinkingmachines.ai/blog/defeating-nondeterminism-in-llm-inference/

**3.3 Constrained decoding guarantees format, not truth. [secondary]** Grammar or JSON-schema decoding (llama.cpp grammars, Ollama structured outputs) forces valid structure; it does not make values correct, and a truncated generation can still be invalid.

**3.4 Grounded extraction libraries exist. [secondary]** Google LangExtract (Apache-2.0) maps each extracted value to character offsets in the source and supports local models through Ollama; its documentation calls it experimental, and no public benchmark covers it. Source: https://github.com/google/langextract

## 4. Law and regulation

**4.1 POPIA section 71 (automated decisions). [verified, statute text via popia.co.za]** A person may not be subject to a decision with legal consequences or that affects them to a substantial degree **based solely on automated processing intended to profile them** (job performance, reliability, conduct and others). Exceptions need appropriate measures, which must include **a chance to make representations and enough information about the logic** of the processing. Commentators treat CV screening as in scope when the decision rests solely on the automation; **meaningful human review is the key**. Our product design (recommend, never decide) fits; the match explanation and evidence trail are what supports "information about the logic". Sources: https://popia.co.za/section-71-automated-decision-making/ and https://bowmanslaw.com/insights/south-africa-ai-in-the-workplace-2-of-6-popia-considerations/
* No Information Regulator guidance on CV screening was found. **[unverified]**

**4.2 POPIA section 14 (retention). [verified]** Records may be kept only as long as necessary for the purpose, unless a law, a contract, a lawful need linked to the organisation's functions, or **consent** allows longer; once not authorised they must be destroyed or de-identified **as soon as reasonably practicable**, so they cannot be reconstructed. Practitioner guidance suggests 6 to 12 months for unsuccessful applicants, **not a statutory number [secondary]**. Our retention rules are a per-organisation setting candidate. Source: https://popia.co.za/section-14-retention-and-restriction-of-records/

**4.3 POPIA section 72 (sending data abroad). [verified]** Allowed only if the recipient is bound by law, binding rules or an agreement giving substantially similar protection (including limits on onward transfer), or the person consents, or the transfer is needed for a contract at their request, or is for their benefit and consent is impracticable. This is a legal reason to keep all processing local, beyond your cost rule. Source: https://popia.co.za/section-72-transfers-of-personal-information-outside-republic/

**4.4 Special personal information. [verified, partial]** Section 27 permits processing it with consent, to establish or defend a legal right or obligation, where the person made it public, for research under conditions, or under sections 28 to 33 (religion, race or ethnic origin, trade union, political persuasion, health or sex life, criminal or biometric information). The page did not include the text of section 26 or any employment-specific rule. Source: https://popia.co.za/section-27-general-authorisation-concerning-special-personal-information/

**4.5 Employment equity versus our "strip protected details" design. [secondary, needs legal advice]** South African designated employers may rely on race, gender and disability in recruitment under their employment equity plan (EEA section 6(2)). Our parser deliberately removes protected details from extraction. That is a sound bias safeguard, but employers with equity duties may need **voluntary self-declaration collected separately**, not read from a CV. This is a product question for your father and a labour lawyer. I did not find the rules on collecting applicant race and gender data. Sources: https://www.michaelpageafrica.com/our-expertise/equal-opportunities/legal-background and https://businesstech.co.za/news/business/351075/10-employment-equity-cases-you-should-know-when-hiring-or-looking-for-a-job-in-south-africa/

**4.6 EU AI Act (only if you ever serve EU candidates or customers). [secondary, formal adoption reported]** Recruitment AI is "high-risk" (Annex III). The Digital Omnibus (Regulation (EU) 2026/1744, in force 27 July 2026) moved the date for these obligations from 2 August 2026 to **2 December 2027**. Verify against EUR-Lex before relying on it. Sources: https://www.gibsondunn.com/eu-ai-act-omnibus-agreement-postponed-high-risk-deadlines-and-other-key-changes/ and https://labs.cloudsecurityalliance.org/research/csa-research-note-eu-ai-act-omnibus-vii-deadline-delay-20260/

**4.7 Qualification fraud is a legal matter in South Africa. [secondary]** The NQF Amendment Act lets SAQA keep registers of fraudulent qualifications and makes misrepresentation an offence (fine or up to five years). Employers are expected to verify qualifications against SAQA records. A parser that extracts qualification names, institutions and years can support, but not replace, SAQA verification. Our "completed or not" and level fields are claims, not verified facts, and should be labelled so. No current national figure for falsified CVs was found (an old SAQA figure was 0.6% of verifications). Source: https://businesstech.co.za/news/business/858574/legal-warning-to-anyone-lying-on-their-cvs-in-south-africa/

## 5. Evaluation and fairness

**5.1 Vendor accuracy claims cannot be compared. [secondary]** Affinda publishes a field-by-field comparison with strict scoring (partial, false positive and false negative all count as zero) against **unnamed** competitors, so it is not independent; commentary on it reports contact fields in the high 90s and work history about 87 to 88% and education 85 to 90%. **No neutral benchmark of Textkernel, Sovren or Affinda was found.** The only honest way to compare is a pilot on your own CVs.

**5.2 How many real CVs we need. [calculated]** If a method is truly 90% right, the 95% interval on a sample is: 30 CVs: 74 to 97%; 50: 79 to 96%; 100: 83 to 94%; 200: 85 to 93%. To pin a 90% rate within plus or minus 5 points we need about **140 CVs**, within 3 points about **385**. A 20 to 30 CV pilot is enough to find failure types, **not** to claim an accuracy number.

**5.3 Name bias is well documented for AI ranking; parser extraction bias is not. [secondary]** Wilson and Caliskan (AIES 2024), reported secondhand: white-associated names ranked higher in 85.1% of paired comparisons with language-model retrieval, Black-associated in 8.6%. Direct measurements of parser extraction error across name or language groups are scarce; one vendor-cited "3.2% gap" could not be verified. New York City Local Law 144 requires bias audits of automated hiring tools. Implication: when a model sees names, test for disparities, and consider hiding names from any scoring step.

## 6. What this changes (ranked)

1. Close the two verified gaps: hidden text in Word files, and zero-width character removal (cheap, security-relevant now).
2. If a model is added: fence candidate text as inert data; run the model only on text that passed hidden-text exclusion; require quotes and line pointers back to the source; keep our evidence check as the last gate.
3. Do not trust temperature 0 for repeatability; record model, version, hardware and verify by re-running.
4. Camera photos are the hardest input for every engine (8 to 18 points lower than clean on the same model); target a visible "please check this one" state rather than promising accuracy.
5. A neural OCR trial (PP-OCRv5 on ONNX is the lightest route into Node; PaddleOCR-VL if a GPU exists) should be measured on our scan and photo stress sets; claims so far are self-reported.
6. Real CVs: aim for 140 or more for a defensible accuracy number; 20 to 30 first for finding failure types. Consent and POPIA retention rules apply to the test set too.
7. Legal items for a lawyer: section 71 wording in the product, retention defaults, equity self-declaration, and "verified" versus "claimed" qualification labels.

## 7. Could not confirm

* Information Regulator guidance on automated CV screening.
* llama.cpp reproducibility behaviour.
* Independent accuracy of commercial parsers.
* Parser extraction error rates by name or language group.
* IsiZulu and other South African language OCR accuracy.
* Exact text of POPIA section 26 and the rules on applicant equity data.

## 8. Assessment of Gemini's executive brief (received 2026-10-22)

Checked against primary sources. Gemini's "Verified" labels link only to repositories or generic pages, which does not meet our evidence standard; treat its tags as **secondary**.

* **Contradicted by evidence:** "SLMs under grammar constraints eliminate hallucinations" (grammar guarantees structure, not truth; the Alibaba paper measured untuned Qwen3-4B at F1 0.869 to 0.885 and 14B at 0.91, not above 0.98); "direct PDF text is inferior to OCR for born-digital PDFs" (the same paper's ablation: removing native-text fusion cost over 10 points; OCR adds error where a text layer exists); "the Employment Equity Act prohibits using race or gender from CVs" (designated employers may rely on race, gender and disability in recruitment under their equity plan; POPIA's special-information list covers race or ethnic origin, health and others, not gender as such, and permits processing with consent or a legal basis; a separate self-declaration is a sound design, not a legal prohibition).
* **Breaks our rules without saying so:** Surya's **model weights** are under a modified AI Pubs Open Rail-M licence, "free for research, personal use, and startups under $5M funding/revenue" (code is Apache-2.0); broader commercial use needs a separate paid licence. Source: https://github.com/datalab-to/surya. The brief claimed no rules were broken. Not usable under our no-fees, permissive-only rule.
* **Overstated:** PhantomLint (arXiv 2508.17884) evaluated PDF and HTML only, reports a false-positive rate of about 0.092% on 3,402 documents, and the abstract does not mention OCR or a vision model; "completely exposes hidden payloads regardless of file format" is not supported. Source: https://arxiv.org/abs/2508.17884
* **Unsourced numbers:** "PP-OCRv5 under 500 ms on CPU", "under 200 ms per page on GPU with reading order", ">98% extraction fidelity for 7B under 4-bit".
* **Plausible, still to test ourselves:** thread count and SIMD differences changing llama.cpp output at temperature 0 (consistent with, but not proven by, our sources; the verified cause in the literature is batch-size-dependent kernels).
* **Consistent with our findings:** its unknowns (South African language OCR, no South African CV benchmark, Node bindings for vision-language models, no Regulator guidance, no published layout fine-tunes) match our own "could not confirm" list.
* **Possibly useful:** olmOCR (Apache-2.0 on the model card, a note says research and educational intended use, so check; fine-tuned from Qwen2.5-VL-7B, GPU needed); Docling and Granite-Docling (to verify licences and CPU claims); Qwen2.5 7B and 14B (believed Apache-2.0; the 3B is believed to be under a restrictive research licence; verify on the official model pages).
