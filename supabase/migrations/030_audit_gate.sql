-- The language model audits every CV before it reaches a panel (server/src/auditor.ts). The rules' reading waits here, on its own document row and so inside its own portal's row rules, invisible to every panel, search and match until it is passed. Additive: an older server ignores the column and publishes as before.
alter table documents add column if not exists awaiting_audit jsonb;
alter table model_reviews drop constraint if exists model_reviews_kind_check;
alter table model_reviews add constraint model_reviews_kind_check check (kind in ('extraction', 'matching', 'audit'));
-- Documents waiting for the auditor are still documents waiting, so they count against the portal's own limit.
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
           (select count(*) from queue j where j.status in ('queued', 'running') and (j.type not like 'model-%' or j.type = 'model-audit'))::integer + held_units
      into used_units, used_bytes, waiting;
    refused := case when used_units + p_units > p_max_units then 'QUOTA-001' when used_bytes + p_bytes > p_max_bytes then 'QUOTA-002' when waiting + p_units > p_max_waiting then 'QUOTA-003' end;
  else
    select (select count(*) from matches m where m.created_at > now() - interval '1 hour')::integer + held_units, 0::bigint, 0 into used_units, used_bytes, waiting;
    refused := case when used_units + p_units > p_max_units then 'QUOTA-004' end;
  end if;
  if refused is null then insert into quota_holds (org_id, portal_id, kind, units, bytes) values (org, portal, p_kind, p_units, p_bytes) returning id into new_hold; hold := new_hold; end if;
  return next;
end $$;
