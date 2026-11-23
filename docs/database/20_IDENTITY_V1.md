# Our own sign-in, first slices: one interface, two implementations, then the switch

Written 8 November 2026, before any code (owner rule: plan with diagrams first). It builds [05_IDENTITY.md](05_IDENTITY.md) and phase 2 of [13_PLAN.md](13_PLAN.md). Live keeps Supabase's sign-in until the cutover; nothing here changes live until the switch, which is the owner's to authorise.

## Where it starts (counted 8 Nov)

Everything about who someone is goes through Supabase Auth, from three places only:

| Where | What | Count |
|---|---|---|
| `server/src/supabase.ts` | account creation and deletion, sign-up and recovery codes, password sign-in, refresh, sign-out, session lists, access-token checks against Supabase's signing keys, passkeys | about 20 functions |
| `server/src/auth.ts` | direct reads of `auth.users` (confirmed? name of a pending sign-up? created when?) | 4 queries |
| migration 001 | `profiles.user_id references auth.users(id)` | 1 reference |

Our own database already runs all migrations with empty stand-ins for `auth.users` (deploy/db/00-roles.sh), marked "to be retired by the own-identity work".

## How it fits

```
                 ┌──────────────────────────── server/src/identity.ts : the one interface ─────────────────────────────┐
 auth.ts ──────► │ createAccount  deleteAccount  signUpCode  freshCode  verifySignUp  recoveryCode  verifyRecovery    │
 index.ts ─────► │ setPassword  signIn  refresh  signOut  signOutOnly  sessionsOf  endSessions  verifyAccessToken      │
 (passkeys) ───► │ isConfirmed  pendingName  createdAt   (the 4 direct auth.users reads become questions, not SQL)        │
                 └──────────────┬───────────────────────────────────────────────┬─────────────────────────────────────┘
                     IDENTITY=supabase (today, default)               IDENTITY=own (built beside it, off until the switch)
                                │                                               │
                  Supabase Auth (Ireland), as now                  our PostgreSQL, schema "identity" on the PC
                                                                   accounts (same ids as today, so every membership,
                                                                   note and audit row keeps pointing at the right person)
                                                                   passwords argon2id (Node 24's own), sessions with
                                                                   rotating refresh tokens stored as hashes, codes stored
                                                                   as keyed digests, 5 tries per 15 min (AUTH_ATTEMPTS)
                                                                   access tokens ES256 signed with our key, checked by the
                                                                   same tokens.ts code that checks Supabase's today

  contract tests: one suite, run against both implementations; the switch happens only when "own" passes everything "supabase" passes
  the way back: IDENTITY=supabase again (accounts made after the switch would need copying back; the cutover plan says how)
```

## Decisions recorded (the owner's where marked)

1. **One interface first, no behaviour change.** Today's Supabase code moves behind `identity.ts` unchanged; the existing tests prove nothing changed. This is the only slice that touches live's code path before the switch.
2. **Same account ids.** Our accounts keep Supabase's user ids, so nothing that points at a person needs rewriting.
3. **Accounts at the switch: none carried over (owner, 8 Nov 2026).** Every account is deleted at the switch and the owner signs up again to test, a clean slate. So no passwords move (the bcrypt question falls away) and slice 4 copies nothing. What else the clean slate covers (organisations, their candidates, jobs and originals) is confirmed with the owner at the cutover, before anything is deleted, because it cannot be undone. (Before: A, carry bcrypt hashes with a new dependency; B, everyone resets. Recommended B.)
4. **Sessions are not carried over:** everyone signs in again after the switch (already in the cutover plan).
5. **Passkeys:** none are enrolled on live, so nothing to move. Our own passkey support is a later slice; a WebAuthn library is outside code to approve then.
6. **Codes:** made and checked by us (keyed digest, constant-time comparison, purpose-bound, used once, 15 minutes, 60 seconds between resends, 5 tries per 15 minutes); the mail still goes through our outbox, never an endpoint that takes any address.

## Slices

| # | Slice | Changes live? | Done when |
|---|---|---|---|
| 1 | `identity.ts` interface; Supabase code moved behind it; the 4 `auth.users` reads become interface questions | no behaviour change | the full suite passes unchanged |
| 2 | `identity` schema migration; own accounts, argon2id passwords, sign-in, ES256 tokens, refresh rotation with reuse detection, sign-out | no (off) | the contract suite passes against "own" on a fresh own database |
| 3 | own codes: sign-up, fresh code, recovery, set password, session lists and ending | no (off) | contract suite, rate limits, codes never logged |
| 4 | no account copy (decision 3): the rehearsal starts with no accounts, the switch's deletion is rehearsed on a copy, and a new sign-up works end to end | no | the rehearsal copy holds no account and a fresh sign-up signs in |
| 5 | the switch, with the database cutover, separately authorised | yes | browser journeys pass on live |

## Result of slice 1 (8 Nov 2026, 01:31)

`identity.ts` holds the interface and today's Supabase implementation; `auth.ts` and `index.ts` take every sign-in function from it, and the four direct `auth.users` reads are now interface questions (`accountCreatedAt` returns the database's own text so the microsecond comparison in SQL is unchanged; `isConfirmed` takes the caller's transaction). `identity-boundary.test.ts` fails if any other file reads `auth.*` or imports a sign-in function from `supabase.ts` (checked by adding a stray read: it failed). `IDENTITY=own` refuses to start until slice 2 exists. **Full suite on the PC: 163 files passed, 0 failed** (commit 998802f), so the move changed no behaviour the tests can see. Not released: it reaches live with the next release that carries it.

## Result of slices 2 and 3 (8 Nov 2026, 01:39)

Built together, because the codes and sessions share one account record. **Off on live** (`IDENTITY=supabase`).

* `036_own_identity.sql`: `identity_accounts`, `identity_sessions`, `identity_codes` in the app's schema (so every test gets its own), row security on with no policy. Nothing stored as itself.
* `ownIdentity.ts`: all 19 functions of the interface. Passwords argon2id (`passwords.ts`, moved from the console, one copy). Access tokens ES256, 15 minutes, signed with `IDENTITY_SIGNING_KEY` and checked by the unchanged `tokens.ts` (`tokenSigner.ts`). Refresh tokens change at every use; the replaced one presented again ends the session; 7 days unused or 30 days in all ends it. Codes six digits, an HMAC under `IDENTITY_CODE_KEY`, one live per purpose, used once, `OTP_EXPIRY_MINUTES`. A wrong address costs the same time as a wrong password. Sign-outs, password changes and deletions reach every server at once through the shared sign-out list (moved out of `supabase.ts` into `signedOut.ts`, unchanged). Passkeys answer "not available" until their own slice.
* `IDENTITY=own` starts only with both keys; any other value is refused at start.
* **Tests against a real database (`own-identity.test.ts`, 9):** invited accounts, wrong password and unknown address; sign-up with a superseded, wrong, used and expired code; refresh rotation and a copied token ending the session and its access token at once; idle and absolute expiry; sign out of all sessions and of one; password reset ending old sessions and the old password; account deletion; passkeys not offered. Plus `own-tokens.test.ts` (4) and the boundary test.
* **Not done yet, so not claimed:** one contract suite run against both implementations (Supabase's side is covered today by the existing sign-up, reset and session tests, not by this suite); argon2id's cost measured under many sign-ins at once on the PC; the switch's own steps (moving `profiles.user_id` to reference `identity_accounts`, the copy of accounts, decision 3).
* **Full suite on the PC (02:03):** 164 files passed; the one failure was the schema chapter, which refuses a table without its purpose, personal information and retention written down. The three tables are now in `data-classes.json` (two retention periods marked "not set" for the owner) and the chapter is regenerated from a database the migrations built; the test passes.

## Retention set (8 Nov 2026)

The owner left the two open periods to me. **An ended session is deleted 90 days after it ended** (one never signed out counts as ended at its 30-day limit): long enough to look into a copied token or a "someone signed in as me" question over a quarter, and the row holds no address, browser or token. **A code is deleted 2 days after it was issued**, the same as `signup_challenges` and `password_resets`; it works for 15 minutes. Both deletions run when a session starts or a code is issued, as the existing code tables' do, on indexes added in `037_identity_retention.sql`. Test: `own-identity.test.ts` (failed on the code before, passes now).
