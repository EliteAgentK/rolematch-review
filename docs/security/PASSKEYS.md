# Passkey sign-in

Optional sign-in with a passkey (WebAuthn/FIDO2), set up 2026-11-03. **Status: implemented and tested locally. Off by default, not enabled on the hosted project, and not yet tried on a real device.**

## How it works
- **Sign-in service:** Supabase Auth remains the only identity store. Its passkey feature is **in beta** ([changelog](https://supabase.com/changelog/46458-passkeys-for-supabase-auth-beta), May 2026); its JavaScript API is marked experimental. RoleMatch doesn't use that browser client: our server calls the service's passkey endpoints directly, so the endpoint shapes are the dependency. They changed once in April 2026 (`fix(passkeys): modify the passkeys request and response shapes`), which is the main risk of relying on a beta. Local version tested: Auth v2.197.0.
- **Session:** a passkey sign-in ends in the same tokens and HttpOnly cookies as a password sign-in, and goes through the same session checks. There's no frontend-only "authenticated" flag.
- **Face and fingerprint data:** RoleMatch never receives any. The device checks the person with whatever it has and reports only yes or no. The server stores nothing about passkeys itself; the sign-in service stores the public key and metadata.

## What each side checks
| Check | Who |
|---|---|
| Challenge generation, storage, 5-minute expiry, single use | sign-in service |
| Origin, relying-party identity, signature, signature counter (including synced passkeys) | sign-in service, using the maintained `go-webauthn` library |
| Duplicate credentials, per-person limit, a challenge bound to the person it was issued to | sign-in service |
| **User verification required** (the service only prefers it) | **RoleMatch**: reads the flag inside the signed authenticator data, before relaying. The signature covers that flag, so it can't be faked past the service's check |
| **Recent sign-in to add or remove** (15 minutes, `PASSKEY_RECENT_MINUTES`) | **RoleMatch**: otherwise asks for the password, in place |
| **Membership, portal access, invitations** | **RoleMatch**: the same checks as a password. A passkey proves who someone is, not that they belong |
| **Rate limits** | **RoleMatch**: 60 challenge requests a minute and 30 rejected sign-ins per 15 minutes, per address, because an office shares one address. A cancelled prompt never reaches the server |

**Audit log:** `auth.login` with `via: passkey`, `passkey.added`, `passkey.removed` and `auth.reauthenticated`. No key material or signatures.

## Setting it up for an environment
1. Switch it on in the sign-in service, with this site as the relying party.
   - **Local:** `supabase/config.toml` (`[auth.passkey]`, `[auth.webauthn]`).
   - **Hosted:** dashboard, Authentication > Passkeys.
2. Set `PASSKEYS_ENABLED=true` on the server. The website only offers it when this says so.

**A passkey belongs to one site name.** One made on `localhost` doesn't work in production, and the reverse. Production's relying-party ID must be chosen deliberately before anyone enrols, because changing it later makes every passkey stop working. Use the bare domain (for example `rolematch.co.za`, if that is the final domain), with the exact sign-in origins listed.

## Evidence
**Against the real sign-in service, with a software authenticator making real keys and signatures (`test/passkeys.test.ts`, 11 tests):**
- enrolment after recent sign-in;
- sign-in with no e-mail or password, reaching the same person, organisation and portals, with real cookies;
- replayed, expired and non-existent challenges;
- wrong origin and wrong relying party;
- a key nobody enrolled;
- missing user verification, at sign-in and at enrolment;
- cross-account enrolment, listing and removal;
- duplicates;
- recent-sign-in enforcement, and a wrong password refused;
- removal;
- lost device;
- a removed member refused with no session;
- switched off.

**In real Chrome with its virtual authenticator (`test/passkey-browser.test.ts`, 5 tests; `PASSKEY_BROWSER=1`):**
- the agreed wording;
- enrol from the Security tab, then sign in without typing;
- the session cookie is unreadable by page code;
- a device that can't confirm the person leaves them on the sign-in page with the password available;
- the invitation return;
- removal.

## Not proven
- **A real device.** A virtual authenticator proves the page and protocol. **It doesn't show Face ID or Touch ID working.** That needs a person with a real device, and each platform (iPhone, Mac, Windows) is its own check.
- **The hosted project:** passkeys aren't switched on there. Its Auth version and behaviour are untested.
- **A real invitation** end to end with a passkey: only the return to the invitation page is tested; accepting one with a passkey session uses the normal accept route.

## Review of the weaker routes
- **The password remains, and it's the weaker route.** A passkey resists phishing; a stolen password still gets in, so adding a passkey doesn't make an account phishing-resistant by itself.
- **There is no "forgot password" flow.** Someone who loses both their device and their password has no self-service way back; today it needs an administrator with access to the sign-in service. Any reset flow added later must not be weaker than what it protects, and must tell the person when it's used.
- **Not implemented, recommended for the owner to decide:**
  - e-mail the person when a passkey is added or removed (needs real mail);
  - require a passkey or second factor for administrators (a policy change);
  - a limit on how long a "recent" sign-in lasts for administrators.
- **An abuse alert isn't wired yet:** rejected passkey sign-ins are counted and limited, but the monitor doesn't watch them.
