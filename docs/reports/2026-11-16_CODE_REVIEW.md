# Line-by-line code review, 16 November 2026

The owner asked for every line read ("I haven't read all 37,000 lines line by line — i expect you to"). This is what was read, what was found, what
is fixed and proven, and what waits for a decision. Findings were reported by seven reviewers reading one area each; every finding fixed here was
first confirmed in the code (and most reproduced by a test that failed before the fix).

## What was read

All 280 source files, every line, in seven areas (the file lists are kept with the review notes):

| Area | Files | Lines | High | Medium | Low |
|---|---:|---:|---:|---:|---:|
| A. API, sign-in, permissions, settings, deletion | 35 | 4,821 | 0 | 11 | 20 |
| B. Document intake, queue, readers, OCR, AI reading | 60 | ~8,400 | 3 | 11 | 14 |
| C. Matching, rules, assessment, overview figures | 43 | ~5,370 | 3 | 6 | in file |
| D. Owner console, scripts, mail | 25 | 2,191 | 0 | 5 | 20 |
| E. Matching Board, its components, the API client | 67 | 6,768 | 2 | 11 | 17 |
| F. Pages (Home, Features, Pricing, Contact, sign-in, Settings, Profile) | 9 | 5,938 | 2 | 9 | 12 |
| G. Overview, theme, utilities, entry point | 41 | 4,948 | 0 | 12 | 37 |

**What held up everywhere:** no path lets one organisation or portal read or change another's records (row rules plus explicit filters, checked on
every route the reviewers traced); no XSS sink in the app or the console; a match starts only when a person asks and is never re-run once recorded;
an AI failure never becomes a made-up score; nothing decides on a person automatically.

## Fixed and proven today

| Finding | What was wrong | Commit |
|---|---|---|
| A-M2 | Every sign-up code e-mail said the literal text `${words.ignore}`; the reset e-mail's plain text said "Didn't create a RoleMatch account?" | d1eae1d |
| E-H1 | While a batch ran, the board reloaded every 2 s and wiped what a recruiter was typing in the notepad or the edit form | 8b2b625 |
| E-H2 | On a saved shortlist, after Not suitable the Details window showed the next person, and a second click marked them too | 8b2b625 |
| C-H1 | Experience counted each role a month short and was rounded down and frozen when the CV was read: three full years went to the AI as "2 years"; a 30-year career was stored as 25 | c4f340f |
| C-H3 | "BCom (part-time), 2012–2015" and "AWS Architect – current" were "in progress", and the AI was told so | c4f340f |
| C-H2 | Every CV line was cut at 400 characters before the AI saw it; evidence at the end of a long line was never shown | 5f26f45 |
| B-H3 | Two runs of one document (a job re-queued while still running) made two candidate records; reproduced, now one | f49b05b |
| B-M1, B-M2 | A Cancel mid-read could be undone and the file published; a late failure could mark a published document failed | f49b05b |
| B-H2 | A Word file declaring tiny sizes passed the zip-bomb check and was then unpacked in full; real sizes are now measured (all 113 genuine Word files here pass) | 5db6eba |
| D-M4 | Deleting a portal or company dropped the queued removal of a CV file deleted moments before; the file stayed in storage for good (migration 054) | e5c1559 |
| A-M1 | Settings' "status in use" check saw only the administrator's own portal | 4b1902f |
| F-H1, F-H2, F-M1, F-M2, F-M3, G-11, E-M8 | The profile page ran on an invented demo file and browser storage: it could show the previous person's name, photo and phone on a shared computer, Change Password changed nothing, sign-in failed if the demo file did not load. Rebuilt on the server's account (name, e-mail, organisation, role, portals; password changed with an e-mailed code); the demo file and the browser profiles are removed, and what earlier versions left in browsers is wiped on load | (this release) |

## The owner's decisions (16 Nov 2026)

1. **Large CVs stored compressed (B-H1):** fine as it is. Closed.
2. **Logging out (A-M7):** signs out every device, as intended; and a person is signed in on one device at a time (built: 0419653).
3. **Allowances (A-M8):** per portal at all times; the counting already was. The wording that said "organisation" is corrected but held back on the
   owner's word. The AI's monthly allowance stays $20 per company for now.
4. **Session length (F-M4):** 8 hours for everyone, not a setting (built: d8e6003).
5. **Public pages (F-M5 to F-M9, E-M11), the cookie banner (G-M6) and text colours (G-M7):** later, in the owner's words; colours are the owner's
   father's call. Measured contrast for G-M7 is in the release notes of 16 Nov.

## Fixed after the decisions, released together (16 Nov 2026, afternoon)

Every fix has a test that failed on the code before it. Double billing and security first, on the owner's word ("needs to be fixed immediately").

| Finding | What is true now | Commit |
|---|---|---|
| C-M2, A-M6, B-M8, B-M11 | Nothing is paid for twice: one match per pair however many clicks, one Read again at a time, a job reading held by a lease, and a company's AI allowance reserved call by call (migration 055) | cb446fd |
| A-M3, A-M4 | The platform's health figures are the operator's alone; no one can read a colleague's sign-ins or addresses | b9af8d0 |
| A-M5, A-M9, A-M10, A-M11 | Last administrator held under a lock; a deleted record takes its AI reviews along (056); a made-up session cookie buys nothing; own sign-in survives two refreshes at once | e7d78e4 to d9e49e6 |
| D-M1, D-M2, D-M3, D-M5 | Console alerts bounded; self-refresh is not activity; every account reachable past 1,000 (057); maintenance scripts name their database and refuse live unless told | 1ab482a to 6dcfec3 |
| B-M3 to B-M7, B-M9, B-M10 | A slow document fails alone; PDF pages and TIFF frames have pixel caps and are closed; the layout reading's time limit stops its work; long job descriptions read in parts, too-long refused unpaid; Read again dates as the first reading did | 6ba2a0f to afd3213 |
| C-M1, C-M3 to C-M6 | Scored on the versions the match records; edits recount experience; relocation judged by distance; one clock (Johannesburg) for months and days (065); the CV fenced as data in the scoring question, unsupported scores refused (ai-score-5) | 6ee1962 to e3a7b0c |
| E-M1 to E-M7, E-M9, E-M10 | Board: newest reload wins, filters work, a record being read again cannot be edited, no recruiter actions while the role is unknown, honest failure and success messages, quiet polling, lists cut at 5,000 say so | e8aa7c0 to 15f395f |
| G-M1 to G-M5, G-M8 to G-M10, G-M12 | Overview: periods are the days drawn, proportional pipeline, one shortlist definition, uploads refused with a reason, settings failures said, keyboard access, debounced refresh, qualifications never shown as held without completion, the Demo company lived on minute by minute | 6ee9e79 and others |
| Housekeeping | The unused formula engine removed (2,264 lines); stored years of experience recounted by a one-off repair (0c3f14f); the Mac's backup copy back since 16 Nov (4d92100); old rehearsal copies on the Mac deleted | |

## Was open at the time of the first report (all medium items above are now fixed or decided)

Matching: a match is scored on the record as it is when the worker runs, not when Match was pressed (C-M1); two Match clicks at once can bill twice
(C-M2, A-low); correcting a role does not recompute experience (C-M3); "unable to relocate" anywhere is a conflict even for a local job (C-M4); months
cut at UTC midnight (C-M5, known G4). Documents: a timed-out document restarts the worker and costs four others an attempt (B-M3); PDF pages and TIFF
frames have no pixel cap (B-M4, B-M5); a re-read uses today's date (B-M10); AI allowances can be overshot under load (B-M11); job readings can be
paid twice (B-M8). Board: overlapping reloads can overwrite a newer answer (E-M1); "Show only needs review" ignores jobs (E-M2); a card being re-read
can still be edited (E-M3); a failed portal lookup offers a hiring manager the editing buttons the server will refuse (E-M4). API: health details and
`?reset=1` are open to any organisation administrator (A-M3); a recruiter can read a colleague's sign-in IP addresses through the audit route (A-M4);
"Read again" twice bills twice (A-M6). Console: the people list stops at 1,000 (D-M3); the idle sign-out never fires because pages refresh themselves
(D-M2); anyone can trigger the console-locked alert e-mail repeatedly (D-M1). Overview: the shortlisted headline misses the oldest partial day, the
pipeline chart's percentages can pass 100% (G-1, G-2); text colours below WCAG AA (G-7); parts are mouse-only (G-8).

## Measured honestly

Each fix above has a test that failed before it, except where marked "by construction" in its commit message. The full suite runs before the release.
Matches already recorded never change: they are kept by candidate and job, not by what was sent to the AI.
