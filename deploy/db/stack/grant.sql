-- What the application's login (rm_app) may do on this database (docs/architecture/DESIGN_JOHANNESBURG_MOVE.md): read and write the platform's data, never
-- change its shape. Run by grant.sh as supabase_admin after every release's migrations; safe to run again. On Supabase's hosted service the application
-- connects as postgres, the tables' owner; here it cannot drop a table, switch off row security, or alter the audit log's append-only trigger.
-- Still true, as on the hosted service: rm_app reads every organisation's rows (BYPASSRLS), because platform work (claiming queue jobs, sign-in, rate limits)
-- is not done for one organisation; work for an organisation switches to rolematch_tenant, which row security binds.
grant rolematch_tenant to rm_app;
grant rolematch_console to rm_app;
grant usage on schema public to rm_app;
grant select, insert, update, delete on all tables in schema public to rm_app;
grant usage, select on all sequences in schema public to rm_app;
grant execute on all functions in schema public to rm_app;
alter default privileges for role postgres in schema public grant select, insert, update, delete on tables to rm_app;
alter default privileges for role postgres in schema public grant usage, select on sequences to rm_app;
alter default privileges for role postgres in schema public grant execute on functions to rm_app;
-- What the application reads of sign-in's own tables (identity.ts, supabase.ts sessionsOf): the accounts and their sessions, nothing else, never a write.
grant usage on schema auth to rm_app;
grant select on auth.users, auth.sessions to rm_app;
-- The extensions the platform's queries use (pg_trgm for search).
grant usage on schema extensions to rm_app;
