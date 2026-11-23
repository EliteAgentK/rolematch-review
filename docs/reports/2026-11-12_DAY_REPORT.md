# RoleMatch: everything done on 12 November 2026

Written 11:20 SAST, while live was down in the area's power cut (see "Right now"). 28 changes committed and pushed today.

## Right now

- **Live is down because of the power cut.** At 11:04 live answered with Cloudflare's "origin unreachable" error and the PC stopped responding.
  The last check before that, at 10:58, was all green. Nothing is lost: everything was saved to the PC's disk.
- **When the power is back:** switch the Dell on if it doesn't start by itself. Windows starts the keep-alive, which starts RoleMatch's Linux, then
  Docker, then the services: about 5 minutes. Then I check the database, backups, services and console, and release what's waiting (below).
- **One lesson from the cut:** a home PC has no backup power. A UPS for the Dell and its router is the cheap fix until production moves to Azure.

## Live today (released and checked)

| Time | What went live |
|---|---|
| 06:53 | **Switched onto the PC's own database and sign-in in Johannesburg.** Live had been on Supabase in Ireland. Pages answer in about 0.1 s. |
| Morning | **Security:** limits against flooding the console and sign-in; nothing read for visitors without a session; each company's monthly AI allowance (no one can run up a client's AI bill); e-mail addresses no longer scrambled by Cloudflare. |
| Morning | **Platform fixes:** a test candidate's CV reading (current job and stray "skills"), jobs always shown with their company, the "Superpower" colour flow, a 2-second opening screen, the live clock beside dark mode, everyone's own time zone. |
| 09:34 | **The console's control:** delete people, portals and companies; block; sign out everywhere; set allowances; support access ("where did this CV go"); daily totals; unusual-activity alerts; "Active now" like Instagram; resolved history apart from notices; pages refresh themselves; dollars with "about R..." at the day's real rate; Johannesburg as the location. Strongest matches: scores on people, jobs by full name. |
| 10:20 | **Overview chart in round numbers** (0, 50, 100, 150, 200), never 0, 43, 87, 130, 174. |
| 10:57 | **Period switch on every console section:** last 24 hours (hour by hour), 7 days, 30 days, 3 months, or any month. The choice follows you between pages. Checked on live: 25 hourly points for the last 24 hours; November so far: 5 people joined. |

## Fixed with you this morning

- **The Dell's keep-alive:** it had failed every 10 seconds since installation. Two permission problems on its key, now fixed. It held from 09:55
  until the power cut, and it now records SSH's own reason if it ever fails again.
- **The two backup keys** are saved off the PC.

## Built and tested, waiting for the power

- **Your dad's console account.** The console now holds two accounts at most, each with its own password, e-mailed code, lock and sessions. Every
  action records who did it. The full suite passed. It will be released when the PC is back. Then your dad's account is added at the PC's terminal:
  `sudo /srv/rolematch/deploy/pc/console-password.sh`. **I still need his full e-mail address** ("tabo@gmail" is incomplete).

## Written for you to read (nothing live)

| Document | What it says |
|---|---|
| `docs/architecture/PLAN_AZURE_PRODUCTION.md` | Moving to Azure Johannesburg when the first corporate signs: diagrams of today and the target, what our code needs (checked), Microsoft's own prices (about $312 a month to start, about $503 with a standby database), and the order of work. Our AI can't be placed in South Africa through Microsoft, and buying Azure through a reseller would block our AI there. |
| `docs/legal/` | Privacy policy, terms, cookie policy, customer data processing agreement and candidate notice, as drafts to brainstorm. **Found: live has no privacy, terms or cookie pages at all** (the footer words lead nowhere). Six decisions only you can make are listed in its README. |
| `docs/legal/AI_ROUTE_ENQUIRIES_DRAFT.md` | Two enquiries to send: TrendAI (Claude in a South African data centre) and Cassava (Claude reseller for Africa). The questions: where it runs, which models, and the price. |
| `docs/architecture/PLAN_LIVE_EXCHANGE_RATE.md` | A rate that changes through the day: each AI charge turned into rand at the moment it happens. Providers from $10 to $60 a month. Nothing bought. |

## Not done, and why

- **Live journeys with a test account:** creating accounts on the live site is outside what I'm allowed to do, even for testing. They need either
  your own walk-through, or a separate test site (for example test.rolematch.co.za) where test accounts are allowed. No test companies are left
  on live.

## Waiting on you

1. Power back, Dell on.
2. Your dad's full e-mail address for the console.
3. "Read again" on that candidate's CV, so their current job comes back.
4. The decisions in `docs/legal/README.md`, the AI route enquiries, and the exchange-rate provider, when you're ready.

## Where we are, how good it looks, next step

- **Where:** live on our own database in Johannesburg, fast, with a console that gives full control and history. It's down only because of the
  power cut.
- **How good:** the product and the console are strong. The weak points are the hosting (a home PC with no backup power) and the missing legal
  pages: both are known, planned and cheap to fix.
- **Next:** when the power returns, check everything, release the second console account, add your dad's account, then the legal pages once you're
  happy with the drafts.
