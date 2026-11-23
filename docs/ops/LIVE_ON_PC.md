# Live on the PC, model on the Mac (from 6 November 2026)

## Why

On 6 November the Mac was the owner's desktop, the live server, the test stack and the model at once. Short of memory (165 MB free, 8 GB of swap in use), its model wrote at 7 to 15 tokens a second instead of about 40. Live moved to the Dell PC; the Mac now runs only the model. Measured after the move: the Mac's model at 41 to 43 tokens a second with 3 GB free, and 52 tokens a second as seen from the PC through the link.

## How it runs

```
internet ──► Cloudflare named tunnel "rolematch-pc" (rm-tunnel-named, on the PC; deploy/pc/tunnel.sh, docs/ops/NAMED_TUNNEL_PLAN.md)
               │  https://app.rolematch.co.za (from 8 Nov 00:59; permanent)
               │  the quick tunnel (rm-tunnel, https://photo-scientists-profits-district.trycloudflare.com) still runs for one day for old links, then stops
               ▼
PC  Dell Precision 5820 (i9-10920X), Windows 11, always on, plugged in
    WSL 2 distribution "RoleMatch" (Ubuntu 24.04, 10 GB, 20 threads, mirrored networking),
    owned by the limited Windows account "rolematch"; Docker 29.9 inside it
      rm-api, rm-worker, rm-ai-worker   image rolematch:<commit>, built on the PC from the same commit (amd64)
      the Anthropic key  /etc/rolematch/ai.env (root only), given to rm-ai-worker alone; Claude is reached over HTTPS
      settings  /etc/rolematch/live.env (root only)   data volume  rolematch-pc-data
      deploy scripts  /srv/rolematch/deploy           deploy log  /srv/rolematch/deploys.log
               ▲
keep-alive (ssh, key only), opened BY the Mac: launch agent com.rolematch.pc-keepalive
    holds one session open in the PC's Linux so it keeps running (until 8 Nov 2026 it also carried the Mac's Ollama; the local model is gone)
Mac  nothing for live but this keep-alive.
     Colima (the Linux VM) is stopped unless tests need it.
Supabase rolematch-live (Ireland): database, sign-in, private files. Unchanged.
```

If Claude is slow, unreachable or out of credit, a CV is published with the parser's reading and says why, and a match keeps the rules' result; the health report and the console say so.

## Watchdog and keep-alive on the PC itself (from 10 November 2026)

On 10 Nov Windows powered off the RoleMatch Linux at 04:59, the forced stop jammed the WSL service, and live stayed down until the PC was restarted by hand at 06:08 (incident log in docs/architecture/PRODUCTION_READINESS.md). Every watcher ran inside the Linux that had stopped, and the limited account may not restart the WSL service or Windows. So, outside Linux:

```
Linux cron, every minute ── writes the time ──► C:\ProgramData\RoleMatch\linux\heartbeat
"RoleMatch Watchdog" (SYSTEM, every minute, deploy/dell/watchdog.ps1)
    API answers on 127.0.0.1:18787 ─────────────► healthy, nothing to do
    API down, heartbeat fresh (Linux alive) ────► logged only: a release, a bad image or the database; Docker and people handle it
    API down AND heartbeat older than 3 min, 5 minutes running (10-minute grace after Windows starts):
        1. restart the WSL service (ends its processes if it will not stop in 90 s); the keep-alive starts Linux again
        2. still gone 6 minutes later: restart the PC, once per outage and never within 60 minutes of the last restart
        3. after that it only logs, hourly: a person must look
"RoleMatch KeepAlive" (SYSTEM, at startup, deploy/dell/keepalive.ps1)
    holds one session open in Linux through the rolematch account, with a key that may run only `wsl -d RoleMatch -u root -- sleep infinity`
```

* Install, update or remove: `deploy/dell/install-watchdog.ps1` in PowerShell run as administrator (`-Remove` takes everything out). It copies the scripts to `C:\ProgramData\RoleMatch\bin`, which only administrators can change: SYSTEM never runs anything the rolematch account can edit. Settings in `C:\ProgramData\RoleMatch\watchdog.json`.
* Logs, readable by the rolematch account: `C:\ProgramData\RoleMatch\logs\watchdog.log` (only changes are written; `watchdog-state.json` beside it shows the last run) and `keepalive.log` (each time a session ends).
* Rehearse without acting: `watchdog.ps1 -DryRun -Root <test folder>` with its own `watchdog.json` and `linux\heartbeat`. On 10 Nov this rehearsed, on the PC, a healthy API, the API down with Linux alive, the full ladder, recovery, a missing and a broken heartbeat, and the boot grace.
* WSLg is off (`guiApplications=false` in the rolematch account's `.wslconfig`, earlier copy `.wslconfig.before-20261110`): its display server had crashed 3,101 times between 6 and 10 Nov. Takes effect when Linux next starts.
* Not covered here: an outage of the tunnel, Cloudflare or the internet line, and telling the owner. That is the outside check (a free uptime service on the owner's account).

## Operating it (from the Mac, through the limited account)

* Run a command in the PC's Linux as root: the helper used on 6 November wraps `ssh rolematch@192.168.1.100 "wsl -d RoleMatch -u root -- bash -c ..."`.
* Test a commit on the PC: always through `deploy/pc/test-suite.sh /srv/test/<commit>` (installed as `/srv/rolematch/test-suite.sh`): lowest priority, 6 workers, and a watchdog that stops the suite if live's health report slows (R166). Never run the suite unguarded beside live.
* Release a new commit: first check that the release commit's deploy/ equals the main branch's (`git diff --quiet rolematch/formula-a-offline <release> -- deploy/`, R156); then copy `git archive <commit>` to the PC, `docker build` it there with the revision label, then on the PC: `cd /srv/rolematch && ROLEMATCH_ENV=/etc/rolematch/live.env ROLEMATCH_DATA_VOLUME=rolematch-pc-data ROLEMATCH_MODEL_URL="mac=http://127.0.0.1:11500,pc=http://127.0.0.1:11434" deploy/mac/run.sh rolematch:<commit>`; append the deploy log. The same release gates apply.
* Backups: scheduled by `deploy/pc/cron.rolematch`: the nightly backup (`deploy/pc/backup-nightly.sh`), a full database backup each Sunday and a differential one every other day (pgBackRest), and a restore drill each Monday whose result the daily check reports. A release takes a backup first and stops if it fails (`deploy/pc/release.sh`).

## Rollback to the Mac (about 5 minutes)

1. On the PC: `docker stop rm-api rm-worker rm-model-worker rm-tunnel`.
2. On the Mac: `colima start`, then `docker start rm-api rm-worker rm-model-bridge rm-model-worker`, then `docker restart rm-tunnel` and read its new address from `docker logs rm-tunnel`.
3. Put that address into `~/.rolematch/mac.env` (ALLOWED_ORIGINS, PUBLIC_APP_URL) and run `deploy/mac/run.sh rolematch:<commit>`.
4. Copy back anything new in the PC's data volume.

## Open

* A fixed address: the owner's domain rolematch.co.za, once it is on Cloudflare, as a named tunnel on the PC.
* An outside uptime alert.
* WSL restarts with the Mac's link; a PC restart with the Mac away leaves live down until the link returns.
* The tests and the isolated stack still use the Mac's Colima; moving them to the PC keeps the Mac free.

## Release of 6 November 2026, afternoon (7bee83d)

* **Release:** the full suite passed on the PC (two files needed the frontend built in a fresh workspace first). A backup was taken, the image was built on the PC from `git archive`, and `run.sh` started live with the monitor (`rm-monitor`).
* **Restart:** the pending security updates were installed and WSL restarted. One held-back Mesa update needed a new dependency and was installed by hand.
* **Tunnel:** cloudflared went from 2025.10.0 to 2026.10.7, with its metrics bound to 127.0.0.1:20241. The quick tunnel's address changed, so `PUBLIC_APP_URL` and `ALLOWED_ORIGINS` in `/etc/rolematch/live.env` were updated (the previous file is kept as `.before-new-tunnel`).
* **Test stack:** its ports (54321/54322) are dropped for anything but the PC itself (`deploy/pc/rolematch-test-ports.service`, enabled), until the own-database work retires the stack.
* **Checks:** from outside, ready, 404s, headers, sign-in needed and other origins refused. From the Mac, 54321, 54322 and 20241 are closed. The daily check reports all current.
* **Rollback:** `run.sh` with `rolematch:d45ce2d…` and `/srv/rolematch/deploy.prev`.
