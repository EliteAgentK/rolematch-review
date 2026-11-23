-- Batch report and completion acknowledgement, plus the first slice of platform-wide error handling.
--
-- upload_batches: files the browser left out before sending (unsupported type, empty, too large), the names of files that were already in the organisation,
-- (Acknowledging a completion summary is per person, in migration 020: one person's acknowledgement must not change anyone else's.)
alter table upload_batches add column if not exists skipped jsonb not null default '[]'::jsonb;           -- [{ fileName, reason }], capped
alter table upload_batches add column if not exists duplicate_names jsonb not null default '[]'::jsonb;   -- [fileName], capped

-- error_occurrences: one row per failure that mattered, with no document text and no personal detail (detail is sanitised before it is written).
-- The kinds keep expected validation, temporary operational trouble, suspected and confirmed software defects, model mistakes and ambiguous
-- reports apart. Rows are bounded per organisation (src/occurrences.ts prunes them) and only administrators can read them through the API.
create table if not exists error_occurrences (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id),
  occurred_at timestamptz not null default now(),
  correlation_id text not null,                  -- the request or job that failed: what a person quotes to support
  component text not null,                       -- upload, batch, pipeline, ...
  stage text,                                    -- received, security, reading, extracting, ...
  code text not null,                            -- the stable error code
  kind text not null check (kind in ('expected_validation', 'operational_transient', 'suspected_defect', 'confirmed_defect', 'model_error', 'ambiguous')),
  severity text not null check (severity in ('info', 'low', 'medium', 'high', 'critical')),
  batch_id uuid, document_id uuid, user_id uuid, -- references by id only: the evidence is looked up under the same access rules, never copied here
  defect_key text not null,                      -- groups repeats of the same suspected defect
  attempt integer,
  versions jsonb not null default '{}'::jsonb,   -- parser, application and runtime versions in force
  detail jsonb not null default '{}'::jsonb      -- sanitised
);
create index if not exists error_occurrences_org_time on error_occurrences (org_id, occurred_at desc);
create index if not exists error_occurrences_org_key on error_occurrences (org_id, defect_key, occurred_at desc);

-- defect_groups: the running count per suspected defect. "suspected" is what every new group is. Only a person can move it to "confirmed" (with a
-- reference to the error register entry), and nothing here ever becomes a training example: that is a separate, authorised, reviewed step.
create table if not exists defect_groups (
  org_id uuid not null references orgs(id),
  defect_key text not null,
  component text not null, code text not null, kind text not null,
  first_seen timestamptz not null default now(), last_seen timestamptz not null default now(),
  occurrences integer not null default 1,
  status text not null default 'suspected' check (status in ('suspected', 'confirmed', 'resolved', 'accepted_limitation')),
  register_ref text,                              -- e.g. R24 in docs/learning/ERROR_REGISTER.md, set when a person confirms it
  status_changed_by uuid, status_changed_at timestamptz,
  primary key (org_id, defect_key)
);

do $$
declare s text := current_schema(); t text;
begin
  foreach t in array array['error_occurrences', 'defect_groups'] loop
    execute format('alter table %I.%I enable row level security', s, t);
    execute format('revoke all on %I.%I from anon, authenticated', s, t);
    execute format('grant select, insert, update, delete on %I.%I to rolematch_tenant', s, t);
    execute format('drop policy if exists own_org on %I.%I', s, t);
    execute format('create policy own_org on %I.%I for all to rolematch_tenant using (org_id = nullif(current_setting(''app.org_id'', true), '''')::uuid) with check (org_id = nullif(current_setting(''app.org_id'', true), '''')::uuid)', s, t);
  end loop;
end $$;
