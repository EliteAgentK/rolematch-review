#!/usr/bin/env bash
# The whole load bench on the PC: disposable database, API servers and crowd together, so the Mac and the live service carry none of it. Invented data only, copied from the isolated stack.
#   server/test/load/pcBench.sh setup          install the database, copy today's committed code and the invented data
#   server/test/load/pcBench.sh code           copy the committed code again
#   server/test/load/pcBench.sh data           copy the invented data again, from a clean database
#   server/test/load/pcBench.sh up <servers> <connections> <workers> [KEY=VALUE ...]    runs until `down`; sign-in tokens and originals stay on the isolated stack, reached through this session
#   server/test/load/pcBench.sh down
set -uo pipefail
"$(cd "$(dirname "$0")/../../.." && pwd)/deploy/preflight.sh" bench || exit 3
KEY="$HOME/.ssh/rolematch_dell"; PC=rolematch@192.168.1.100; ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"; RUN="$HOME/.rolematch/load/pc"; ENVF="$HOME/.rolematch/rehearsal.env"; mkdir -p "$RUN"
S=(ssh -i "$KEY" -o BatchMode=yes "$PC"); PGB='tools\pgsql\bin'; PSQL="$PGB\\psql.exe -q -h 127.0.0.1 -p 15432 -U postgres -v ON_ERROR_STOP=1"
PGPW_FILE="$RUN/db.pw"; [ -f "$PGPW_FILE" ] || { umask 077; openssl rand -hex 16 > "$PGPW_FILE"; }; PW="$(cat "$PGPW_FILE")"

code() {
  git -C "$ROOT" archive HEAD server supabase > "$RUN/code.tar"
  scp -i "$KEY" -o BatchMode=yes -q "$RUN/code.tar" "$PC:tools/code.tar"
  scp -i "$KEY" -o BatchMode=yes -q "$ROOT/server/test/load/pcServe.mjs" "$ROOT/server/test/load/loadgen.mjs" "$ROOT/server/test/load/prelogin.mjs" "$ROOT/server/test/load/afterRun.mjs" "$PC:tools/"
  # Each step apart: in this shell a line after "if ... &" belongs to the if, which once left an old build running while the bench said it was new.
  "${S[@]}" "if not exist tools\\bench mkdir tools\\bench"
  "${S[@]}" "tar -xf tools\\code.tar -C tools\\bench"
  WANT="$(git -C "$ROOT" cat-file -s HEAD:server/src/index.ts)"; GOT="$("${S[@]}" "for %I in (tools\\bench\\server\\src\\index.ts) do @echo %~zI" | tr -d '\r ')"
  [ "$WANT" = "$GOT" ] || { echo "The bench's code is not what was committed: index.ts is $GOT bytes, expected $WANT. Stopping."; exit 3; }
  grep -vE '^(DATABASE_URL|PORT|SUPABASE_URL)=' "$ENVF" > "$RUN/bench.env"; echo "DATABASE_URL=postgres://postgres:$PW@127.0.0.1:15432/postgres" >> "$RUN/bench.env"; sed -i '' '/^ROLEMATCH_ENVIRONMENT=/d' "$RUN/bench.env"; echo "ROLEMATCH_ENVIRONMENT=bench" >> "$RUN/bench.env"
  case "$(grep '^MAIL_SMTP_HOST=' "$RUN/bench.env" | cut -d= -f2)" in 127.0.0.1|localhost|"") ;; *) echo "Refusing: the bench's mail would leave the machine."; rm -f "$RUN/bench.env"; exit 3;; esac
  scp -i "$KEY" -o BatchMode=yes -q "$RUN/bench.env" "$PC:tools/bench/bench.env"; rm -f "$RUN/bench.env"
  git -C "$ROOT" rev-parse --short HEAD > "$RUN/commit"; echo "code at $(cat "$RUN/commit")"
}
# On this PC what an SSH session starts ends with that session, so the database stays attached to one.
pgup() { "${S[@]}" "$PGB\\postgres.exe -D tools\\pgdata" > "$RUN/pg.log" 2>&1 & PGPID=$!; for i in $(seq 1 30); do "${S[@]}" "$PGB\\pg_isready.exe -q -h 127.0.0.1 -p 15432" && return 0; sleep 1; done; echo "database did not start"; return 1; }
pgdown() { "${S[@]}" "$PGB\\pg_ctl.exe -D tools\\pgdata -m fast -w -t 20 stop" > /dev/null 2>&1; kill "${PGPID:-0}" 2>/dev/null; wait 2>/dev/null; }
data() {
  docker exec supabase_db_rolematch pg_dump -U postgres -n public --no-owner --no-privileges -Fp postgres > "$RUN/public.sql"
  docker exec supabase_db_rolematch psql -U postgres -tAc "copy (select id, email from auth.users) to stdout" > "$RUN/users.tsv"
  # A journey on this stack can leave an account with an ordinary-looking address. The copy holds only invented ones, so each is rewritten here, before anything leaves the Mac.
  docker exec supabase_db_rolematch psql -U postgres -tAc "select email from auth.users where email is not null and email not like '%.invalid' union select email from public.members where email not like '%.invalid'" > "$RUN/rewrite.txt"
  python3 -I - "$RUN/rewrite.txt" "$RUN/users.tsv" "$RUN/public.sql" <<'PY'
import sys
olds=[l.strip() for l in open(sys.argv[1]) if l.strip()]
for path in sys.argv[2:]:
    t=open(path,encoding='utf8').read()
    for i,o in enumerate(olds): t=t.replace(o,f'rewritten-{i}@load.invalid')
    open(path,'w',encoding='utf8').write(t)
PY
  rm -f "$RUN/rewrite.txt"
  cat > "$RUN/prepare.sql" <<SQL
drop schema if exists public cascade; drop schema if exists auth cascade; drop schema if exists extensions cascade;
do \$\$ begin
  if not exists (select from pg_roles where rolname='rolematch_tenant') then create role rolematch_tenant nologin nobypassrls; end if;
  if not exists (select from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select from pg_roles where rolname='service_role') then create role service_role nologin; end if;
end \$\$;
create schema public; grant usage on schema public to rolematch_tenant; create schema auth; create schema extensions;
create extension pg_trgm schema public; create extension pgcrypto schema extensions; create extension "uuid-ossp" schema extensions; create extension pg_stat_statements schema extensions;
create table auth.users (id uuid primary key, email text);
\copy auth.users from 'users.tsv'
SQL
  # Row rules and grants are the whole point of a tenant test, so the grants the dump leaves out are put back from the database itself.
  docker exec supabase_db_rolematch psql -U postgres -tAc "select 'grant '||string_agg(privilege_type,',')||' on public.'||quote_ident(table_name)||' to rolematch_tenant;' from information_schema.role_table_grants where grantee='rolematch_tenant' and table_schema='public' group by table_name" > "$RUN/grants.sql"
  docker exec supabase_db_rolematch psql -U postgres -tAc "select 'grant execute on function '||p.oid::regprocedure||' to rolematch_tenant;' from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and has_function_privilege('rolematch_tenant',p.oid,'execute') and p.prokind='f' and p.oid not in (select objid from pg_depend where deptype='e')" >> "$RUN/grants.sql"
  grep -vE '^(CREATE EXTENSION|COMMENT ON EXTENSION|CREATE SCHEMA public|COMMENT ON SCHEMA public)' "$RUN/public.sql" > "$RUN/public2.sql"
  scp -i "$KEY" -o BatchMode=yes -q "$RUN/prepare.sql" "$RUN/users.tsv" "$RUN/public2.sql" "$RUN/grants.sql" "$PC:tools/"
  "${S[@]}" "cd tools && set PGPASSWORD=$PW&& pgsql\\bin\\psql.exe -q -h 127.0.0.1 -p 15432 -U postgres -v ON_ERROR_STOP=1 -f prepare.sql && pgsql\\bin\\psql.exe -q -h 127.0.0.1 -p 15432 -U postgres -f public2.sql 2>&1 | findstr /i \"error\" & pgsql\\bin\\psql.exe -q -h 127.0.0.1 -p 15432 -U postgres -f grants.sql && pgsql\\bin\\psql.exe -q -h 127.0.0.1 -p 15432 -U postgres -c \"analyze\" && pgsql\\bin\\psql.exe -h 127.0.0.1 -p 15432 -U postgres -tAc \"select count(*) from public.members; select count(*) from public.candidates; select count(*) from pg_policies where schemaname='public'\""
  rm -f "$RUN/public.sql" "$RUN/public2.sql" "$RUN/users.tsv"
}
case "${1:-}" in
setup)
  "${S[@]}" "cd tools && if exist pg.zip (tar -xf pg.zip && del pg.zip)"
  "${S[@]}" "$PGB\\postgres.exe --version"
  if ! "${S[@]}" "if exist tools\\pgdata\\PG_VERSION (exit 0) else (exit 1)"; then
    printf '%s' "$PW" > "$RUN/pw.tmp"; scp -i "$KEY" -o BatchMode=yes -q "$RUN/pw.tmp" "$PC:tools/pw.tmp"; rm -f "$RUN/pw.tmp"
    "${S[@]}" "$PGB\\initdb.exe -D tools\\pgdata -U postgres --auth=scram-sha-256 --pwfile=tools\\pw.tmp -E UTF8 --locale=C > nul & del tools\\pw.tmp"
    cat > "$RUN/pg.conf" <<CONF
listen_addresses = '127.0.0.1'
port = 15432
max_connections = 300
shared_buffers = 1GB
effective_cache_size = 6GB
work_mem = 16MB
max_wal_size = 4GB
checkpoint_timeout = 15min
shared_preload_libraries = 'pg_stat_statements'
logging_collector = off
CONF
    scp -i "$KEY" -o BatchMode=yes -q "$RUN/pg.conf" "$PC:tools/pg.conf"
    "${S[@]}" "type tools\\pg.conf >> tools\\pgdata\\postgresql.conf"
  fi
  pgup; data; pgdown; code
  "${S[@]}" "cd tools\\bench\\server && set PATH=%USERPROFILE%\\tools\\node-v24.11.1-win-x64;%PATH%&& npm ci --no-audit --no-fund 2>&1 | findstr /v /c:\"npm warn\""
  ;;
code) code ;;
data) pgup; data; pgdown ;;
up)
  shift; N="$1"; P="$2"; W="$3"; shift 3
  # The PC's own session: its reverse link to the isolated stack's sign-in service and file store, and everything it started ends with it.
  ssh -i "$KEY" -o BatchMode=yes -o ServerAliveInterval=20 -R 127.0.0.1:54321:127.0.0.1:54321 -R 127.0.0.1:11434:127.0.0.1:11434 "$PC" "cd tools && node-v24.11.1-win-x64\\node.exe pcServe.mjs $N $P $W $*" > "$RUN/serve.log" 2>&1 &
  echo $! > "$RUN/serve.pid"
  for i in $(seq 1 40); do "${S[@]}" "curl.exe -s -m 2 -o nul -w %{http_code} http://127.0.0.1:$((18800 + N))/api/ready" 2>/dev/null | grep -q 200 && break; sleep 2; done
  for i in $(seq 1 "$N"); do "${S[@]}" "curl.exe -s -m 3 -o nul -w server$i:%{http_code}\\n http://127.0.0.1:$((18800 + i))/api/ready"; done; cat "$RUN/serve.log" | head -5
  ;;
down)
  [ -f "$RUN/serve.pid" ] && kill "$(cat "$RUN/serve.pid")" 2>/dev/null; rm -f "$RUN/serve.pid"
  # This limited account may not list or force-stop processes, so nothing here depends on taskkill: closing the session ends what it started, and the database is told to stop by its own tool. Its lock file is never deleted by hand: a running database shuts itself down if it is.
  "${S[@]}" "$PGB\\pg_ctl.exe -D tools\\pgdata -m fast -w -t 20 stop" > /dev/null 2>&1; pkill -f 'rolematch_dell.*postgres.exe' 2>/dev/null; sleep 3; echo stopped
  ;;
*) sed -n 2,7p "$0"; exit 2 ;;
esac
