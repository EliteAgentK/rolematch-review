-- Per-organisation settings. The CURRENT settings are one row; every change is also kept as a numbered version, so nothing is ever lost
-- and each change says who made it. (The scoring rules are NOT settings: they are fixed and the same for everyone.)
create table org_settings (
  org_id uuid primary key references orgs(id),
  version integer not null,
  settings jsonb not null,
  updated_by uuid references members(user_id),
  updated_at timestamptz not null default now()
);
create table org_settings_history (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id),
  version integer not null,
  settings jsonb not null,
  change jsonb not null default '{}'::jsonb,
  changed_by uuid references members(user_id),
  created_at timestamptz not null default now(),
  unique (org_id, version)
);
alter table org_settings enable row level security;
alter table org_settings_history enable row level security;
create index org_settings_history_org on org_settings_history (org_id, version desc);
