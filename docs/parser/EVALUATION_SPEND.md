# Claude spend on measurements for the CV pass

Owner's cap, 10 Nov 2026: **$4.00** (first $3.50, then "your limit is $4. I've topped up a little bit") for the pass's measurements (docs/architecture/PLAN_CV_READING_CLAUDE_ONLY.md), counted from this file's first
entry. Every measurement run that calls the real Claude is written here before the next one starts: what was run, on how many documents or pairs, and
what the run itself reported ("About $..."). Work stops at the cap, whatever state it is in, and the owner is told. Any session doing this work uses
this one ledger. Stand-in (test) Claude calls cost nothing and are not entered.

| When (SAST) | Run | Documents or pairs | Cost | Running total |
| --- | --- | --- | --- | --- |
| 10 Nov 2026, cap set | (none yet) | | $0.00 | $0.00 of $4.00 |
| 10 Nov 2026, 21:00 | Where a CV's time goes on today's path (test/collection/timeStages.ts, run timing-1110) | 50 CVs | $0.13 | $0.13 of $4.00 |
| 10 Nov 2026, 21:08 | Claude-only reader, first version (test/collection/cvOnly.ts, run cvonly-1) | 30 keyed CVs | $0.14 | $0.27 of $4.00 |
| 10 Nov 2026, 21:15 | Claude-only reader, version 2: contact from the whole CV, nothing masked, labels bear out jobs (run cvonly-2) | 30 keyed CVs | $0.14 | $0.41 of $4.00 |
| 10 Nov 2026, 21:21 | Version 3: labels as text, the reading as two questions (run cvonly-3) | 30 keyed CVs | $0.14 | $0.55 of $4.00 |
| 10 Nov 2026, between 21:21 and 21:32 | Each question timed on 4 CVs, twice; department and summary with and without thinking | 4 CVs, 30 department pairs, 6 summaries | $0.06 | $0.61 of $4.00 |
| 10 Nov 2026, 21:32 | Version 4: reading as two questions, department early (run cvonly-4): jobs read worse, split taken back out | 30 keyed CVs | $0.15 | $0.76 of $4.00 |
| 10 Nov 2026, between 21:32 and 21:39 | The summary with and without thinking, each sentence checked by itself | 30 CVs | $0.04 | $0.80 of $4.00 |
| 10 Nov 2026, 21:39 | Version 5: one reading question again, labels' second look on jobs (run cvonly-5): jobs worse, that second look removed; two missed names traced | 30 keyed CVs + 6 contact questions | $0.15 | $0.95 of $4.00 |
| 10 Nov 2026, 21:45 | Version 6 (run cvonly-6): names right; six jobs of one CV wrong, traced to taking dates in the CV's spaced letters | 30 keyed CVs | $0.14 | $1.09 of $4.00 |
| 10 Nov 2026, 21:50 | Version 7 (run cvonly-7): one reading question, values in the CV's own spacing; jobs fully right equal to live's (126 of 147) | 30 keyed CVs | $0.14 | $1.23 of $4.00 |
| 10 Nov 2026, 21:55 | Run 8: the reading as two questions, measured cleanly against version 7 (as right, median 7.9 s against 11.0 s); four CVs tried on the final version | 30 keyed CVs + 4 | $0.17 | $1.40 of $4.00 |
| 10 Nov 2026, 22:06 | Run 9, the version built (cv-ai-5): every document read twice, for accuracy, for the agreement of two readings and for time. Result: not yet good enough to release (see the plan, section G, "Measured") | 50 CVs, each twice | $0.34 | $1.74 of $4.00 |
| 10 Nov 2026, 23:04 | Run 10 (branch rolematch/cv-claude-only, 043956d): repeated page lines kept once, an agency's number judged on labelled lines only; the two phone-miss CVs looked at first (one cent) | 50 CVs, each twice, + 2 | $0.35 | $2.09 of $4.00 |
| 10 Nov 2026, 23:38 | Before release: three real CVs (Word, text PDF, scan) uploaded through the whole pipeline on this Mac with Claude reading; all three reached the panel in 12 to 17 s | 3 CVs | $0.02 | $2.11 of $4.00 |
| 11 Nov 2026, before 16:46 | Runs 11 and 12: the two open misses (an address broken across a line break; an agency's footer number read as the candidate's), each read twice, before and after their fixes | 2 CVs, each twice, two times | $0.03 | $2.14 of $4.00 |
| 11 Nov 2026, 16:46 | Run 13: the 30 keyed CVs once, after both fixes: name 28, e-mail 29, phone 30, town by city 30 of 30 (last night 27) | 30 keyed CVs | $0.13 | $2.27 of $4.00 |

Times are each run's finishing time from its result file's clock (corrected 10 Nov 2026, 22:19: several earlier entries had carried estimated times up to half an hour late).
