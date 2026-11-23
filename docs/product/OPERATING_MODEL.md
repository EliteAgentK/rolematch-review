# RoleMatch operating model: from sign-up to log out

This document describes what the platform does today, step by step, from the code in this repository (checked 2026-10-22, parser 2.5.3, rules 1.0.0). Where something is simulated, missing or not yet true, it says so (section 12). Each step has an id (S1, S2, ...) that the diagrams use. "Where" says which part does the work; "Rule" says what is enforced; "Writes" says what is stored; "Audit" says what is logged.

The platform recommends candidates for human review. It never silently rejects, shortlists, interviews or hires anyone: every decision about a person is a person's click, and is recorded.

## The parts

| Part | What it is | Where |
|---|---|---|
| Browser app | React frontend. Holds no secrets and no data of its own: everything it shows comes from `/api`. | `src/` |
| Application API | One Node.js 24 process. Owns sign-in, authorisation, tenant scope, settings, workflow and audit. Also serves the built frontend. | `server/src/index.ts` |
| Supabase Auth | Holds the login (email, password, confirmation code). Dev project today. | `server/src/supabase.ts` |
| Postgres | Records, documents metadata, queue, matches, settings, audit. Every row carries `org_id`. | `supabase/migrations/` |
| Private storage | Original CVs and job descriptions, in a private bucket under `org_id/document_id`. Never a public URL. | `server/src/supabase.ts` |
| Durable queue | A table (`queue`) worked by the API process: bounded retries, fair between organisations. | `server/src/queue.ts` |
| Reader | The parser and OCR that turn a document into a structured record. Runs inside the queue's worker. | `server/src/{parse,layout,rules,ocr,...}.ts` |
| Matching engine | Frozen, versioned scoring rules. Same for every organisation. | `server/src/{match,ruleset}.ts` |

## 1. Arrive and sign up

**S1. Visit the site.** The marketing pages (Home, Features, Pricing, Contact) load. A cookie-consent banner appears. Note: the marketing pages contain claims that have not been verified (section 12).

**S2. Open the sign-up page and fill the form.** Fields: full name, organisation name, email, password (minimum 12 characters; the page suggests a short sentence), confirm password. A hidden "website" field is a honeypot: real people never fill it, so a filled one is treated as a bot.
* Where: `SignupPage.jsx` checks the obvious errors before sending.
* Rule: the server checks again, never trusting the browser: name 2 to 80 characters, organisation 2 to 80, valid email under 160, password 12 to 128 characters (`VAL-001`).

**S3. Submit.** `POST /api/auth/signup`.
* Rule (rate limits, shared across servers so restarting one does not reset them): at most 5 sign-ups per hour from one address, 3 per 30 minutes per email (`RATE-001`).
* If the honeypot is filled: pretend success, do nothing.
* Writes: Supabase Auth gets a pending login and a six-digit code. **Nothing is created in RoleMatch yet.**
* The answer is always the same ("code sent", HTTP 202), whether or not the email is already registered, so the form cannot be used to find out who has an account.

**S4. The email.** A six-digit code is emailed (Resend). A resend is allowed once a minute, at most 3 per 15 minutes per email (`RATE-001`). If email cannot be sent: `INT-001`. In production, sign-up refuses to run without email configured.
* Test mode only (`SIGNUP_REQUIRE_CODE=false`, refused when `COOKIE_SECURE=true`): no code, signed in at once. The server prints a warning at start.

**S5. Enter the code.** `POST /api/auth/verify`.
* Rule: code must be 6 to 10 digits; wrong codes are counted per email (8 per 15 minutes) and per sender address (30 per 15 minutes); beyond that, refused with the same message as a wrong code (`AUTH-004`), so guessing is slowed without revealing anything.
* Writes, **only now**, in one step: a new organisation (`orgs`) and the person as its first member with role `admin` (`members`). Idempotent: if they already belong to one, nothing is duplicated.
* Audit: `user.signed_up`, then `auth.login` (via signup).
* Answer: the person is signed in (S9 cookies) and goes to the dashboard. A first-time tour opens once (stored only in the browser's session storage; nothing breaks if it is unavailable).

## 2. Log in, stay logged in, log out

**S6. Log in.** `POST /api/auth/login` with email and password.
* Rule: failed attempts are counted three ways (shared store): one address on one account (5 per 15 minutes), any addresses on one account (10), one address on any accounts (30). When blocked: `RATE-001` with retry-after 15 minutes, even for a correct password.
* Wrong email or password, or a valid login that belongs to no organisation: `AUTH-001`, identical message either way. An unconfirmed email: `AUTH-003`.
* Audit: `auth.login` with the address.

**S7. The session.** Two cookies, both `HttpOnly` (browser scripts cannot read them), `SameSite=Lax`, `Secure` in production: a short-lived access token and a 30-day refresh token. Nothing sensitive is in browser storage.

**S8. Every request after that.** In this order: (1) cross-site write check (the `Origin` must be ours, `ORIGIN`), (2) per-address rate limit, (3) the access token is verified; if it has expired, the refresh token is used and fresh cookies are set on the same response, so the person is not interrupted, (4) the person's organisation and role are looked up (cached 10 seconds, so removing someone takes effect within that window), (5) per-user rate limit, (6) the route runs, always filtered by the person's `org_id`. No session: `AUTH-002`, and the browser goes to the login page.
* Every response carries security headers (content policy that lets the page load only our own files and Google Fonts and talk only to itself, no framing, no sniffing, HSTS in production). API responses are `no-store`.

**S9. Roles.** `admin`, `recruiter`, `viewer` exist in the database. Today only `admin` is checked, for changing settings (`PERM-001`) and for seeing system health. See section 12 for what is not yet enforced.

**S10. Log out.** The "Sign out" button calls `POST /api/auth/logout`.
* Where: the API asks Supabase to end the session and answers by clearing both cookies.
* The browser shows a goodbye screen for about three seconds ("Your session has ended securely", "Everything you did is saved") and then returns to the home page. Everything done earlier was already saved by its own request; nothing waits for logout.
* Not audited today (log-in is audited, log-out is not).

## 3. Settings (per organisation)

**S11. Read and change settings.** Any member can read the organisation's settings (`GET /api/settings`); only an administrator can change them (`PUT /api/settings`, `PERM-001`, 20 changes a minute).
* Sections: workflow statuses (labels, colours, which are active; `new` must exist), wording (what to call candidates, jobs and notes), fair-use limits, review thresholds, reading policy (hidden text, copy-forbidden PDFs, seconds per page, batch size), panel display, and "What can be edited".
* Rule: every value is validated and capped by platform ceilings (nobody can set a limit above what protects the shared service). Sending the version you are changing is required; if someone else changed it first, you are refused (`CONF-001`) rather than overwriting.
* Writes: the new version, and the old one in `org_settings_history`. Audit: who changed what, from what, to what.
* **The scoring rules are not in settings.** There is no screen, route or setting for them (section 8).

## 4. Upload

**S12. Choose files.** Drag onto the drop zone or browse. The browser's file picker is limited to the formats the server says it accepts, which come from one list (`formats.ts`): PDF, Word (.docx and .doc), OpenDocument, RTF, TXT, and images (JPEG, PNG, TIFF, BMP, GIF). The person marks each upload as a CV or a job description.

**S13. Send.** `POST /api/documents` (one file per request).
* Rule, in order: upload rate (40 a minute per user, `RATE-001`); declared size against the organisation's file limit (`FILE-002`, default 50 MB, never above the platform's); a real file and a kind of `cv` or `jd` (`VAL-001`); not empty (`FILE-001`); organisation quotas: uploads per day, storage, documents already waiting (`QUOTA-001`, `QUOTA-002`, `QUOTA-003`).
* **The file type is decided from its first bytes, never from the name or what the browser says.** A renamed file, or a format we do not accept, is refused with a helpful note (`FILE-001`, HTTP 415).

**S14. Same file twice.** A fingerprint (SHA-256) is taken. If this organisation already uploaded the same file as the same kind, the answer is the existing document (`duplicate: true`) and nothing new is made: uploading is idempotent, and two people uploading at the same moment cannot create two records. If the earlier attempt was rejected, it is tried again instead of staying stuck behind its old failure (audit: `document.retried`).

**S15. Store.** The original is written, untouched, to the private bucket at `org_id/random-id`. One database statement then records the document (name, size, fingerprint, path, status `processing`, stage `received`) and the audit entry `document.uploaded` together, or neither.

**S16. Queue the work.** A `process-document` job is added to the queue and the answer returns at once (HTTP 202). **Publication never happens inside the upload request**; the request only receives and records.

**S17. Show progress.** The dashboard asks for unfinished documents every 1.5 seconds and shows each as a card in a visible processing state with its stage. **A candidate is not in the candidate panel until extraction and validation are complete.**

## 5. The queue

**S18. Claim the next job.** Workers (4 at once by default) claim the oldest ready job, but **fairly between organisations**: whoever has the fewest jobs running goes first, and one organisation never has more than 2 running (a 500-file batch from one client cannot starve another). Claiming is atomic, so a job is never handed out twice.

**S19. Retries and recovery.** A failed job is tried up to 3 times, waiting longer each time (about 4 seconds, then 8, capped at a minute). After the third failure the document is marked `PROCESSING_FAILED` with a plain explanation, and an administrator can retry it. A job left "running" by a crash goes back to the queue when the server restarts, and any job running for over 10 minutes is returned too. Handlers are idempotent, so running one twice is safe.

## 6. Reading: from file to record (the pipeline)

The stages the person sees are: received, security, (optimising), reading, extracting, validating, ready.

**S20. Security.** The file type is checked again from its bytes. **No malware scanner is wired in yet**, and the record says so honestly ("malware scan NOT performed") rather than claiming a clean scan (section 12).

**S21. Optimising (only large files).** A scanned PDF or a PDF/Word file over 2 MB is made smaller for speed. The smaller file replaces the stored one **only if the words still read exactly the same** (for scans, if OCR agrees). Photos and other formats are kept exactly as received. A file still over the processing limit (default 15 MB) is refused (`FILE_TOO_BIG`).

**S22. Inspect.** Before reading, PDFs are inspected without running anything: text a person cannot see (white on a plain page, invisible, transparent, tiny) is detected; copy permissions are checked; scripts, attachments and other people's comments are counted and never opened. Word, OpenDocument and RTF files are checked for hidden text the same way. Hidden text is left out of the evidence and flagged, per the organisation's setting; a PDF whose permissions forbid copying is read and flagged, or held for a person to look at first (`COPY_FORBIDDEN`), per the setting. Zero-width and direction-control characters are removed everywhere.

**S23. Read.**
* **Text-based PDF:** each page is read by the position of every piece of text. Columns, sidebars, tables and header blocks are rebuilt so the reading order is the page's. A sidebar on page 1 is read after the last page so it does not sit in the middle of jobs that continue.
* **Word, ODT, RTF, TXT:** read as text with the same clean-up.
* **Scans and photos:** image preparation (camera rotation flag, dark blocks turned the right way, shadows flattened, faint writing strengthened, tilt straightened, edges cropped), then OCR on our own server (Tesseract, English and Afrikaans). OCR text then gets look-alike and email repairs only where the document itself supports them.
* **Per-page time limit** (default 20 seconds): a page that hangs is given up, the document is released, and the pages not read are reported.
* Refusals, each with plain words the person can act on: `UNREADABLE` (corrupted or password-protected), `PHOTO_UNREADABLE` (too blurry, dark or small; retake or upload the PDF or Word file), `NEEDS_OCR` (almost no text even after OCR).
* The text that was read is stored beside the document so a match can quote it later.

**S24. Extract.** One fixed plan, top to bottom, in the order the panel shows it: name and contact, summary, skills, education and certifications, work history, projects, worth noting (for a job: title, company, location, overview, responsibilities, requirements). For each step, every way of looking is tried in order, and what was tried is written down ("Education: found under the Certifications heading" or "not found (looked at: ...)").
* **Rules first.** The built-in rule-based parser reads structure (headings, dates, bullets). It never guesses: if it cannot tell, the field stays empty. It never makes up a missing fact.
* **No external AI.** Under the owner's rule there is no outside AI service or key; a legacy key can no longer activate one. (See [`ML_ARCHITECTURE.md`](../architecture/ML_ARCHITECTURE.md) for how a local model could be added later.)
* **Evidence check.** Each extracted item keeps a quote from the document. An item whose quote is not really in the document is dropped and counted. Skills are all those the CV evidences, not three headline ones.
* **Years of experience** are worked out from dated roles (overlaps counted once; undated roles add nothing), as of the document's upload date, so the same CV always gives the same answer.
* A layout-family label (LinkedIn export, Europass, Canva, Google Docs, Word, scanner or photo, other) is recorded with its evidence. It changes nothing about reading.

**S25. Validate.** A CV with no name can be neither published nor trusted (`IDENTITY_UNRESOLVED`); a job with no title likewise (`TITLE_UNRESOLVED`). These refusals are final and are not retried. Anything else that fails (a timeout, a network problem) is retried by the queue.

**S26. Decide whether a person should look.** The review rules (plain, versioned, explained in words) produce a state and reasons: no contact details, no job title, no work history, roles without titles or dates (years may be understated), no or few skills, low extraction confidence (default below 50%), very little text, items dropped for lack of evidence, any reading issue from S22 to S23 (hidden text, photo quality, a page given up, copy-forbidden), and a **possible duplicate**: the same email, the same phone number or the same name as a candidate already in the organisation's list (a different file of the same person). The reason names the existing record; nothing is merged, because a person decides. The state is `needs_review` or `ok`. **A flag never blocks anything; only a person can clear it.** Normal omissions (no location, no education when the organisation does not flag it) are shown as notes only.

**S27. Publish.** In one transaction: the candidate (status `new`) or job (status `draft`) is created, the document is linked and marked `published` and `ready`, and the audit entry `candidate.published` or `job.published` is written, with the method, confidence, review state and reasons. If any part fails, none of it happens.
* If the document is rejected instead, it is marked as an exception with its code and message, the audit entry `document.exception` is written (no file names or personal data in logs), and the dashboard tells the person briefly what went wrong and what to try, then clears the card.

## 7. Working with a record

**S28. Open a candidate or job.** The panel shows the extracted record in the plan's order, the review flag and its reasons, and at the bottom **View Original CV** (or original job document).
* Viewing the original is streamed from private storage through the API, as a private, uncacheable response, never a public link. Audit: `document.original_viewed`.

**S29. Notes and workflow status.** A recruiter's own work is always editable: the confidential notepad and the workflow status (default: New, Reviewed, Shortlisted, Awaiting interview, Interviewing, Interviewed, Declined, Archived; each organisation can rename, recolour, add and switch statuses off). A status can only be set to one the organisation uses (`VAL-002`).

**S30. Corrections: what is editable.** Facts read from a document are editable only as far as the organisation allows (Settings, "What can be edited"). Defaults: who the person is (name, email, phone, location) and a job's own specification are editable; what a CV states (summary, skills, work history, education, projects) is locked. What the platform works out (years of experience, certifications and languages as derived, evidence, confidence, review state) is never editable. The server enforces it (`PERM-002` names the fields); the panels only offer what is allowed.

**S31. Every change is safe.** An edit sends the version it was based on. The row is locked while the change is checked, so two people cannot both pass a version check; a stale edit is refused with `CONF-001` and the person reloads. The original extraction is never overwritten. Audit: `candidate.edited` with, for each field, what it was and what it became (notes are audited as "changed" without their words).

**S32. Mark as reviewed.** A person clears a review flag by confirming they looked (`POST .../review`). It records who and when (`candidate.review_confirmed`) and keeps the original reasons in the audit entry.

## 8. Matching

**S33. Nothing matches automatically.** Matching is a deliberate act. The recruiter places one candidate in one slot and one job in the other. **Only when both slots are filled does the green Match button appear.** Nothing is calculated until it is pressed.

**S34. Run.** `POST /api/matches`, 120 a minute per user and the organisation's hourly allowance (`QUOTA-004`). The API loads both records (always inside the organisation) and the CV's stored text, and runs the engine.

**S35. The rules (frozen, versioned, identical for every organisation).** Recruiters and client administrators cannot change them: no screen, no route, no setting. Only a reviewed developer change, which bumps the version (now 2.0.0). The full mathematics, with proofs, is in [`MATCHING_MODEL.md`](../architecture/MATCHING_MODEL.md).
* A requirement is a set of parts joined by AND; a part is a group of alternatives joined by OR ("Bash or Python" is one part met by either) or a years requirement. Each mandatory requirement is worth 10 and each preferred requirement 4. Location is not scored (rules 2.1.0): on-site and hybrid jobs get a separate Logistics line (same place, straight-line distance from a local place table, explicit statements such as "willing to relocate" or "remote only"), which never changes the score, and an on-site or hybrid job without a location shows a notice on the job. Each job requirement is also checked for wording that may be unfair, unclear or excessive, and flagged for a recruiter; nothing is removed automatically.
* For each skill the evidence is `direct` (described in work or projects), `listed` (only named) or `absent` (not mentioned; **never** proof the person lacks it). Credit is 1, 0.5 and 0; a requirement earns the **mean of its parts**, so "AWS, Linux, Terraform and Docker" earns a quarter for each one evidenced, in proportion.
* Years requirements earn credit in a straight line up to the number asked for, then stop (more years than asked earn nothing extra). Only roles that are about the subject count: at least half of the requirement's subject words must appear in the role, or the role must use a skill the requirement names.
* Every result is three numbers, not one: what the documents **prove** (the floor, and the headline score), the expected value (equal to the floor until it is calibrated on recruiter data), and the most it **could** be if every gap were confirmed (the ceiling). A CV that says little has a wide range, shown plainly, instead of looking like a poor candidate.
* **Nothing is counted twice.** A requirement that repeats an earlier one (same skills and years) is shown but carries no weight; repeating a word, a skill or a whole role in a CV earns nothing extra; ranking uses a fixed total order so ties are never broken by chance. See section 4 of [`MATCHING_MODEL.md`](../architecture/MATCHING_MODEL.md) and the full [points catalogue](../architecture/POINTS_CATALOGUE.md).
* A mandatory requirement the evidence contradicts caps the score at 40 (no check produces this state yet).
* Never used as inputs (checked by a test): rating, name, email, phone, avatar, age, gender, race, religion, nationality.

**S36. The result.** A score band in wording about documented evidence ("Strong documented fit"), the proved score with the range it could reach, a **confidence** (High, Medium, Low) that measures how tightly the evidence pins the score down (one minus the width of the range) times how well the documents were read, and never the quality of the candidate; every requirement with its state, its three credits, an explanation and a quote from the CV; the strengths and gaps; warnings (job still a draft, built-in parser used, original text unavailable); and a recommendation that always points to a person: "Proceed to human review", "Review the gaps and confirm unknowns", "Verify N mandatory requirements before progression", or that additional evidence is needed. The score is fit to **this job's stated requirements**, not a general measure of how qualified a person is. It always carries the line that this is a recommendation for human review, not a hiring decision.

**S37. Snapshot and audit.** The result is saved as an immutable snapshot with the candidate version, job version, engine version and a fingerprint of the rules plus the skill dictionary, so it can be proven later that every candidate was scored under the same rules. Audit: `match.run` with the score and confidence.

**S38. Find matches at scale.** From a candidate: matched against up to 50 of the organisation's jobs; from a job: against up to 50 candidates (the cap stops unbounded candidate-by-job products). The organisation's hourly match allowance applies to the whole batch before it starts. Results open in a shortlist view.

**S39. Human actions.** The recruiter chooses what happens next: shortlist, request information, review the CV, or mark not suitable. Shortlist and not suitable set the candidate's status, and that change is audited like any edit (who, from what, to what). **The platform never does any of this itself.**

## 9. Removing data

**S40. Delete a candidate or job.** Permanent, requested by a person (`DELETE`). In one transaction: the record, every match result that includes it, the queue jobs, the document row and the extracted text go; the personal detail inside past edit-history entries is blanked; what remains is a plain audit line saying who deleted what and when, with no names or contents. The original file is removed by the queue with up to 8 retries, so a storage problem can never leave a record half deleted.

## 10. Rules that apply to every step

* **Tenant isolation.** Every table has `org_id`; every query filters on it; there are no cross-organisation routes. The API connects with a service role and enforces scope itself.
* **Audit.** Append-only: the database refuses to change or remove audit rows (only the deletion step may blank personal detail in old edit entries, inside its own transaction). Each entry has who, what, from what, to what, when, and a request id.
* **Rate limits** in two kinds: memory (ordinary request rates) and shared in the database (sign-in, sign-up, email, code checks), so attempts spread across servers or restarts still count. If the shared store is unreachable it falls back to memory rather than letting everything through.
* **Errors** always carry a code and a request id for support; no personal data is written to logs.
* **Nothing hard-coded that an organisation may want different** is a setting (statuses, wording, limits, review thresholds, reading policy, what is editable, panel display).
* **Determinism.** The same document gives the same record: the parser has a version, frozen outputs are tested against it, and a change in behaviour must bump the version.

## 11. Where machine learning would plug in

See [`ML_ARCHITECTURE.md`](../architecture/ML_ARCHITECTURE.md). In short: inside reading (S23) and extracting (S24), behind the same checks; rules first; every value must pass the evidence check; shadow mode before anything goes live; matching (S35) is never touched.

## 12. What is not true yet (candid)

* **Database and hosting:** the database, login and private storage run on a Supabase **dev** project. No production project, backups or point-in-time recovery yet; the owner wants this under our own control.
* **No malware scanner** (the record says so). Planned late.
* **OCR** is local Tesseract with image clean-up and has only been measured on invented documents. Scans read fully correct about 3% of the time and photos about 15% in our tests, so scanned CVs need a person's check; pages turned sideways or upside down are not corrected yet.
* **Parser** accuracy was measured only on generated CVs (about 63% of PDFs and 83% of Word files fully correct); no real CVs have been tested.
* **Roles:** `viewer` exists but is not restricted by the API; only `admin` is checked. **There is no screen to invite colleagues** (a developer helper creates extra users); sign-up creates one organisation with one administrator.
* **Status is on the candidate**, not per application to a job.
* **The profile page** still uses browser-stored demo profiles, and the **log-in page's** profile lookup still touches them.
* **The marketing pages** (Home, Features, Pricing) contain claims that have not been verified.
* **`contradicted`** is defined in the engine and caps the score, but the current checks do not yet produce it; they produce verified, partial or not demonstrated.
* **The job's level** (senior, lead, head of) is not yet an explicit requirement, and recency of skill use is not weighed; both are planned in [`MATCHING_MODEL.md`](../architecture/MATCHING_MODEL.md).
* **Logout and failed log-ins** are not in the audit log (successful log-ins are).
* A passing test is not production readiness.
