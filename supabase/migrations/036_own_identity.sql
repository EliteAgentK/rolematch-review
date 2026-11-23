-- Our own sign-in (docs/database/20_IDENTITY_V1.md, slice 2): accounts, sessions and e-mailed codes, kept beside Supabase's until IDENTITY=own replaces it.
-- Nothing here is used while IDENTITY=supabase. An account keeps the id it has in Supabase, so memberships, notes and audit rows keep pointing at the right person.
-- No password, code or refresh token is stored as itself: passwords as argon2id, codes and refresh tokens as keyed or plain SHA-256 digests.
-- Row security is on with no policy, so the tenant role reads none of it; only the platform's own connection does.
-- Known for the switch (slice 5): profiles.user_id references auth.users (001); it must reference identity_accounts before own sign-ups can create profiles.

create table if not exists identity_accounts (
  id uuid primary key,
  email text not null check (email = lower(btrim(email)) and email like '%_@_%'),
  password_hash text check (password_hash is null or password_hash like '$argon2id$%'),
  confirmed_at timestamptz,                          -- null until the e-mailed code is entered (or the account was made confirmed, for an invitation)
  meta jsonb not null default '{}'::jsonb,           -- what sign-up recorded: name, and the organisation or invitation it was for
  created_at timestamptz not null default now(),
  password_set_at timestamptz
);
create unique index if not exists identity_accounts_email on identity_accounts (email);

-- A session lasts at most 30 days and ends after 7 days unused. Its refresh token changes at every use; the one it replaced is remembered, so a copied
-- token used after the real one is noticed and the whole session ends (05_IDENTITY.md: never two successors).
create table if not exists identity_sessions (
  id uuid primary key,
  account_id uuid not null references identity_accounts (id) on delete cascade,
  signed_in_at timestamptz not null default now(),
  refresh_hash text not null unique check (length(refresh_hash) = 64),
  previous_hash text check (previous_hash is null or length(previous_hash) = 64),
  refreshed_at timestamptz not null default now(),
  ends_at timestamptz not null,
  ended_at timestamptz,
  ended_why text check (ended_why is null or ended_why in ('signed out', 'password changed', 'reused token', 'ended by request', 'expired', 'account deleted'))
);
create index if not exists identity_sessions_open on identity_sessions (account_id) where ended_at is null;
create index if not exists identity_sessions_previous on identity_sessions (previous_hash) where previous_hash is not null;

-- An e-mailed code: one live code per account and purpose (a new one supersedes the old), used once, kept only as a keyed digest.
create table if not exists identity_codes (
  id bigint generated always as identity primary key,
  account_id uuid not null references identity_accounts (id) on delete cascade,
  purpose text not null check (purpose in ('signup', 'recovery')),
  digest text not null check (length(digest) = 64),
  issued_at timestamptz not null default now(),
  used_at timestamptz,
  superseded_at timestamptz
);
create index if not exists identity_codes_live on identity_codes (account_id, purpose) where used_at is null and superseded_at is null;

alter table identity_accounts enable row level security;
alter table identity_sessions enable row level security;
alter table identity_codes enable row level security;
