# Existing e-mail hosting: what was measured, what is unknown (2026-10-29)

Method: public DNS look-ups (read-only) and an **unauthenticated** connection to the host's SMTP ports that read the greeting and capabilities and then quit. No login, no message, no DNS change, no mailbox touched. Run from the development laptop (197.221.123.98 at the time).

## Measured
| Item | Finding |
|---|---|
| Domain `rolematch.co.za` MX | one record: `10 mx1.tld-mx.com` (hosted mail) |
| SPF (TXT at the domain) | `v=spf1 +a:mail.rolematch.co.za +mx include:_spf.tld-mx.com ~all`: one record, soft-fail. Authorises the hosting server and its MX. **Do not add a second SPF record**; any change edits this one record |
| DKIM | selector `default` exists (a 2048-bit RSA public key is published); so the host signs outgoing mail for this domain |
| DMARC | `v=DMARC1; p=none;`: monitoring only, **no report address**, so nobody receives reports and nothing is enforced |
| Server `mail.rolematch.co.za` | A record 169.239.218.76; greeting `cp76.domains.co.za ESMTP Exim 4.100.1`: a cPanel host at domains.co.za |
| SMTP ports | **465** (implicit TLS) and **587** (STARTTLS) both answered, TLS 1.3, certificate issued by Let's Encrypt for `cpcontacts.rolematch.co.za`, chain verified OK. The certificate **name differs from `mail.rolematch.co.za`**; the client must connect to a hostname the certificate covers (to be confirmed with the host) and must keep certificate verification on |
| Authentication | `AUTH PLAIN LOGIN` offered (only after TLS) |
| Advertised limits | message size 52,428,800 bytes (50 MB); `MAILMAX=1000` messages per connection; `RCPTMAX=50000` recipients per message |
| Greeting notice | "We do not authorize the use of this system to transport unsolicited and/or bulk e-mail." This forbids bulk/unsolicited mail; **whether automated transactional mail is allowed is a matter for the host's terms, not decided by this banner** |

## Not measurable from here: the owner must obtain from domains.co.za (cPanel > Email > Track Delivery / their terms, or support)
1. Is automated application sending of transactional e-mail permitted on this plan? In writing.
2. **Hourly and daily sending limits** for the domain and per mailbox (the host enforces these outside the SMTP greeting; they are not advertised). Our planning default is deliberately small (60 an hour) until this number is known. Do not raise it without the number.
3. Can a **separate mailbox** be created for the application login (so the application credential is not `info@`'s password and can be rotated or revoked on its own)? Recommended: a mailbox such as `app-mail@rolematch.co.za` that is allowed to send **as** `info@rolematch.co.za` only if the host permits (some cPanel hosts refuse a From that is not the authenticated mailbox). If it refuses, the credential must be `info@`'s own, which ties application mail to the normal correspondence mailbox: **reputation and the hourly limit are shared with normal correspondence**.
4. Bounce handling: bounces return to the envelope sender. A dedicated bounce mailbox (for example `bounces@rolematch.co.za`) can be read over IMAP; the host's delivery log (Track Delivery) is a manual screen, with no API that we know of.
5. Whether outgoing connections from the machine that will run the server (a laptop today, a server later) are allowed, and from which addresses. cPanel hosts commonly allow authenticated submission from anywhere, but this is not confirmed.

## Suitability, plainly
* **Technically usable:** yes. Authenticated submission on 465/587 with modern TLS is exactly what a transactional application needs, and DKIM and SPF already cover the host.
* **Capacity:** unknown until item 2 is answered. A shared cPanel host typically allows hundreds, not tens of thousands, per hour, and is shaped for a person's correspondence; **10,000 invitations a day is not supported by evidence** (see the planning table in `docs/architecture/NOTIFICATIONS.md`).
* **Reputation risk:** one shared sending address for correspondence and application mail means a burst of invitations that bounce can hurt the mailbox people use daily.
* **Operating our own mail server** is a different project (a public server, reverse DNS, IP reputation, warm-up, abuse handling). It is not done here and not free.
* **Cheapest way to keep portability:** the application talks to an interface (SMTP). Moving to a different SMTP host, a dedicated mailbox, or an owned relay later is a configuration change, not a code change.

## Deliberate non-actions
No DNS was changed; no mailbox or password was changed; no message was sent. DMARC moving from `p=none` to enforcement, adding a report address, and changing SPF `~all` to `-all` are recommended later steps that depend on a clean reporting period: owner decision.

## Owner-confirmed settings (cPanel, `info@rolematch.co.za`)
SMTP host `mail.rolematch.co.za`, port 465, implicit TLS, username `info@rolematch.co.za`. The certificate check above validates this exact host name. These settings do **not** establish permission for automated sending or any hourly/daily allowance: both remain outstanding questions for the host.

## Deferred by the owner (2026-10-30): RoleMatch icon beside the sender in inboxes
Gmail shows no RoleMatch icon beside `info@rolematch.co.za` (it uses a letter). Website favicons are not used by mail clients. Two routes, both deferred ("problem for later"):
* **Google profile picture** for `info@rolematch.co.za` (register the address as a Google account, no Gmail mailbox, set the RM icon). Free, Gmail recipients only, not guaranteed. Owner action (account creation).
* **BIMI**: a DNS `default._bimi` record pointing to the logo as SVG Tiny PS; DMARC moved from `p=none` to `quarantine` or `reject` first (after confirming every legitimate sender passes); for Gmail, a paid Verified Mark Certificate (needs a registered trademark) or Common Mark Certificate (logo in public use about a year). Each step needs owner approval: DNS change, DMARC policy change, purchase.
The full logo is already embedded at the top of every message; that is unaffected.
