# Security audit: front end, back end and repository

Date: 2026-10-22. Scope: everything in this repository (web app, server, database migrations, build output, git history, dependencies). Method: reading the code route by route, scanning the built bundle and the full git history, a dependency audit, hostile-input testing of the reader, and running the tests. This is an engineering review, not an independent penetration test or a compliance certificate; a production launch still needs one (see "What still needs doing").

How to read the tables: **Fixed** means changed in code and covered by a check where one is possible. **Open** means known, not fixed, and why.

## 1. Verified clean

| Check | Result |
|---|---|
| Secrets in the repository's **entire history** (59 commits, all branches): Anthropic, OpenAI, Resend, AWS and GitHub tokens, JWTs, database URLs with passwords, private keys | None found. `.env` was never committed; only `server/.env.example` (empty values) is tracked. |
| Private planning documents and original CVs | Never committed (`/*.docx`, `build_*.py`, `sample-documents/real/` and `server/data/` are ignored). |
| **Built front end** (`dist/`): service-role key, database URL, API keys, JWTs, Supabase address, source maps | None present. The browser bundle holds no secret and no server address; it talks only to its own origin. |
| Unsafe browser patterns in `src/`: `dangerouslySetInnerHTML`, `innerHTML`, `eval`, `new Function`, `document.write`, links that open a new tab without `rel` | None. |
| Tokens in browser storage | None. The session lives in two `HttpOnly` cookies that scripts cannot read. |
| Database access from the browser | Blocked: Row Level Security is on for every table with no public policies; the bucket for originals is private. |
| Dependencies | Front end: 0 known vulnerabilities. Back end: 1 moderate advisory, reviewed and accepted in `server/audit-allowlist.json` (the vulnerable code is never loaded; review date 2027-01-20). |
| Tenant isolation | Every table carries `org_id`; every by-id query is filtered by the caller's organisation; no cross-organisation route exists. A test checks it. |
| SQL injection | All queries are parameterised. The few places that build SQL text put only constant table names into it (never user input). |
| Cross-site request forgery | `SameSite=Lax` cookies, an `Origin` check on every write, and now a `Sec-Fetch-Site` check as well. |
| Uploads | File type decided from the first bytes, never the name; size, quota and rate limits; stored under a random name in a private bucket; served back through the API, audited, `nosniff`, private and uncached. |
| Sign-up and sign-in | Same answer whether or not an address is registered; wrong-code and wrong-password attempts counted three ways in a shared store; identical error messages; codes never logged in production. |
| Response headers | Content policy (own files only, no framing, no outside connections), `nosniff`, no referrer, camera/microphone/location blocked, HSTS in production, API responses `no-store`. |

## 2. Findings and what was done

### Back end

| # | Severity | Finding | Status |
|---|---|---|---|
| B1 | High | **Hostile documents could tie up a worker for minutes.** Several patterns went quadratic: one 48 KB line took 3 seconds, and the 2 MB text ceiling would have taken minutes. Two documents could block an organisation's whole queue share. | **Fixed.** Lines over 3000 characters are cut at a space before reading, and trailing-space trimming is a single pass. Worst case on 150 KB hostile input is now under 0.5 s. A regression test (`server/test/hostile-input.test.ts`) keeps it so. |
| B2 | Medium | Every request body was allowed up to the upload size (about 52 MB), including sign-in and settings. | **Fixed.** Only the document upload may be large; every other body is limited to 1 MB and refused before it is read. |
| B3 | Medium | Database roles used by Supabase's public API kept table and function rights, protected only by Row Level Security. A function added later could have been exposed by accident. | **Fixed in code, not yet applied.** Migration `012_lock_down_public_api.sql` removes those rights and sets safe defaults. It has not been run against the dev project: apply it with `npm run migrate` after review. |
| B4 | Medium | A production run with `COOKIE_SECURE` forgotten would have issued session cookies without the `Secure` flag. | **Fixed.** `NODE_ENV=production` now refuses to start without `COOKIE_SECURE=true`. |
| B5 | Medium | Leftover code could send CV text to an outside AI service if a key was present (disabled earlier, but the client, key setting and dependency were still there). Against the owner rule. | **Fixed.** Client, key and settings, and the dependency are removed. A test fails if any server file references an outside AI service. |
| B6 | Low | Four by-id queries relied on an earlier check instead of repeating the organisation filter. | **Fixed.** Each now filters by organisation itself (defence in depth). |
| B7 | Low | No type checking existed for the server; 22 errors were hidden, including a startup crash I introduced during this work and a processing stage missing from the stage list. | **Fixed.** `npm run typecheck` added and clean. |
| B8 | Low | Tests still launched the server through a "bun" label and relied on a removed mock AI service. | **Fixed.** Renamed and rewritten around the built-in reader. |
| B9 | Medium | **Authorisation is thin.** Only `admin` is checked (settings, health). The `viewer` role exists in the database but is not restricted by the API, and there is no way to invite colleagues from the app. | **Open.** Needs role rules per route before more than one person per organisation uses it. |
| B10 | Medium | No password reset, no multi-factor sign-in. | **Open.** Needed before production. |
| B11 | Medium | No malware scanner. The record says so honestly. | **Open.** Planned late; required before production. |
| B12 | Low | Failed sign-ins and sign-outs are not in the audit log (successful sign-ins are). | **Open.** |
| B13 | Low | Original files are shown inline from our own origin. Browsers sandbox their PDF viewers, but a stricter default would be a download. | **Open, accepted for now.** |
| B14 | Info | Session checks are cached briefly (access token 30 s, organisation membership 10 s), so a removed person or revoked session works for a few seconds. | **Accepted.** |
| B15 | Medium | Everything runs on a Supabase **dev** project: no backups, no point-in-time recovery, one region. | **Open.** The owner wants the database under our own control; production needs its own project and key rotation. |

### Front end

| # | Severity | Finding | Status |
|---|---|---|---|
| F1 | High | **Personal data stayed in the browser after sign-out.** The profile page kept the person's name, email, phone, bio and photo in `localStorage`, and sign-out did not remove them; on a shared computer the next person could read it. Fourteen `console.log` lines also printed profile objects and emails. | **Fixed.** Sign-out now wipes every profile, photo and "last user" entry; all `console.log` calls are removed. |
| F2 | Medium | Fonts were fetched from Google on every page load: a third party saw each visitor's address and browser, and the content policy needed exceptions for it. | **Fixed.** Outfit and Sora are now served from our own site; the content policy allows no outside origin at all. |
| F3 | Medium | 63 of 111 front-end files and 19 packages were unused, including a second UI kit (Tailwind and shadcn) loaded beside Chakra: extra attack surface, extra supply chain, and two styling systems that could fight each other. | **Fixed.** Removed; the login page renders pixel-identically before and after. |
| F4 | Low | The page description said "AI-powered"; the platform uses no AI. | **Fixed.** Wording corrected. The same claim remains in the marketing pages (F7). |
| F5 | Medium | The profile page still works from browser-stored demo profiles, and a demo profile file (`/data/profiledata.json`, fictional people) is served publicly. While signed in, personal data sits in the browser. | **Open.** The profile must move to the API; then the demo file and the browser storage go. |
| F6 | Info | The content policy still allows inline styles (`style-src 'unsafe-inline'`) because the UI library injects styles at runtime. Inline scripts are not allowed. | **Accepted.** |
| F7 | Low | The marketing pages (Home, Features, Pricing) make claims that have not been verified (for example "AI-powered"). | **Open.** To be reviewed against what the product really does before launch. |

### Repository

| # | Severity | Finding | Status |
|---|---|---|---|
| R1 | High (process) | The `origin` remote is a **public** repository owned by another account. Pushing there would publish this code, the audit and the research. | **Handled.** Work is pushed only to `personal` (private). Do not push to `origin` without a deliberate decision. |
| R2 | Low | Two lock files (npm and pnpm), unused packages and a stale README. | **Fixed.** One lock file; README rewritten; documents organised under `docs/`. |

## 3. What still needs doing before real organisations use it

1. Apply migration `012` after review, then re-run `npm run schema:check`.
2. A production Supabase project (or our own database): backups, point-in-time recovery, key rotation, separate keys per environment. **Revoke the old leaked Anthropic key** (owner action).
3. Authorisation by role (B9), password reset and multi-factor sign-in (B10), sign-out and failed-sign-in audit (B12).
4. A malware scanner (B11).
5. Move the profile page to the API (F5) and review the marketing claims (F7).
6. An independent penetration test and a POPIA review (operator agreements, consent and purpose notice, retention, cross-border transfer) by a lawyer.

## 4. How to re-check

```bash
git log --all -p | grep -E "sk-ant|re_[A-Za-z0-9]{20}|eyJ[A-Za-z0-9_-]{20}" | head     # secrets in history
npm run build && grep -rE "service_role|DATABASE_URL|sk-ant" dist | head               # secrets in the bundle
npm audit --omit=dev && (cd server && npm audit --omit=dev)                            # dependencies
npm run typecheck && (cd server && npm run typecheck && npm test)                      # types and tests
```
