-- Shared counters for the rate limits that protect sign-in, sign-up and e-mail sending, so the limits hold across several servers.
-- UNLOGGED: very fast, and losing it in a crash only resets the counters. Keys are hashed, so no e-mail address or IP is stored in clear.
create unlogged table if not exists rate_limits (
  key text not null,
  window_start bigint not null,
  count integer not null default 0,
  primary key (key, window_start)
);
alter table rate_limits enable row level security;
