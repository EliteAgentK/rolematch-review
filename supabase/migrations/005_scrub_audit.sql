-- Deleting a candidate or job must also remove personal data from the audit trail. The audit table stays append-only for everyone
-- and for every column, with one narrow exception: inside a transaction that explicitly sets rolematch.scrub = 'on', the `detail`
-- column of an existing row may be replaced (nothing else may change, and rows still cannot be deleted).
create or replace function audit_immutable() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE'
     and current_setting('rolematch.scrub', true) = 'on'
     and new.id = old.id and new.org_id = old.org_id and new.actor_id is not distinct from old.actor_id
     and new.action = old.action and new.entity_type = old.entity_type and new.entity_id is not distinct from old.entity_id
     and new.created_at = old.created_at then
    return new;
  end if;
  raise exception 'audit_events is append-only';
end $$;
