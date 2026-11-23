-- Settings limits taken atomically (server/src/limits.ts). Counting and then acting let twenty uploads at the same moment all see room for three: the load probe showed it.
-- A hold stands for work between "may I" and its record existing. It is counted as if done, and removed once the record exists; one left by a server that stopped runs out by itself.
-- Additive: old code ignores the table and the function.
create table if not exists quota_holds (
  id uuid primary key default gen_random_uuid(), org_id uuid not null, portal_id uuid not null,
  kind text not null check (kind in ('document', 'match')),
  units integer not null check (units > 0), bytes bigint not null default 0,
  expires_at timestamptz not null default now() + interval '5 minutes',
  foreign key (portal_id, org_id) references portals (id, org_id) on delete cascade
);
create index if not exists quota_holds_portal on quota_holds (portal_id, kind);
do $$
declare s text := current_schema();
  both_ text := 'org_id = nullif(current_setting(''app.org_id'', true), '''')::uuid and portal_id = nullif(current_setting(''app.portal_id'', true), '''')::uuid';
begin
  execute format('alter table %I.quota_holds enable row level security', s);
  execute format('revoke all on %I.quota_holds from anon, authenticated', s);
  execute format('grant select, insert, delete on %I.quota_holds to rolematch_tenant', s);
  execute format('drop policy if exists own_portal on %I.quota_holds', s);
  execute format('create policy own_portal on %I.quota_holds for all to rolematch_tenant using (%s) with check (%s)', s, both_, both_);
end $$;

-- One statement, so one trip to the database; the lock lasts only as long as the statement. It runs with the caller's rights, inside the row rules, in the portal the request is in. Limits are set per organisation and have always counted what the request's row rules show, which is the portal.
create or replace function quota_take(p_kind text, p_units integer, p_bytes bigint, p_max_units integer, p_max_bytes bigint, p_max_waiting integer)
returns table (hold uuid, refused text, used_units integer, used_bytes bigint, waiting integer)
language plpgsql set search_path from current as $$
declare portal uuid := nullif(current_setting('app.portal_id', true), '')::uuid; org uuid := nullif(current_setting('app.org_id', true), '')::uuid;
  held_units integer; held_bytes bigint; new_hold uuid;
begin
  if portal is null or org is null then raise exception 'quota_take needs a portal in scope'; end if;
  perform pg_advisory_xact_lock(hashtextextended('quota:' || portal::text, 0));
  delete from quota_holds q where q.expires_at < now();
  select coalesce(sum(q.units), 0)::integer, coalesce(sum(q.bytes), 0)::bigint into held_units, held_bytes from quota_holds q where q.kind = p_kind;
  if p_kind = 'document' then
    select (select count(*) filter (where d.created_at > now() - interval '24 hours') from documents d)::integer + held_units,
           (select coalesce(sum(d.size), 0) from documents d)::bigint + held_bytes,
           (select count(*) from queue j where j.status in ('queued', 'running') and j.type not like 'model-%')::integer + held_units
      into used_units, used_bytes, waiting;
    refused := case when used_units + p_units > p_max_units then 'QUOTA-001' when used_bytes + p_bytes > p_max_bytes then 'QUOTA-002' when waiting + p_units > p_max_waiting then 'QUOTA-003' end;
  else
    select (select count(*) from matches m where m.created_at > now() - interval '1 hour')::integer + held_units, 0::bigint, 0 into used_units, used_bytes, waiting;
    refused := case when used_units + p_units > p_max_units then 'QUOTA-004' end;
  end if;
  if refused is null then insert into quota_holds (org_id, portal_id, kind, units, bytes) values (org, portal, p_kind, p_units, p_bytes) returning id into new_hold; hold := new_hold; end if;
  return next;
end $$;
do $$ begin execute format('grant execute on function %I.quota_take(text, integer, bigint, integer, bigint, integer) to rolematch_tenant', current_schema()); end $$;
