# Needs attention: what appears, and when

Owner, 10 Nov 2026: it shows only what waits on a recruiter, always relevant, the same for everyone in the portal, updating as the team works, and "there
can't always be something to do". Code: `server/src/attention.ts` (one query per rule, the same records on the Overview and on the Matching Board), the
demo in `src/overview/demo.ts` by the same rules. No AI: every rule counts what is already recorded.

## Principles

1. **Work for a person, never a platform fault.** A document the platform could not read, or a job with no title, is the platform's to solve. It is not a
   recruiter's task, so it is not listed here (removed 10 Nov 2026).
2. **Shown only when something waits.** A rule with nothing to show is not shown. With nothing at all, the card says "Nothing is waiting on you".
3. **One count, one list.** The number on the Overview and the records the board shows come from the same query, so they always agree.
4. **Most urgent first:** people part-way through a process before work not yet started. At most four are shown; the rest follow once these are dealt with.
5. **Open jobs only.** A closed or archived job's people are history, not work.

## The rules today

| Order | Rule | Appears when | The board shows |
| --- | --- | --- | --- |
| 1 | Interview stage, no update | A person has been in an interview stage (awaiting interview, interviewing, interviewed) for a job for 5+ days with no change | Those people and their jobs |
| 2 | Shortlisted, waiting | A person has been shortlisted for a job for 5+ days with no next step | Those people and their jobs |
| 3 | Strong matches not acted on | The AI's final score is 80+ (in the last 30 days), the job is open, and the person is neither on the job's list nor turned down | Those people and jobs |
| 4 | Open jobs with no shortlist | A job has been open 7+ days and nobody is shortlisted or further | Those jobs |
| 5 | New candidates not matched | A candidate added 2 to 14 days ago, in a department that has an open job, has not been matched against anything | Those candidates |

## Next, to decide together

- **Each organisation sets its own days and score** (Settings, versioned and audited like every setting), and can switch a rule off.
- **Snooze or dismiss** an item for a set time, recorded with who did it and why, so a deliberate wait is not shown as work.
- **Matches made before a record changed:** a match on an earlier reading of the CV or job, worth running again. This would cost a credit, so it is listed, never run by itself.
- **A hiring manager's view:** the people waiting on their decision only.
- **Credits running low**, once each company has its own monthly allowance.
