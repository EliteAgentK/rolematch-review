#!/bin/bash
# Runs once, when the database is first created. Passwords come from root-only files mounted at /run/secrets; none is written into this image, a log or Git.
#
# Roles (docs/database/04_ROLES_AND_SECURITY.md):
#   rm_schema_owner  NOLOGIN  owns every table, so no login can drop or alter them by accident
#   rm_migrate       LOGIN    runs migrations as rm_schema_owner; used only by deployments
#   rm_app           LOGIN    what the API and workers use: reads and writes data, never changes the database's shape (app-role.sql, run at the end)
#   rm_readonly      LOGIN    reads only, with a 30 s statement limit: reports, the console's later read role, the schema generator
#   rolematch_tenant          the row-security role (migration 014); created here, since a migration login may not create roles
#   rolematch_console         the console's role (migration 035); created by app-role.sql, for the same reason
#
# Compatibility, to be retired by the own-identity work (bible 03, "Source transfer"): migrations 001 and 012 were written for Supabase and name auth.users,
# storage.buckets and the roles anon, authenticated and service_role. Empty stand-ins let all 34 migrations run unchanged on plain PostgreSQL.
set -euo pipefail
secret() { tr -d '\n' < "/run/secrets/$1"; }
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v migrate_pw="$(secret rm_migrate)" -v app_pw="$(secret rm_app)" -v ro_pw="$(secret rm_readonly)" <<'SQL'
create role rm_schema_owner nologin;
-- Migration 014 creates this role only when missing; created here because a migration login may not create roles. The owner may grant it on.
create role rolematch_tenant nologin nobypassrls;
grant rolematch_tenant to rm_schema_owner with admin option;
create role rm_migrate login password :'migrate_pw' in role rm_schema_owner;
create role rm_app login password :'app_pw';
-- Migrations work as the owner from the first statement, so everything they create belongs to rm_schema_owner and not to a login.
alter role rm_migrate set role = 'rm_schema_owner';
grant create on database rolematch to rm_schema_owner;   -- pg_trgm (migration 004) is a trusted extension the owner may add
create role rm_readonly login password :'ro_pw';
alter role rm_readonly set statement_timeout = '30s';
alter role rm_readonly set default_transaction_read_only = on;

revoke all on database rolematch from public;
grant connect, temporary on database rolematch to rm_migrate, rm_app;
grant connect on database rolematch to rm_readonly;
revoke create on schema public from public;
alter schema public owner to rm_schema_owner;
grant usage on schema public to rm_readonly;
alter default privileges for role rm_schema_owner in schema public grant select on tables to rm_readonly;

-- In its own schema, as Supabase does: its functions belong to the superuser, and migration 012 revokes rights on every function in the app's schema.
create schema extensions;
create extension if not exists pg_stat_statements schema extensions;
grant usage on schema extensions to rm_readonly;
grant pg_read_all_stats to rm_readonly;

-- Supabase stand-ins (see the header)
create role anon nologin; create role authenticated nologin; create role service_role nologin;
create schema auth authorization rm_schema_owner;
create table auth.users (id uuid primary key, email text unique, created_at timestamptz not null default now());
alter table auth.users owner to rm_schema_owner;
create schema storage authorization rm_schema_owner;
create table storage.buckets (id text primary key, name text not null, public boolean not null default false);
alter table storage.buckets owner to rm_schema_owner;
SQL
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -f /docker-entrypoint-initdb.d/app-role.sql.in
