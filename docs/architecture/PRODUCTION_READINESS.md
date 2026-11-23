# RoleMatch production readiness

Living checklist of what must exist before real customers. Goal: enterprise SaaS, thousands of users. Update as items are done. A passing test is not production readiness.

## Scaling approach (user note, 2026-10-19, from a Slack engineering talk)
Do not build for millions of users on day one. Design for about 100-200 users at launch and make features and performance solid for that. Then review usage data every day, plan scaling quarterly from real numbers, deploy small changes many times, and look after the running system. So: measure first (monitoring, usage and queue metrics, slow-request logs), scale where the data shows a bottleneck, and avoid speculative infrastructure.

## Already in place (dev level)
- Multi-tenant database, every organisation's data separated by `org_id`, enforced by PostgreSQL row rules as well as the code (migration 014; see ARCHITECTURE.md).
- Document reading can run in separate worker processes (`ROLE=api` + `npm run worker`); sign-outs are shared through the database.
- Durable Postgres queue, fair between organisations, with fair-use limits per organisation.
- Sign-in through Supabase, append-only audit log, rate limits, CSRF check.
- Tests run against the real database in throwaway schemas.

## Needed before real customers (suggested order)
1. **Backups and recovery**: dev database has none. Production needs daily backups, point-in-time recovery, and a restore we have actually tried.
2. **Separate environments**: dev, staging and production each with their own database and keys; repeatable, reversible deploys.
3. **Monitoring and alerts**: error tracking, logs, uptime checks, alerts for queue backlog and slow requests.
4. **Run more than one server**: rate limits and caches are in one process's memory today; move them to shared storage (Postgres or Redis).
5. **Containers and automated deployment**: package the server, automate tests and deploys. The backend now runs on Node 24 (done 2026-10-19); still to do: the container and the deploy pipeline.
6. **Security**: malware scanner (deferred to the end), zip-expansion and upload limits, regular dependency checks, independent penetration test before launch.
7. **Privacy and compliance**: POPIA (and GDPR if serving Europe), retention and deletion rules, consent, data-processing agreements with Supabase, Resend and others. No SOC 2 / ISO 27001 certificates exist, so marketing pages must not claim them.
8. **Load testing**: prove thousands of users before claiming it.
9. **Team features**: invites, roles and permissions; later SAML single sign-on.
10. **Legal**: terms, privacy policy, a lawyer's view on copyright of AI-written code.
11. **SEO and meta descriptions (very important to the user)**: today only one site-wide `<title>` and description exist in `index.html`, so every page looks the same to Google. Needed: a unique title and meta description for each public page (Home, Features, Pricing, Contact, Login, Sign up), Open Graph and Twitter share cards with an image, a canonical URL per page, `robots.txt` and `sitemap.xml`, structured data (Organization and SoftwareApplication), and `noindex` on signed-in pages. Because the site is a single-page React app, crawlers may not see per-page tags, so we need pre-rendering or server-rendered tags for the public pages. Descriptions must stay honest (no unverified SOC 2 / GDPR / "eliminate bias" claims). Also check page speed (Core Web Vitals), image alt text and heading order.

## Gaps found 2026-10-28 (queued; started only when the owner says "let's deal with the gaps found")
Found by comparing a multi-tenant SaaS guide (Rishabh Software) and IBM's multi-tenancy kit (github.com/IBM/multi-tenancy) with RoleMatch. Isolation itself is already ahead of both (database-enforced, tested on every endpoint); these are the gaps, in order:
1. **The viewer role is not enforced (a fault).** The database allows admin, recruiter and viewer, but the server only checks for admin on Settings, so a viewer can upload, edit, delete and match. To do: read-only for viewers on the server (403), actions hidden in the website, proven by a test of every route for every role.
2. **No team management.** Sign-up creates one organisation and one administrator; nobody can be invited and roles cannot be changed. To do: invite by email code, change role, remove member, all audited and per organisation.
3. **No health view per organisation.** To do: queue backlog, processing time, failures, request volume and slow requests per organisation, with an alert when one organisation slows the others.
4. **No automated safety pipeline.** To do: a CI pipeline (prepared locally, published only with approval) running the tests, secret scanning and a dependency audit.

Later, for corporate clients: a dedicated database for a large client; sign-in through a client's own identity provider (SSO); releasing changes to selected organisations first.

## Route to production (agreed 2026-10-27; not rolling out yet)

The owner's order: first make sure the platform is secure, fully up to date and still works as intended (dependency upgrades, below), then production.

1. **Owner decisions:** hosting (ADR-003) with supplier quotes, domain name, mail sending (the existing mail host's written limits, an application mailbox, DMARC), a second person on call, one to three pilot organisations, and the malware scanner (ClamAV's GPL licence conflicts with the "permissive only" rule).
2. **Make it deployable** (no cost): dependency upgrades; a container image; an automatic test pipeline on GitHub (none exists yet); separate development, staging and production settings with secrets out of files; rate limits and sign-out records moved from memory to the database so more than one server can run; a load test.
3. **Staging on real servers:** deploy, restore-tested backups, monitoring, alerts and a status page, outage rehearsals on the real setup, an independent penetration test, the POPIA paperwork.
4. **Pilot, then launch:** one to three organisations with consented real CVs, accuracy measured against their recruiters; then launch with honest marketing pages and SEO.

Product work (AI reading and matching side by side with the rules, candidate explanations, per-application workflow status, the profile page) continues alongside.

## Dependency routine (since 2026-10-27)

* `npm test` includes `test/dependencies.test.ts`: any known high or critical vulnerability in the website or backend packages fails the tests (skipped, and saying so, when the npm registry cannot be reached).
* Monthly: `cd server && npm run deps:report` lists vulnerabilities, outdated packages (marking breaking upgrades) and whether Node is the newest long-term support release. Small updates are taken one at a time with tests, build, browser tests and the screenshot checks (`npm run visual:baseline` / `visual:compare` for the public pages; `npm run test:visual` for every screen and state, light and dark, pixel for pixel).
* Chakra UI moved from 2.10 to 3.37 on 2026-10-27 with every captured screen pixel-identical (docs/frontend/CHAKRA3_MIGRATION.md).
* Holds: onnxruntime-node stays where @huggingface/transformers pins it.

## Language and runtime guidance
- TypeScript for API, queue, matching, frontend. Python only for OCR/document-AI worker services (licences checked first). Java not needed.
- Node 24 LTS for the backend (Bun was dropped on 2026-10-19 for enterprise trust and hosting support).
- Everything shipped must be permissively licensed (no licence fees).

## Configuration instead of hard-coding (user rule, 2026-10-19)
Move into per-organisation, versioned, audited settings (an `org_settings` table, an admin-only settings API, and a frontend settings provider with sensible defaults): workflow statuses (name, colour, order), terminology/labels, panel display (fields shown, skills/roles per panel), review thresholds, fair-use limits. The scoring ruleset stays fixed and RoleMatch-only. Remove dead demo content and the fake profile data.

## Upload failure handling (user note, 2026-10-19)
Done: a document that cannot be added shows a notice that stays until closed (for single uploads) saying why and what to try, then clears itself; the exact code is in the server error log and the audit trail. Several failures at once become one notice.
**Later (batch uploads):** when several CVs are uploaded together, show one summary pop-up once the whole batch finishes, listing which files failed and why (with the same plain reasons and hints), and which succeeded. Also give recruiters a way to look at past failures (an upload history / error log view).

## File size and page limits (user decision, 2026-10-19)
**CVs have no page limit (owner rule, 2026-11-02):** every CV is read in full, including every page of a scan by OCR; the page count is recorded for the audit trail only. This replaces the seven-page CV hold of 2026-10-29. Defaults (all settings, to move into per-organisation configuration): at most **12 pages** per job description PDF (refused with a clear reason above that), **50 MB** accepted for upload, **15 MB** after optimising, optimiser tried above **2 MB**.
**Own optimiser (`server/src/optimise.ts`)**: phase 1 done: large *scanned* PDFs are rendered at 200 dpi, re-encoded as JPEG and rebuilt (pdf.js + @napi-rs/canvas + pdf-lib, all permissive); the smaller file replaces the stored one only if OCR agreement on the first pages is at least 90%. The stored file is "the original, made smaller for speed" (`documents.optimised`, `original_size`). Heavy sample: 4.7 MB to 0.33 MB. **Phases 2 and 3 done:** text PDFs with large embedded photos (only the pictures are shrunk, the text must read byte-for-byte the same) and Word files (pictures shrunk; opaque PNGs become JPEGs with every reference updated; the words and the picture count must be unchanged). Samples: a 6.5 MB text PDF becomes 0.3 MB, a 5.3 MB Word file 0.3 MB. **Caveat:** Word files were verified by re-reading them, not by opening them in Microsoft Word itself, so open a few optimised .docx files in Word before launch. **Formats and OCR (done, with caveats):** JPEG and PNG photos, .doc, .rtf, .odt and .txt are accepted (`server/src/formats.ts`). Photos are straightened, de-shadowed and cropped before OCR (`imageprep.ts`), OCR word positions are put in reading order with the same column logic as PDFs (`layout.ts`), and OCR below 50% average confidence is refused with a plain reason rather than published from guesses. On the synthetic degradation set (`npm run eval:ocr`) word recovery went from 72% to 100% for a phone photo in good light and from 15% to 99% for a poor one. **These numbers come from invented CVs; real consented scans have not been measured.** Not supported: iPhone HEIC (refused with instructions), several photos as one CV, handwriting, rotated-sideways photos without a camera orientation flag. `.doc` uses `word-extractor` (MIT, unmaintained since 2022, parses untrusted binary files in-process: keep it behind the queue and the type check, and review before production). **Still to do:** PDFs with transparent or CMYK pictures are left as they are. Industry notes to revisit: archival PDF/A, mixed-raster-content compression for scans, OWASP file-upload guidance.

## Outside-provider incidents (log)

Recorded so the dependency on hosted providers is judged on what actually happened, not on uptime claims. See ADR-001 for the plan to run our own PostgreSQL.

| Date | Provider | What happened | Effect on RoleMatch |
|---|---|---|---|
| 2026-10-22 | Supabase | "API Gateway Request Issues" on the Supabase status page, ongoing for about 3 hours and in Monitoring when noted; every listed component (Postgres, Data APIs, Connection Pooler, Functions) still showed green. | During the same window the test run lost the dev project for a while (`getaddrinfo ENOTFOUND <project>.supabase.co`): 21 tests failed on upload, sign-up, email and deletion with 500s. The same tests passed unchanged once the address resolved again. No data was lost. It shows that RoleMatch's login, storage and database all stop together when the provider's gateway fails, and that a green component list did not reflect it. |
| 2026-11-06 | Own host (the Mac) and Cloudflare quick tunnel | The Mac that runs live was on battery; at 01:22 SAST it reached 1% and slept until 08:02. While it slept the quick tunnel lost its connection and its address `hotel-changing-desperate-outstanding.trycloudflare.com` stopped resolving for good. | Live was unreachable from about 01:22 until about 08:20. Restored by restarting the tunnel container (new address `recreational-cruise-plains-kerry.trycloudflare.com`), changing `ALLOWED_ORIGINS` and `PUBLIC_APP_URL` in the live settings to it (backup `mac.env.before-tunnel-*`), and recreating the containers on the same release `7a3d8a5`. Checked: ready, new origin accepted, old refused, data APIs 401 without sign-in. No data was lost. It shows that live depends on the Mac staying on mains power and awake, and that a quick-tunnel address does not survive an outage: a named tunnel or a fixed host would. Anyone holding the old address must be given the new one. |
| 2026-11-06 | Own hosts (change, not an outage) | Live moved from the Mac to the Dell PC (WSL 2, Docker), with the model staying on the Mac behind a private link the Mac opens. Reason: the Mac's model wrote at 7 to 15 tokens a second while the Mac also ran live and tests. | About 3 minutes unavailable at 10:42 SAST. Backup 20261106T084204Z first; the Mac containers kept for rollback. Verified from outside: ready on d45ce2d, sign-in rule, data needs sign-in, model link, health healthy (database 176 ms). The Mac's model then wrote at 41 to 43 tokens a second. New address therapy-caused-circulation-interior.trycloudflare.com. Runbook: docs/ops/LIVE_ON_PC.md. |
| 2026-11-10 | Own host (the Dell PC, WSL) | At 04:59:18 SAST Windows told the RoleMatch Linux to power off (`systemd-logind: The system will power off now!`). Linux had run normally all night (no gap in its log) and WSL had not been updated (files dated 8 Oct); which Windows component asked is in Windows' event log, closed to the limited account. The shutdown took longer than WSL's 10 s, WSL forced it off (`InitTerminateInstanceInternal ... calling reboot(RB_POWER_OFF)`), and Windows' WSL service then jammed: every start, `wsl --terminate` and `wsl --shutdown` hung. The same 10 s forced stop happened twice on 6 Nov without a jam. Seen alongside: WSLg's display server (weston) crashed 3,101 times since 6 Nov, which RoleMatch does not use. | Live was unreachable (Cloudflare error 1033) from about 04:59 until 06:08. Found by the owner on their phone at 05:29: every watcher (host status, daily check) runs inside the Linux that stopped, so nothing reported it. The limited account may not restart Windows remotely; the PC was restarted at the PC, and all services came back by themselves at 06:08 (ready, site 200). No data was lost. It shows that live needs a watcher outside the Linux it watches, an outside check that reaches the owner's phone, and an automatic recovery that does not depend on someone at the PC. |
