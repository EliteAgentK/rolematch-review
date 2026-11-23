# Overview page: Live and Demo (plan, 10 Nov 2026)

Owner, 10 Nov 2026: a dashboard beside the Matching Board, "a very good looking corporate dashboard ... not boring ... not too busy ... everything
calculated, everything informative ... interactive". Credits first. Everything on one screen on a computer, its own composition on a phone. Activity
refreshes every minute. A Live / Demo switch for **every account**, so a viewer sees their real organisation and also what RoleMatch looks like after
months of use. Design: `docs/product/design/dashboard.html`. Diagram: `OVERVIEW_PLAN.svg` (`OVERVIEW_PLAN.mmd`).

## TODAY vs WILL BE

| Block | Question it answers | Source (TODAY, nothing new stored) | Notes |
|---|---|---|---|
| Credits | How much AI use is left this month? | `ai_usage` for the organisation this month | **TODAY there is no per-organisation credit.** Live shows the AI used this month in rand. Credits remaining arrive with per-company keys and billing (PLAN in memory, 10 Nov). |
| Candidates | How many people, and how fast are they coming in? | `candidates` (created in the period vs the one before) | |
| Open jobs | How much is being recruited for? | `jobs` not closed or archived; new this period | |
| Shortlisted | How many people are moving forward, across how many jobs? | `applications` past New, not Not suitable | per job, as recruiters set it |
| Recruitment activity | What came in and moved forward, day by day? | `documents` read per day, `matches` per day, `audit_events` application.status_changed to shortlisted per day | Pipeline tab: read, matched, shortlisted, interviewing, hired |
| Strongest matches this week | Which pairs should someone look at first? | `matches` of the last 7 days, the AI's final score | a recommendation, never a decision |
| Job families | Where is the work? | open `jobs` by department (TODAY); by job family read by Claude (WILL BE) | |
| Incoming talent | What experience is arriving? | `candidates` in the period by years of dated experience | |
| Needs attention | What is waiting on a person? | shortlisted with no change for 5 days; open jobs 7 days old with no shortlist; documents that could not be read; jobs that need a title | counts only, each opens the records |
| Team activity | What has the team done? | `audit_events` (History's list, now including a status set for a job) | |

## How it is served
- `GET /api/overview?days=7|30|90`: signed in, one organisation, read under that organisation's own database rules (RLS), the same as every route.
- One-minute cache per organisation: a page that refreshes every minute costs one small request per organisation per minute, whoever is looking,
  light enough for 1,000 organisations online at once.
- A hiring manager (read-only) sees Demo, and Live where it shows only what they may see (TODAY: Demo only, with a note).
- Demo: sample data built in the browser, labelled "Demo" on every block; nothing is sent or stored. The switch is remembered per person.
- isolation.test.ts covers the new route (another organisation gets nothing of this one's).
