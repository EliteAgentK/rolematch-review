-- The owner's actions in the console, and support access to one portal's log (owner, 12 Nov 2026: "I should have full autonomy ... if I want to delete
-- users, I should be able to"; "if a client comes to me saying 'where did this CV go?' ... I need to know what's going on").
-- docs/architecture/PLAN_CONSOLE_OPERATIONS.md. Every function here is the database's own (security definer), callable by the console's role alone, and
-- writes what it did to console_actions, which nothing deletes. Sign-in accounts themselves are removed by the console through the sign-in service.
--
-- console_actions: every owner action, kept for the life of the platform (who did what, to what, with what counts).
-- support_access: a portal's log opened for a stated reason, for one hour, and said in that portal's own audit log, so the company sees it.
-- The audit log and the removed-uploads history stay append-only for everyone, with one narrow exception: the owner deleting a whole portal or company.
-- Then, and only inside the database's own deletion functions below (running as the tables' owner), the rows of that one portal or company may go with it:
-- they hold names and file names, and a deleted company's data must be gone. The deletion itself is kept in console_actions, with its counts and reason.
do $$
declare s text := current_schema();
begin
  execute format($f$
    create or replace function %1$I.audit_immutable() returns trigger language plpgsql set search_path = %1$I, pg_temp as $body$
    begin
      if tg_op = 'UPDATE'
         and current_setting('rolematch.scrub', true) = 'on'
         and new.id = old.id and new.org_id = old.org_id and new.actor_id is not distinct from old.actor_id
         and new.action = old.action and new.entity_type = old.entity_type and new.entity_id is not distinct from old.entity_id
         and new.created_at = old.created_at then
        return new;
      end if;
      if tg_op = 'DELETE' and current_setting('rolematch.owner_delete', true) in (old.portal_id::text, old.org_id::text)
         and current_user = (select r.rolname from pg_class c join pg_roles r on r.oid = c.relowner where c.oid = tg_relid) then
        return old;
      end if;
      raise exception 'audit_events is append-only';
    end $body$ $f$, s);
  execute format($f$
    create or replace function %1$I.upload_history_immutable() returns trigger language plpgsql set search_path = %1$I, pg_temp as $body$
    begin
      if tg_op = 'DELETE' and current_setting('rolematch.owner_delete', true) in (old.portal_id::text, old.org_id::text)
         and current_user = (select r.rolname from pg_class c join pg_roles r on r.oid = c.relowner where c.oid = tg_relid) then
        return old;
      end if;
      raise exception 'upload_history_removed is append-only';
    end $body$ $f$, s);
end $$;

create table if not exists console_actions (
  id bigserial primary key,
  at timestamptz not null default now(),
  action text not null,
  target_kind text not null check (target_kind in ('person', 'portal', 'company')),
  target_id uuid,
  target_name text not null,
  detail jsonb not null default '{}'
);
create table if not exists support_access (
  id bigserial primary key,
  portal_id uuid not null,
  org_id uuid not null,
  reason text not null check (length(reason) between 8 and 500),
  opened_at timestamptz not null default now(),
  ends_at timestamptz not null default now() + interval '1 hour'
);
create index if not exists support_access_portal on support_access (portal_id, ends_at);
-- The original files of what the console deleted, for the monitor to remove from the vault (the console itself has no access to the files). A path
-- stays here until it is gone; nothing else is kept about it.
create table if not exists file_removals (path text primary key, requested_at timestamptz not null default now(), tries integer not null default 0, last_error text);
alter table file_removals enable row level security;

do $$
declare s text := current_schema();
begin
  -- The console reads and adds to its own record; it changes nothing in it.
  execute format('alter table %I.console_actions enable row level security', s);
  execute format('alter table %I.support_access enable row level security', s);
  if exists (select from pg_roles where rolname = 'rolematch_console') then
    execute format('grant select, insert on %I.console_actions, %I.support_access to rolematch_console', s, s);
    execute format('grant usage on sequence %I.console_actions_id_seq, %I.support_access_id_seq to rolematch_console', s, s);
    execute format('drop policy if exists console_actions_console on %I.console_actions', s);
    execute format('create policy console_actions_console on %I.console_actions to rolematch_console using (true) with check (true)', s);
    execute format('drop policy if exists support_access_console on %I.support_access', s);
    execute format('create policy support_access_console on %I.support_access to rolematch_console using (true) with check (true)', s);
  end if;
  -- A company may see when RoleMatch support opened its own portal's log, never another's (test/tenant-separation.test.ts).
  if exists (select from pg_roles where rolname = 'rolematch_tenant') then
    execute format('grant select on %I.support_access to rolematch_tenant', s);
    execute format('drop policy if exists own_portal on %I.support_access', s);
    execute format('create policy own_portal on %I.support_access for select to rolematch_tenant using (org_id = (select nullif(current_setting(''app.org_id'', true), '''')::uuid) and portal_id = (select nullif(current_setting(''app.portal_id'', true), '''')::uuid))', s);
  end if;

  -- Deletes every row of one portal, table by table, in whatever order the database's own links allow (a table refused because another still points at
  -- it is tried again after the others), all in the caller's one transaction. AI usage stays, for the bill (its link to the portal becomes empty). Returns
  -- what went, table by table, and the original files' paths for the console to remove from the vault.
  execute format($f$
    create or replace function %1$I.console_delete_portal(p_portal uuid, p_why text) returns jsonb language plpgsql security definer set search_path = %1$I, pg_catalog, pg_temp as $body$
    declare t text; left_ text[]; again text[]; n bigint; counts jsonb := '{}'; files jsonb; who jsonb; p record;
    begin
      select p2.id, p2.name, p2.org_id, g.name as company into p from portals p2 join orgs g on g.id = p2.org_id where p2.id = p_portal;
      if p.id is null then raise exception 'no such portal'; end if;
      select coalesce(jsonb_agg(storage_path), '[]') into files from documents where portal_id = p_portal and storage_path is not null;
      insert into file_removals (path) select jsonb_array_elements_text(files) on conflict (path) do nothing;
      perform set_config('rolematch.owner_delete', p_portal::text, true);   -- this portal's own audit lines may go with it (audit_immutable)
      select jsonb_build_object('aiMicroUsdAll', coalesce(sum(cost_micro_usd), 0), 'aiCallsAll', count(*)) into who from ai_usage where portal_id = p_portal;
      select array_agg(c.table_name::text order by c.table_name) into left_ from information_schema.columns c join information_schema.tables x on x.table_schema = c.table_schema and x.table_name = c.table_name
        where c.table_schema = %1$L and c.column_name = 'portal_id' and x.table_type = 'BASE TABLE' and c.table_name not in ('portals', 'ai_usage', 'portal_daily', 'support_access');
      for pass in 1..12 loop
        again := '{}';
        foreach t in array left_ loop
          begin
            execute format('delete from %%I where portal_id = $1', t) using p_portal; get diagnostics n = row_count;
            if n > 0 then counts := counts || jsonb_build_object(t, n); end if;
          exception when foreign_key_violation then again := again || t;
          end;
        end loop;
        left_ := again; exit when cardinality(left_) = 0;
      end loop;
      if cardinality(left_) > 0 then raise exception 'could not delete from %%', left_; end if;
      delete from portals where id = p_portal;
      insert into console_actions (action, target_kind, target_id, target_name, detail) values ('portal.deleted', 'portal', p_portal, p.name,
        jsonb_build_object('company', p.company, 'orgId', p.org_id, 'why', p_why, 'deleted', counts, 'files', jsonb_array_length(files), 'aiKeptForTheBill', who));
      return jsonb_build_object('deleted', counts, 'files', files);
    end $body$ $f$, s);

  -- Deletes a company: each of its portals as above, then every row of its own, its people's memberships, and the company. Returns their accounts for the
  -- console to remove from sign-in, and the files. AI usage stays for the bill; its totals are kept in console_actions.
  execute format($f$
    create or replace function %1$I.console_delete_company(p_org uuid, p_why text) returns jsonb language plpgsql security definer set search_path = %1$I, pg_catalog, pg_temp as $body$
    declare t text; left_ text[]; again text[]; n bigint; counts jsonb := '{}'; files jsonb := '[]'; people jsonb; usage jsonb; g record; r jsonb; pid uuid;
    begin
      select id, name into g from orgs where id = p_org; if g.id is null then raise exception 'no such company'; end if;
      select coalesce(jsonb_agg(user_id), '[]') into people from members where org_id = p_org;
      select jsonb_build_object('aiMicroUsdAll', coalesce(sum(cost_micro_usd), 0), 'aiCallsAll', count(*)) into usage from ai_usage where org_id = p_org;
      for pid in select id from portals where org_id = p_org loop
        r := console_delete_portal(pid, p_why); files := files || (r->'files');
      end loop;
      perform set_config('rolematch.owner_delete', p_org::text, true);   -- and the company's own
      select array_agg(c.table_name::text order by c.table_name) into left_ from information_schema.columns c join information_schema.tables x on x.table_schema = c.table_schema and x.table_name = c.table_name
        where c.table_schema = %1$L and c.column_name = 'org_id' and x.table_type = 'BASE TABLE' and c.table_name not in ('orgs', 'ai_usage', 'billing_accounts', 'portal_daily', 'support_access');
      for pass in 1..12 loop
        again := '{}';
        foreach t in array left_ loop
          begin
            execute format('delete from %%I where org_id = $1', t) using p_org; get diagnostics n = row_count;
            if n > 0 then counts := counts || jsonb_build_object(t, n); end if;
          exception when foreign_key_violation then again := again || t;
          end;
        end loop;
        left_ := again; exit when cardinality(left_) = 0;
      end loop;
      if cardinality(left_) > 0 then raise exception 'could not delete from %%', left_; end if;
      delete from orgs where id = p_org;
      insert into console_actions (action, target_kind, target_id, target_name, detail) values ('company.deleted', 'company', p_org, g.name,
        jsonb_build_object('why', p_why, 'deleted', counts, 'people', jsonb_array_length(people), 'aiKeptForTheBill', usage));
      return jsonb_build_object('deleted', counts, 'people', people, 'files', files);
    end $body$ $f$, s);

  -- A person's sessions ended everywhere: every sign-in session removed, and each one remembered as signed out so a token already issued stops at once.
  execute format($f$
    create or replace function %1$I.console_end_sessions(p_user uuid) returns integer language plpgsql security definer set search_path = %1$I, auth, pg_catalog, pg_temp as $body$
    declare n integer;
    begin
      -- The same record a sign-out writes (src/signedOut.ts: the session id's SHA-256), kept for the hour an issued token can last.
      insert into signed_out_sessions (session_hash, expires_at) select encode(sha256(s.id::text::bytea), 'hex'), extract(epoch from now() + interval '65 minutes')::bigint
        from auth.sessions s where s.user_id = p_user on conflict (session_hash) do nothing;
      delete from auth.sessions where user_id = p_user; get diagnostics n = row_count;
      return n;
    end $body$ $f$, s);

  -- A company's monthly AI allowance (migration 047), set from the console as it is from the PC's terminal, with the change recorded in both places.
  execute format($f$
    create or replace function %1$I.console_set_allowance(p_org uuid, p_usd numeric) returns jsonb language plpgsql security definer set search_path = %1$I, pg_catalog, pg_temp as $body$
    declare before numeric; g text;
    begin
      if p_usd is not null and (p_usd < 0 or p_usd > 100000) then raise exception 'allowance out of range'; end if;
      select ai_monthly_cap_usd, name into before, g from orgs where id = p_org for update; if g is null then raise exception 'no such company'; end if;
      update orgs set ai_monthly_cap_usd = p_usd where id = p_org;
      insert into audit_events (org_id, actor_id, action, entity_type, entity_id, detail) values (p_org, null, 'ai_allowance.set', 'org', p_org, jsonb_build_object('by', 'the owner, in the console', 'before', before, 'after', p_usd));
      insert into console_actions (action, target_kind, target_id, target_name, detail) values ('company.allowance_set', 'company', p_org, g, jsonb_build_object('before', before, 'after', p_usd));
      return jsonb_build_object('before', before, 'after', p_usd);
    end $body$ $f$, s);

  -- Support access: opened with a reason, for an hour, and said in the portal's own audit log (the company sees that RoleMatch looked, when, and why).
  execute format($f$
    create or replace function %1$I.console_open_support(p_portal uuid, p_reason text) returns timestamptz language plpgsql security definer set search_path = %1$I, pg_catalog, pg_temp as $body$
    declare p record; ends timestamptz;
    begin
      select id, org_id, name into p from portals where id = p_portal; if p.id is null then raise exception 'no such portal'; end if;
      insert into support_access (portal_id, org_id, reason) values (p.id, p.org_id, trim(p_reason)) returning ends_at into ends;
      insert into audit_events (org_id, portal_id, actor_id, action, entity_type, entity_id, detail) values (p.org_id, p.id, null, 'support.access_opened', 'portal', p.id,
        jsonb_build_object('by', 'RoleMatch support', 'reason', trim(p_reason), 'until', ends));
      insert into console_actions (action, target_kind, target_id, target_name, detail) values ('portal.support_opened', 'portal', p.id, p.name, jsonb_build_object('reason', trim(p_reason), 'until', ends));
      return ends;
    end $body$ $f$, s);

  -- The portal's log, only while support access is open: when, who, what, on which record, and the record's own words for what changed. Never a CV's text.
  execute format($f$
    create or replace function %1$I.console_support_log(p_portal uuid) returns jsonb language plpgsql stable security definer set search_path = %1$I, auth, pg_catalog, pg_temp as $body$
    declare open_until timestamptz;
    begin
      select max(ends_at) into open_until from support_access where portal_id = p_portal and ends_at > now();
      if open_until is null then raise exception 'support access is not open for this portal'; end if;
      return jsonb_build_object('until', open_until, 'events', (select coalesce(jsonb_agg(e order by (e->>'at') desc), '[]') from (
        select jsonb_build_object('at', a.created_at, 'who', coalesce((select u.email from auth.users u where u.id = a.actor_id), case when a.actor_id is null then 'RoleMatch' else 'a removed account' end),
          'action', a.action, 'entity', a.entity_type, 'entityId', a.entity_id, 'detail', a.detail - 'text' - 'cv' - 'body') as e
        from audit_events a where a.portal_id = p_portal order by a.created_at desc limit 300) x),
        'documents', (select coalesce(jsonb_agg(jsonb_build_object('name', d.original_name, 'kind', d.kind, 'status', d.status, 'stage', d.stage, 'error', d.error_code, 'at', d.created_at, 'by', d.uploaded_by_email) order by d.created_at desc), '[]')
          from (select * from documents where portal_id = p_portal order by created_at desc limit 300) d));
    end $body$ $f$, s);

end $$;

do $$
declare s text := current_schema();
begin
  -- A company's allowance and this month's AI spend, for its page in the console (the console reads no table of a company's own).
  execute format($f$
    create or replace function %1$I.console_company(p_org uuid) returns jsonb language sql stable security definer set search_path = %1$I, pg_catalog, pg_temp as $body$
      select jsonb_build_object('id', g.id, 'name', g.name, 'allowanceUsd', g.ai_monthly_cap_usd,
        'spentMonthMicroUsd', (select coalesce(sum(a.cost_micro_usd), 0) from ai_usage a where a.org_id = g.id and a.at >= date_trunc('month', now())),
        'portals', (select count(*) from portals p where p.org_id = g.id), 'people', (select count(*) from members m where m.org_id = g.id))
      from orgs g where g.id = p_org
    $body$ $f$, s);
end $$;

do $$
declare s text := current_schema(); f text;
begin
  foreach f in array array['console_delete_portal(uuid, text)', 'console_delete_company(uuid, text)', 'console_end_sessions(uuid)', 'console_set_allowance(uuid, numeric)', 'console_open_support(uuid, text)', 'console_support_log(uuid)', 'console_company(uuid)'] loop
    execute format('revoke all on function %I.%s from public', s, f);
    if exists (select from pg_roles where rolname = 'rolematch_console') then execute format('grant execute on function %I.%s to rolematch_console', s, f); end if;
  end loop;
end $$;
