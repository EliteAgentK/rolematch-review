# Console, first slice: one owner sign-in, Today and Alerts

Written 6 November 2026, before any code (owner rule: plan with diagrams first). It builds the first two pages of `09_CONSOLE.md` and the wire maps in `17_REVIEW_AND_IMPROVEMENTS.md` §4, on the live system as it is today (the local Supabase database on the PC). It moves to our own database at the cutover with the rest of the schema, unchanged.

## What this slice is, and is not

**Is:** the owner's single account, set by the owner at the PC's terminal; sign-in with a password; the Today page; the Alerts feed, with acknowledge and mute; alerts written by the monitor as well as e-mailed; phone and laptop layouts; light and dark.

**Is not yet:** reachable from the internet (that is Cloudflare Access, waiting on the owner's account); a passkey (next slice, using the app's existing `passkeys.ts`); Web Push to the phone (needs the installed app over HTTPS, so after Cloudflare); Organisations, People, Records, Processing, Audit, Health, Backups, Schema and Ask pages (later slices, each drawn first).

## How it fits

```
 phone / laptop
      │  now: on the PC, or through an SSH link from the Mac
      │  after Cloudflare: https://console.rolematch.co.za, Access lets only the owner's e-mail through
      ▼
 ┌───────────── rm-console (same image as live; its own container; 127.0.0.1:18790 only) ────────────┐
 │  sign-in ── argon2id (built into Node 24) ── 5 tries / 15 min ── session 15 min idle, 8 h at most │
 │  Today  ◄── reads ──┬── rm-api /api/ops/health (service token): live, queue, reading, model, mail  │
 │                     ├── /srv/rolematch/status/host.json (written each minute by root's cron):       │
 │                     │     disk, backups, Mac copy, restore drill, model servers   (mounted read-only) │
 │                     └── database, as rolematch_console: counts only, through fixed functions          │
 │  Alerts ◄── owner_events ◄── written by the monitor (and later every source), folded by fingerprint   │
 └──────────────────────────────────────────────────────────────────────────────────────────────────┘
      ▲
      │  the owner sets the password once:  deploy/pc/console-password.sh  (asks at the terminal, never echoed;
      │  Claude never types it). Running it again replaces the password; it cannot make a second account.
```

## The database part (migration 035)

| Object | What it holds | Who may touch it |
|---|---|---|
| `console_owner` | the one account: e-mail, argon2id hash, when set | a primary key that can only be `true`, so a second row is impossible in the database itself, not only in code |
| `console_sessions` | a hash of each session's id, when it started, last used, ends | the console only; the id itself lives only in the owner's cookie |
| `owner_events` | alerts: severity (urgent, today, info), source, title, what it means, what to do, first and last seen, count, cleared, acknowledged, muted until | the console reads and acknowledges; the monitor writes |
| `console_overview()` | counts for Today: organisations, people, sign-ups today, CVs read in 24 h, failed in 24 h, errors recorded in 24 h | a security-definer function returning **numbers only**, so the console role never reads a row of anyone's data |
| role `rolematch_console` | no login; the console switches to it for every query | may call `console_overview()` and use its three tables; nothing else |

Row security is on for all three tables, with policies naming only `rolematch_console`, so the tenant role sees none of them. **No personal data:** alert text is written by our own code from counts and states, never from a document, a name or an address (the monitor already keeps to this).

**Known limit (measured 6 Nov on a fresh own database):** the console connects with the app's login (`rm_app`) and switches to `rolematch_console` for each query. The switch works as intended (`candidates` is refused, `console_overview()` gives counts), but the app's login itself still has `BYPASSRLS` and full rights on the three console tables, so a fault in the API could change the owner's account or the alerts. The fix is a console login of its own (`rm_console`, a member of `rolematch_console` only), with `rm_app` losing both the membership and the rights on these tables. It belongs with replacing `BYPASSRLS` (phase 3) and the cutover, when live leaves the Supabase containers, whose login has the same reach today.

## Rules carried into the code

1. **No silent zeros:** a source that cannot be read shows "unknown" and why, never 0 (17 §5.3).
2. **The console checks itself:** if the host file or the health report is more than 2 minutes old, the status dot turns grey and says so (17 §5.4).
3. **Never colour alone:** every status is a word too.
4. **Plain words first:** "All well", "1 needs you", "Reading CVs".
5. **Nothing private cached:** every page is `Cache-Control: no-store`; a strict content-security policy; no scripts from anywhere else; the page cannot be framed.
6. **Forms are protected twice:** a same-site-strict cookie and a per-session form token; the console refuses a change from another origin.
7. **One path:** same image, same release, same tests as live (owner, 5 Nov).

## Tests (written with the code)

- The database refuses a second owner row; the console role cannot read `candidates` or `documents`; `console_overview()` returns numbers only.
- Sign-in: wrong password counted, sixth try in 15 minutes refused even with the right password; idle and absolute limits; sign-out ends the session in the database.
- A copied session id from the database (its hash) cannot sign in.
- Today: a missing host file shows "unknown", a stale one turns the dot grey; an unhealthy check becomes a "needs you" line.
- Alerts: the monitor's open, repeat and clear fold into one alert with a count and a "back to normal"; acknowledge and mute; a form from another origin is refused.
- Pages carry `no-store`, the security headers, and no personal data.

**Result, 6 Nov:** all 7 database tests and 6 judgement tests pass on the PC. The first run found one fault: a session past its limit was refused but its row still looked open; it is now closed in the record when found (`sessionFor`). On a database built from scratch with our own PostgreSQL, all 35 migrations apply, the app login's schema check is in sync with row security on, and the schema chapter generated from it is identical to the committed one.

## After this slice

A console login of its own (the known limit above); passkey sign-in; Cloudflare Access and the permanent address; Web Push; then Backups, Processing and Health (the pages that turn existing checks into screens), then the data pages with masking and reveal-with-reason.

## Slice 2 (planned 8 Nov 2026, before code): the console from anywhere, without Cloudflare Access

**Why:** the owner wants the console from phone, Mac and PC. Cloudflare Zero Trust Free would not take the owner's card (8 Nov), and the owner parked it ("we'll set this up another time … as long as I can access the console"). So the console carries its own second step, so it can be put on `console.rolematch.co.za` safely without Access. Access can still be added later in front of it as a third wall.

```
 phone / Mac / PC browser
        │ https://console.rolematch.co.za   (Cloudflare edge, TLS; DNS record: owner's click)
        ▼
 named tunnel rm-tunnel-named (outbound from the PC) ── ingress: console. → 127.0.0.1:18790, app. → API, anything else 404
        ▼
 console server (127.0.0.1 only)
   1. /login: e-mail + password ──wrong──► counted; 5 wrong (password or code) in 15 min locks sign-in and alerts the owner
        │ right
        ▼
   2. a 6-digit code e-mailed to the console owner's own address (the one set at the PC's terminal; never one from the form)
      a pending cookie (32 random bytes, kept only in the browser; the database keeps its hash and the code's hash bound to it)
        ▼
   3. /login/code: the code within 10 minutes, once, in the same browser ──wrong──► counted towards the same lock
        │ right
        ▼
   session as today (15 min unused, 8 h at most, its hash only in the database)
```

**Rules:**
1. The code goes only to the address in `console_owner`; nothing a visitor types chooses a recipient (no open mail endpoint).
2. A code is asked for only after the right password, so a stranger cannot make the console send mail. At most one code per minute; a new one replaces the old.
3. Neither the code nor the pending token is stored or logged as itself; the code's hash is bound to the pending token, so a copy of the table cannot be tried offline without the browser's cookie.
4. Wrong codes count towards the existing lock (5 in 15 minutes, `AUTH_ATTEMPTS`), and the lock alerts the owner, as today.
5. Locally (127.0.0.1 on the PC) the same two steps apply: one path.
6. Codes are deleted 1 day after they were issued (retention, `data-classes.json`).

**Tests (written with the code, against a real database):** the right password alone gives no session; the e-mailed code gives one; a wrong code, an expired code, a used code, a code from another browser (other pending cookie) are refused; wrong codes lock like wrong passwords; a second code within a minute is refused; the mail goes to the owner's address whatever the form says; nothing in the logs holds the code.

**Then, separately:** the tunnel's `console.` route (Claude, on the PC, after the code step is live and proven), the DNS record (the owner's click), and a check from outside that an anonymous visitor sees only the sign-in page.

**Result of slice 2's code (8 Nov 2026):** `038_console_codes.sql`, `auth.ts` (`sendCode`, `checkCode`), `/login/code`. `console.test.ts` 9 of 9 pass against a real database and the real console server, with mail written to preview files and nothing sent. The tests cover: the password alone gives no session; the code gives one, once, only in the browser that entered the password; another browser's token and a used or 11-minute-old code are refused; a second sign-in within the minute sends no second mail; wrong codes count towards the same lock, which then refuses the right code and alerts the owner; neither the code nor the token is stored. Found while writing it, before any test ran: clearing the wrong-try count at the right password would have let someone holding the password guess codes without end, so the count is now cleared only when the code is right too. Not yet live: the full suite, the release, the tunnel route and the owner's DNS record follow.
