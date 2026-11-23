-- The owner's console, first slice (docs/database/18_CONSOLE_V0.md): one owner account, its sessions, and the alerts feed.
-- The console works as rolematch_console for every query. That role can use these three tables and call console_overview(), which returns numbers only;
-- it cannot read a single row of any organisation's data. Row security is on for all three, with policies naming only rolematch_console.
do $$
begin
  if not exists (select from pg_roles where rolname = 'rolematch_console') then
    create role rolematch_console nologin nobypassrls;
  end if;
exception when duplicate_object then null;   -- two test runs creating it at the same moment
end $$;
grant rolematch_console to current_user;   -- lets the console switch to it (and back)

-- Exactly one account. The key can only be true, so the database itself refuses a second row; setting the password again replaces this one.
create table if not exists console_owner (
  only_one boolean primary key default true check (only_one),
  email text not null check (email = lower(btrim(email)) and email like '%_@_%'),
  password_hash text not null check (password_hash like '$argon2id$%'),
  set_at timestamptz not null default now(),
  set_by text not null    -- where it was set (for example 'pc terminal'); never a password or a hint
);

-- A session is known only by a hash of its id; the id itself lives only in the owner's cookie, so a copy of this table cannot sign anyone in.
-- Its form token is worked out from the id (server/src/console/auth.ts), so it is not stored either.
create table if not exists console_sessions (
  id_hash text primary key check (length(id_hash) = 64),
  started_at timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  ends_at timestamptz not null,                     -- the absolute limit (8 h)
  ended_at timestamptz,                             -- signed out, or ended by a password change
  client text                                       -- a short description of the browser, for the owner's own list; no address
);
create index if not exists console_sessions_open on console_sessions (ends_at) where ended_at is null;

-- Alerts for the owner. Written by our own code from counts and states only: never a document, a person's name or an address.
-- A problem that repeats is one row: the same fingerprint while it is open folds into it and raises the count; clearing it closes the row.
create table if not exists owner_events (
  id bigint generated always as identity primary key,
  fingerprint text not null,                        -- which problem this is, e.g. 'monitor:health:queue'
  severity text not null check (severity in ('urgent', 'today', 'info')),
  source text not null,                             -- 'monitor', 'daily check', 'backups', ...
  title text not null check (length(title) <= 200),
  meaning text,                                     -- what it means, in plain words
  action text,                                      -- what to do
  first_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  times integer not null default 1 check (times >= 1),
  cleared_at timestamptz,                           -- back to normal
  acknowledged_at timestamptz,
  muted_until timestamptz
);
create unique index if not exists owner_events_one_open on owner_events (fingerprint) where cleared_at is null;
create index if not exists owner_events_recent on owner_events (last_at desc);

do $$
declare s text := current_schema(); t text;
begin
  execute format('grant usage on schema %I to rolematch_console', s);
  foreach t in array array['console_owner', 'console_sessions', 'owner_events'] loop
    execute format('alter table %I.%I enable row level security', s, t);
    execute format('drop policy if exists console_only on %I.%I', s, t);
    execute format('create policy console_only on %I.%I for all to rolematch_console using (true) with check (true)', s, t);
  end loop;
  execute format('grant select on %I.console_owner to rolematch_console', s);   -- the password is set by the owner's terminal script, as the owner of the tables
  execute format('grant select, insert, update on %I.console_sessions to rolematch_console', s);
  execute format('grant select, insert, update on %I.owner_events to rolematch_console', s);

  -- Today's numbers. Security definer, so it may count rows the console role cannot read; it returns counts only, never a row.
  execute format($f$
    create or replace function %1$I.console_overview() returns jsonb language sql stable security definer set search_path = %1$I, pg_temp as $body$
      select jsonb_build_object(
        'organisations', (select count(*) from orgs),
        'people', (select count(*) from members where left_at is null),
        'peopleJoinedToday', (select count(*) from members where created_at >= date_trunc('day', now())),
        'organisationsToday', (select count(*) from orgs where created_at >= date_trunc('day', now())),
        'documentsPublished24h', (select count(*) from documents where status = 'published' and updated_at >= now() - interval '24 hours'),
        'documentsFailed24h', (select count(*) from documents where status = 'exception' and updated_at >= now() - interval '24 hours'),
        'documentsProcessing', (select count(*) from documents where status = 'processing'),
        'correctionsRecorded24h', (select count(*) from error_register where created_at >= now() - interval '24 hours'),
        'at', now())
    $body$ $f$, s);
  execute format('revoke all on function %I.console_overview() from public', s);
  execute format('grant execute on function %I.console_overview() to rolematch_console', s);
end $$;
