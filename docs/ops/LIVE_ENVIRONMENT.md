# The live service

The actual RoleMatch service for real accounts and prospective clients, on free infrastructure. A launch candidate: public registration and general email stay closed until the activation report has been read and the owner enables them. Being deployed does not make it production-ready; see "Known limits".

## What runs where

| Part | Where | Notes |
|---|---|---|
| Records, accounts, private originals | A Supabase Free project, separate from development | 500 MB database, 1 GB files, pauses after a week idle. Its region is the owner's decision. |
| Website and API, document reading, mail, language model, HTTPS | One Oracle Always Free server, ARM, 2 processors, 12 GB, 100 GB disk | `deploy/compose.yml`: separate processes with their own memory and processor limits. |
| Code and checks | GitHub, `EliteAgentK/rolematch` (private) | CI on every push. Deploys are by exact commit, `deploy/release.sh`, from any machine holding the deploy key. |
| Outgoing mail | The existing `rolematch.co.za` mailbox on domains.co.za, port 465 | Oracle blocks port 25, not 465. Hourly limit and permission for automated sending are unconfirmed: `MAIL_MAX_PER_HOUR=60` until the host answers. |

## Setting it up

Done by the owner (accounts, money-related screens, DNS): an Oracle account in the chosen region, never upgraded; the server (VM.Standard.A1.Flex, 2 OCPU, 12 GB, Ubuntu 24.04 aarch64, 100 GB, public IP, the deploy public key); the Supabase project; a DNS A record for `app.rolematch.co.za`; ports 80 and 443 opened in the network's security list; a test mailbox.

Done over SSH with the deploy key:

1. `deploy/setupServer.sh`, once.
2. `deploy/makeLiveEnv.sh` on the Mac makes `~/.rolematch/live.env` without printing anything; the owner adds the three Supabase values in an editor. It is copied to `/etc/rolematch/live.env`, `chmod 600`.
3. With the owner's approval, the migrations: `docker run --rm --env-file /etc/rolematch/live.env rolematch:<commit> node src/scripts/migrate.js`. A deploy never migrates; the server refuses to start out of step.
4. `deploy/release.sh <full commit>`. It refuses a commit that has not passed CI, builds on the server, starts it, and puts the previous release back if it does not become healthy.
5. The models: `docker compose exec model ollama pull qwen3.5:4b` and `ollama pull qwen3:4b-instruct-2507-q4_K_M`. Record the digests in `server/ml-models.json`.

## Proving it

`/api/ops/health`, with the service token, states the running commit and component versions. The browser checks run against the real address:

```bash
E2E_BASE=https://app.rolematch.co.za E2E_MAILBOX=<test mailbox> E2E_IMAP_HOST=mail.rolematch.co.za E2E_IMAP_USER=<test mailbox> E2E_IMAP_PASS=<its password> E2E_CREATE_USER="<ssh command running createUser>" npx playwright test -c playwright.hosted.config.ts
```

Reports and traces go to `~/.rolematch/e2e-results`, outside the repository, because they can hold document contents and sessions. `deploy/rehearse.sh` runs the same containers and checks on one machine against disposable services.

## Backup, restore, rollback

* **Backup:** nightly at 01:00 UTC (`deploy/backup.sh`): records and accounts as an encrypted dump, seven nights kept; originals in the encrypted vault on the data volume. Worst-case loss is about a day. Both are on the server, so they do not survive losing it unless a copy is taken off.
* **Restore:** `deploy/restore.sh <backup path>` into an empty project with the migrations applied. Keep `BACKUP_KEY` and `LOCAL_ENCRYPTION_KEY` off the server as well: without them a backup cannot be read.
* **Rollback:** `ROLLBACK=1 deploy/release.sh <earlier commit>`. A migration is not undone by this; the migrations so far only add.

## Known limits

* No malware scanning (deferred by the owner). Uploads record "malware scan NOT performed", and nothing says otherwise. Type, size, unpack size and reading time are limited, originals are private, and the reader runs with no extra rights.
* One server: losing it stops the service until it is rebuilt. Free-tier capacity is not guaranteed.
* The language model runs without a GPU, in shadow: labelled, stored beside the record, changing no record or score. Its speed on this server is to be measured.
* Real CVs need the owner's decision on consent and on where they are held.
* Marketing pages hold unverified claims, the profile page is still a demo, and the site asks search engines not to list it.
