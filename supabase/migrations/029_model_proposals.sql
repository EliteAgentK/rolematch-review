-- What the language model proposes about a record, one row per value (server/src/modelPolicy.ts decides what happens to each). A person's answer on each is what the model is later measured and taught on, so the row keeps exactly what was proposed, from which model and prompt, and what became of it. Additive.
create table if not exists model_proposals (
  id uuid primary key default gen_random_uuid(), org_id uuid not null, portal_id uuid not null,
  review_id uuid not null references model_reviews (id) on delete cascade,
  subject_id uuid not null,      -- the candidate
  field text not null, value text not null, quote text not null default '', line integer not null default 0,
  recorded text,                 -- what the record held, where the model read it differently
  outcome text not null check (outcome in ('suggested', 'applied', 'logged', 'conflict')),
  decision text check (decision in ('accepted', 'rejected')), decided_by uuid, decided_at timestamptz, undone boolean not null default false,
  model text not null, prompt_version text not null, policy_version text not null,
  created_at timestamptz not null default now(),
  foreign key (portal_id, org_id) references portals (id, org_id) on delete cascade
);
create index if not exists model_proposals_subject on model_proposals (subject_id, created_at desc);
create index if not exists model_proposals_measure on model_proposals (field, prompt_version) where decision is not null;
do $$
declare s text := current_schema();
  both_ text := 'org_id = nullif(current_setting(''app.org_id'', true), '''')::uuid and portal_id = nullif(current_setting(''app.portal_id'', true), '''')::uuid';
begin
  execute format('alter table %I.model_proposals enable row level security', s);
  execute format('revoke all on %I.model_proposals from anon, authenticated', s);
  execute format('grant select, insert, update on %I.model_proposals to rolematch_tenant', s);
  execute format('drop policy if exists own_portal on %I.model_proposals', s);
  execute format('create policy own_portal on %I.model_proposals for all to rolematch_tenant using (%s) with check (%s)', s, both_, both_);
end $$;
