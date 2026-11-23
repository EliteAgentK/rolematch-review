# Notifications: ownership, catalogue, contracts, capacity

RoleMatch owns the policy, templates, queue, limits, lifecycle states and audit. The **only** external dependency is an SMTP submission service (today: the existing hosting, see `docs/ops/MAIL_HOSTING_FINDINGS.md`) behind a small interface (`src/mail/transport.ts`). No hosted e-mail API and no fallback provider is used.

## Who authors what
| Concern | Where | Notes |
|---|---|---|
| Sender, SMTP endpoint, limits, URLs | environment (`MAIL_*`, `PUBLIC_APP_URL`), validated at start (`config.ts`) | secrets (`MAIL_SMTP_PASS`) only in the environment or the host's secret store; never tenant-editable, never logged |
| Notification policy (class, priority, expiry, retry) | `src/mail/catalogue.ts` (code, versioned) | tenants cannot weaken security ceilings |
| Verification codes | Supabase Auth issues and checks them (expiry, attempts, single use, invalidation on resend); RoleMatch only sends the e-mail, **synchronously, and never stores the code** | integrating, not competing, with the identity authority |
| Invitations | `portal_invitations` (state of the invitation) separate from `outbox` (logical notification) and `mail_attempts` (each SMTP attempt) | accepted stays accepted whatever a later delivery event says |
| Templates | `src/email.ts` (approved branding) | escaped, plain-text alternative, "Sent via RoleMatch" |
| Limits and priority | `src/mail/limits.ts` + outbox claim order | authentication mail has reserved headroom; bulk classes cannot use it |

## Catalogue (status honest)
| Notification | Purpose | Recipient | Priority | Expiry | Dedupe | Preference | Status |
|---|---|---|---|---|---|---|---|
| E-mail verification code | security | the address registering | 0 (highest) | 15 minutes, enforced by RoleMatch before Supabase is asked (`OTP_EXPIRY_MINUTES`) | one live code per address; a resend (offered always, issued at most once per 60 s per address) invalidates the earlier one | cannot be disabled | **implemented** over SMTP; direct, not queued |
| Portal invitation | collaboration | one invited address | 1 | invitation expiry (7 days) | one event per invitation version | cannot be disabled by recipients; organisation may lower allowance | **implemented** (outbox) |
| Invitation reminder (authorised) | collaboration | pending invitee | 1 | invitation expiry | resend = new version | – | **implemented** as "resend" |
| Welcome after activation | account | new user | 2 | none | once per account | optional | deferred (contract defined) |
| Password recovery / change, e-mail change, security alerts | security | account owner | 0 | short | per challenge | cannot be disabled | **deferred**: sign-in is by an emailed code/password flow in Supabase Auth; there is no recovery screen in the product yet. Contract: purpose-bound, Supabase-issued, never queued with plaintext |
| Membership / role change, access removal | collaboration | affected member | 1 | none | per change | admin-configurable | deferred (events exist in audit) |
| Invitation accepted (to inviter) | collaboration | inviter | 2 | none | per invitation | optional | deferred |
| Batch completion summary / final failure / review-required summary | operations | submitter | 2 | none | one per batch closure | personal preference | deferred: the closure event exists (`batch.finished`); needs preference storage |
| Billing events | billing | organisation billing contact | 1 | – | provider event id | – | **not applicable: there is no billing system.** Contract only: send on a verified billing event, never on a browser redirect; no invoice/refund claims without the billing record |
| Product updates / offers | marketing | consenting individuals | 3 | – | – | consent + unsubscribe | **disabled** (not built). Needs consent, unsubscribe, suppression, and a legal review of South African marketing rules before it is switched on. Verification is never consent |

Per-success mail is not sent. Precedence for settings: platform ceilings > organisation settings (may lower, never raise) > personal preferences (optional classes only).

## Delivery states (what the product says)
`queued` -> `deferred` (waiting for the hourly allowance; spends no attempt) -> `attempting` -> **`accepted by the mail server`** (SMTP 250: the server took responsibility; not inbox proof) | `retrying` (temporary failure, bounded) | `failed` (permanent rejection or retries used up) | `expired` / `cancelled` (no longer valid when its turn came). Not implemented, so never claimed: *delivered* (needs a feedback source), *bounced/complained* (needs the bounce mailbox to be read: **gap**, interim: administrators read `info@`/bounce mailbox).

**Uncertain outcome:** if the connection drops after the message was sent but before the answer, the attempt is recorded `uncertain` and **retried** (a duplicate e-mail is possible; the link inside is the same single-use invitation link, so a duplicate cannot create a second membership). SMTP gives no exactly-once guarantee; this is the documented trade-off.

## Capacity planning (a planning scenario, not a claim)
Let H = the host's real hourly limit (unknown). Messages per hour needed = invitations + verifications + retries (each retry is another SMTP send) + other classes.
* 10,000 invitations/day if spread over 8 working hours: **1,250/hour** before retries; with a 5% retry rate **about 1,310/hour**; plus verification (say 1 per new account).
* Over 24 hours: about **417/hour**.
* The application default is **60/hour** until H is known (reserve 15 for authentication). A queue cannot create sending capacity: at 60/hour, 10,000 invitations take about **7 days**.
* Therefore the claim "supports 10,000/day" requires H of at least ~420 (24 h) or ~1,300 (working hours) in writing from the host, or a different relay. Measure, do not assume.

## Built in the owned-mail slice (2026-10-29), all against a simulated mail host
* `src/mail/transport.ts`: the only code that knows SMTP (nodemailer, MIT-0). Typed failures: temporary, permanent (with the enhanced status code), unavailable (login/configuration), uncertain (connection broke mid-send). Header-injection refused, never cleaned. Certificate checking and TLS 1.2+ enforced. A preview transport writes files and is never reported as sent.
* `src/mail/index.ts`: one sending path with a rolling hourly allowance shared across servers (advisory-locked count-and-insert), headroom reserved for authentication, suppression after permanent address refusals (7 days), one `mail_attempts` row per SMTP attempt (keyed recipient hash, no readable address, no code), metrics for operators.
* `src/outbox.ts`: priority order, expiry (never sent late), jittered backoff, permanent refusal ends at once, deferral spends no attempt, mail unavailable spends none either, validity re-checked as the last step before the message leaves, one Message-ID per logical message.
* Verification codes: synchronous, never stored by RoleMatch, never queued; "mail unavailable" is a distinct, honest answer (`MAIL-001`).
* Acceptance: inviter authority is re-checked at the moment of acceptance (`INVITE-INVALIDATED`); the link only identifies the invitation, acceptance is an explicit authenticated action; the token is removed from the address bar.
* Residual risks, stated: a send already in flight when a revocation lands cannot be recalled; SMTP cannot promise exactly-once; accepted is not delivered; bounces are not read (gap); a shared mailbox shares reputation and limit with normal correspondence.
