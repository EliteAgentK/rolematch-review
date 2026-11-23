-- The database itself keeps organisations apart, not only the server's code.
-- The server connects as the owner, which skips Row Level Security. For work done on behalf of one organisation it switches each query to
-- rolematch_tenant (cannot skip it) and names the organisation in app.org_id (server/src/db.ts, forOrg). These policies then show and accept only
-- that organisation's rows; with no organisation named they show nothing. Queue claiming, sign-in, rate limits and migrations stay with the owner.
-- The role belongs to the whole database cluster; the grants and policies belong to the schema this runs in (live, or a test's own schema).
do $$
begin
  if not exists (select from pg_roles where rolname = 'rolematch_tenant') then
    create role rolematch_tenant nologin nobypassrls;
  end if;
exception when duplicate_object then null;   -- two test runs creating it at the same moment
end $$;
grant rolematch_tenant to current_user;   -- lets the server switch to it (and back)

do $$
declare s text := current_schema(); t text;
begin
  execute format('grant usage on schema %I to rolematch_tenant', s);
  execute format('alter table %I.schema_migrations enable row level security', s);   -- every table has row rules on (only the owner uses this one)
  -- orgs: its own row only, and only to read
  execute format('grant select on %I.orgs to rolematch_tenant', s);
  execute format('drop policy if exists own_org on %I.orgs', s);
  execute format('create policy own_org on %I.orgs for select to rolematch_tenant using (id = nullif(current_setting(''app.org_id'', true), '''')::uuid)', s);
  -- audit_events stays append-only (its trigger refuses changes); the others can be read and changed within the organisation
  foreach t in array array['members', 'documents', 'candidates', 'jobs', 'matches', 'audit_events', 'queue', 'org_settings', 'org_settings_history'] loop
    execute format('grant select, insert, update, delete on %I.%I to rolematch_tenant', s, t);
    execute format('drop policy if exists own_org on %I.%I', s, t);
    execute format('create policy own_org on %I.%I for all to rolematch_tenant using (org_id = nullif(current_setting(''app.org_id'', true), '''')::uuid) with check (org_id = nullif(current_setting(''app.org_id'', true), '''')::uuid)', s, t);
  end loop;
end $$;
