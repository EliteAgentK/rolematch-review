-- Forgotten passwords (server/src/auth.ts). Only a hash of each code is kept, for this platform's own lifetime and single-use rules, the same way as sign-up codes. Additive: old code ignores the table.
create table if not exists password_resets (
  id uuid primary key, email text not null, code_hash text not null,
  issued_at timestamptz not null default now(), superseded_at timestamptz, consumed_at timestamptz,
  unique (email, code_hash)
);
do $$
declare s text := current_schema();
begin
  execute format('alter table %I.password_resets enable row level security', s);
  execute format('revoke all on %I.password_resets from anon, authenticated, rolematch_tenant', s);
end $$;
