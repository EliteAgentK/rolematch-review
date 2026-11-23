# A permanent address: app.rolematch.co.za and console.rolematch.co.za

Written 7 November 2026, before any change (owner rule: plan with diagrams first). Replaces the quick tunnel, whose `trycloudflare.com` address changes whenever it restarts (LIVE_ON_PC.md).

## State at writing

* Cloudflare holds a copy of every record the domain had at Domains.co.za: 22 records, checked one by one on 7 Nov, including the e-mail signing key (DKIM), which Cloudflare's automatic copy had missed and was imported. All mail records are "DNS only", so mail goes straight to the mail host as before.
* The owner changed the nameservers at Domains.co.za to `cartman.ns.cloudflare.com` and `zainab.ns.cloudflare.com` (7 Nov, about 22:50). DNSSEC is off at the registrar, as Cloudflare requires. The zone becomes active when the .co.za registry publishes the change.
* DNS changes are the owner's clicks: the session's permission check refuses them for Claude. Everything else below is done from the PC's terminal.

## How it fits

```
 visitor ── https://app.rolematch.co.za ─────┐
                                             ▼
 owner ──── https://console.rolematch.co.za ─► Cloudflare edge ── TLS, DDoS, WAF (free plan)
                 │                              │
                 │  Cloudflare Access: only the │  outbound-only connection, started by the PC;
                 │  owner's e-mail, one-time    │  no port is opened on the router or the PC
                 │  code, before any request    ▼
                 │  reaches the PC      ┌── rm-tunnel (cloudflared, named tunnel "rolematch-pc") ──┐
                 │                      │  config:  /etc/rolematch/cloudflared.yml (from Git)       │
                 └────────────────────► │  secret:  /etc/rolematch/tunnel.json (root only, never   │
                                        │           leaves the PC, not in Git, not in a log)       │
                                        │  app.rolematch.co.za     ─► http://127.0.0.1:18787  rm-api │
                                        │  console.rolematch.co.za ─► http://127.0.0.1:18790  rm-console
                                        │  anything else           ─► 404                          │
                                        └──────────────────────────────────────────────────────────┘
 rolematch.co.za and www stay the existing website at Domains.co.za; mail records are untouched.
```

## Decisions

1. **Names:** `app.` for the service, `console.` for the owner's console. The bare domain stays the marketing site.
2. **Locally managed tunnel**, so its secret is created on the PC and never shown in a browser, chat or log. The alternative, a dashboard-managed tunnel, hands out a token that would have to be copied across.
3. **The tunnel's settings live in Git** (`deploy/pc/cloudflared.yml`) and a test pins them to the containers' own ports, so a port change cannot quietly break the address (the R161 lesson).
4. **The quick tunnel keeps running until the new address is proven**, so live is never without an address. Two tunnels side by side are safe; the old one stops only after the checks below.
5. **The console is never reachable without Access.** Until the Access rule exists, the tunnel has no route for `console.`; the console's own password stays as the second lock.
6. **Passkeys:** none are enrolled on live. Before anyone enrols, the relying party is set to `rolematch.co.za` (PASSKEYS.md: changing it later breaks every passkey).

## Steps

| # | What | Who | Reversible by |
|---|---|---|---|
| 1 | Wait for the zone to show **Active** in Cloudflare | watcher (dig, every 30 s) | — |
| 2 | `cloudflared tunnel login` on the PC prints a link; the owner opens it and picks rolematch.co.za. Cloudflare then writes a certificate to the PC | PC terminal + owner's one click | deleting the certificate |
| 3 | `cloudflared tunnel create rolematch-pc` makes the secret on the PC; moved to `/etc/rolematch/tunnel.json`, mode 600 | PC terminal | `cloudflared tunnel delete` |
| 4 | Two DNS records: `app` and `console` as CNAME to `<tunnel id>.cfargotunnel.com`, proxied | owner (DNS) | deleting them |
| 5 | Access application for `console.rolematch.co.za`: allow the owner's e-mail only, one-time PIN, 8-hour session | owner, or Claude in the owner's browser if allowed | deleting the application |
| 6 | Start the named tunnel with `app` only; check https://app.rolematch.co.za/api/ready from outside | PC terminal | stopping the container |
| 7 | Live settings: `PUBLIC_APP_URL=https://app.rolematch.co.za`, `ALLOWED_ORIGINS` lists both addresses for one day; restart the API, worker and monitor | release procedure, backup of live.env first | the backup file |
| 8 | Checks from outside: ready, security headers, 401 without sign-in, sign-in page, a mail link points at app.; the monitor reports "outside" healthy on the new address | Claude | — |
| 9 | Add the `console` route after step 5 is proven: an anonymous request to console. must stop at Cloudflare's sign-in, never at RoleMatch | Claude | removing the route |
| 10 | Stop the quick tunnel; `ALLOWED_ORIGINS` drops the old address the next day | Claude | starting it again |
| 11 | Timed restart of the PC: does live come back by itself on the permanent address, and how long does it take | Claude, owner told first | — |

## Tests

* The tunnel's settings send `app.` to the API's port and `console.` to the console's port from `deploy/mac/run.sh`, and end with a 404 rule (`deploy-names.test.ts`).
* No tunnel secret is in Git (the existing secret scan covers `*.json` credentials).
* From outside, after steps 8 and 9: the new address answers ready; an anonymous request to `console.` is answered by Cloudflare Access (status 302 to `cloudflareaccess.com`), not by the console.

## Known limits

* Cloudflare's free Zero Trust plan may ask for a payment card at sign-up even at R0. If it does, that is the owner's decision (no spend rule); without Access the console stays local only.
* The console does not yet check Cloudflare's Access token itself; its own password is the second lock. Checking the token is a later console slice.

## Result (7–8 Nov 2026)

| # | Step | Done |
|---|---|---|
| 1 | Zone active | 8 Nov 00:33: the .co.za registry lists `cartman` and `zainab`; MX, SPF, DKIM and the mail host's addresses answer from Cloudflare as before |
| 2–3 | Tunnel login and secret | 7 Nov 22:54, tunnel `4e7c33e3-…`; the owner clicked Authorize (Claude's click was refused by the session's permission check). Secret `/etc/rolematch/tunnel.json`, owned by cloudflared's user, mode 600 |
| 4 | `app` record | 7 Nov 23:00, by `cloudflared tunnel route dns`, run by the owner at the Mac's terminal |
| 5 | Access for `console.` | **parked by the owner (8 Nov):** Zero Trust Free would not take the owner's card. Replaced by the console's own second step (an e-mailed code, `18_CONSOLE_V0.md` slice 2); Access can be added in front later |
| 6 | Tunnel started, app only | 7 Nov 23:00, 4 connections; the first start failed because the secret was root's and the container runs as nonroot (fixed in `tunnel.sh`) |
| 7 | Live settings | 8 Nov 00:59, release bc5fd0c: `PUBLIC_APP_URL=https://app.rolematch.co.za`; `ALLOWED_ORIGINS` keeps the quick tunnel for a day (backup `live.env.before-app-domain`) |
| 8 | Checks from outside | ready on the release; HSTS, CSP, frame refusal; 401 without sign-in; the bare domain still serves the website; `console.` does not resolve |
| 9 | Console route | **done 8 Nov** (release f0501dc): `console.` CNAME added in the owner's Cloudflare at their request; outside, `/login` answers 200, every other page sends a stranger to it, a form from another site gets 403 |
| 10 | Stop the quick tunnel | due 8 Nov evening, then `ALLOWED_ORIGINS` loses it |
| 11 | Timed PC restart | after step 10 |
