# Rate limits and overload protection (as built, 2026-10-29; sign-in and code limits 2026-11-02)

Rate limits, portal capacity and worker concurrency are three separate protections; none replaces another. A 429 (`RATE-001`, with a retry time) is a **temporary** limit and never means the portal's 500 slots are used (`CAPACITY-001`); the text says so and says nothing already submitted is affected. Refused requests reserve and store nothing. Retry times carry 0 to 3 s of random spread, and the browser adds up to 30% jitter and widens the wait on repeats, so refused clients do not return together.

## What existed and was kept
Per-IP and per-account request limits; sign-in failures counted three ways (shared, exact, database); sign-up and e-mailed-code limits (shared); settings and matching limits. Verified by `ratelimit.test.ts` (23 tests). **Not built (so not claimed):** password recovery (no such flow exists), live connections (no such endpoint exists), LLM requests (no model is in the application path), a proxy/edge limit (a deployment must add one).

## Guessing a secret: 5 failed attempts per 15 minutes (owner rule, 2026-11-02)
Anything that guesses a secret gets at most **5 failed attempts in any 15 minutes** for the thing being guessed. One constant holds the rule (`AUTH_ATTEMPTS` in `server/src/ratelimit.ts`). Every tier below is shared and exact: a sliding log in the database, so it holds across servers and restarts and has no window-edge effect.
| Tier | What is guessed | Counts | Limit | Before |
|---|---|---|---|---|
| `login_pair` | a password, from one address for one account | failures; a successful sign-in clears this pair | 5 per 15 min | 5 per 15 min |
| `login_email` | a password for one account, from any addresses (spread-out guessing) | failures | **5 per 15 min** | 10 per 15 min |
| `verify_email` | the e-mailed sign-up code for one address | wrong codes | **5 per 15 min** | 8 per 15 min |
| `invite_lookup_ip` | an invitation link: opening it or signing up with it | unknown, used, revoked or expired links, per sender | **5 per 15 min** (new) | none |
| `invite_accept_user` | an invitation link accepted while signed in | unknown, used, revoked or expired links, per person (not per address: an office shares one) | **5 per 15 min** (new) | none |
| `ops_token_ip` | the monitor's service token on `/api/ops/health` | wrong tokens, per address; a refused address gets the same "not found" as anyone else, and a monitor sharing that address is locked out too until the window passes | **5 per 15 min** (new) | none |
| `resend_email`, `signup_email` | (these cost real e-mails) | requests | 3 per 15 min, 3 per 30 min | unchanged: already stricter than the rule |

Where I expanded on the rule:
* **The real wait.** A refused person is told the real time left ("Try again in 12 minutes"), and the `retry-after` header carries the same figure. Before this, sign-in said "a few minutes" and always sent 900 s.
* **No more "incorrect" after the limit.** A wrong code after the limit is now refused with "Too many incorrect codes" and the wait, without being checked. Before, it was told "incorrect", which invites another guess.
* **Invitation links are covered.** Before, they had no limit. The links are long random tokens, so guessing one is impractical, but probing is now capped too.
* **Kept higher on purpose:** `login_ip` (30 failures in 15 min from one address, across any accounts) and `verify_ip` (30). A whole office can share one public address. These two stop one machine trying many accounts; the per-account limits above are the ones at 5.
* **Known trade-off:** anyone who knows an address can lock that account's sign-in for 15 minutes with 5 wrong passwords (`login_email`). That is the price of the per-account limit. The person who owns the account is told the wait, and nothing is lost. Closing this properly needs a step-up check (for example an e-mailed code) instead of a lock: not built.

Evidence: `ratelimit.test.ts`:
* The rule's own test: the four tiers are exactly 5 per 15 minutes and shared.
* The real-wait wording and header, for sign-in and for codes.
* Five invalid invitation links are allowed, the sixth is refused, and another sender is unaffected (default limit, no override).

## What was added (defaults; scopes are complementary, never IP alone)
| Tier | Scope | Limit | Store | Rationale |
|---|---|---|---|---|
| `api_portal`, `api_org` | all authenticated traffic | 3,000 and 6,000 /min | per server | stop one tenant using the service up; far above normal use |
| `reserve_user / _portal / _org` | asking for a batch reservation | 20 per 10 min, 80 per 10 min, 300 per hour | **shared** | a person normally makes a few; 10 recruiters × 3 batches stays under the portal limit (tested) |
| `upload` (single) / `upload_portal` | single uploads, each also reserves | 40 /min per person, 300 /min per portal | per server | existing per-person limit kept |
| `upload_file_user / _portal` | files sent into an already-admitted batch | 240 /min, 900 /min | per server | measured: one person's 500-file batch moves about 35 files a minute here, so this is not a bottleneck; 500 files are **not** treated as 500 abusive requests |
| `upload_bytes_user / _portal` | bytes sent (counts the size, not the request) | 400 MB /min, 1.5 GB /min | per server | a legitimate 500-CV batch is far below this; protects bandwidth and storage |
| `status_user / _portal` | progress, capacity and batch-list polling | 300 /min, 1,500 /min | per server | the page polls every 2 to 5 s; endless polling is limited without affecting colleagues |
| `batch_action_user` | cancel, retry, dismiss, acknowledge | 30 per 10 min | shared | |
| `export_user` | batch reports | 30 per 10 min | shared | sensitive export |
| `invite_user / _portal / _org` | invitations (each can send an e-mail) | 30, 100 per hour; 300 per day | shared | |
| `member_user` | removing members, revoking, resending | 60 per hour | shared | |
| `match` (existing), `match_portal`, `match_org` | matching | 120 /min per person, 600 and 1,500 /min | per server | independent of upload; plus at most 6 matches running at once per portal per server (`MATCH_CONCURRENCY`) |
"Shared" limits live in the database and hold across servers. The high-frequency ones are per server on purpose (a database call per poll would cost more than it protects); their effective limit is the figure times the number of servers, and the proxy limit covers the rest.

## Evidence (`ratelimit-portal.test.ts`, defaults, four recruiters on one address)
Legitimate: four recruiters, 12 batches of 100, dozens of polls each: **no 429**. Abuse: reservations flood limited (about 20 admitted, rest 429 with a reason and a retry header, **zero slots taken by refused requests**, a colleague on the same address unaffected); 340 rapid capacity polls limited per account; 34 invitations in a row: exactly 30 pass, 4 limited; match flood limited with "does not affect upload capacity" (the per-account match limit is lowered to 15 in that test only, because over the internet a match request takes about 2 s and the default 120 /min cannot be reached from a test); 12 files into an admitted batch: none limited. Thresholds are initial values from this machine, not production measurements.

## Metrics
`/api/health/details` (the platform operator only, by the operator token; code review 16 Nov 2026, A-M3): per tier, allowed, limited, last limited, and the number of distinct keys limited. Counts only: no accounts, addresses or content (tested). Unbounded growth is avoided: the key set used for the distinct count is capped at 5,000.
**Tenant-lower limits:** organisation limits can already lower documents per day, storage and in-progress work; per-tier rate overrides by tenant are **pending** (platform ceilings are enforceable today; `RATE_OVERRIDES` is a platform setting).
