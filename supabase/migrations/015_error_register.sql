-- The error register (docs/learning/TRAINING_AND_IMPROVEMENT_PLAN.md, milestone 1). Every time a recruiter corrects a field the reader got wrong
-- (an edit with the reason "extraction_correction"), one row is written here, in the same transaction as the edit, for later checking and
-- labelling. Other reasons (the candidate updated a detail, a recruiter's preference, a disagreement) are recorded on the audit entry only: they
-- are not reading errors. Nothing here trains anything; rows start "unverified" and their category is decided by a person later.
-- Personal detail lives in from_value and to_value, so a row is deleted with its record (deletion.ts).
create table if not exists error_register (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id),
  record_kind text not null check (record_kind in ('candidate', 'job')),
  record_id uuid not null,
  document_id uuid,
  field_path text not null,
  from_value jsonb,
  to_value jsonb,
  change_kind text not null check (change_kind in ('extraction_correction', 'candidate_update', 'recruiter_preference', 'disputed_interpretation')),
  category text,   -- decided when the row is checked: image_quality, detection, recognition, reading_order, field_extraction, association, normalisation, ...
  status text not null default 'unverified' check (status in ('unverified', 'verified', 'rejected')),
  parser_version text,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists error_register_org_record on error_register (org_id, record_id);
create index if not exists error_register_org_status on error_register (org_id, status, created_at);

-- The same protection as every other organisation table (migration 014): row rules on, nothing for Supabase's public roles, and the tenant role
-- sees and writes its own organisation's rows only.
do $$
declare s text := current_schema();
begin
  execute format('alter table %I.error_register enable row level security', s);
  execute format('revoke all on %I.error_register from anon, authenticated', s);
  execute format('grant select, insert, update, delete on %I.error_register to rolematch_tenant', s);
  execute format('drop policy if exists own_org on %I.error_register', s);
  execute format('create policy own_org on %I.error_register for all to rolematch_tenant using (org_id = nullif(current_setting(''app.org_id'', true), '''')::uuid) with check (org_id = nullif(current_setting(''app.org_id'', true), '''')::uuid)', s);
end $$;
