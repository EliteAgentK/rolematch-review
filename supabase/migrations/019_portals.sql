-- Recruitment portals: the ownership boundary for shared recruitment work.
--
--   Organisation  -> one or more portals -> explicitly authorised portal members -> the portal's candidates, jobs, documents, batches, reports and history.
--
-- Organisation membership alone grants access to NO portal. A person sees a portal's data only through a row in portal_members, and the database enforces
-- it: every portal table's row rule requires BOTH the organisation (app.org_id) and the portal (app.portal_id) that the server has verified for the request
-- or job. A row's portal is filled in from app.portal_id when it is inserted, so no query has to remember it, and a write into another portal is refused.
--
-- EXISTING DATA (this migration changes data, so it needs approval before it is applied to the shared project): each organisation gets ONE portal called
-- "Main portal"; every current member of the organisation becomes a member of it (admin->admin, recruiter->recruiter, viewer->viewer); every existing
-- document, candidate, job, match, batch and queue row is assigned to it. Nothing is deleted or merged, nothing is shared between organisations, and an
-- organisation with no data simply gets an empty portal. Audit rows already written stay organisation-level (portal_id null): the audit log is append-only.
-- Rollback: docs/architecture/MIGRATION_019_020_ROLLBACK.md (columns, tables and policies are removed; the data itself is untouched).

create table if not exists portals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id),
  name text not null check (length(name) between 1 and 80),
  created_by uuid, created_at timestamptz not null default now(),
  unique (org_id, name), unique (id, org_id)
);
create table if not exists portal_members (
  portal_id uuid not null, org_id uuid not null,
  user_id uuid not null references members(user_id) on delete cascade,
  role text not null default 'recruiter' check (role in ('admin', 'recruiter', 'viewer')),
  added_by uuid, created_at timestamptz not null default now(),
  primary key (portal_id, user_id),
  foreign key (portal_id, org_id) references portals (id, org_id)
);
create index if not exists portal_members_user on portal_members (user_id);

-- Invitations: one per person per portal, bound to the invited address, expiring, single-use. Only a hash of the token is stored; the token itself is
-- shown once to the inviter and is never logged.
create table if not exists portal_invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null, portal_id uuid not null,
  email text not null check (email = lower(email)),
  role text not null default 'recruiter' check (role in ('admin', 'recruiter', 'viewer')),
  token_hash text not null unique,
  invited_by uuid not null, invited_by_email text not null,
  created_at timestamptz not null default now(), expires_at timestamptz not null,
  accepted_at timestamptz, accepted_by uuid, revoked_at timestamptz,
  foreign key (portal_id, org_id) references portals (id, org_id)
);
create unique index if not exists portal_invitations_open on portal_invitations (portal_id, email) where accepted_at is null and revoked_at is null;

-- Backfill: one portal per organisation, every member in it.
insert into portals (org_id, name) select o.id, 'Main portal' from orgs o where not exists (select 1 from portals p where p.org_id = o.id);
insert into portal_members (portal_id, org_id, user_id, role)
  select p.id, m.org_id, m.user_id, m.role from members m join portals p on p.org_id = m.org_id and p.name = 'Main portal'
  on conflict do nothing;

-- Portal columns on everything a portal owns.
do $$
declare t text;
begin
  foreach t in array array['documents', 'candidates', 'jobs', 'matches', 'upload_batches', 'error_occurrences', 'defect_groups', 'error_register', 'queue'] loop
    execute format('alter table %I add column if not exists portal_id uuid', t);
    execute format('update %I x set portal_id = (select p.id from portals p where p.org_id = x.org_id order by p.created_at limit 1) where x.portal_id is null', t);
    execute format('alter table %I alter column portal_id set default nullif(current_setting(''app.portal_id'', true), '''')::uuid', t);
    execute format('alter table %I alter column portal_id set not null', t);
    execute format('create index if not exists %I on %I (portal_id)', t || '_portal', t);
    -- a row's portal must belong to the row's organisation
    execute format('alter table %I drop constraint if exists %I', t, t || '_portal_org_fk');
    execute format('alter table %I add constraint %I foreign key (portal_id, org_id) references portals (id, org_id)', t, t || '_portal_org_fk');
  end loop;
end $$;
-- The audit log is append-only, so old rows keep a null portal; new rows are tagged with the portal in scope.
alter table audit_events add column if not exists portal_id uuid default nullif(current_setting('app.portal_id', true), '')::uuid;
create index if not exists audit_events_portal on audit_events (portal_id);

-- Relationships cannot cross portals: a candidate's document, a match's candidate and job, a document's batch are all in the same portal.
alter table documents add constraint documents_id_portal unique (id, portal_id);
alter table candidates add constraint candidates_id_portal unique (id, portal_id);
alter table jobs add constraint jobs_id_portal unique (id, portal_id);
alter table upload_batches add constraint upload_batches_id_portal unique (id, portal_id);
alter table candidates add constraint candidates_document_portal_fk foreign key (document_id, portal_id) references documents (id, portal_id);
alter table jobs add constraint jobs_document_portal_fk foreign key (document_id, portal_id) references documents (id, portal_id);
alter table matches add constraint matches_candidate_portal_fk foreign key (candidate_id, portal_id) references candidates (id, portal_id);
alter table matches add constraint matches_job_portal_fk foreign key (job_id, portal_id) references jobs (id, portal_id);
alter table documents add constraint documents_batch_portal_fk foreign key (batch_id, portal_id) references upload_batches (id, portal_id);

-- defect groups are counted per portal
alter table defect_groups drop constraint if exists defect_groups_pkey;
alter table defect_groups add primary key (org_id, portal_id, defect_key);

-- Row rules. The tenant role sees a portal's rows only when the server has set BOTH the organisation and the portal for this request or job.
do $$
declare s text := current_schema(); t text;
  both_ text := 'org_id = nullif(current_setting(''app.org_id'', true), '''')::uuid and portal_id = nullif(current_setting(''app.portal_id'', true), '''')::uuid';
begin
  foreach t in array array['documents', 'candidates', 'jobs', 'matches', 'upload_batches', 'error_occurrences', 'defect_groups', 'error_register', 'queue'] loop
    execute format('drop policy if exists own_org on %I.%I', s, t);
    execute format('drop policy if exists own_portal on %I.%I', s, t);
    execute format('create policy own_portal on %I.%I for all to rolematch_tenant using (%s) with check (%s)', s, t, both_, both_);
  end loop;
  -- audit: organisation-level rows (settings, sign-in) are visible in any scope of the organisation; portal rows only in their portal
  execute format('drop policy if exists own_org on %I.audit_events', s);
  execute format('create policy own_org on %I.audit_events for all to rolematch_tenant using (org_id = nullif(current_setting(''app.org_id'', true), '''')::uuid and (portal_id is null or portal_id = nullif(current_setting(''app.portal_id'', true), '''')::uuid)) with check (org_id = nullif(current_setting(''app.org_id'', true), '''')::uuid and (portal_id is null or portal_id = nullif(current_setting(''app.portal_id'', true), '''')::uuid))', s);
  -- the portal tables themselves
  foreach t in array array['portals', 'portal_members', 'portal_invitations'] loop
    execute format('alter table %I.%I enable row level security', s, t);
    execute format('revoke all on %I.%I from anon, authenticated', s, t);
    execute format('grant select, insert, update, delete on %I.%I to rolematch_tenant', s, t);
  end loop;
  execute format('drop policy if exists own_org on %I.portals', s);
  execute format('create policy own_org on %I.portals for all to rolematch_tenant using (org_id = nullif(current_setting(''app.org_id'', true), '''')::uuid) with check (org_id = nullif(current_setting(''app.org_id'', true), '''')::uuid)', s);
  foreach t in array array['portal_members', 'portal_invitations'] loop
    execute format('drop policy if exists own_portal on %I.%I', s, t);
    execute format('create policy own_portal on %I.%I for all to rolematch_tenant using (%s) with check (%s)', s, t, both_, both_);
  end loop;
end $$;
