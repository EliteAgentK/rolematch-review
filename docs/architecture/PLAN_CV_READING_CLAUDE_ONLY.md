# CVs read by Claude alone, as job descriptions are (plan, 10 Nov 2026)

Owner, 10 Nov 2026, after the three-way measurement: "this is really making me want to take the parser out of this and just do what we did with the
upload of job descriptions"; on masking: "why does it matter if the person's details get read by Claude, that's the whole point" (no masking).

Diagram: [CV_READING_CLAUDE_ONLY_PLAN.svg](CV_READING_CLAUDE_ONLY_PLAN.svg) (source [.mmd](CV_READING_CLAUDE_ONLY_PLAN.mmd)), drawn from the code.

## The measurement behind it (10 Nov 2026, `server/test/collection/threeWay.ts`, `output/Parser-Claude-Both-comparison.html`)

| On the 30 real CVs with keys | Parser alone | Claude alone | Both (live) |
| --- | --- | --- | --- |
| Jobs fully right | 51.0% | 86.4% | 85.7% |
| Jobs that should not be there | 32 | 5 | 7 |
| Education read that is real | 63.6% | 93.4% | 90.5% |
| Names missed (all 50 documents) | 3 | 0 | 0 |

Every missed name and every certificate read as a job came from the parser. Cost per CV about $0.0034 (R0.06) with or without it.

## TODAY (from the code)

- `prepare.ts` reads the file (text, OCR), then the parser's word rules (`rules.ts`, `candidatePipeline.ts`) read every field.
- **A CV whose name the parser cannot find, and which looks unusable without one, is refused before Claude sees it** (`IDENTITY_UNRESOLVED`).
- The duplicate check uses the parser's name and email. The parser's name is masked before the text goes to Claude (`askAi`).
- Claude reads (`hybridRead`), code checks every value against the document, and `reconcile.ts` merges the two readings, adding parser roles and skills.
- If Claude fails twice, the parser's reading is published instead.

## WILL BE

1. The file is read exactly as today (type, size, text, OCR, glyph repair) and the safety checks stay (hidden text flagged, instructions planted in a
   CV, page limits). Nothing about reading the file changes.
2. Claude reads the whole CV, personal details included, with no masking. One reading gives every field: name, contact, location, agency, headline,
   jobs, education and certificates, skills, languages, summary, department.
3. Code checks every value against the document's own words, as today: a value the document does not hold is dropped.
4. The duplicate check runs on Claude's name and email, before the record is published.
5. No parser fallback. If Claude cannot read it (down, refused, out of credit), the CV waits as "The AI could not read this CV", with Retry, as a job
   description does. Nothing is half-read by word rules.
6. Removed completely, with their tests, as the job rules were: the parser's CV field rules, the reconciling of two readings, the name refusal before
   Claude, the parser fallback, and the masking.
7. CVs already on live, read before this, are read again once by the new path. The count and the exact cost are shown to the owner first.

## Pass bar, set before building

Measured on the same 50 documents with `threeWay.ts` adapted to the new path. Release only if the new path is at least as good as today's live reading
on every scored field (names, email, phone, location, jobs fully right, education, certificates, skills, languages), has no more wrong jobs, misses no
name, reads every one of the 50 (Word, text PDF, scans, phone photos), and costs no more per CV. The layout audit and the full rehearsal pass as always.

## Order of work

1. Claude's reading gives the contact details as well (today a separate question): one question fewer.
2. `prepare.ts`: CVs take the job descriptions' path after the file and safety checks.
3. `aiRead.ts`: the record is built from Claude's checked reading alone; duplicates checked there; no masking; the failure path waits with Retry.
4. Remove the parser's CV field rules, `reconcile.ts`'s merging, and their tests; keep what file reading and safety checks need.
5. Measure on the 50 against the pass bar; full suite, rehearsal, layout audit.
6. Release with the owner's yes; then the one-time re-read of older live CVs, count and cost first.

## Amendment (owner, 10 Nov 2026, "put this amendment in with the next pass, this is so important")

### A. Records arrive one by one, as soon as each is ready, in batches too (CVs and job descriptions)

Each record goes onto the board the moment its reading is checked, never held back for the rest of its batch, with a short arrival animation. Today the
board learns of new records by checking every 2 seconds during a batch; the next pass makes publishing a record tell the board at once, and the
rehearsal measures it: a record on the board within 2 seconds of being ready, in the order they finish.

### B. The upload date at a glance

Today the CV card says "Applied 08 Nov" and the job card "Posted 10 Nov" for the same thing. Both will say "Uploaded 10 Nov", with the exact time on
hover, on the cards and in the side panels.

### C. Rules so Claude reads every CV the same way (the job reader's method, for CVs)

The job reader is consistent because Claude works in two steps that code holds it to. CVs get the same:

1. **Every line labelled.** Claude gives each numbered line of the CV one label: personal details, job title, employer, job dates, duty, education,
   certificate or course, skill, language, project, agency, referee, heading, or other. A line is never left without one, so nothing quietly
   disappears; lines labelled "other" are counted and shown in the reading's report.
2. **Every value cites its lines, and the labels must agree.** A job must cite lines labelled job title, employer or job dates; an education entry,
   lines labelled education; a certificate, lines labelled certificate. Code refuses a value whose lines carry another label. So a certificate can
   never become a job, and a job can never become a certificate.
3. **Structural checks in code**, not word lists: a job needs a title and a period of employment; duties belong to the job above them; a date range
   that no job, education or certificate accounts for is flagged; the same job listed twice (a summary table and its description) is one job.
4. **One contract for every panel field**, written down (`docs/parser/CV_READING_CONTRACT.md`) and enforced by the schema: what each field is, where it
   comes from, its form (dates as printed, newest first; titles in normal capitals as `displayCase` shows them; one skill per item, never a sentence;
   a qualification is education, a certificate or short course is a certificate; a language spoken is a language, a programming language a skill), and
   its empty state ("Not stated in the CV").
5. **Fixed settings.** The same model, effort and strict schema for every CV, a versioned prompt, and every change re-measured before release.
6. **Consistency measured.** Each of the 50 documents is read twice: the two readings must agree on at least 95% of fields, and every field must meet
   the pass bar above. Agreement is reported per field.

The labelling is one more question per CV (jobs already ask two). Its cost is measured on the 50 with the rest; the expectation is under R0.05 more per
CV, and the owner sees the measured figure before release.

### D. The tabs always in reach, and every switch instant (owner, 10 Nov 2026: "where's the tab option as well, and going through those options, the change in everything should be instant ... put that in the pass as well")

TODAY (from the code): both side panels have tabs (`src/components/ui/PanelTabs.tsx`: candidate Overview, Experience, Education, Skills, Notes; job
Overview, Requirements, Responsibilities, Skills, More), but the tab bar scrolls away with the panel (`CenterPanel.tsx` scrolls the whole panel), so a
recruiter deep in a CV's Experience sees no tabs. Each tab is drawn afresh every time it is opened (`lazyMount unmountOnExit`), and the selected tab
fades in over 0.25 s.

WILL BE:

1. **The tab bar stays at the top of the panel** while its content scrolls, for CVs and jobs alike, with the person's or job's name beside it in small
   print once the header has scrolled away, so a recruiter always knows whose record it is and can always switch.
2. **Switching tabs is instant.** Each record's tabs are drawn once when it opens and kept, so changing tab only shows what is already there: no
   redrawing, no fade, no waiting. A tab opens at its top.
3. **Every other switch is instant too**: Overview and Matching Board, Live and Demo, 7, 30 and 90 days, the department and status filters. Each shows
   what the page already holds; anything that must be fetched comes in behind what is shown and never blanks it or shows another option's figures.
4. **Measured, not judged by eye.** The rehearsal clicks every tab of a long CV and a long job, and every Overview option, and fails if any change
   takes longer than 100 ms to show, if a tab bar is out of sight after scrolling, or if a figure on screen belongs to another option. The layout audit
   (`e2e/hosted/9-layout-audit.spec.ts`) gains the sticky-tab check at every width, in dark and light.

### E. Matching: faster, the same must-haves every time, and nothing covered (owner, 10 Nov 2026, testing a senior technology leader's CV against a bank's Head of Technology)

Measured: live gave 40% (medium confidence); the same matcher run on this Mac on a fresh reading gave 42% (Medium). The scores agree, but the five
must-haves did not: the job lists six minimum requirements, the reader keeps at most five, and which one is left out differed between the two readings
(live kept "regulated environment", the fresh reading kept "budgets above R150 million").

1. **The same must-haves on every reading.** When a job lists more minimum requirements than the five allowed, which five are kept is decided by rule
   (the document's own order, the role's level), never left to the reading; all the others stay requirements. Measured: every job read twice keeps the
   same must-haves.
2. **Faster.** One match is one Sonnet question with deep thinking: 29 s measured here. The board also only asks every 3 s whether it is done, and
   the percentage creeps towards 90%, so it looks stuck. The board will hear the moment the answer lands, the progress will show real steps, and the
   answer will be shorter (each requirement's reason cites the CV's lines instead of restating them). Thinking less deeply is not changed without the
   owner's yes, and only after the time and the agreement of the two readings are measured side by side.
3. **Nothing covered.** The match window's buttons (View CV, View job, Shortlist, Not suitable) sit over the requirements table, with rows showing
   beneath them. They will sit below the content, and the layout audit gains the check.
4. **A requirement far short is not "partly met"** (owner's review of Musa Dlamini, 10 Nov 2026). Matched against a CIO role, "led 300+ people" was
   marked partly met for a CV that states eight programme managers, and "5+ years at CIO level" partly met for none; the headline read "3 of 5
   must-haves met" while the score (24%) was right. Rule for the matcher: partly met only when the CV shows the requirement at a lower but comparable
   level; a requirement with several parts is judged by its hardest part; well short (8 against 300) is not demonstrated.
5. **"Inferred" only when the CV does not say it in words.** "Requirements gathering" was marked inferred where the CV says "wrote requirements".
6. **The fit and the confidence never read alike.** "Limited documented evidence" beside "Evidence confidence: high" reads as a contradiction: the
   band names say how well the person fits ("Low alignment"), the confidence how sure the reading is.
   Items 4 to 6 change the matcher's instructions: measured on the evaluation pairs before release; recorded matches are never changed by them (F).

### F. A recorded match never changes (owner, 10 Nov 2026: "once someone is matched, that should always be the recorded scores and reasons, nothing should ever change")

TODAY (from the code, `server/src/aiMatch.ts` `aiStartOf`): selecting Match again looks for an earlier score under a key made from what Claude was
given: the CV's passages, the years of experience and the job's text. The passages and the years are worked out against today's date (a role ending
"Present" grows every month), so the same pair matched again next month gets a new key, a new Sonnet answer, and possibly a different score and
different reasons. Reading the CV or the job again (as the new CV path will, for every CV on live) does the same.

WILL BE:

1. **The first finished match of a candidate and a job is the record**: its score, confidence, must-have states, reasons and next steps, kept exactly
   as they were, with the date, the model and the versions of the CV and job it was made from. Nothing rewrites it: not a later date, not a CV or job
   read again, not a new reader or matcher version.
2. **Match again shows the record**, at once and at no cost, wherever it is opened (board, shortlist, Overview).
3. **Only a recruiter's edit to the CV or job** can lead to a new match, and only when someone selects Match after the edit; the board says the record
   was made before the edit. The new match is added with its own date; the old one stays, unchanged, in the record's history. (To confirm with the
   owner: whether even an edit may lead to a new match.)
4. **The one-time re-read of older CVs** (section 7 of WILL BE) does not touch any recorded match.
5. **Tested**: a pair matched, the clock moved on a year, the CV read again and the matcher's version raised, then Match selected: the same score and
   reasons come back, and no AI call is made.

### G. Reading faster (owner, 10 Nov 2026: "how do we get the reader faster")

**Corrected 10 Nov 2026 (evening), from the code.** An earlier version of this section said a CV is sent to Claude in four questions one after
another, about 30 to 40 s a CV. That was wrong: the 30 to 40 s was the progress bar's allowance, not a measurement, and the questions mostly run side
by side (src/hybridReader.ts, src/aiRead.ts). What the code does and what was measured:

- Turning the file into text (this Mac, the owner's 9 CVs, no AI): 0.1 s for Word, 1.6 s for a text PDF, about 9 s for a scanned PDF (local OCR).
- Claude (Haiku, low effort, thinking on): the reading, the summary and the contact details are asked at the same time; then the department and any
  unclear places are asked again at the same time; sometimes one more question about education. Median 10.7 s a CV on the 30 real CVs (8 Nov 2026).
- So one CV by itself is about 11 to 13 s as Word or a text PDF, about 20 s as a scan. In a batch, most of a CV's time is waiting its turn: live
  turns 3 files into text at a time per portal (deploy/pc/release.sh), then reads up to 20 CVs at a time with Claude.

1. **Less for Claude to type, the same reading.** Claude's time is almost all the writing of its answer. Today it types every value out in full (each
   job with its duties, word for word), and code then checks the typing against the CV. In the new reading (section C) Claude labels every line and
   gives each value as the numbers of the lines it is on; code takes the words from the CV itself. The answer is several times shorter, so it comes
   several times sooner, and it is more exact, not less: a value copied from the document cannot be mistyped, shortened or reworded. Measured on the 50.
   **Accuracy decides, not speed:** released only if every field is at least as accurate as today's and two readings agree on at least 95% of fields.
2. **No parser before Claude.** The parser's word rules no longer run first, so Claude starts as soon as the text exists.
3. **More files at once where the PC has room** (how many files are worked on side by side; each is read exactly as before, so accuracy is untouched). Word and text PDFs are light; scans are heavy. Text files read 6 at a time, scans 2, measured
   against the PC's memory under a batch of 50 before the change is made.
4. **Each record on the board the moment it is ready** (section A), so a batch is useful long before its last file finishes.

5. **A second wave only where it is needed.** Today's second wave (unclear places asked again) and the second look (G.5) are asked only for the lines
   code's check finds unaccounted for, as line numbers, so they are short. Where G.5's measurement shows the second look on every CV catches more,
   every CV gets it, answered as line numbers too.
6. **More CVs at once with Claude**, as far as the Anthropic account's limits allow (20 per company today): a batch then moves faster; each CV is
   read exactly the same.
7. **Thinking as measured, not assumed.** "Low effort, thinking on" was chosen on 8 Nov for its accuracy. Labelling lines may not need it, as the job
   reader's labelling does not; tried on the 50 and kept off only if no field loses accuracy.
8. **A speed budget that is tested like everything else.** Proposed, to be confirmed by measurement: one Word or text-PDF CV on the board within
   8 s of upload, a scan within 15 s; a batch of 500 mixed files within 6 minutes. The rehearsal fails a release that misses it.
9. **First step: measure, per CV, where the time goes** on the 50 (file to text, waiting, each Claude answer and its length), before changing anything.

**Measured, 10 Nov 2026 (night): built, and not released.** The new reading (server/src/cvReader.ts, version cv-ai-5) is on the branch
`rolematch/cv-claude-only`. It did not meet the bar set above, so live still reads CVs as it did. Run cvonly-9: all 50 real documents, each read twice;
accuracy on the 30 that have checked answers; cost in docs/parser/EVALUATION_SPEND.md.

| On the 30 checked CVs | Live's reading | New reading, first time | New reading, second time |
| --- | --- | --- | --- |
| Name right | 30 of 30 | 30 of 30 | 30 of 30 |
| E-mail right | 27 of 30 | 29 of 30 | 29 of 30 |
| Phone right | 28 of 30 | 27 of 30 | 27 of 30 |
| Where they live right | 30 of 30 | 27 of 30 | 28 of 30 |
| Jobs fully right (of 147) | 126 | 124 | 125 |
| Jobs that are not jobs | 7 | 10 | 8 |
| Qualifications found (of 74) | 57 | 56 | 57 |
| Qualifications given that are right | 90.5% | 91.8% | 91.9% |
| Skills found | 96.2% | 97.0% | 97.0% |
| Skills given that are in the answers | 31.9% | 28.8% | 29.1% |

- **Better:** e-mail, skills found, qualifications given that are right. **The same:** names, languages, certificates found. **Worse:** phone (one
  CV), where the person lives (two or three CVs), jobs (one or two fewer fully right, one to three more that are not jobs). "At least as accurate on
  every field" is not met.
- **The same CV read twice:** 85.8% of values the same (2,249 of 2,621), against the 95% asked. Name, e-mail, phone and languages agree every time;
  job titles 96%; skills 90%; qualifications 89%; whole jobs 83% (the employer's wording differs); certificates 76%; and the lists taken from the
  line labels agree least (the CV's own summary 64%, worth noting 63%, projects 61%). Haiku 5.5 does not accept a setting that makes it answer the
  same way each time (the API refuses a changed "temperature"), so sameness has to come from how the reading is built, not from a switch.
- **Against live's own consistency (no AI cost: two saved readings of live's path, 8 Nov version, live-080 and live-080b).** On the same 30
  CVs and the same fields (name, e-mail, phone, town, headline, jobs, qualifications, certificates, skills, languages), live's reading agrees with
  itself on 82.1% of values and the new reading on 87.9%: jobs 65% against 78%, headline 71% against 97%, town 77% against 86%, skills 84% against
  90%, qualifications and certificates about even. Live looks steadier overall (86.0%) only because its summary, projects and worth-noting come from
  word rules, which give the same answer every time. So 95% is met by neither today; whether the bar is 95% on every field, or "steadier than
  today", is the owner's call.
- **Time, Claude's part:** half of the 50 CVs within 7.1 s, nine in ten within 15.4 s, the slowest 28.6 s; live's reading measured 9.5 s for half.
  Word files 6.0 s, text PDFs 8.1 s, scans 5.0 s after about 9 s of turning the scan into text.
- **What was tried on the way** (each measured on the 30): the reading asked as two questions side by side, work and lists (as accurate as one
  question, 7.9 s against 11.0 s: kept); the line labels answered as short text and without thinking (kept); the department and the capital-letters
  question without thinking (kept); a second look at jobs from the labels (added wrong jobs: removed, kept for qualifications only); the summary
  with thinking (5.7 s, about 1,000 tokens) or without (2.0 s, blander and too long): kept with thinking, a choice for the owner.

**Three things this section said that were wrong, corrected here.**
1. Item 1 said Claude types every job's duties word for word. It does not: duties have been taken from the document's own lines since 8 Nov
   (hybridReader.ts). What Claude does write, per CV on average: the reading about 1,800 tokens, the summary 1,000, the second look 400, the line
   labels 375, the rest 250; about 3,850 in all, and most of it is thinking, which counts as writing.
2. Item 8 proposed 500 files within 6 minutes. Not possible on today's account: Anthropic allows the account 80,000 written tokens a minute on
   Haiku, RoleMatch uses 80% of that (server/src/ai/rateLimit.ts), which is about 16 to 18 CVs a minute. **500 CVs take about 27 to 31 minutes**,
   however many are read side by side. The estimates given to the owner earlier on 10 Nov (15 to 20 minutes, then 8 to 12) were wrong for the same
   reason. Two things change it: a higher limit from Anthropic (asked for on the Console; it rises with the account's tier), or writing less per CV.
3. Item 6 (more CVs at once) does not make a batch faster while that limit is the ceiling; it only makes more of them wait at the same time.

**Run 10 (23:04, branch rolematch/cv-claude-only, 043956d), after the first two fixes below.** The CV whose town was lost now has it in both
readings. Otherwise no clear change: phone 28 and 27 of 30 (live 28), town 27 and 28 (live 30), jobs fully right 125 and 123 (live 126), two
readings agree on 83.6%. Between two runs of the same reader on these 30 CVs the numbers move by one or two CVs a field, about the size of each
fix, so single fixes cannot be told apart from chance on 30 CVs; deciding needs more keyed CVs, not more runs. Paid measurement stopped here for
the night at $2.09 of $4.00.

**Found while measuring.** (1 and 3 fixed on the branch; 2 and 4 open.)
1. Lines repeated at the top of every page were left out of the text on every page, the first included (docmodel/model.ts), so one CV's
   contact block and town never reached Claude. Fixed: kept where they first stand (ac6327e).
2. An address that runs over two lines with something between them ("Gardens Cape" / phone / "Town 8001") comes back cut short.
3. An agency's own phone in its letterhead was given as the candidate's on one CV: its footer repeats were not shown to Claude and carried no
   label, so the agency rule never held. Fixed (043956d). Open: a candidate's phone inside an agency's form is read as the agency's on another.
4. One CV says "Current Location | JHB" and names Johannesburg under each job: the new reading shows "JHB", the answers say Johannesburg.

**11 Nov 2026: all four closed.** 2: a place the AI reads cut at a line break is completed across the break from the city list (cvReader.ts, wholePlace),
icon characters from a symbol font ignored. 3, the open half: a phone on a line naming the agency (by its registered or trading name) or the agency's own
number is never the candidate's (agencysOwnPhone). 4: "JHB" is Johannesburg by the place rule (places.ts). Run 13, the 30 keyed CVs: town by city 30 of 30,
phone 30 of 30, name 28, e-mail 29.

### H. After this pass: Claude reading scans directly (owner, 10 Nov 2026: "you can do that after this next pass so I can see")

Today a scanned CV is turned into text by local OCR on the PC (about 9 s a scan) before Claude reads the text. Claude can read the scanned page itself as
an image, which removes the local OCR step and is often more accurate on poor scans, at a higher cost per scanned CV (an image costs more to read than
text; Word files and text PDFs are unaffected). Once this pass is released, the scans in the 50-document set are read both ways and the owner sees
accuracy, time and cost side by side before anything changes. Nothing is built for this until then.

### I. The board hears the server; it never waits on the browser's timers (owner, 10 Nov 2026: "leaving the page and sometimes going to other browsers results in the uploads hanging a bit ... built with our golden rule in mind and long-term fix")

TODAY (from the code): the work never depends on the page; it runs on the server's queue. But the board learns of it by asking: every 1.5 s for files
being read, 2 s for a batch, 3 s for a match's score, 10 s for a reading again. A browser slows the timers of a page out of sight (after a few minutes to
about once a minute), so a returning recruiter could wait up to a minute for news that was already there. Fixed for now (10 Nov 2026,
src/utils/wake.ts and the loops in Dashboard.tsx): every check runs at once when the page is seen again.

WILL BE: one event stream per signed-in page (Server-Sent Events, an open web standard), carrying only that portal's events: a record published, a
file failed, a batch's counts, a match scored, a record read again. The server sends each the moment it happens; the board shows it at once and asks
nothing. Tenant isolation is the stream's first rule: it is opened with the session, scoped to the session's organisation and portal by the same row
rules as every query, and a test proves another portal's events never arrive. The checks stay only as a slow safety net (every 30 s, and at once when
the page is seen again), so a dropped connection costs seconds, never correctness. Measured in the rehearsal: an event on screen within 1 s of the
server's change, with the tab hidden and shown again.

### J. Judging a career by its work, not its labels (owner, 10 Nov 2026: "I really like these ideas")

Owner, 10 Nov 2026, on a test candidate's career (a real CV used with permission; name withheld. Technology leadership at a bank, then at an insurer, then CIO; no degree): "they
meet the relevant stuff, but it's in a completely different department ... can we refine that, or should we just leave it as it is?"

Measured: on a bank's Head of Technology the matcher gave 40 to 42%, held down by scale the CV never states (team sizes, budgets) and the degree; the
industry it called "related", not different. Against an insurer's Head of Technology Centre of Excellence it gave 90%. So the moves between departments
are not what costs him most; what the CV does not say is. Proposed, all within "never judge a requirement" and "never manufacture a fact":

1. **The work, not the title or department.** Head of Technology, Head of a Centre of Excellence and CIO are the same function at different scopes: the
   matcher judges what the person did and led, never the name of the unit. Each must-have's reason cites the work.
2. **Neighbouring sectors are close.** Banking, insurance and asset management are financial services: "related", and costing little unless the job
   itself asks for one sector.
3. **The career's direction, from dated roles alone.** Code works out the steps up in seniority and scope, how long each took, and whether the function
   stayed the same (technician to CIO in technology, here). The matcher is given it as a fact, as it is given the years of experience today.
4. **A qualification is the employer's call, made visible.** A degree not shown stays "not shown in the CV", never "missing" and never quietly waived.
   Where the job itself says "or equivalent experience", the matcher weighs the career against it and says so. Each job gets a setting, off unless
   the company turns it on: "Accept equivalent experience for qualifications". Where the career is strong and the degree is the gap, the first next
   step says exactly that, for a person to decide.
5. **Measured before release** on the evaluation pairs: careers that cross departments and sectors should rise only where the work matches; weak fits
   (Musa Dlamini against a CIO role) must not rise; the same pair read twice must give the same answer. Recorded matches are not changed (F).

### K. Shortlists that work at scale (owner, 10 Nov 2026: 5,000 CVs for a handful of jobs; "there should be an option there to go through shortlists"; "I need to know those scores are really accurate and it's not just because this person tailored their CV")

Diagram: [SHORTLISTS_AT_SCALE_PLAN.svg](SHORTLISTS_AT_SCALE_PLAN.svg) (source [.mmd](SHORTLISTS_AT_SCALE_PLAN.mmd)), drawn from the code.

TODAY (from the code): "Who to match" (MatchChooser) lists every candidate with a search box and tick boxes, and no filter; the browser then asks for
one full match per person, four at a time, so the page must stay open. A person's status is per job (applications), the role panel has "View
shortlist", and the candidate list's Status filter means "for any job".

WILL BE:

1. **Who to match, with filters.** For a role: All, Shortlisted for this role, Not yet matched with this role, any status for this role, a department;
   "Select all shown". For a candidate: All roles, open roles, roles in their department. The same filters the board uses, one rule each.
2. **The server runs it.** One request queues the whole run inside the portal; the page can be closed and the board hears progress (section I).
3. **The same match for everyone.** Every candidate chosen gets the full Sonnet match, exactly as today; no cheaper model and no pre-screen (owner,
   10 Nov 2026: "we're not changing any models ... this isn't our cost to bear"). A pair already matched is shown as recorded, never run again (F).
4. **Evidence graded by where it sits.** Strong: inside a dated job at a named employer, with scope or numbers. Medium: inside a job, without specifics.
   Weak: only in the summary or skills, or the advert's own words repeated. A tailored CV with nothing dated behind it stays low.
5. **Facts the CV cannot dress up**, worked out by code from dates and titles: time at each level, the climb, recency, tenure, gaps, and claims no
   role supports ("led 300 people" in a junior role). Never called a lie: it lowers confidence and becomes a question in the next steps.
6. **The top 50 ranked head to head** by the same model, must-have by must-have, with the reason each is above the next. The same order whichever
   order they are given, and when asked twice. Candidates within the matcher's normal wobble are shown as level, not 87 against 86.
7. **Shortlists everywhere they belong.** The role panel gets a Shortlisted tab that opens the same ranked view as after matching; the candidate
   list's Status filter becomes "Status for" the role selected; the Overview's Shortlisted block and Needs attention count exactly these records.
8. **Measured before release:** one job, a mixed set of CVs (honest strong, honest weak, tailored, keyword-stuffed, over-claiming): the honest strong
   rise, the stuffed sink, the ranking holds when run twice; and a run of 500 timed end to end.

### L. An upload always finishes once Upload is pressed (owner, 10 Nov 2026: "it needs to always be running once someone clicks upload unless there's an interruption with wifi")

TODAY (from the code): sending belongs to the app, not the board (src/utils/backgroundSends.ts), so moving between the Overview, the board and
Settings never stops it, and the browser asks before letting the tab close mid-send. Once a file is on the server, its reading never depends on the
page. But: a lost connection is waited out about 20 times (5 to 25 s each, roughly six minutes in all, src/utils/batchUpload.ts), after which each
remaining file is marked not sent; and a tab closed mid-send leaves the rest unsent with no way to finish that batch.

WILL BE:

1. **A lost connection never gives up** (owner, 10 Nov 2026: "I don't want this thing automatically saying no, you can't do this ... it just needs to
   pause, and as soon as they're connected again, it needs to follow through"). While the page is open, sending pauses when the connection drops and
   resumes by itself the moment it returns, from the next unsent file, however long the connection was gone. A lost connection is never an error and
   never marks a file "not sent": the panel only says "Paused: waiting for the connection". Cancel remaining is always there for the person who wants
   to stop. No file is sent twice (the server already knows each file by its contents).
2. **Finish a batch that was cut short.** If the tab was closed, the batch panel says which files did not arrive and offers "Choose them again": the
   same files go into the same batch (matched by name and size), and nothing already in is sent again. (A browser cannot reopen files on its own after
   the page has closed; this is the closest the web allows.)
3. **Faster sending, so the window is short.** More files in flight at once on a good connection, measured on a batch of 500.
4. **Tested:** the connection cut for ten minutes mid-batch and restored; the tab closed at file 120 of 500 and the rest chosen again; in each case
   every file arrives once.

### G.5 A second look at every CV (owner, 10 Nov 2026: "reading the CV and filling out the panel and then doing one more CV trip to make sure everything was caught")

Two checks after the reading, measured side by side on the 50 documents before choosing:

1. **Code's check, every CV, free and instant.** Every line carries a label (section C), so code knows what must have been used: a line labelled job
   title that no job cites, a certificate line no certificate cites, a skill line no skill cites, a date range nothing accounts for. Lines Claude left
   unlabelled are asked about once, by number, as the job reader already does (src/jobReader.ts).
2. **Claude's second look.** Claude is given the CV's numbered lines beside the panel it filled and asked only: what did you miss, or get wrong? Each
   answer must cite the lines it comes from, with the right labels, and code checks it against the document's words, as for every value; it can add
   or correct a value, never invent one.

Measured: (a) the second look on every CV, (b) the second look only where code's check finds something unaccounted for. Chosen by accuracy (missed
roles, skills, certificates, education, contact details), then by consistency; only where both are equally accurate does time decide. Expected cost
of (a): about 15 to 20 s more per CV, about 5 to 8 min more on a batch of 500, and roughly double the reading's AI cost (the company's, as agreed).

### M. The footer on every page, as a website has (owner, 10 Nov 2026, for the next pass: "my dad mentioned that he wanted this footer to be persistent on every page, similar to how a website behaves")

TODAY (from the code): the footer (src/components/Footer.jsx) is placed by hand at the bottom of four pages only: Home, Features, Pricing and
Contact. Login, Sign up, Accept invite, the Overview, the Matching Board, Settings and Profile have none (routes in src/main.jsx).

WILL BE: the footer is part of the page frame, not of each page, so every page has it and a new page cannot forget it: one layout around the
routes renders the page and then the footer, which sits at the bottom of the content (at the bottom of the window when the page is short) and
scrolls with it, as on a website; it is not pinned over the content. The four pages lose their own copy. Checked by the layout audit
(e2e/hosted/9-layout-audit.spec.ts): every route ends with the footer, nothing overlaps it, at phone width too.

Questions for the owner:
1. **Settled (owner, 10 Nov 2026: "obviously just tailor it for once you're inside, 'Get Started' won't be necessary"):** inside the signed-in
   app too (Overview, Matching Board, Settings, Profile), in a version for someone already signed in: no Get Started, no sign-up or trial
   prompts; its links lead to the app's own pages. The board fills the window and scrolls its own lists, so there the footer sits below the
   board, reached by scrolling the page.
2. Still open: what the footer says, now that it would be on every page. Today it shows things that are not true or do nothing: "SOC 2", "ISO 27001" and
   "GDPR Compliant" badges (none held; South Africa's law is POPIA), "Free Trial: 14-day full access" (no trial exists), four social links that go
   nowhere (#), a newsletter box that sends nothing, and links to Careers, Blog, Press, Documentation, Guides, API Reference and Community pages
   that do not exist; Terms, Privacy and Cookies are not links at all, and there are no such pages. The rule is that every public promise is
   proven (docs/product/CLAIMS_REGISTER.md). Proposed: keep the logo, the description and the links to pages that exist (Features, Pricing,
   Contact, Sign up); remove or replace the rest, with the owner's choice for each. A privacy notice is wanted in any case (POPIA), as its own task.
