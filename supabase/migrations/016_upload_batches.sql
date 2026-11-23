-- Upload batches: a recruiter drops many files at once. A batch is a durable record of that act, so progress survives a refresh, a sign-out,
-- a second browser and a worker restart. Counts are never stored: they are worked out from the documents' own states when asked, so they
-- cannot drift from the truth. What IS stored is what the documents cannot say: how many files were declared, which files were refused at the
-- door (they never become documents), how many were already in the organisation, and whether the person cancelled.
create table if not exists upload_batches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id),
  created_by uuid not null references members(user_id),
  kind text not null check (kind in ('cv', 'jd')),
  declared_files integer not null check (declared_files > 0),
  declared_bytes bigint not null check (declared_bytes >= 0),
  duplicate_files integer not null default 0,          -- already in the organisation: answered, not processed again
  refusals jsonb not null default '[]'::jsonb,         -- [{ fileName, code, message }], capped; refused files never become documents
  cancelled_at timestamptz,
  last_activity_at timestamptz not null default now(),  -- last file accepted: tells an abandoned transfer from healthy work (the upload-mode lease)
  closed_at timestamptz,                               -- the person dismissed the progress panel; the batch itself is kept
  created_at timestamptz not null default now()
);
create index if not exists upload_batches_org on upload_batches (org_id, created_at desc);

alter table documents add column if not exists batch_id uuid references upload_batches(id);
alter table documents add column if not exists manual_retries integer not null default 0;   -- bounded: a failing file is not retried for ever
create index if not exists documents_batch on documents (org_id, batch_id) where batch_id is not null;

do $$
declare s text := current_schema();
begin
  execute format('alter table %I.upload_batches enable row level security', s);
  execute format('revoke all on %I.upload_batches from anon, authenticated', s);
  execute format('grant select, insert, update, delete on %I.upload_batches to rolematch_tenant', s);
  execute format('drop policy if exists own_org on %I.upload_batches', s);
  execute format('create policy own_org on %I.upload_batches for all to rolematch_tenant using (org_id = nullif(current_setting(''app.org_id'', true), '''')::uuid) with check (org_id = nullif(current_setting(''app.org_id'', true), '''')::uuid)', s);
end $$;
