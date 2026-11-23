-- The console's second step (docs/database/18_CONSOLE_V0.md, slice 2): after the right password, a 6-digit code is e-mailed to the console owner's own
-- address and must be entered in the same browser within 10 minutes, once. Neither the code nor the browser's pending token is stored as itself: the row is
-- found by a hash of the pending token, and the code's hash is bound to that token, so a copy of this table cannot be tried offline without the cookie.
-- Rows are deleted a day after they were issued (src/console/auth.ts).
create table if not exists console_codes (
  pending_hash text primary key check (length(pending_hash) = 64),
  code_hash text not null check (length(code_hash) = 64),
  issued_at timestamptz not null default now(),
  used_at timestamptz                               -- entered, or replaced by a newer code
);
create index if not exists console_codes_issued on console_codes (issued_at);

do $$
declare s text := current_schema();
begin
  execute format('alter table %I.console_codes enable row level security', s);
  execute format('drop policy if exists console_only on %I.console_codes', s);
  execute format('create policy console_only on %I.console_codes for all to rolematch_console using (true) with check (true)', s);
  execute format('grant select, insert, update, delete on %I.console_codes to rolematch_console', s);
end $$;
