-- The product is now called RoleMatch. The setting that lets a deletion blank personal detail in old audit entries was renamed from
-- the old product name to rolematch.scrub. Databases that already ran migration 005 get the same function here; new databases
-- already have it from the (updated) 005. Behaviour is unchanged.
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
