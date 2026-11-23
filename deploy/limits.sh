# The limits the live containers run under, read by deploy/mac/run.sh and by deploy/rehearse.sh, so a rehearsal runs with exactly what live has (register R148: the rehearsal worker had 1500 MB and no restart rule where live has 2500 MB and restarts, and died overnight on a 20-page photo CV).
# DB_POOL_*: Supabase's session pooler allows 15 connections on this plan; each process holds what it opens, so 5 + 3 + 2 (AI worker) + 2 (console) + 1 (monitor) = 13 leaves 2 for a backup or a migration (registers R107, R170: the AI worker's first pool of 8 took live past 15 on 9 Nov 2026). The AI worker waits on Claude, not on the database, so 2 serve its 40 slots. The monitor reads health over HTTP and holds one connection, to write the console's alerts; the console holds 2. Live on the PC still reaches its database through this pooler (seen 9 Nov 2026), so the 15 binds there too.
# Each value can be given for one host (the PC's own database has room for more connections than Supabase's pooler): set it before this file is read.
RESTART_RULE=unless-stopped
API_MEMORY=${API_MEMORY:-1200m}
WORKER_MEMORY=${WORKER_MEMORY:-2500m}
AI_WORKER_MEMORY=${AI_WORKER_MEMORY:-512m}
MONITOR_MEMORY=${MONITOR_MEMORY:-160m}
CONSOLE_MEMORY=${CONSOLE_MEMORY:-200m}
DB_POOL_API=${DB_POOL_API:-5}
DB_POOL_WORKER=${DB_POOL_WORKER:-3}
DB_POOL_AI=${DB_POOL_AI:-2}
DB_POOL_CONSOLE=${DB_POOL_CONSOLE:-2}
