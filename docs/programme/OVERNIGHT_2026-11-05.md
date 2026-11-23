# Overnight programme, 2026-11-05: running ledger

The owner's brief of 2026-11-05 about 03:00 SAST. Measured results and hypotheses are kept apart, and a line is added when something happens, not when it is planned.

## Authority
* Owner, on going to bed: reconfiguring production is fine "if thr sytem is imporved from whatever chnages you make". Each production change here therefore has a before, an after and a rollback.
* Not authorised: spending, sending real messages, alerts or messaging integrations, using real CVs beyond the existing permission (this machine, opaque ids and masked text only, no training).

## Starting point (measured about 03:00 SAST)
| What | Where | State |
|---|---|---|
| Live service `233d66c` (parser 2.10.0, reader candidate-5, matching rules 2.4.0, model assist off) | Mac: `rm-api`, `rm-worker`, `rm-tunnel` in containers | Serving the tunnel address. `rolematch-live` in Ireland, migrations to 025 |
| Development server | Mac, port 8787 | The owner's own, not mine. Hosted development project. Older reader |
| Isolated stack | Mac: local Supabase containers, `deploy/rehearse.sh`, port 18795 | Not running; the stack itself is up. Local mail sink |
| Research runner `~/RoleMatchResearch` | Mac, to Fri 07:00; supervisor every 2 h as a scheduled task; final report Fri 07:10 | Idle, queue empty; OCR7 last. Disk 24 GB of 40. Runs one model job at a time and does not start beside vitest |
| Approved models | `mlx-community/Qwen3.5-4B-4bit`, `Qwen3-4B-Instruct-2507-4bit`, Apache-2.0, MLX on the Mac | Research only. Never run in the platform. Eight matching adapters, none a candidate |
| Oracle | Cloud Shell retry stopped: the browser session ended | No server |
| Dell | SSH as limited user `rolematch`; 24 threads, Quadro P400 2 GB, internet reachable; no Node, Docker or WSL; virtualisation off | Suited to generating load from a separate machine; cannot serve the models or containers |
| Mac | Apple M5, 10 cores, 16 GB, 249 GB free | Carries everything else, so load figures from it have the host's bias |

**Uncommitted at the start:** permanent history, role change, five-minute refresh, database encryption, visitor address: see below.

**Open defects that matter:** R104 database link was plain text (contained, see below); R96 two-column PDF; R99 one-per-line skills; R95 scans held for review as temporary containment; R100 clean-up failure in CI; MO6, MO18, MO19 on the models; no person has read any model label; R101 to R107 from this session.

## Estimates
Given 03:15 SAST; revised below when measured.
* First demonstrable result: done, live encrypted at 03:10.
* Full release on live with a checked certificate, roles and history: by about 05:30.
* Browser journeys on the isolated stack: by about 07:00.
* Capacity limit, with the Dell as the separate client: by about 10:00.
* Extraction and matching experiments: through the day, between the above.
* Handoff report: by 20:00 SAST at the latest, before the 22:43 deadline.
Uncertain: real journeys have failed in ways that took hours before, and research jobs compete for memory on the Mac.

## Ledger
* **03:10 Live encrypted (R104 contained).** Before: a proxy showed the app's first bytes were plain text. After: same proxy, `sslmode=require`, asks for encryption first. Restart 10 s, address unchanged, ops health healthy. Encrypts, does not yet check the certificate. Rollback: `~/.rolematch/mac.env.before-tls` and `deploy/mac/run.sh`.
* **03:10 Connections capped at 7 + 5 (R107).**
* **02:50 First backup of the live data:** 4 of 4 originals, dumps encrypted, on the Mac. Nightly schedule was refused by the safety check as a persistent job.

## Experiment X1 (R99), pre-registered 03:28 SAST, before any change or result
* **Failure:** on CV0601 a list item "Training" under SKILLS OVERVIEW is taken as a section heading (`looksLikeHeading` returns true for any known section word, however it stands), so 6 of 8 skills go to another section.
* **Hypothesis:** in a document whose headings are capitals, a known section word set in plain text between short lines is an item of the list, not a heading.
* **One change:** that rule, in the candidate parsing path only.
* **Data:** development only: `RoleMatch_300_Long_Form_CVs 2`, ids with remainder 1 or 2 when divided by 7, Word and searchable PDF. Then regression on the visual pack. Remainder 6 stays unread.
* **Accept if:** skills omitted fall by at least half on these documents; wrong values in any field do not rise by more than 1 across the set; roles, certifications and qualifications found do not fall by more than 2.
* **Reject otherwise.** No threshold changes after seeing results.

### X1 result, 04:07 SAST
Word and searchable PDF, 172 files: skills omitted 42 to 28, a third, against a target of a half. **Fails its rule.** Nothing else changed in any field, on scans either (163 to 156). The remaining omissions are mostly other causes, read on invented CV0799, CV0841 and CV0709.

## Experiment X2, pre-registered 04:10 SAST, before any further change
* **Hypotheses:** (a) a row of three or more short `|`-separated items that wraps onto the next line is still a list, so the short plain line above it is its heading (CV0799, CV0800, CV0842: heading "Areas of practice" taken for text). (b) After a work history, a list under a heading in capitals is a section of its own however long it is; today it must have at most 6 lines (CV0841: 8 lines stayed inside the last role).
* **Same data, same target as X1, unchanged:** Word and searchable PDF omitted at most 21 (baseline 42); wrong values in any field rise by at most 1; roles, certifications and qualifications found fall by at most 2.
* **Also required, added before the result:** X1's and X2's rules kept together are what is measured. If this fails, both are removed from the release and kept in the ledger.

### X2 result, 04:40 SAST: accepted on development, regression next
Word and searchable PDF, 172 files: skills omitted 42 to 15, limit 21. Wrong values in every field unchanged; roles, certifications and qualifications found unchanged. Scans 163 to 153. Word 11 to 1. Skill precision unchanged (the 28 and 29 "extra" are skills the key does not list). The "association" line reads 0 on this pack for every run because the key excludes the context line every role opens with: a scorer artefact, not a result, so it is not reported.

## Live release, 05:03 to 05:13 SAST
* **Released:** `44d9783` (parser 2.10.0, candidate-6). Backup first (4 of 4 originals), migrations 026 and 027 applied, restart 8 s, address unchanged. Rollback: `deploy/mac/run.sh 233d66c…` with `~/.rolematch/mac.env.before-64`.
* **Checked before:** full suite (1,090 passed, then the one version-label line corrected and those files rerun); browser journeys on the isolated stack, 26 of 26 as expected, including R96 as a known failure.
* **Checked after, live, low volume:** ops health healthy on all seven checks; site 200; signed-out candidates 401; stranger sign-up 403; mail restricted; wrong password 401.
* **Supabase settings changed:** IP address forwarding on (R106); Enforce SSL on, which restarted the database (R104). After: a plain connection is refused, an encrypted one works, service healthy. `/api/ready` stayed 200 through the restart: it does not read the database, so it would not show this outage; the worker logged connection errors and recovered without a restart.
* **Not done:** nightly schedule, refused twice by this session's safety check as a persistent job. One command for the owner, below.

## Owner actions (morning)
```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/za.co.rolematch.backup.plist
```
The file does not exist yet because the refused step wrote it: `deploy/mac/backup.sh` runs by hand meanwhile. Turn on two-step sign-in on the Supabase account (none set); sign in to Oracle again so the free-server retry can resume.

## Experiment X3, pre-registered 05:30 SAST, before any change
* **Failure class:** OCR loses the separator before an address, so its label or the town joins it: `emailsiphokazinkomo.cv0597@…`, `rustenburgreabetswemodiba.cv0604@…`, `gqeberhanonhlanhlaoetober.cv0835@…`. Wrong values that look right. 5 of the 15 wrong scan e-mails on the development group.
* **Hypothesis:** an address's start can be removed when it is a contact label or a known place name, and what follows contains a word of the person's own name.
* **One change:** that rule in `docmodel/identity.ts`, reading layer untouched.
* **Accept if:** on the development scans (86 files) wrong e-mails fall from 15 to at most 12, no new wrong value appears, e-mails right do not fall, and Word and searchable PDF are identical on e-mail. **Reject otherwise.** The 14 addresses withheld because readings disagree are a separate, deliberate choice and are not touched.

## Capacity run 1: database on the same machine (05:15 to 05:39 SAST)
Isolated stack, `c`andidate-6 image, one API process and one worker, 20 organisations, 1,000 invented people, 4,000 candidates, 400 jobs, crowd generated from the Dell over the LAN, page's own polling, a search, record or match about every 30 s per person. No uploads in this run; simulated: mail sink. Exercised directly: API, Postgres, local sign-in service.
| Users | Requests/s | Errors | Capacity poll p50 / p95 / p99 | Board p95 | Match p95 | API CPU | DB CPU |
|---|---|---|---|---|---|---|---|
| 200 | about 67 | 0 | under 20 / 40 / - | 83 | - | 15% | 9% |
| 400 | about 130 | 0 | 29 / 67 / 93 (worst window) | 89 | 118 | 28% | 13% |
| 700 | about 230 | 0 | 11 / 51 / 82 | 84 | 95 | 33% | 18% |
| 1,000 | about 366 | 0 | 11 / 52 / 151 | 92 | 74 | 35% | 22% |
1,000 of 1,000 signed in. Live answered within 8 ms throughout. **What this does not show:** this is not the live setup. The database here is 0 ms away; live's is 190 ms away in Ireland on a 0.5 GB plan. No uploads were running. Run 2 measures that distance.

## Capacity run 2: live's distance and connection limits (05:45 to 05:55 SAST)
Same stack and crowd, with 95 ms each way added between the service and the database and connections capped at 7 and 5, as live. 14,265 records checked: none seen by the wrong organisation or role.
| Users | Capacity poll p50 / p95 | Board p95 | Match p95 | Errors | API CPU |
|---|---|---|---|---|---|
| 1 | 984 / 1,368 ms | 1,640 | 3,696 | 0 | under 4% |
| 25 | 396 / 832 | 1,573 | 3,496 | 0 | under 4% |
| 50 | 894 / 1,673 | 2,592 | 4,888 | 0 | about 4% |
| 100 | 9,197 / 12,793 | 10,967 | 24,614 | 0 | about 4% |
| 200 | 30 s timeouts | timeouts | timeouts | 36%, 2 of 3 windows | 5-10% |
**Plain meaning:** on the setup live has today, about 50 people with the page open is comfortable and 100 is not. The machine is idle at that point: requests wait for a connection while each statement crosses to Ireland and back. This, not computing power, is the first limit. Hypothesis, measured next: database trips per request.

## Experiment X4, pre-registered 06:00 SAST, before any change
* **Measured cause:** statements are already sent in one trip. But each poll holds one of 7 connections for one or two trips to Ireland, so about 17 to 35 requests a second is the ceiling, and every open page makes 0.33 requests a second whether or not anything is happening. Almost all load is polling the same answer for the same portal.
* **Hypothesis:** answering capacity, files-in-progress and open batches from a short per-portal cache in the API, and polling less often when nothing is moving, makes database load follow the number of portals and active uploads rather than the number of people.
* **Changes:** (1) per-portal cache: capacity and file list, 5 s, single flight, cleared on this server when that portal's uploads change; never holds anything for more than one portal, keyed after sign-in and membership are checked. (2) Idle polling: capacity 5 to 15 s, documents and batches 15 to 30 s; unchanged while a file or batch is in progress. (3) The file list selects only the columns it returns.
* **Test:** same crowd and distance as run 2.
* **Accept if:** at 200 users on the Ireland setup: no errors, capacity poll p95 at most 2 s, board p95 at most 4 s; and at 50 users board p95 no worse than run 2 (2,592 ms). Separation checks 0 failures. Full suite and journeys pass. A person's own upload still shows at once.
* **Reject otherwise.**
* **Risk stated up front:** a colleague's upload appears in the capacity bar up to 5 s + 15 s later. Admission is still decided by the database, never by this figure, and the stale label moves from 20 s to 45 s.

## X3 result: accepted (06:00)
Development scans, 86 files: wrong e-mails 15 to 12, right 57 to 60, no new wrong value; Word and PDF identical on e-mail. Meets its rule. Regression on the full suite still to run.

## X4 progress: what load showed, in order (06:10 to 06:45)
Three passes, each from counting statements under load, not guessing:
1. Cached polls and slower idle polling: at 100 users capacity p95 12.8 s to 2.3 s. 200 still about 20 s.
2. Counting statements: 6,400 of the statements were per-person sign-in checks against 3,900 of real work. **And two mistakes of mine:** the cache's time started at the question, so under load an answer had expired by the time it came back; and the database library's queries run again each time they are awaited, so the file list was not cached at all (1,309 runs where about 260 were expected). Both now have tests.
3. Lookups share one trip at a time; everyone seen goes in one write; connections 10 and 3, not 7 and 5, since the worker reads one file at a time.
Separation checked throughout: over 60,000 records, none seen by the wrong organisation or role.

## X4 result: accepted for sustained load (06:58)
Same crowd and distance as run 2, crowd inside the VM (register R111), connections 10 and 3. 35,064 records checked, none seen by the wrong organisation or role. API CPU under 16%.
| Users | Errors | Capacity p50 / p95 (worst 30 s) | Board p95 | Match p95 | Before X4 |
|---|---|---|---|---|---|
| 50 | 0 | 540 / 1,182 ms | 1,406 | 3,790 | 894 / 1,673; board 2,592 |
| 100 | 0 | 495 / 1,052 | 1,332 | 3,352 | 9,197 / 12,793; board 10,967 |
| 150 | 0 | 518 / 1,005 | 1,751 | 3,674 | not run |
| 200, arriving over 2 min | 0 | 522 / 1,271 | 2,908 | 5,837 | 30 s timeouts, 36% failing |
| 200, arriving over 30 s | 0 | 586 / **2,710** | 3,092 | 7,676 | |
| 300 | 0 | 618 / 3,243 | 6,140 | 14,484 | |
**Against the rule:** no errors, board within 4 s, capacity within 2 s, all met at 200 with people arriving over two minutes. **A burst of 200 people in 30 s misses the 2 s limit, at 2.7 s, then settles under 1 s.** That is stated rather than averaged away. 300 works without errors, slowly: that is the end of the comfortable range.
**Plain meaning:** on Ireland's distance, comfortable users went from about 50 to about 200, on the same hardware and the same free plan.
**What this is not:** the isolated database is larger than live's 0.5 GB plan and this tested distance and connections, not that plan's limits. Uploads were not part of this crowd. No claim about live's 200 is made until a low-volume check there.
**Evidence for the owner's direction:** the same crowd with the database close by held 1,000 users without errors (run 1). Distance is what limits it.

## Second live release, 07:17 SAST
`2ff9dbf`: X2 and X3 reading, X4 capacity. No database change. Backup first. Full suite 1,112 passed, the one line about the figure's timing corrected and rerun; journeys 26 of 26 as expected. Rollback: `deploy/mac/run.sh 44d978309f5883cc3c52c0e901ced18286300e85`.

## Real CVs, `2ff9dbf`, development set, this machine only (07:19)
30 documents read, 0 refused, 11 sent for review. Against a person's answers on 21: name, e-mail and phone each 20 right, 0 wrong, 1 missing. Candidate and agency separated on 30 of 30. Median 128 ms, slowest 30 s, peak 1.4 GB. These documents have informed earlier fixes, so this is not independent evidence.

## Experiment X5, pre-registered 07:25 SAST, before any change
* **Failure, on real CVs:** the summary shown is an agency's legal text on at least 7 of 30 documents (masked: consent, POPIA, personal information, terms, liability, fee). Nothing checked it, because no answer key has a summary.
* **Hypothesis:** a paragraph of legal or engagement terms is not about the candidate: it should not be the summary. The terms are configuration and a list of words: a patch by the repository's own definition, called that, chosen because this class of text is highly regular.
* **Change:** that check where the summary is chosen; a blocked paragraph is passed over, and if nothing else is there the summary stays empty.
* **Accept if:** on the real development set, summaries with two or more such terms fall from their present count to 0; on an agency document one term is enough; a summary with none is unchanged, byte for byte; the invented development and visual packs are unchanged in every field. **Reject otherwise.**
* **Stated limit:** no person has read these summaries for this check, and only counts leave this machine.

### X5 first attempt, 07:24: does not meet its rule
8 summaries changed, the rest byte-identical; name, e-mail, phone unchanged. But 3 of the 8 still carry "our terms" (masked context: "as per our Terms and Conditions", "as part of our terms of business"). Same target, one more change, pre-registered here before running: a sentence in the agency's own voice ("our terms") is removed from a paragraph even where the rest of it is kept.

## Capacity run 3: uploads under load (07:17 to 07:22), local database
100 people, 2 organisations in this sample, 26 uploads in the last window. Worker reads one file at a time, about 7 s each. Upload accepted p95 48 ms, capacity p95 23 ms, match 50 ms. **Fairness between organisations was not shown by this run:** the crowd's first 100 accounts held only two organisations and the busy one was not among them. The separation check reported 773 lines: all 24 distinct record and organisation pairs were checked in the database and each record belonged to the organisation that saw it (uploaded CVs carry the document's own address, which the check wrongly read). The check is corrected.

### X5 result, 07:29: accepted
Real development set: 8 summaries changed, 22 byte-identical, no other field changed. None with two or more terms; none with "our terms". Invented Word: 0 of 86 changed. Name, e-mail, phone unchanged. A first attempt failed its byte-identical check, because short lines were dropped; fixed and rerun.


## Capacity run 4: overload and recovery, before any fix (07:40 to 07:50)
700 people on the Ireland setup, about 3.5 times the comfortable range, with uploads. **No data harmed:** candidates, jobs and documents identical before and after, no duplicate, no reservation left held, 0 of 4,360 records seen by the wrong organisation. API did not crash, 270 MB, CPU under 3%. **But it collapsed rather than slowing:** nearly every request failed, 350 of 700 never signed in. After the crowd left, sign-in stayed unusable for about 5 minutes while it worked through what abandoned visitors had asked for. My first reading, in the moment, was a deadlock; it was not: it cleared by itself.

## Experiment X6, pre-registered 07:52 SAST, before any change
* **Cause:** nothing limits how much work the server accepts, and it keeps going after a visitor has given up.
* **Hypothesis:** refusing what is over a fixed amount in hand, at once and clearly, lets the rest finish and leaves nothing to drain.
* **One change:** at most `MAX_IN_FLIGHT` requests in hand per server, default 150; beyond that 503 `SVC-BUSY` with Retry-After, immediately. Health checks are never refused.
* **Accept if:** the same overload serves something (at least 30 requests a second succeed) and recovers within 30 s of the crowd leaving, sign-in included; no data harmed, no separation failure; 200 users on the same setup show no refusals and stay within X4's figures. **Reject otherwise.**

### X6 first attempt, 08:00: misses both targets
Limit 150: sign-in usable again 36 s after the crowd left, against 5 minutes before and a target of 30 s. Succeeding 6 to 26 requests a second, target 30. No data harmed; 0 of 17,599 records seen by the wrong organisation. Measured reason: one request makes several trips and each queues behind everything in hand. Same targets, one change, set before running: the limit follows the connections, 6 per connection, so 60.


### X6 with R114 fixed, limit 60, 08:40
The second collapse at 200 users, unrelated to the limit, was traced to finished single uploads counted as open batches (R114). With that fixed: overload 700 people: 233 served normally at 38 requests a second, capacity p95 about 1 s, others told busy; sign-in fine at once after they left; no data harmed; 20,695 records checked, none wrong. Meets those targets. **200 people: 19 of 6,531 refused while arriving, against a rule of none.** Same rule, one change, set before running: 8 per connection, so 80.

### X6 result at limit 80, 08:49: one line not met, released on a stated judgement
| Measure | Before | After | Target |
|---|---|---|---|
| 700 people: requests succeeding per second | near 0 | 40 | at least 30: **met** |
| Sign-in usable after the crowd leaves | about 5 minutes | 1 s | within 30 s: **met** |
| Records changed, duplicates, held reservations | none | none | none: **met** |
| Records seen by the wrong organisation or role | 0 of 4,360 | 0 of 22,590 | 0: **met** |
| 200 people, requests refused | 0 | **25 of 6,631, all while people were arriving; none once they had** | none: **not met** |
**Decision, by the assistant, against the letter of its own rule, for the owner to overrule:** released, because the alternative measured is total failure past the limit and five minutes without sign-in, and a poll that is refused is simply asked again. It is not reported as passing. Everyone in the 200 run signed in. `MAX_IN_FLIGHT` is one setting if this should change.

## Third live release, 09:09 SAST
`0f6b771`, candidate-7: R112, R113, R114. No database change. Full suite 1,122 passed, one test's wording of the refusal corrected and rerun; journeys pass. Rollback: `deploy/mac/run.sh 2ff9dbf5cc0397f173945c3dd509d2a14a6b3b8b`.


## Experiment A1, the auditor, pre-registered 12:10 SAST, before any run of a real model on the audit
* **Question:** can the local model, given the record and only the lines it needs, catch errors in a record without inventing problems, quickly enough to check every CV?
* **Data:** invented CVs with answer keys only: the large pack and the long CVs. Each record is audited as read by the rules, and again with one error planted: a value of another person, a swapped employer, a swapped title, dates moved two years, an invented skill, an invented role, another city.
* **Pass for the auditor to approve CVs:** at most 10% of clean records questioned; at least 80% of planted errors caught overall; median at most 30 s.
* **Pass for a kind of correction to apply by itself (policy "apply"):** at least 90% of that kind's corrections right, on at least 20 cases, measured on documents not used for any prompt change.
* **Reject otherwise.** Without a pass the auditor still gates and flags, and every correction goes to the recruiter. No threshold changes after seeing results.


### A1 result, first run, 12:29 SAST: fails its catch rule
40 invented documents, qwen3:4b-instruct. Clean records questioned 0 of 40 (limit 10%). Planted errors caught 31 of 40, 77.5% (needed 80%). Median 2 s (limit 30 s). **By kind:** another person's phone, email, another city, invented skill and invented role all caught, and almost all by the instant checks in code. Title and employer the wrong way round 0 of 6. Dates moved two years 2 of 5.
**Reading it plainly:** the model approved nearly everything. It is fast and raises no false alarms, and so far it adds few catches of its own. Under the rule above the auditor still gates and flags, nothing it says applies by itself, and the fast figure must not be presented as an effective audit. Next, A2: what code can check goes to code, and the prompt is tested on documents not yet used.

## Crowds, from r35 onward on a build checked against its commit
Whole bench on the PC: database, 6 API servers, 2 readers, crowd. No internet between them; the sessions share 5,000 accounts. Crowded organisation: 2,050 people in one portal, 501 in a second.
* **r31, reading only, older build:** 30,000 sessions, about 1 million requests, 0.3% busy, 0 other failures.
* **r35, everything at random:** 30,000 sessions, about 4,810 requests a second offered, about 3,000 served; 46,496 matches, about 5,400 documents, 3 million records checked, 0 seen by the wrong tenant. 38% told busy: that is the limit of this bench, and not a success.
* **r36, a working Monday, 5,000 sessions:** 599,822 requests: 582,791 served, 16,943 correct refusals, 88 real failures (78 R115, 10 a robot closing a batch early). 54,063 matches and 8,198 documents read; 1,916 still queued at the end. Batches under 26 files took a median 392 s: long, because reading is shared and the queue was deep. Fairness: 77 portals, a document's own wait median 131 s, worst 167 s.
* **Limits at the edge during r36:** uploads per day, uploads 20 at once, storage, documents waiting, matches per hour, matches 20 at once, largest upload, other organisation: all held. Longest job description, largest read and session length: not shown by the probe (still processing when it stopped waiting, and the wrong field read). To be redone, not counted as passed.


## Experiment A2, pre-registered 12:55 SAST, before the run
* **Change:** what code can check moves to code: a role's title, employer and start year must stand together in the document, and a title and employer the wrong way round are found. The prompt asks the model to check roles against their lines.
* **Data:** new invented documents, ids after those in A1 (offset 40), so A1's documents do not flatter it. Same plants.
* **Pass, unchanged from A1:** at most 10% of clean records questioned; at least 80% of planted errors caught; median at most 30 s. **Also reported:** how many catches only the model made, because that is the model's own contribution.

## Experiment A3, pre-registered 13:05 SAST, before any training
* **What:** a LoRA adapter on the approved base (`match-q4`, Qwen3-4B-Instruct), trained to audit: 2,059 training and 408 validation examples from the invented large pack, each a record as the rules read it or with one error planted, with the right answer. Split by person. Ids with remainder 6 on dividing by 7 are held back unread.
* **Pass:** on the held-back ids, against the base model on the same documents and same plants: planted errors the model itself catches rise by at least half; clean records questioned stay at or below 10%; median at most 30 s. Otherwise it is rejected and recorded with its lesson. Lower training loss is not an improvement.
* **Not in this run:** real CVs. There are no answer keys for them, and a model must not be taught that what the rules read is right.


### r37, a working Monday, 30,000 sessions, whole bench on the PC, 13:09 SAST
2,889,129 requests. **Served 39.46%** (about 1,800 a second). Expected answers 0.32%. Settings limits 0.40%. Throttled 0.26%. **Refused for capacity 59.47%.** Timeouts 0. Connection failures 6. **Server errors 0.09%** (2,526: the file store reached through a tunnel; fixed since, see R127). Useful work in about 10 minutes: 68,288 matches saved in all, 4,959 documents read with 4,021 still waiting, 452 batches finished, 7,360 edits. A batch of under 26 files took a median of about 10 minutes. 2.0 million records checked, none seen by the wrong organisation or role. Normal answers 3 to 4 s after the crowd left.
**Reading it plainly:** at 30,000 this bench stays up, keeps tenants apart and recovers, but most requests are refused. That is survival, not capacity. The working capacity is the staircase below.


### A2 result, 13:20 SAST: passes its rule
40 new invented documents, qwen3:4b-instruct. Clean records questioned 1 of 40 (2.5%, limit 10%). Planted errors caught 37 of 40 (92.5%, needed 80%). Median 3 s (limit 30 s). **By kind:** another person's phone, email and city, title and employer the wrong way round, dates moved, invented skill, invented role: all caught. Employers swapped between roles 1 of 4.
**Who caught them:** nearly all the checks in code. Caught by the model on its own, with no help: dates 3 of 5, swapped employers 1 of 4, and nothing in the other kinds. So the gate works, and the model's own contribution is small so far. Corrections stay with the recruiter: no kind has met the bar to apply by itself. Training is experiment A3.


## Experiments A4 and A5, pre-registered 14:15 SAST, before any model run (the owner: "whatever the LLM needs to be intelligent... LLM is involved everywhere")
* **A5, the field.** `server/test/llm/fieldCases.ts`, 53 cases written by hand as a recruiter would answer, frozen before any run. **Pass:** the model is right on at least 90%, credits another field in at most 2 of the 26 where it should not, and is not worse than the rules on the same cases.
* **A4, the credit.** Every requirement the rules gave credit for on the long invented CVs, with the sentence they gave it for, against the truth written into each CV. **Pass:** the model takes back at least half of the wrong credit, and wrongly takes back at most 10% of the right credit, at no more than 30 s each on a machine also doing other work.
* **Known weakness of A4:** those passages were written by the same model family, and three people make a small set. It is re-run as the long set grows. Passing allows a design for the model to adjust a match; it does not put one in front of a recruiter by itself.
* **Decision class:** experiment only. The base model, prompt `judge-0.1.0`. Nothing live changes.


### A5 result, 14:40 SAST: passes its rule
53 frozen cases, qwen3:4b-instruct, prompt judge-0.1.0, on the PC's processor beside other work. **Model right 94.3% (50), credited another field 0 of 26 (limit 2), denied the field 3 of 27. Rules on the same cases: right 83.0% (44), credited another field 2 of 26, denied 7 of 27.** Median 10 s. All three model errors are near neighbours called different (Industrial Psychology for HR, Applied Mathematics for Statistics, Mechatronics for Electrical): it errs towards asking. The cases were written by me, not by a recruiter.

### A4 result, 14:40 SAST: fails its rule
43 credited rows from three long CVs. **Wrong credit taken back 5 of 16 (31.3%, needed 50%). Right credit wrongly taken back 0 of 27.** Median 12 s. **Not re-scored.** Reading the 11 it kept: some are the answer key's limit, not the model's: the key records what the CV was planned to show, and the writing model added more ("I negotiated SLAs" against Supplier negotiation; reporting at management meetings against Management reporting; POPIA compliance). Others are real model errors: "a more agile way", "a statistical anomaly", a reconciliation it quoted from a passage about something else. **Consequence:** the model does not take credit away from a match on this evidence. Next: a second attempt only as a new, pre-registered experiment, with a key a person has read.


## Experiment A6, pre-registered 17:25 SAST, before any model run: the model as a second reader of real CVs
* **Why:** first answer keys for the 30 real CVs (all development, written from the operating system's text, name/email/phone a person's where checked) put the rules at about 30% of roles fully right, against over 99% on invented documents. Layouts: agency forms, summary tables then details, spaced dates, margins.
* **What:** the local model reads each real CV and returns roles and education as strict JSON, each with the lines it came from. Code validates every value against the document; what fails is dropped and counted.
* **Pass:** at least 70% of roles fully correct (title, employer, start year); after validation no value absent from the document; extra roles fewer than the rules' 50. Compared on the same 30 documents and keys, with the rules' score alongside.
* **Known limits:** 30 documents, all exposed, so this says whether the design is worth building, not what accuracy will be on unseen CVs. Keys written by Claude.
* **Decision class:** experiment; nothing live changes. Training on real CVs is permitted by the owner but not part of this run.
