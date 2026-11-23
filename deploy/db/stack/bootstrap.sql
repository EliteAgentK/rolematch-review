-- Run by up.sh as supabase_admin (the image's superuser), safe to run again. Values come in as psql variables, never as text in this file.
-- postgres works as the schema's owner, as on Supabase's hosted service, so migrations run exactly as they do there; supabase_auth_admin is GoTrue's;
-- rm_app is the application's login and gets its rights in grant.sql, after the migrations have made the tables.
alter role postgres with login password :'pg_pw';
alter role supabase_auth_admin with login password :'auth_pw';
select 'create role rm_app login' where not exists (select from pg_roles where rolname = 'rm_app') \gexec
alter role rm_app with login password :'app_pw' nosuperuser nocreatedb nocreaterole noreplication bypassrls connection limit 80;
-- The console's definer functions read the statistics views for every connection, as on the hosted service.
grant pg_read_all_stats to postgres;
-- Supabase's file service makes storage.buckets when it starts; here the encrypted vault (STORE_DIR) holds the originals and that service never runs.
-- Migration 001 records the private bucket in this table on every host, so the table is made here, with the columns 001 writes and the ones the hosted
-- service has, and nothing reads it but the record that the bucket is private.
create schema if not exists storage;
create table if not exists storage.buckets (id text primary key, name text not null unique, owner uuid, public boolean default false,
  created_at timestamptz default now(), updated_at timestamptz default now());
grant usage on schema storage to postgres;
grant select, insert, update on storage.buckets to postgres;
