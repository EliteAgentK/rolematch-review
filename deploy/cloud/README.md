# Live on a cloud server (prepared 12 Nov 2026, not used yet)

The plan and the reasons: `docs/architecture/PLAN_MOVE_OFF_THE_PC.md`. Owner, 12 Nov 2026: one server and its database off the PC, upkeep by us, paid by
startup credits; Azure Johannesburg preferred, AWS Cape Town if Azure's credits do not come through.

| Step | Who | Script |
|---|---|---|
| 1. Credits approved, budget alert set | Owner | none |
| 2. Create the server | Owner, in the provider's own browser shell | `azure-create-server.sh` (Azure Cloud Shell) or `aws-create-server.sh` (AWS CloudShell) |
| 3. Prepare it | Claude, over SSH with `~/.ssh/rolematch_cloud` | `sudo bash prepare-server.sh` |
| 4. Same stack as the PC, beside live, at next.rolematch.co.za | Claude | `deploy/db/stack/up.sh`, `deploy/pc/release.sh`, `deploy/pc/tunnel.sh` (all plain Linux, unchanged) |
| 5. Copy live, check everything (full suite, tenant separation, console) | Claude | as in `deploy/move/` for the move of 11 and 12 Nov |
| 6. Switch, with the owner's yes; the PC kept a week as the way back | Claude | `deploy/move/switch.sh` pattern |

What the scripts make sure of:
- **Nothing reachable but SSH by key.** Live is reached only through the Cloudflare tunnel, which connects outward, so no web port is opened.
- **The credits, not the card.** The Azure script stops unless the subscription is the sponsored (credits) one. The AWS server uses "standard" CPU
  credits, so bursts never add charges.
- **The same folders as the PC** (`/srv/rolematch`, `/etc/rolematch`), so every deploy script and the console's host checks run unchanged. The
  Windows-only lines (the watchdog's heartbeat) do nothing where there is no Windows.

The deploy key's private half is on the Mac only (`~/.ssh/rolematch_cloud`). Its public half is in both create scripts.
