# Responsiveness of verification and invitation mail: what is measured, how, and what is not

Three different things are measured separately and never merged:
1. **Application response time**: how long the sign-up or resend request takes for the person (includes Supabase Auth and our database). Recorded server-side as the stage `mail.verification.total` (the send step) in `/api/health/details` timing, and client-side by the browser's 20-second bound.
2. **SMTP acceptance time**: from starting the attempt to the mail server's "250 accepted". Recorded per attempt (`mail_attempts.started_at`/`finished_at`) and summarised by class with p50/p95/p99 in `/api/health/details` under `mail.acceptanceSeconds`. Failures and timeouts are counted (`mail.failures`, `mail.timeoutsOrUncertain`). No code, address or credential is logged: attempts carry a keyed recipient hash and a short error class.
3. **Observed inbox arrival**: only measurable with a real send to an agreed address, by comparing our accepted time with the time the message appears (the received time in the message headers). It is **not** measured by any automated test, and one successful arrival is not general deliverability.

## Design for responsiveness
* Verification codes are sent directly (never queued) with their **own connection pool** (default 2) and shorter timeouts; invitations share a separate pool (default 1). A burst of invitations cannot hold the connections a code needs, and the host never sees more than 3 connections from us. The dispatcher sends invitations one at a time, so a burst cannot occupy API request capacity either.
* The hourly allowance keeps headroom for verification (`MAIL_RESERVED_AUTH_PER_HOUR`).
* **Bounded wait:** a verification send that the mail server has not answered within 12 seconds is reported as **uncertain**: the code may still arrive. There is no automatic retry (a second message would not help and could confuse). The sign-up page says so plainly, starts the 60-second resend wait, and never claims delivery; the resend button also blocks double-clicks. The browser stops waiting after 20 seconds with the same guidance.

## Measured so far (simulated mail host only; Apple M5 laptop; remote Supabase development database)
Verification-class send, from the start of the send step to the host's acceptance, with the simulated host taking 800 ms per message. Four sends, 200 ms apart:

| Run | Commit | Idle (ms) | During a 12-invitation burst (ms) | Burst total | Peak connections at the host |
|---|---|---|---|---|---|
| 1 | 88275e3 | 4231, 2364, 2273, 2432 | 4314, 2364, 2255, 2352 | 28.8 s | 2 |
| 2 | 667ce4c | 4052, 2255, 2288, 2222 | 4426, 2677, 2223, 2186 | 29.3 s | 2 |

What it shows: the burst does **not** slow verification sends (same numbers with and without it; worst difference 0.42 s, on the first send) and the host never saw more than 2 connections. What it also shows, and was not expected: each send spends **about 1.4-1.6 s above the host's own time**, and the first, cold send about 3.3 s. That time is database round trips to the remote development database (suppression check, the quota reservation transaction, the attempt record), not SMTP. An earlier absolute expectation of under 2.3 s was wrong and is no longer asserted; the isolation (relative) assertion stays. **Improvement to make:** fold the suppression check into the reservation transaction and record the attempt in fewer statements, then measure again. A database close to the server (the planned own PostgreSQL in South Africa) would shrink the rest.

## First real sends (2026-10-30, isolated schema `trial_mail`, restricted to the owner's approved addresses)
Kept in two columns on purpose: what the system recorded, and what the owner saw. Neither stands in for the other.

**Recorded by the system** (`npm run mail:trial -- report`, `mail_attempts`; one sample each, taken while the full test suite was also running against the same development database):

| When (UTC) | Message | Host accepted | Send step | Other timings from the same session |
|---|---|---|---|---|
| 05:31:07 | verification code to the first approved address (gmail.com) | yes | 1287 ms | sign-up request 5.5 s; two refused wrong codes 1.5 s and 1.3 s; accepted code 7.8 s; re-using the used code refused (401) in 1.39 s |
| 06:18:50 | organisation welcome to the same address | yes | 1975 ms | |

No invitation was sent: the trial schema holds no invitation and one member. The invitation, its acceptance from the second approved address and the member welcome were **not exercised**. Single-use and intended-address handling, duplicate-welcome prevention and attribution on acceptance are covered by the automated tests (`invitation-email.test.ts`, `email.test.ts`), not by a real send.

**Confirmed by the owner, in their own words, not measured:** the code arrived quickly, was correct and had not expired; the sign-up succeeded ("boom, it works"); 2026-10-30 09:00: "The flows I tried worked." Not yet stated by the owner: whether the verification and welcome messages arrived in the Inbox or in Spam, and their arrival times.

**Found during the trial:** R33 (the code box does not state the length), R34 (six session requests on load), R35 (the trial API stayed read-only after a short database drop and showed an empty board; fixed).

## Real-send protocol (after you approve recipients)
For each agreed address: (a) request a code and note the wall-clock time of the click; (b) record the server's `acceptanceSeconds` and the request's duration; (c) note when the message appears in the inbox (or spam) and its Received header time; (d) enter the code. Repeat a few times at different moments. Report medians and worst cases separately for application response, acceptance and arrival.
