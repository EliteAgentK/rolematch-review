-- Sessions signed out through RoleMatch, shared by every API server: a sign-out on one server is honoured by all of them (each re-checks a
-- token here at most every TOKEN_RECHECK_MS). Kept only until the session's token would have expired anyway. The session id is stored hashed.
-- Logged (not UNLOGGED like the rate-limit counters): losing these in a crash would make signed-out sessions valid again until they expire.
create table if not exists signed_out_sessions (
  session_hash text primary key,
  expires_at bigint not null            -- seconds since 1970, the token's own expiry
);
create index if not exists signed_out_sessions_expiry on signed_out_sessions (expires_at);
alter table signed_out_sessions enable row level security;   -- not reachable through Supabase's public API (see 012)
