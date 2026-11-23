# Overview blocks open the Matching Board in the state they describe (plan, 10 Nov 2026)

Owner, 10 Nov 2026: "when I click shortlisted ... it must open up the shortlist", "when I click these matches, it should show the saved match results",
"incoming talent doesn't need to be clickable", departments "updated as soon as I add a job ... if I delete it, they should be gone", "absolutely nothing
I've spoken about here today should use more credits", "the only things AI is used for is ... the uploads/extraction and the matching", "for accounts that
are already created, everything should be there for them when we push live", and purposeful, corporate animations between the two views.

Diagram: [OVERVIEW_LINKS_PLAN.svg](OVERVIEW_LINKS_PLAN.svg) (source [.mmd](OVERVIEW_LINKS_PLAN.mmd)), drawn from the code as it stands.

## TODAY

- Every block's click opens `/dashboard` as it was; the board does not know what was clicked.
- The board already opens one record from `?open=candidate:<id>` (History's links) and already shows a saved match without any AI call (`showSavedMatch`, `GET /api/matches?candidateId&jobId`).
- Departments on the Overview and in the board's filters are counted from the records each time, so a new job's department appears once it is read, and a deleted job's goes (a change clears the portal's 20-second cache).
- Candidates and jobs read before departments existed are "Not grouped yet".

## WILL BE

1. **One link contract**, `/dashboard?focus=<what>&...`, read by one tested parser (`src/utils/boardIntent.ts`). No AI, no credit: each only sets the board's filters or opens what is already saved.

   | Block on the Overview | Link | What the board shows |
   | --- | --- | --- |
   | New candidates | `focus=new&days=N` | Candidates added in the last N days |
   | Open jobs | `focus=jobs` | Open jobs |
   | Shortlisted | `focus=shortlisted` | Candidates on a shortlist |
   | A strongest match | `focus=match&c=<id>&j=<id>` | Both records open and the saved assessment, as after Details |
   | A department | `focus=department&dept=<name>` | Jobs and candidates in that department |
   | A Needs attention item | `focus=attention&rule=<id>&title=...` | Exactly the records that rule counted (`GET /api/attention/:rule`, server/src/attention.ts), in the lists the rule is about; none when it has since been dealt with |
   | A Recent portal activity line | (a detail card first) | Who, with their full name and address, what happened and exactly when; then `focus=record` or `focus=match` opens its records |
   | Credits, Incoming talent | (not clickable) | |

   Built 10 Nov 2026. "Documents that could not be read" and "Jobs that need a title" were removed from Needs attention by the owner: they are the
   platform's to solve, not a recruiter's. The rules and when each appears: [docs/product/NEEDS_ATTENTION.md](../product/NEEDS_ATTENTION.md).

   The board shows what it is filtered to in one pill above the lists ("Showing from the Overview: Technology"). There is always a way back to the whole
   board (owner, 10 Nov 2026): the pill's "Back to the full board", "Matching Board" in the header pressed on the board, and "Matching Board" in the
   breadcrumb; each undoes what the link set. A filter whose department has gone (its last job deleted) returns to All.
2. **Demo:** a click explains what it would open in Live; nothing opens, since the demo's records are not on any board.
3. **Existing accounts on release:** the AI worker places records that have no department, as part of reading: a candidate from its headline and three latest jobs, a job from its title, its own unit and its company. This runs only where AI reading is on, 25 records a job, billed to the record's portal. A record is placed, or marked as tried, so it is never asked twice. It checks again every 10 minutes for any record missed. There is no button: AI stays in uploads (reading) and matching.
4. **Moving between Overview and Board:** the page content fades and rises into place (220 ms, decelerating), the header stays still, and nothing moves when reduced motion is set. This uses the browser's View Transitions where available, otherwise a CSS entrance.

## Tests

- `boardIntent.test.ts`: every link above parses to its filters; unknown or malformed links change nothing.
- The server sweep: a record with no department is placed once; a second sweep asks nothing; another organisation's records are never touched; nothing is asked when AI reading is off.
- Browser: each block opens its board state at 1536 px; the pill clears; Demo opens nothing.
