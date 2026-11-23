-- RoleMatch schema for Supabase (PostgreSQL). Mirrors server/src/db.ts.
-- NOT yet applied or tested against a live Supabase project: the running prototype uses local SQLite.
-- Access model: the RoleMatch API connects with the service role and enforces organisation scope itself.
-- Row Level Security is switched on with no public policies, so the browser can never read these tables directly.

create table orgs (id uuid primary key default gen_random_uuid(), name text not null, created_at timestamptz not null default now());

create table members (                     -- links Supabase Auth users to an organisation
  user_id uuid primary key references auth.users(id) on delete cascade,
  org_id uuid not null references orgs(id),
  name text not null,
  role text not null default 'recruiter' check (role in ('admin','recruiter','viewer')),
  created_at timestamptz not null default now()
);

create table documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id),
  kind text not null check (kind in ('cv','jd')),
  original_name text not null, mime text not null, size integer not null, sha256 text not null,
  storage_path text not null,               -- path inside the PRIVATE Supabase Storage bucket 'originals'
  status text not null, stage text not null, scan_result text,
  error_code text, error_message text, record_id uuid, source_text text,
  created_by uuid not null references members(user_id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (org_id, kind, sha256)
);

create table candidates (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references orgs(id),
  document_id uuid not null references documents(id),
  data jsonb not null,                      -- current, recruiter-editable record
  extracted jsonb not null,                 -- original extraction, never overwritten
  version integer not null default 1,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table jobs (like candidates including all);
alter table jobs add constraint jobs_org_fk foreign key (org_id) references orgs(id);
alter table jobs add constraint jobs_doc_fk foreign key (document_id) references documents(id);

create table matches (                      -- immutable snapshots
  id uuid primary key default gen_random_uuid(), org_id uuid not null references orgs(id),
  candidate_id uuid not null references candidates(id), job_id uuid not null references jobs(id),
  candidate_version integer not null, job_version integer not null, engine_version text not null,
  result jsonb not null, created_by uuid not null references members(user_id), created_at timestamptz not null default now()
);

create table audit_events (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references orgs(id),
  actor_id uuid, action text not null, entity_type text not null, entity_id uuid,
  detail jsonb not null default '{}', correlation_id text, created_at timestamptz not null default now()
);
create index audit_entity on audit_events (org_id, entity_id);

create table queue (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references orgs(id),
  type text not null, payload jsonb not null, status text not null default 'queued',
  attempts integer not null default 0, max_attempts integer not null default 3,
  run_after timestamptz not null default now(), last_error text, created_at timestamptz not null default now()
);
create index queue_ready on queue (status, run_after);

-- Audit events can be added but never changed or removed (not even by the API role).
create function audit_immutable() returns trigger language plpgsql as $$ begin raise exception 'audit_events is append-only'; end $$;
create trigger audit_no_update before update or delete on audit_events for each row execute function audit_immutable();

-- Lock every table to the service role: no policies means no access through the public API.
alter table orgs enable row level security;       alter table members enable row level security;
alter table documents enable row level security;  alter table candidates enable row level security;
alter table jobs enable row level security;       alter table matches enable row level security;
alter table audit_events enable row level security; alter table queue enable row level security;

-- Private bucket for original CVs and job descriptions (served only through short-lived signed links).
insert into storage.buckets (id, name, public) values ('originals', 'originals', false) on conflict do nothing;
