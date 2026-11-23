# Sample documents for hand-testing RoleMatch

Ten fictional job ads (`jobs/`) and ten fictional CVs (`cvs/`). Every person, company and contact detail is invented (`@example.test` addresses). The set mixes Word and PDF files and well-structured and messy layouts on purpose. Rebuild them with `cd server && npm run build:samples` (source text in `server/test/sample/content.ts`).

## How to test (about 20 minutes)

1. Start the server (`cd server && npm run start`), open http://localhost:8787, and **Sign up** with your own details. While `SIGNUP_REQUIRE_CODE=false` in `server/.env` no email code is needed.
2. Drop all ten files from `jobs/` onto the **job** upload box and all ten from `cvs/` onto the **CV** box. Each should show as *processing* and appear on the board only when finished.
3. Open each candidate and job card. Compare the extracted fields with the document (the table below says what to expect). Edit a field and check it saves.
4. Drag one candidate and one job into the matching slots, then press the green **Match** button. Read the evidence trail: every requirement should say verified, partially evidenced or not demonstrated, with the reason.
5. Look in Supabase (**Table Editor**): `orgs`, `members`, `documents` (one row per upload, `status`, `stage`), `candidates`, `jobs`, `matches` (one immutable row per match run), `audit_events` (every edit and match), and Storage -> `originals` (the private original files).

## What each file is testing

| File | Layout | What to look for |
|---|---|---|
| cv01 Thandi Mokoena | Word, clean headings | Everything extracted: 12 skills, 2 roles, degree. The best match for job01 |
| cv02 Ruan van der Merwe | Word, clean | Data analyst for job02 |
| cv03 Lindiwe Dlamini | PDF | No skills section, so few skills; registration is under "Registration and certification" |
| cv04 Michael Chen | Word | Accountant: has a BCom, uses Pastel not Sage, no IFRS or CA(SA) -> job04 should show gaps, not a fit |
| cv05 Sipho Ndlovu | Word, **plain sentences, no headings** | Hard case. Expect the name, contact and one company with dates only; his position is not stated so it stays blank |
| cv06 Aisha Patel | PDF, **two columns** | Name and skills should not be mixed up with the experience column |
| cv07 Johan Pretorius | Word, **Afrikaans headings** | Werkservaring / Opleiding / Vaardighede should still be understood |
| cv08 Zanele Khumalo | Word, date-first layout | HR; two roles with year ranges |
| cv09 Kevin Naidoo | PDF | A **trap**: lists Kubernetes and Terraform but has 1.5 years' experience. job09 should show "partially evidenced", not a strong fit |
| cv10 Emma Fourie | Word, **ALL CAPS, casual** | Messy; the work history and location may be incomplete. Expect to correct it by hand |
| job01 to job03, job05, job06, job08 to job10 | Word/PDF with headings | Title, company, location, requirements and nice-to-haves |
| job04, job07 | Word, **plain paragraphs, no headings** | Requirements are read from sentences; check them carefully |

## Match scores the engine currently gives (built-in parser, 2026-10-19)

Each CV against its intended job: cv01-job01 97, cv02-job02 85, cv03-job03 60, cv04-job04 44, cv05-job05 28, cv06-job06 60, cv07-job07 54, cv08-job08 57, cv09-job09 63, cv10-job10 56. These are not predictions of hiring quality; they show how much of each requirement is evidenced in the CV.

## Known limits to expect (not bugs you introduced)

- Matching is keyword- and evidence-based. It can over-credit a CV that merely uses a word (a data analyst who writes "weekly sales reporting" gets some credit for a sales requirement) and under-credit CVs written as sentences (cv05). Always read the evidence trail.
- Certificates, registrations and spoken languages are the candidate's own claims; the engine only ever marks them *partial*.
- Skills outside our built-in list (nursing, trades, HR) are not listed as skills, but requirements are still checked from the CV text.
- Scanned PDFs and photos are not supported yet (no OCR).

## The review queue

After extraction every record is checked by plain rules (`server/src/review.ts`) and flagged **Needs review** when something important is missing: no contact details, no job title, no work history, no skills, very few skills, roles without titles or dates, low extraction confidence, or items dropped because the document did not support them. With the built-in parser, cv03 (no skills), cv05 and cv10 should be flagged and the other seven CVs and all ten jobs should not. Use **Show only needs review** above the candidate list, open a flagged record to see the reasons, compare it with the original, then press **Mark as reviewed**. A flag is never cleared by editing; only that button clears it, and who did it and when is audited.
