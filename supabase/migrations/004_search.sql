-- Fast server-side search for large organisations. `search` is a lower-cased text built from the fields people search by,
-- kept up to date by the database itself, with a trigram index so "ILIKE '%word%'" stays quick with thousands of records.
create extension if not exists pg_trgm;

alter table candidates add column if not exists search text generated always as (
  lower(coalesce(data->>'name','') || ' ' || coalesce(data->>'role','') || ' ' || coalesce(data->>'skills','') || ' ' ||
        coalesce(data->>'location','') || ' ' || coalesce(data->>'email',''))
) stored;

alter table jobs add column if not exists search text generated always as (
  lower(coalesce(data->>'title','') || ' ' || coalesce(data->>'company','') || ' ' || coalesce(data->>'department','') || ' ' ||
        coalesce(data->>'location','') || ' ' || coalesce(data->>'skills',''))
) stored;

-- The operator class lives in whichever schema holds the extension (Supabase uses "extensions"), so look it up.
do $$
declare ext text;
begin
  select n.nspname into ext from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  execute format('create index if not exists candidates_search_trgm on candidates using gin (search %I.gin_trgm_ops)', ext);
  execute format('create index if not exists jobs_search_trgm on jobs using gin (search %I.gin_trgm_ops)', ext);
end $$;

-- Filters used by the lists and the review queue
create index if not exists candidates_org_status on candidates (org_id, (data->>'status'));
create index if not exists candidates_org_review on candidates (org_id, (data->>'reviewState'));
create index if not exists jobs_org_status on jobs (org_id, (data->>'status'));
