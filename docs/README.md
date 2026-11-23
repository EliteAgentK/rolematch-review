# RoleMatch documentation

Start with the operating model if you want to know **what the platform does**; start with the architecture if you want to know **how it is built**.

## Product: what the platform does
| Document | What it answers |
|---|---|
| [`product/CLAIMS_REGISTER.md`](product/CLAIMS_REGISTER.md) | Every claim on the public pages, what is true today, and the proof needed before it may be made. |
| [`product/OPERATING_MODEL.md`](product/OPERATING_MODEL.md) ([visual page](product/OPERATING_MODEL.html)) | Every step from sign-up to log out (S1 to S40): who does what, the rules enforced, what is stored and logged, and what is not true yet. |

## Architecture: how it is built
| Document | What it answers |
|---|---|
| [`architecture/ARCHITECTURE.md`](architecture/ARCHITECTURE.md) | The parts of the platform and how they fit together. |
| [`architecture/CAPABILITY_GRAPH.md`](architecture/CAPABILITY_GRAPH.md) | The platform's foundation: one graph of capabilities so every match is graded and explainable (an actuarial degree is not a general BCom), with the arithmetic, sources, guardrails and build order. |
| [`architecture/AI_PHASE_PLAN.md`](architecture/AI_PHASE_PLAN.md) | The AI phase: agents that work only through our tools, the chosen models per role (licences checked), what is rejected and why, the shared vocabulary, and the order of work. |
| [`architecture/ML_ARCHITECTURE.md`](architecture/ML_ARCHITECTURE.md) | Where machine learning could plug in, how it stays safe, the worker contract and APIs, phases and the gate before anything goes live. |
| [`architecture/PRODUCTION_READINESS.md`](architecture/PRODUCTION_READINESS.md) | What must be true before real organisations use it. |
| [`architecture/RESILIENCE.md`](architecture/RESILIENCE.md) | Staying up when the database or sign-in service is down: what is done (sign-in checked on our own server) and the plan. |
| [`architecture/ADR-003-self-hosting.md`](architecture/ADR-003-self-hosting.md) | Proposed: our own PostgreSQL on two South African servers, with costs and the decisions needed. |
| [`architecture/MATCHING_MODEL.md`](architecture/MATCHING_MODEL.md) | How a match is scored: the mathematics, its proved properties, the configuration, how it will be validated, and what is not covered yet. |
| [`architecture/POINTS_CATALOGUE.md`](architecture/POINTS_CATALOGUE.md) | Every criterion the platform judges, only shows, or must never use (102 points in 8 families), each with its evidence, rule and guard against double counting and unfairness. Generated from `server/src/points.ts`. |
| [`architecture/ADR-002-assessment-framework-review.md`](architecture/ADR-002-assessment-framework-review.md) | Review of the Mathematical Assessment Framework: what was adopted in rules 2.1.0 (logistics apart from the score, distance, wording review, coverage, reference date), what was rejected and why (the mandatory zero gate, unvalidated constants, cosine credit), and the owner's decisions. |
| [`architecture/ADR-001-own-database-and-matching-blueprint.md`](architecture/ADR-001-own-database-and-matching-blueprint.md) | Review of the custom-database and 4-pillar blueprint: what we adopt, what we change, and why we run our own PostgreSQL instead of writing an engine. |

## Parser: how documents are read
| Document | What it answers |
|---|---|
| [`parser/EXTRACTION_CONTRACT.md`](parser/EXTRACTION_CONTRACT.md) | The written behaviour of the reader and its change log by parser version. Tests check parts of it. |
| [`parser/AI_EXTRACTION_DECISION.md`](parser/AI_EXTRACTION_DECISION.md) | The decision on AI: local models only, rules first, guards on model output. |
| [`parser/PARSER_BUILD_PLAN.md`](parser/PARSER_BUILD_PLAN.md) | The short list of parser and OCR work that earned its place, with status. |

## Research: what we learned and what we are weighing
| Document | What it answers |
|---|---|
| [`research/FIELD_RESEARCH_REPORT.md`](research/FIELD_RESEARCH_REPORT.md) | Sourced findings on prompt injection, OCR, language models, South African law and test-set sizes, with how solid each is. |
| [`research/RESEARCH_NOTES.md`](research/RESEARCH_NOTES.md) | Running notes on ideas, papers, tools and measurements. |
| [`research/RESEARCH_ROADMAP.md`](research/RESEARCH_ROADMAP.md) | Gaps and candidates drawn from the notes (not a build list). |
| [`research/RESEARCH_PROMPTS.md`](research/RESEARCH_PROMPTS.md) | The prompts used to brief outside research tools. |

## Security
| Document | What it answers |
|---|---|
| [`security/SECURITY_AUDIT.md`](security/SECURITY_AUDIT.md) | The security audit of the front end and back end: what was checked, what was found, what was fixed, what remains. |
