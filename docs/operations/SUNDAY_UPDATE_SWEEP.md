# The Sunday update sweep

Owner, 11 Nov 2026: "every Sunday it must be a full update sweep of everything, during 00:00 and 06:00, check for updates on everything, the PC as well
as the platform, and then you must always make sure that nothing is affected from updates, and if it is, speak to me first."

Run every Sunday by two scheduled tasks on the Mac (Claude app): **the sweep at 00:05** and **the check after Windows at 04:30**, Johannesburg time.
Windows installs its own updates at 03:00 on Sundays (set on the PC on 11 Nov 2026: AUOptions 4, ScheduledInstallDay 1, ScheduledInstallTime 3) and may
restart; the start-up task "\RoleMatch\Keep Linux running" brings Linux and every service back without anyone signing in.

## The rule

1. **Check everything** (the list below).
2. **Apply only what is proven safe:** security and patch updates whose checks all pass afterwards.
3. **Anything that is not proven safe is held, and the owner is asked first:**
   - a new major or minor version
   - anything that changes how the platform behaves
   - anything that fails a check
4. **Nothing is left changed and unverified.** Every change has a backup taken before it, a way back, and a check after it. A check that fails after
   a change means it is undone, then the owner is told.
5. **The owner hears the result by 06:00:** what was checked, applied and held, and anything waiting for them.

## Before anything (00:05)

- A backup of live (`deploy/pc/backup-nightly.sh`); the sweep stops if it fails.
- The baseline, written to the sweep's report:
  - every rm-* container and its health
  - `/api/ready`
  - the console's `/healthz`
  - the sign-in page loading
  - the board's and the Overview's response times from the PC
  - the database round trip
  - the versions below

## What is checked

| Part | How it is checked | Applied by the sweep? |
|---|---|---|
| Windows | updates pending, and the last restart (read only as rolematch) | Windows installs them itself at 03:00 |
| WSL (the Linux side's host) | `wsl --version` against the latest release | No: held for the owner. A WSL update restarts all of live |
| Linux on the PC | `apt list --upgradable`; security updates only | Security updates, yes, then everything rechecked |
| Docker | engine version against the latest | No: held. An engine update restarts every container |
| The tunnel (cloudflared) | version against the latest | Patch versions, yes, by restarting the tunnel container on the new image, then rechecked |
| Base images (`node:24-bookworm-slim`, `postgres:17-alpine`, Supabase's `postgres` and `gotrue`, `postgres:17.6-bookworm`) | newer builds and tags | Rebuilt on the same version line, yes, only through a release with the full suite and rehearsal passing |
| Platform packages (`npm outdated`, `npm audit` in the app and the server) | outdated and vulnerable packages | Patch updates with a security fix, yes, only through a release with the full suite and rehearsal passing; everything else held |
| The database (PostgreSQL 17 minor), sign-in (GoTrue) | versions against the latest | No: held; planned with the owner |
| Certificates and the domain | expiry dates | Reported 30 days ahead |
| Backups | last nightly backup, last restore drill | Reported; a missed one is urgent |

## Every component the platform is built from, and a verdict on each update

Owner, 11 Nov 2026: "we must also check for updates on the components we use within the platform. And whether there are good updates or bad updates,
not just the PC." A newer version is not good because it is newer. Each one gets a verdict, with its reasons, before anything is done with it.

**The components** (read from package.json, server/package.json, the Dockerfiles and deploy/ each Sunday, so a new one is never missed):

| Area | Components |
|---|---|
| The app people use | React, React DOM, React Router, Chakra UI and Emotion, Motion, Chart.js and react-chartjs-2, react-icons, the Lottie players, the Sora and Outfit fonts |
| Building and testing | Vite and its React plugin, TypeScript, Vitest, Playwright (Chromium, Firefox, WebKit), esbuild, tsx |
| The server | Node.js 24, postgres (postgres.js), zod, nodemailer, the AI provider's SDK |
| Reading documents | pdf-lib, unpdf, mammoth, word-extractor, @xmldom/xmldom, fflate, utif2, @napi-rs/canvas, tesseract.js and its English data, the OCR and model tools used in evaluation |
| Services | PostgreSQL 17 (Supabase's image), Supabase Auth (GoTrue), cloudflared, Docker, the base images (node:24-bookworm-slim, postgres:17-alpine) |
| The AI | the models in use, their prices and their retirement dates |

**For each update found:**

1. **Read what changed:**
   - its release notes or changelog
   - security advisories (npm audit, GitHub advisories)
   - its issue tracker for problems reported against that version in its first days
   - whether it needs a newer Node, browser or database than ours
2. **Give a verdict:**
   - **Good:** a security fix, or a fix for something that touches us, with nothing breaking and no reported trouble.
   - **Wait:** too new to trust (under a week old, or with open reports of regressions), a new major or minor version, or a change in behaviour. Held
     and listed for the owner with what it would bring.
   - **Bad:** known regressions, breaking changes that hit our code, a withdrawn release, or a change of licence or ownership that matters. Not taken;
     the reason is recorded, so it is not considered again until a later version fixes it.
3. **Prove the good ones on our own code:** the full server suite on the clean worktree, the app's build, the rehearsal's journeys, and for
   document readers the reading evaluations on invented documents. A good verdict is not acted on until this passes.
4. **Record it:** each component's version, the newest version, the verdict and its reasons, in the week's report, so the owner can see the whole
   picture and how it changed since last week.

The AI gets its own line: any model announced to retire, a price change, or a newer model. No change of model is ever made in a sweep: it goes to the
owner, with a measured comparison when it is worth one.

## After the sweep (by 02:30) and after Windows (04:30)

The same checks as the baseline, compared with it:

- every container healthy
- every address answering
- response times within 20 percent of the baseline
- the database round trip unchanged
- no new alert in the console

A failure after a change the sweep made: that change is undone, and the owner gets a push saying what and why. A failure after Windows: Linux is
started again if it has not come back; if the platform still does not answer, the owner is pushed at once.

## The report

`docs/operations/sweeps/<date>.md` (counts, versions and results only; no secret, no customer data), committed, and a push to the owner:

- where we are
- how it looks
- what is waiting for them
