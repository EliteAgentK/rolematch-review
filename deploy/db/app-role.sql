-- What the app's login (rm_app) may do: read and write data, never change the database's shape (docs/database/04_ROLES_AND_SECURITY.md).
-- Run as postgres; safe to run again. 00-roles.sh runs it for a new database, before any table exists; default privileges then cover every table a
-- migration adds, because migrations create them as rm_schema_owner.
--
-- Before: rm_app worked as the tables' owner, as the Supabase connection it replaces does, so a fault or an injection in the app could drop a table,
-- switch off row security or disable the trigger that keeps the audit log append-only. After: it cannot.
-- Still true, and the next step: rm_app reads every organisation's rows (BYPASSRLS), because platform-wide work (claiming queue jobs, sign-in, rate
-- limits) is not done for one organisation; work for an organisation still switches to rolematch_tenant, which row security binds. Replacing
-- BYPASSRLS with explicit platform policies is planned, not done.
alter role rm_app reset role;
revoke rm_schema_owner from rm_app;
alter role rm_app bypassrls;
grant rolematch_tenant to rm_app;
grant usage on schema public to rm_app;
grant select, insert, update, delete on all tables in schema public to rm_app;
grant usage, select on all sequences in schema public to rm_app;
grant execute on all functions in schema public to rm_app;
alter default privileges for role rm_schema_owner in schema public grant select, insert, update, delete on tables to rm_app;
alter default privileges for role rm_schema_owner in schema public grant usage, select on sequences to rm_app;
alter default privileges for role rm_schema_owner in schema public grant execute on functions to rm_app;
-- The Supabase stand-ins: read only, for the schema check (the own-identity work replaces them).
grant usage on schema auth, storage to rm_app;
grant select on all tables in schema auth, storage to rm_app;
-- The console's role (migration 035). Created here because a migration login may not create roles; the owner may grant it on, and rm_app switches to it
-- for every console query, as it does to rolematch_tenant.
do $$ begin
  if not exists (select from pg_roles where rolname = 'rolematch_console') then create role rolematch_console nologin nobypassrls; end if;
end $$;
grant rolematch_console to rm_schema_owner with admin option;
grant rolematch_console to rm_app;
