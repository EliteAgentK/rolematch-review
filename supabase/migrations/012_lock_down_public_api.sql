-- Defence in depth for Supabase's public (PostgREST) API.
-- Row Level Security already blocks the browser's anonymous and signed-in roles from every table (001, 009, 010), and the API server connects as the
-- service role. This also removes their rights to the tables and functions altogether, so a table or function added later cannot be exposed by accident.
-- It acts on the schema the migration runs in (the live schema, or a test's own throw-away schema), never on another.
do $$
declare s text := current_schema();
begin
  execute format('revoke all on all tables in schema %I from anon, authenticated', s);
  execute format('revoke all on all sequences in schema %I from anon, authenticated', s);
  execute format('revoke execute on all functions in schema %I from public, anon, authenticated', s);
  execute format('alter default privileges in schema %I revoke all on tables from anon, authenticated', s);
  execute format('alter default privileges in schema %I revoke all on sequences from anon, authenticated', s);
  execute format('alter default privileges in schema %I revoke execute on functions from public, anon, authenticated', s);
end $$;
