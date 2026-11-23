-- A workflow status belongs to a candidate FOR ONE JOB (owner, 9 Nov 2026: pressing Shortlist marked the person shortlisted everywhere; "we need an elegant
-- way to show in someone's panel what stage they're at and for what job"). One row per candidate and job: shortlisted, not suitable (declined), interviewed,
-- hired, or any other status the organisation uses. The candidate's own status stays as the headline (the furthest stage reached for any job), which is what
-- the board filters on and what a hiring manager's sight depends on. Rows live in the candidate's portal, under the same row rule as every portal table, and
-- go when the candidate or the job is deleted. Who changed what, from what, to what, is in the audit log.
create table if not exists applications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  portal_id uuid not null default nullif(current_setting('app.portal_id', true), '')::uuid,
  candidate_id uuid not null,
  job_id uuid not null,
  status text not null check (status <> 'new' and length(status) between 1 and 40),
  created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (candidate_id, job_id),
  foreign key (portal_id, org_id) references portals (id, org_id),
  foreign key (candidate_id, portal_id) references candidates (id, portal_id) on delete cascade,
  foreign key (job_id, portal_id) references jobs (id, portal_id) on delete cascade
);
create index if not exists applications_job on applications (job_id);
create index if not exists applications_portal on applications (portal_id);

do $$
declare s text := current_schema();
  both_ text := 'org_id = (select nullif(current_setting(''app.org_id'', true), '''')::uuid) and portal_id = (select nullif(current_setting(''app.portal_id'', true), '''')::uuid)';
begin
  execute format('alter table %I.applications enable row level security', s);
  execute format('revoke all on %I.applications from anon, authenticated', s);
  execute format('grant select, insert, update, delete on %I.applications to rolematch_tenant', s);
  execute format('drop policy if exists own_portal on %I.applications', s);
  execute format('create policy own_portal on %I.applications for all to rolematch_tenant using (%s) with check (%s)', s, both_, both_);
end $$;

-- Statuses set before this (on the person, with no job named): where the person was matched against exactly one job, it can only have been for that job.
-- Anyone matched against several jobs, or none, keeps the status as it is, shown as "job not recorded", for a person to place. Nothing is guessed.
insert into applications (org_id, portal_id, candidate_id, job_id, status)
select c.org_id, c.portal_id, c.id, m.job_id, c.data->>'status'
from candidates c
join lateral (select min(job_id::text)::uuid as job_id, count(distinct job_id) as jobs from matches where candidate_id = c.id) m on m.jobs = 1
join jobs j on j.id = m.job_id and j.portal_id = c.portal_id
where c.data->>'status' in ('shortlisted', 'awaiting interview', 'interviewing', 'interviewed', 'declined')
on conflict (candidate_id, job_id) do nothing;

-- The default statuses are now New, Shortlisted, Interviewed, Hired and Not suitable (owner, 9 Nov 2026). An organisation that saved its settings before
-- holds its own copy of the list (statuses are stored whole), so the new defaults never reach it by themselves. Each change below is a new numbered version
-- with its own history entry, made by no person (Settings > History shows RoleMatch):
--  1. a copy that is exactly the earlier default (nobody changed a status) moves to the new default list;
--  2. any other list without "hired" gets it, active, just before "declined", and "declined" still labelled with the earlier default "Declined" reads
--     "Not suitable". Everything else in an edited list (labels, colours, what is switched on or off) is the organisation's and stays as it is.
with moved as (
  update org_settings set version = version + 1, updated_by = null, updated_at = now(), settings = jsonb_set(settings, '{statuses}', '[
    {"key":"new","label":"New","colour":"blue","active":true},{"key":"reviewed","label":"Reviewed","colour":"green","active":false},
    {"key":"shortlisted","label":"Shortlisted","colour":"teal","active":true},{"key":"awaiting interview","label":"Awaiting interview","colour":"orange","active":false},
    {"key":"interviewing","label":"Interviewing","colour":"purple","active":false},{"key":"interviewed","label":"Interviewed","colour":"cyan","active":true},
    {"key":"hired","label":"Hired","colour":"green","active":true},{"key":"declined","label":"Not suitable","colour":"red","active":true},
    {"key":"archived","label":"Archived","colour":"gray","active":false}]'::jsonb)
  where settings->'statuses' = '[
    {"key":"new","label":"New","colour":"blue","active":true},{"key":"reviewed","label":"Reviewed","colour":"green","active":true},
    {"key":"shortlisted","label":"Shortlisted","colour":"teal","active":true},{"key":"awaiting interview","label":"Awaiting interview","colour":"orange","active":true},
    {"key":"interviewing","label":"Interviewing","colour":"purple","active":true},{"key":"interviewed","label":"Interviewed","colour":"cyan","active":true},
    {"key":"declined","label":"Declined","colour":"red","active":true},{"key":"archived","label":"Archived","colour":"gray","active":true}]'::jsonb
  returning org_id, version, settings)
insert into org_settings_history (org_id, version, settings, change, changed_by)
select org_id, version, settings, '{"platform":"New default statuses: New, Shortlisted, Interviewed, Hired, Not suitable (Reviewed, Awaiting interview, Interviewing and Archived switched off)"}'::jsonb, null from moved;

with added as (
  update org_settings o set version = o.version + 1, updated_by = null, updated_at = now(), settings = jsonb_set(o.settings, '{statuses}', (
    select jsonb_agg(x order by ord) from (
      select case when e->>'key' = 'declined' and e->>'label' = 'Declined' then jsonb_set(e, '{label}', '"Not suitable"') else e end as x, i * 2 as ord
        from jsonb_array_elements(o.settings->'statuses') with ordinality t(e, i)
      union all
      select '{"key":"hired","label":"Hired","colour":"green","active":true}'::jsonb,
             coalesce((select i * 2 - 1 from jsonb_array_elements(o.settings->'statuses') with ordinality t(e, i) where e->>'key' = 'declined' limit 1), 1000)
    ) s))
  where jsonb_typeof(o.settings->'statuses') = 'array' and jsonb_array_length(o.settings->'statuses') < 20
    and not exists (select 1 from jsonb_array_elements(o.settings->'statuses') e where e->>'key' = 'hired')
  returning org_id, version, settings)
insert into org_settings_history (org_id, version, settings, change, changed_by)
select org_id, version, settings, '{"platform":"Hired added to the statuses; Declined now reads Not suitable"}'::jsonb, null from added;
