-- A language model's second read of a saved candidate or a match (server/src/modelAssist.ts). It is kept beside the record and never changes it: the record, the score and the
-- evidence stay as the rules made them until a measured gate says otherwise. Additive: no existing row is touched, and old code ignores the table.
create table if not exists model_reviews (
  id uuid primary key, org_id uuid not null, portal_id uuid not null,
  kind text not null check (kind in ('extraction', 'matching')),
  subject_id uuid not null,   -- the candidate (extraction) or the match (matching)
  input_hash text not null,   -- what the model was given, so the same input is never answered twice
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed', 'skipped')),
  model text not null, model_digest text, prompt_version text not null,
  result jsonb, reason text, ms integer,
  created_at timestamptz not null default now(), finished_at timestamptz,
  unique (kind, subject_id, input_hash, model),
  foreign key (portal_id, org_id) references portals (id, org_id)
);
create index if not exists model_reviews_subject on model_reviews (subject_id, kind, created_at desc);
do $$
declare s text := current_schema();
  both_ text := 'org_id = nullif(current_setting(''app.org_id'', true), '''')::uuid and portal_id = nullif(current_setting(''app.portal_id'', true), '''')::uuid';
begin
  execute format('alter table %I.model_reviews enable row level security', s);
  execute format('revoke all on %I.model_reviews from anon, authenticated', s);
  execute format('grant select, insert, update on %I.model_reviews to rolematch_tenant', s);
  execute format('drop policy if exists own_portal on %I.model_reviews', s);
  execute format('create policy own_portal on %I.model_reviews for all to rolematch_tenant using (%s) with check (%s)', s, both_, both_);
end $$;
