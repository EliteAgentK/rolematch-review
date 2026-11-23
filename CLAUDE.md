# RoleMatch engineering handoff

## How to work in this repository

Treat the existing interface as the current product baseline. Inspect before editing, preserve working behaviour, and make targeted changes rather than replacing the application with a new scaffold. Be candid about what is implemented, simulated, unverified or missing. Ask when a requirement is genuinely ambiguous; do not silently invent business rules.

No quick patches and no leftovers (owner, 19 Nov 2026). Fix the cause, not the symptom. When something is replaced, delete the old version in the same change: no commented-out code, no switched-off paths kept "for later", no "temporary" fixes. `npm run check:leftovers` (Knip for unused files, exports and packages in both the website and the server; `scripts/checkStyles.mjs` for style classes no screen uses) must pass before a change is done, and CI blocks a change that fails it. An export used only inside its own file is not exported.

The product is intended for corporate recruitment environments. Prioritise correctness, auditability, privacy, accessibility, restrained visual design and explicit human control over novelty.

## Current reality

The repository has two parts. `src/` is the React/Vite frontend. `server/` is a TypeScript backend on Node.js 24 (not Bun) (`server/README.md`) that owns sign-in, private original documents, a durable processing queue, extraction, evidence-based matching, optimistic-concurrency edits and an audit log. The frontend now reads and writes everything through `/api`; no demo records remain in the browser.

Be candid about what is still missing: live runs on one PC with its own PostgreSQL, sign-in service and private file storage (`docs/ops/LIVE_ON_PC.md`: nightly backups and a weekly restore drill, but one machine and no high availability), the schema is `supabase/migrations/` applied with `npm run migrate`, development and tests use a local Supabase stack, there is no malware scanner, OCR is local Tesseract with image cleanup and has only been measured on invented documents (`npm run eval:ocr`), extraction without `ANTHROPIC_API_KEY` is rule-based and limited (and says so), workflow status is per job (migration 043) with the candidate's own status kept only as a headline, whose production gaps are in `docs/architecture/PLAN_STATUS_PER_APPLICATION.md`, the profile page shows only what the server holds about the signed-in account (no name, photo or phone edits, no activity list), and the Home/Features/Pricing/Contact marketing pages contain unverified claims. A passing test is not production readiness.

Run `npm run build`  after frontend changes and `cd server && npm run test:local` after backend changes (the local Supabase stack; `server/.env` points at live, and a test run refuses anything not on this machine). Do not commit secrets, original CVs, `server/data/`, private Word dossiers, generated build output or local package caches.

## Non-negotiable product behaviour

1. An uploaded candidate must remain in a visible processing state and must not enter the candidate panel until extraction and validation are complete.
2. The original CV must be retained privately and linked at the bottom of the candidate detail panel as **View Original CV**.
3. Extract every supported field evidenced by the CV, including all listed skills—not only three headline skills. Never manufacture missing facts.
4. Not everything in a panel is editable. A recruiter's own work (notes, workflow status) always is. Facts read from a document are editable only as far as the organisation's edit policy allows (`server/src/editPolicy.ts`, Settings > What can be edited): by default corrections to who the person is (name, email, phone, location) and a job's own specification are editable, and what a CV states (summary, skills, work history, education) is locked. What the platform works out (years of experience, evidence, confidence, review state) is never editable. The server enforces the policy (403 PERM-002); the panels only offer what is allowed. Preserve the original extracted evidence and audit who changed what, from what, to what.
5. Each candidate has a separate recruiter notepad and workflow status such as New, Reviewed, Shortlisted, Awaiting interview and Interviewed. Interview completion may expose structured notes.
6. A candidate and job do not match automatically. Only when both matching slots are filled should a green **Match** action appear; calculation begins only after that action is selected.
7. Matching must distinguish `verified`, `partially evidenced`, `not demonstrated`, `contradicted` and `not applicable`. Absence from a CV is not proof that a candidate lacks a skill.
8. A recommendation must include confidence and an evidence trail. Confidence measures the quality and completeness of evidence, not candidate quality.
9. Match details must explain mandatory requirements, strengths, gaps, evidence and recruiter actions. Avoid unexplained stars, decorative point scoring or false precision.
10. The platform recommends candidates for human review. It does not silently reject, shortlist, interview or hire people.
11. A configurable requirements and weighting model should keep extraction and assessment consistent across organisations, roles and versions. Configuration changes must be versioned and auditable.

## Target service boundary

The future backend remains separate from this frontend. The application API owns authorisation and workflow state. Private object storage holds originals; PostgreSQL holds metadata, processing state, configurations, extracted records, evidence and audit events; ClamAV gates unsafe files; parser workers extract native text; OCR is a fallback for image-only or poor documents; AI maps source text into a strict schema; validation checks evidence and confidence; a durable queue distributes jobs and retries; n8n may coordinate tasks but must not bypass the API or become the source of truth.

Backend implementation should support idempotency, tenant isolation, least-privilege access, signed document links, encryption, retention rules, observable queues, bounded retries and manual recovery. Do not couple publication to a single long-running web request.
