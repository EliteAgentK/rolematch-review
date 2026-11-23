-- One-off repair (production review, 12 Nov 2026, docs/architecture/PLAN_STATUS_PER_APPLICATION.md): every person's headline stage brought in step with
-- their status for each job, worked out exactly as server/src/applications.ts headlineOf does: the furthest stage any job has them at, in the order the
-- organisation lists its statuses, ignoring New and Not suitable; New when no job has them past it. Before the fixes of that day, deleting a job left
-- its people at the stage it gave them, and two jobs changed at once could leave the headline behind.
--
-- Only people who have, or once had, a status for a job are touched (an 'application.status_changed' line in the audit log says they had one). People
-- whose stage was set before statuses were per job (9 Nov 2026) and never placed on a job keep it as it is: what to do with those is the owner's
-- decision (P5), and nothing a recruiter set is thrown away here. Each change is written to the audit log by no person (RoleMatch), with what it was and
-- what it became. Running it again changes nothing more.
with ord as (
  select o.id as org_id, coalesce(s.settings->'statuses', '[{"key":"new"},{"key":"reviewed"},{"key":"shortlisted"},{"key":"awaiting interview"},{"key":"interviewing"},{"key":"interviewed"},{"key":"hired"},{"key":"declined"},{"key":"archived"}]'::jsonb) as statuses
  from orgs o left join org_settings s on s.org_id = o.id
), idx as (
  select ord.org_id, e->>'key' as key, i from ord, jsonb_array_elements(ord.statuses) with ordinality t(e, i)
), computed as (
  select c.id, c.org_id, coalesce(c.data->>'status', 'new') as cur,
    coalesce((select a.status from applications a left join idx on idx.org_id = c.org_id and idx.key = a.status
              where a.candidate_id = c.id and a.status not in ('declined', 'new') order by coalesce(idx.i, 0) desc limit 1), 'new') as best,
    exists (select 1 from applications a where a.candidate_id = c.id)
      or exists (select 1 from audit_events e where e.org_id = c.org_id and e.entity_id = c.id and e.action = 'application.status_changed') as per_job
  from candidates c
), fixed as (
  update candidates c set data = jsonb_set(c.data, '{status}', to_jsonb(x.best)), version = c.version + 1, updated_at = now()
  from computed x where c.id = x.id and x.per_job and x.cur <> x.best
  returning c.id, c.org_id, x.cur, x.best
)
insert into audit_events (id, org_id, actor_id, action, entity_type, entity_id, detail)
select gen_random_uuid(), org_id, null, 'candidate.stage_repaired', 'candidate', id,
  jsonb_build_object('from', cur, 'to', best, 'why', 'Brought in step with the person''s status for each job (migration 053, production review of 12 Nov 2026)')
from fixed;
