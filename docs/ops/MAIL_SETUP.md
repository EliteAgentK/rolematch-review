# Mail setup: what the owner must supply (nothing here has been done for you)

RoleMatch owns the mail policy, queue, templates and records. The one outside piece is an **SMTP submission service**: today the existing hosting (see `MAIL_HOSTING_FINDINGS.md`). No Resend or other hosted mail API is used or kept as a fallback.

## What is built and what is not connected
* Built and tested against a **simulated** mail host: SMTP transport (nodemailer), verification-code sending, invitation outbox, attempt records, quota with reserved headroom for verification, suppression, typed failures, local-only link guard, honest states.
* **Not connected:** no real mail host has been used. Mail is reported **unavailable** until `MAIL_TRANSPORT=smtp` and the host and login below are set. While unavailable, sign-up codes cannot be sent, and invitations are saved and wait (never marked sent).

## Owner actions, in order
1. **Ask domains.co.za (the host of `cp76.domains.co.za`) in writing:** may an application send automated transactional mail through this hosting plan; what are the hourly and daily sending limits for the domain and per mailbox; may an extra mailbox be created for the application login; which host name does the SMTP certificate cover (it showed `cpcontacts.rolematch.co.za`, not `mail.rolematch.co.za`); is a bounce mailbox readable over IMAP. Give me the numbers; the default of 60 an hour stays until then.
2. **Create a dedicated mailbox for the application** (for example `app-mail@rolematch.co.za`) if the host allows sending as `info@rolematch.co.za` from it; otherwise `info@` itself must be the login, and its reputation and hourly limit are then shared with normal correspondence (tell me which). Do not change the existing `info@` password.
3. **Enter the credential with the tool, never by hand or in chat.** In a terminal, from the `server` folder, run `npm run mail:config -- credentials`. It asks for the mailbox password at a hidden prompt (twice), writes it to `server/.env` without displaying it, keeps the file private (mode 600), updates the existing keys in place (no duplicates, other settings untouched) and checks that the value reads back exactly with the same parser the server uses. It refuses a password containing a line break or other control character, or all three quote characters at once (the file format cannot hold those: change the password). `npm run mail:config -- status` shows what is set, never the password.
4. **Application address:** set `PUBLIC_APP_URL` (https, real) for deployed links. While it is `http://localhost:...` links are local-only: in restricted mode they go only to the approved recipients and are labelled as local test links; in live mode nothing is sent.
5. **Approve recipients, then enable (in this order; the tool refuses otherwise):** `npm run mail:config -- allow <addresses>` then `npm run mail:config -- enable`, then restart the server. Sending is **default deny**: with a transport but no approved list, nothing is sent; with the list, real mail goes only to those addresses for **every** message type (verification codes and invitations alike). `mode live` (anyone) exists but needs an explicit flag and an explicit decision. `npm run mail:config -- disable` switches everything off at once.
6. **DNS (owner decision, not done):** SPF already authorises the host and DKIM (`default`) exists. DMARC is `p=none` with no report address: add `rua=` and review before tightening. Edit the existing SPF record if ever needed; never add a second one.
7. **Agree test recipients** (addresses you own). First real tests, reported separately: (a) a verification code to an agreed address, (b) an invitation to an agreed address followed by acceptance. Spam placement will be noted but is not proof of general deliverability.

## Operating notes
* Rotate the mailbox password in the host and in the secret store together; restart. Nothing else holds it.
* A suppressed address (permanent refusal) lapses after `MAIL_SUPPRESSION_DAYS` (7). An operator may clear one early by deleting its row from `mail_suppressions` (platform table).
* Bounces return to the sender address (or `MAIL_BOUNCE_ADDRESS`) and are **not** read automatically: until an IMAP reader exists, an administrator watches that mailbox. This is a known gap.

## Safety for automated tests
* Every automated entry point is isolated: the server never reads `MAIL_*` from `.env` when `DB_SCHEMA` is a test schema, `VITEST` or `NODE_ENV=test` is set (`src/config.ts`; tested by `config-isolation.test.ts`), the test helper also pins mail off, and mail tests use only a simulated host.
* Browser tests (`npm run test:e2e`) target an existing server, so their setup first calls `GET /api/health/mail` and **refuses to run** unless sending is off or restricted. The status contains no credential and no address.
