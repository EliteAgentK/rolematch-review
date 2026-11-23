# RoleMatch

RoleMatch is a multi-tenant recruitment platform. Recruiters upload CVs and job descriptions, the platform reads each one into a structured record with evidence, and a recruiter can then compare a candidate with a job. It **recommends for human review** and never silently rejects, shortlists, interviews or hires anyone.

![RoleMatch logo](public/logo-light.png)

## Where things stand

Under active development, **not yet a production system**. What exists today: sign-up with an emailed code, private encrypted document storage, a durable processing queue, CVs and job descriptions read into structured records with every value tied to the lines it came from, matching of one candidate against one job only when a recruiter selects Match, optimistic-concurrency edits within the organisation's edit policy, and an append-only audit log.

**AI.** Reading and matching use a hosted AI service (Anthropic), called with RoleMatch's own key, metered per portal against a monthly allowance per company and a platform budget, both reserved call by call ([`docs/architecture/ADR-005-claude-in-the-platform.md`](docs/architecture/ADR-005-claude-in-the-platform.md)). The AI alone judges a candidate against a job; there is no scoring formula ([`docs/architecture/ADR-006-ai-only-matching.md`](docs/architecture/ADR-006-ai-only-matching.md)). Code checks every answer: values must be found in the document, cited evidence must exist, and a score its own evidence does not support is refused. Those checks prove an answer is grounded and well formed, not that the AI judged correctly: the match percentage is the AI's judgement within those bounds, not a measured probability. Scanned pages are turned into text on our own machine (Tesseract) before anything is read. With the AI switched off, a rule-based reader stands in and says so.

**Where it runs, for now.** While RoleMatch is in development, the live service runs on one PC (Docker under WSL 2) with its own PostgreSQL, sign-in service and encrypted file vault, reached through a Cloudflare tunnel; it is backed up nightly with a weekly restore drill ([`docs/ops/LIVE_ON_PC.md`](docs/ops/LIVE_ON_PC.md)). One machine is not high availability: a power or network cut there takes the service down. Production moves to a cloud server in South Africa when the first corporate customer signs ([`docs/architecture/PLAN_AZURE_PRODUCTION.md`](docs/architecture/PLAN_AZURE_PRODUCTION.md)); the code is built to move (standard PostgreSQL, settings per machine, the file vault behind one interface). Live uses no Supabase hosting. Development and the test suites run PostgreSQL, the same open-source sign-in service and storage on the developer's own machine through the Supabase command-line tool, which is why the schema folder is `supabase/migrations/`.

**Not there yet**, candidly: no malware scanner on uploaded files; reading accuracy has been measured on invented documents and on real ones supplied with permission (30 real CVs, measured repeatedly, and 39 real job descriptions), never independently; there is no labelled set of candidates and jobs with known right answers to measure matching against; the marketing pages (Home, Features, Pricing, Contact) make claims that are not yet proven. The wider list is in [`docs/product/OPERATING_MODEL.md`](docs/product/OPERATING_MODEL.md) (section 12) and [`docs/architecture/PRODUCTION_READINESS.md`](docs/architecture/PRODUCTION_READINESS.md).

## Repository map

| Path | What is in it |
|---|---|
| [`src/`](src) | The web app (React, Vite, Chakra UI). Holds no secrets and no data of its own; everything comes from `/api`. |
| [`server/`](server) | The backend (Node.js 24, TypeScript): sign-in, storage, queue, reader, matching, audit. See [`server/README.md`](server/README.md). |
| [`supabase/migrations/`](supabase/migrations) | The database schema, applied in order with `npm run migrate` (from `server/`). |
| [`docs/`](docs) | Everything written down: product, architecture, parser, research, security. Start at [`docs/README.md`](docs/README.md). |
| [`e2e/`](e2e) | Browser tests (Playwright). |
| [`sample-documents/`](sample-documents) | Invented CVs and job descriptions used for tests and demos. Real CVs never go in the repository. |
| [`scripts/`](scripts) | Small build tools (brand assets, the operating-model page). |
| [`public/`](public), [`design/`](design) | Static assets and brand files. |
| [`CLAUDE.md`](CLAUDE.md) | Engineering handoff: how to work in this repository and the non-negotiable product behaviour. |

## Run it locally

Needs [Node.js](https://nodejs.org) 24 LTS, Docker and the Supabase command-line tool, which runs the database and sign-in service on your machine (setup in `server/README.md`).

```bash
cd server && npm install        # then create server/.env from .env.example
npm run migrate                 # apply the database schema
npm run create-user "My Organisation" you@example.com "Your Name" "a-long-password"
cd .. && npm install && npm run build
cd server && npm run start      # open http://localhost:8787
```

For front-end work: `npm run dev` (with the server running), then open <http://localhost:5173>.

## Checks before every change

```bash
npm run typecheck && npm run build && npm test     # front end
cd server && npm run typecheck && npm test         # back end
```

Do not commit secrets, original CVs, `server/data/`, private planning documents or generated output. The `.gitignore` already excludes them.
