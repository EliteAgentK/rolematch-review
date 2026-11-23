# Code quality: the plan (12 Nov 2026)

Owner, 12 Nov 2026: "ensure the code is elegant from the first line to the very last ... think like a senior corporate engineer throughout this
process ... think like this thing is already in production."

## How we work (the rules every change here follows)

1. **Production first.** Live is a running system holding companies' real data. A change that cleans code must not change behaviour, and is proven
   not to: the full suite passes before and after, and a refactor commit never carries a feature or a fix.
2. **Correctness before elegance.** Faults that can hurt a customer (wrong data, wrong person seeing something, errors under load) come first.
   Cosmetic work never jumps that queue.
3. **Small and reversible.** One concern per commit, each releasable alone, each with its own rollback (the previous image).
4. **Measured.** Every workstream has a number before and after (below). "Cleaner" without a number is opinion.
5. **No rewrites, no mass reformatting.** A file is improved when there is a reason to touch it, in the way that file already works. A diff that
   changes 3,000 lines of spacing hides the one line that matters.
6. **Comments and documents tell the truth.** A comment that no longer matches the code is a fault, fixed like one (12 Nov: CLAUDE.md said status
   was per candidate; it had been per job for three days).

## Where we start (measured 12 Nov 2026)

| Measure | Server (`server/src`) | Frontend (`src`) |
|---|---|---|
| Lines (without tests) | 19,741 | 17,761 |
| TypeScript strict mode, unused locals refused | yes | yes (also unused parameters) |
| `any` (a type that switches checking off) | 480; most in `index.ts` (44), `aiMatch.ts` (18), `prepare.ts`, `history.ts`, `console/view.ts` (15 each) | 38 |
| Untyped JavaScript files | 0 | 13 (largest: `HomePage.jsx` 2,118 lines, `ProfilePage.jsx` 928) |
| Largest modules | `rules.ts` 1,231; `index.ts` 975 (every API route in one file) | `Dashboard.tsx` 1,318; `tokens.ts` 1,202 |
| TODO or FIXME left in the code | 0 | 0 |
| Test files | 219 | 11 |

## Workstreams, in order

| # | Workstream | Why it matters in production | Done when |
|---|---|---|---|
| A | **Correctness found by review** | Customers' data and who sees it | Status per job P1 to P4 and the repair: **done 12 Nov** (b650618, 69b8b7a). P5 and P6 after the owner's decisions |
| B | **Privacy debt** | A corporate reviewer finds these in an hour | `ProfilePage.jsx` reads the account instead of keeping names, e-mails and photos in the browser; the cookie banner offers only what exists |
| C | **Types at the edges** | An `any` is where a wrong shape reaches the database unnoticed | Every request body is checked against a schema where it enters (`index.ts`), every database row read has a type; `any` in the server under 100, none new |
| D | **One router, split by area** | A 975-line `index.ts` is where a permission check is easiest to miss | Routes in one module per area (sign-in, documents, records, statuses, settings, portals), each with its own permission line; behaviour identical, proven by the suite |
| E | **The board's page, split** | `Dashboard.tsx` mixes data loading, filters and layout | Data in hooks, filters as a tested pure function, layout as components |
| F | **JavaScript to TypeScript** | 13 files no type checks | Converted when each is next touched; the profile page with B; the marketing pages with their claims (`docs/product/CLAIMS_REGISTER.md`) |
| G | **One way to say a time or an amount** | "3 min ago", dollars and rands are worked out in several places | One small shared module for the server and one for the frontend, used everywhere |
| H | **Retire the Supabase era** | Code nobody runs still has to be read and secured | After Supabase is retired (about 19 Nov, with the owner): its code paths, the Mac's rehearsal stack and the paused `rm-db` scripts removed, as the owner's rule says ("remove unused completely") |
| I | **Guard rails** | Catch the next fault before review | A small lint rule set that finds real faults (promises not awaited, `==`), not style; it runs with the suite |

`rules.ts` (the CV reader's rules) is deliberately last for structural work: its behaviour is measured by the reading evaluations, and it is changed
only with those numbers beside it.

## What is not done

- No change of a database column, an API path or a stored value for tidiness: those need a migration and a reason.
- No new framework or library for its own sake.
- Nothing here changes what a customer sees, except B, which is a fix.
