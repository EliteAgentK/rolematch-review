-- Two console accounts (owner, 12 Nov 2026: "We need to add another email to the console. It should always just be me and my dad."). The owner table
-- held exactly one row (only_one); it now holds at most two, slot 1 and slot 2, each e-mail once, so the database itself refuses a third. Each account
-- has its own password, its own e-mailed codes, its own lock after five wrong tries, and its own sessions; every owner action records which account did it.
-- Accounts are still set only at the PC's terminal (src/scripts/consolePassword.ts). Safe to run again.
do $$
declare s text := current_schema();
begin
  if exists (select from information_schema.columns where table_schema = s and table_name = 'console_owner' and column_name = 'only_one') then
    execute format('alter table %I.console_owner add column if not exists slot smallint', s);
    execute format('update %I.console_owner set slot = 1', s);
    execute format('alter table %I.console_owner drop constraint if exists console_owner_pkey', s);
    execute format('alter table %I.console_owner drop column only_one', s);
    execute format('alter table %I.console_owner alter column slot set not null', s);
    execute format('alter table %I.console_owner add constraint console_owner_two check (slot in (1, 2))', s);
    execute format('alter table %I.console_owner add primary key (slot)', s);
    execute format('alter table %I.console_owner add constraint console_owner_email_once unique (email)', s);
  end if;
  -- which account a session, a code and an action belong to (e-mail addresses of the two console accounts only)
  execute format('alter table %I.console_sessions add column if not exists owner_email text', s);
  execute format('alter table %I.console_codes add column if not exists owner_email text', s);
  execute format('alter table %I.console_actions add column if not exists by_email text', s);
end $$;

-- The owner actions that run in the database's own functions (migration 050) write their record themselves; the console says which account is acting
-- in the same transaction (set_config('rolematch.console_by', ...), src/console/actions.ts), and this stamps it on every action recorded there.
create or replace function console_actions_by() returns trigger language plpgsql as $$
begin
  new.by_email := coalesce(new.by_email, nullif(current_setting('rolematch.console_by', true), ''));
  return new;
end $$;
drop trigger if exists console_actions_by on console_actions;
create trigger console_actions_by before insert on console_actions for each row execute function console_actions_by();
