# Verification-code lifetime: who enforces what (corrected)

**Correction:** an earlier note called the provider's longer expiry "harmless". That was not established, and is withdrawn. This page lists every way a code can be confirmed and which rule protects each.

**Second correction (2026-10-30, probed against the shared dev project):** this page also said the direct provider path needs the server's key. **That was wrong.** `POST /auth/v1/verify` (code or hashed token) and `GET /auth/v1/verify` (e-mail link) answer without any `apikey` and with a wrong one; other Auth routes (for example `/auth/v1/settings`) refuse without a key (401). Anyone who has the code and knows the project's address can confirm the address directly, outside RoleMatch's 15-minute lifetime and its wrong-code limits (only the provider's own rate limits apply). The project address is not in the frontend bundle, but it is not a secret and must not be treated as one. See ERROR_REGISTER R32.

## Policy
A verification code is valid for **15 minutes** from the moment *that code* was issued. A resend is always offered; a new code is issued at most once every **60 seconds** per address; issuing a new code makes the previous one unusable at once.

## Every confirmation path
| Path | Who can use it | Enforced by | Limit today |
|---|---|---|---|
| RoleMatch `POST /api/auth/verify` (the only path the product uses) | the person signing up | RoleMatch **per-code** record (`signup_challenges`: its own issue time, replaced-by-newer, consumed) **and** Supabase Auth (correctness, single use, its own expiry) | 15 minutes, and refused once replaced or used |
| Direct call to Supabase Auth `/auth/v1/verify` with the code (POST) or a link (GET) | **anyone** with the code and the project address: no key is needed (probed 2026-10-30) | Supabase Auth only, for **confirming the address**. Since R32, RoleMatch refuses to create an organisation or join a portal for an address confirmed this way (onboarding needs a RoleMatch code consumed after the account was created) | the project's OTP expiration (3600 s unless changed) |
| A confirmation link built from the provider's hashed token | nobody: RoleMatch never e-mails links, only codes | Supabase Auth only | same setting |
| Other provider-managed e-mails (recovery, magic link, e-mail change, invite) | none are enabled or used by the product today | Supabase Auth, **one OTP-expiration setting shared by all of them** | same setting |

So until the provider's setting is aligned, the provider-only path accepts the latest code for up to an hour and with the provider's (not RoleMatch's) limits on wrong guesses. What that still allows, after R32: an address can be marked **confirmed at the provider** without RoleMatch; that identity gets **no organisation, no membership and no portal** (sign-in is refused), and the person cannot finish through RoleMatch afterwards (the code is spent). What it no longer allows: reaching any portal. Remaining effects are an unusable confirmed account (support must delete it) and wrong-code guessing at the provider's rate rather than ours. Aligning to 900 s shortens that window by three quarters; it does not close the path, which belongs to the provider.

## Recommended alignment (needs your approval; I have not changed anything)
Set the shared Supabase project's **OTP expiration to 900 seconds** (Authentication > Providers > Email > OTP expiration; or `mailer_otp_exp` through the management API, which needs a personal access token that I do not have and must not be given in chat).
Effects to review before approving:
* The setting is shared by every provider-managed e-mail code/link on the project. Nothing else uses it today. If the Supabase-hosted password recovery or magic links are enabled later, they would also expire in 15 minutes (reasonable for recovery).
* RoleMatch's own per-code rule already enforces 15 minutes, so aligning the provider changes only the provider-only paths above. It does not change invitations (their own 7-day links).
* After changing it, run the local-expiry test and a manual check: request a code, wait 16 minutes, confirm both RoleMatch and Auth refuse it. The setting cannot be read back programmatically without the token; the dashboard value is the evidence.

## What is tested, and what kind of evidence it is
* RoleMatch per-code rules (15 minutes on its own issue time, replaced code refused, newer code never extends an older one, resend and verify at the same instant produce one winner): automated, real Supabase Auth, issue time **simulated** by moving the record's timestamp.
* Provider expiry and single use: `auth-expiry.test.ts` against a **throw-away local Auth container** with a 4-second lifetime (real provider software, isolated; skipped when Docker is not available) plus a simulated-provider test of how RoleMatch reacts to an expired answer. The shared project's configured lifetime is **not** verified by any test.
