-- The console's Activity and Organisations pages (docs/database/22_CONSOLE_LOOK.md): what happened day by day, and each company at a glance.
-- Security definer, callable by rolematch_console alone, like console_overview() and console_database(). Activity, Organisations, Schema and AI return
-- counts, amounts, names of tables and of organisations only. People (owner, 11 Nov 2026: "everything about my platform must be within this console")
-- lists each account's name, e-mail, organisation, role and sign-in times for the owner, behind the console's two-step sign-in: never a password, a code,
-- a phone, an address, a CV's text or a match's reasons.
do $$
declare s text := current_schema();
begin
  -- Day by day for the last p_days days (Johannesburg's days): CVs and job descriptions read, matches made, people shortlisted, new people, AI spend.
  execute format($f$
    create or replace function %1$I.console_activity(p_days int default 30) returns jsonb language sql stable security definer set search_path = %1$I, pg_catalog, pg_temp as $body$
      with days as (
        select (generate_series((now() at time zone 'Africa/Johannesburg')::date - (least(greatest(p_days, 1), 366) - 1), (now() at time zone 'Africa/Johannesburg')::date, interval '1 day'))::date as d
      ), since as (select (min(d)::timestamp at time zone 'Africa/Johannesburg') as t from days)
      select jsonb_build_object('days', least(greatest(p_days, 1), 366), 'at', now(), 'series', (select jsonb_agg(jsonb_build_object(
        'date', days.d,
        'cvs', coalesce((select count(*) from documents x where x.kind = 'cv' and x.status = 'published' and (x.updated_at at time zone 'Africa/Johannesburg')::date = days.d), 0),
        'jobs', coalesce((select count(*) from documents x where x.kind = 'jd' and x.status = 'published' and (x.updated_at at time zone 'Africa/Johannesburg')::date = days.d), 0),
        'matches', coalesce((select count(*) from matches x where (x.created_at at time zone 'Africa/Johannesburg')::date = days.d), 0),
        'shortlisted', coalesce((select count(*) from audit_events x where x.action = 'application.status_changed' and x.detail->>'to' = 'shortlisted' and (x.created_at at time zone 'Africa/Johannesburg')::date = days.d), 0),
        'people', coalesce((select count(*) from members x where (x.created_at at time zone 'Africa/Johannesburg')::date = days.d), 0),
        'aiMicroUsd', coalesce((select sum(x.cost_micro_usd) from ai_usage x where (x.at at time zone 'Africa/Johannesburg')::date = days.d), 0)
      ) order by days.d) from days),
      -- the same totals for the period before, for "up 12 percent on the 30 days before"
      'previous', (select jsonb_build_object(
        'cvs', (select count(*) from documents x, since where x.kind = 'cv' and x.status = 'published' and x.updated_at < since.t and x.updated_at >= since.t - (least(greatest(p_days, 1), 366) * interval '1 day')),
        'jobs', (select count(*) from documents x, since where x.kind = 'jd' and x.status = 'published' and x.updated_at < since.t and x.updated_at >= since.t - (least(greatest(p_days, 1), 366) * interval '1 day')),
        'matches', (select count(*) from matches x, since where x.created_at < since.t and x.created_at >= since.t - (least(greatest(p_days, 1), 366) * interval '1 day')),
        'shortlisted', (select count(*) from audit_events x, since where x.action = 'application.status_changed' and x.detail->>'to' = 'shortlisted' and x.created_at < since.t and x.created_at >= since.t - (least(greatest(p_days, 1), 366) * interval '1 day')),
        'people', (select count(*) from members x, since where x.created_at < since.t and x.created_at >= since.t - (least(greatest(p_days, 1), 366) * interval '1 day')),
        'aiMicroUsd', (select coalesce(sum(x.cost_micro_usd), 0) from ai_usage x, since where x.at < since.t and x.at >= since.t - (least(greatest(p_days, 1), 366) * interval '1 day')))))
    $body$ $f$, s);
  execute format('revoke all on function %I.console_activity(int) from public', s);
  execute format('grant execute on function %I.console_activity(int) to rolematch_console', s);

  -- Each organisation at a glance: its name, when it started, and counts; AI spend this calendar month; when anything last happened in it.
  execute format($f$
    create or replace function %1$I.console_organisations() returns jsonb language sql stable security definer set search_path = %1$I, pg_catalog, pg_temp as $body$
      select coalesce(jsonb_agg(o order by (o->>'lastActivity') desc nulls last, o->>'name'), '[]'::jsonb) from (
        select jsonb_build_object(
          'name', g.name, 'since', g.created_at,
          'portals', (select count(*) from portals p where p.org_id = g.id),
          'people', (select count(*) from members m where m.org_id = g.id and m.left_at is null),
          'cvs', (select count(*) from candidates c where c.org_id = g.id),
          'jobs', (select count(*) from jobs j where j.org_id = g.id),
          'matches', (select count(*) from matches x where x.org_id = g.id),
          'aiMicroUsdThisMonth', (select coalesce(sum(a.cost_micro_usd), 0) from ai_usage a where a.org_id = g.id and a.at >= date_trunc('month', now() at time zone 'Africa/Johannesburg') at time zone 'Africa/Johannesburg'),
          'lastActivity', (select max(e.created_at) from audit_events e where e.org_id = g.id)) as o
        from orgs g) x
    $body$ $f$, s);
  execute format('revoke all on function %I.console_organisations() from public', s);
  execute format('grant execute on function %I.console_organisations() to rolematch_console', s);

  -- People and sign-in: every account, its organisation and role, when it joined and last signed in; the totals; open and lapsed invitations.
  execute format($f$
    create or replace function %1$I.console_people() returns jsonb language sql stable security definer set search_path = %1$I, auth, pg_catalog, pg_temp as $body$
      select jsonb_build_object(
        'accounts', (select count(*) from auth.users),
        'confirmed', (select count(*) from auth.users where email_confirmed_at is not null),
        'signedIn7d', (select count(*) from auth.users where last_sign_in_at > now() - interval '7 days'),
        'signedIn30d', (select count(*) from auth.users where last_sign_in_at > now() - interval '30 days'),
        'neverSignedIn', (select count(*) from auth.users where last_sign_in_at is null),
        'sessionsActive', (select count(*) from auth.sessions where coalesce(refreshed_at, updated_at, created_at) > now() - interval '1 day'),
        'invitationsOpen', (select count(*) from portal_invitations where accepted_at is null and revoked_at is null and expires_at > now()),
        'invitationsLapsed', (select count(*) from portal_invitations where accepted_at is null and revoked_at is null and expires_at <= now()),
        'invitationsAccepted30d', (select count(*) from portal_invitations where accepted_at > now() - interval '30 days'),
        'people', (select coalesce(jsonb_agg(p order by (p->>'lastSignIn') desc nulls last), '[]'::jsonb) from (
          select jsonb_build_object('name', m.name, 'email', u.email, 'organisation', g.name, 'role', m.role,
            'portals', (select count(*) from portal_members pm where pm.user_id = m.user_id), 'joined', m.created_at, 'lastSignIn', u.last_sign_in_at,
            'confirmed', u.email_confirmed_at is not null, 'left', m.left_at) as p
          from members m join orgs g on g.id = m.org_id left join auth.users u on u.id = m.user_id limit 1000) x))
    $body$ $f$, s);
  execute format('revoke all on function %I.console_people() from public', s);
  execute format('grant execute on function %I.console_people() to rolematch_console', s);

  -- The schema: every table of the platform's own, with its size, rows, whether row security guards it and how many rules it has, its columns, its
  -- links to other tables and its indexes. Names and types only, never a value.
  execute format($f$
    create or replace function %1$I.console_schema() returns jsonb language sql stable security definer set search_path = %1$I, pg_catalog, pg_temp as $body$
      select coalesce(jsonb_agg(t order by t->>'name'), '[]'::jsonb) from (
        select jsonb_build_object(
          'name', c.relname,
          'rows', coalesce(st.n_live_tup, 0), 'bytes', pg_total_relation_size(c.oid),
          'rowSecurity', c.relrowsecurity,
          'policies', (select count(*) from pg_policy p where p.polrelid = c.oid),
          'indexes', (select count(*) from pg_index i where i.indrelid = c.oid),
          'columns', (select coalesce(jsonb_agg(jsonb_build_object('name', a.attname, 'type', format_type(a.atttypid, a.atttypmod), 'nullable', not a.attnotnull,
                        'hasDefault', a.atthasdef, 'key', exists (select 1 from pg_index i where i.indrelid = c.oid and i.indisprimary and a.attnum = any (i.indkey))) order by a.attnum), '[]'::jsonb)
                      from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped),
          'links', (select coalesce(jsonb_agg(jsonb_build_object('to', f.relname, 'columns', (select string_agg(a.attname, ', ') from pg_attribute a where a.attrelid = c.oid and a.attnum = any (k.conkey)))), '[]'::jsonb)
                    from pg_constraint k join pg_class f on f.oid = k.confrelid where k.conrelid = c.oid and k.contype = 'f')) as t
        from pg_class c join pg_namespace n on n.oid = c.relnamespace left join pg_stat_user_tables st on st.relid = c.oid
        where n.nspname = %1$L and c.relkind in ('r', 'p')) x
    $body$ $f$, s);
  execute format('revoke all on function %I.console_schema() from public', s);
  execute format('grant execute on function %I.console_schema() to rolematch_console', s);

  -- The AI: this month's spend and calls by purpose, by model and by organisation, and how many calls were answered, refused or failed.
  execute format($f$
    create or replace function %1$I.console_ai() returns jsonb language sql stable security definer set search_path = %1$I, pg_catalog, pg_temp as $body$
      with m as (select * from ai_usage where at >= date_trunc('month', now() at time zone 'Africa/Johannesburg') at time zone 'Africa/Johannesburg')
      select jsonb_build_object(
        'month', to_char(now() at time zone 'Africa/Johannesburg', 'YYYY-MM'),
        'microUsd', (select coalesce(sum(cost_micro_usd), 0) from m), 'calls', (select count(*) from m),
        'inputTokens', (select coalesce(sum(input_tokens), 0) from m), 'outputTokens', (select coalesce(sum(output_tokens), 0) from m),
        'outcomes', (select coalesce(jsonb_object_agg(outcome, n), '{}'::jsonb) from (select outcome, count(*) n from m group by outcome) x),
        'byPurpose', (select coalesce(jsonb_agg(jsonb_build_object('name', purpose, 'microUsd', u, 'calls', n) order by u desc), '[]'::jsonb) from (select purpose, sum(cost_micro_usd) u, count(*) n from m group by purpose) x),
        'byModel', (select coalesce(jsonb_agg(jsonb_build_object('name', model, 'microUsd', u, 'calls', n) order by u desc), '[]'::jsonb) from (select model, sum(cost_micro_usd) u, count(*) n from m group by model) x),
        'byOrganisation', (select coalesce(jsonb_agg(jsonb_build_object('name', coalesce(g.name, 'The platform itself'), 'microUsd', u, 'calls', n) order by u desc), '[]'::jsonb)
                           from (select org_id, sum(cost_micro_usd) u, count(*) n from m group by org_id) x left join orgs g on g.id = x.org_id))
    $body$ $f$, s);
  execute format('revoke all on function %I.console_ai() from public', s);
  execute format('grant execute on function %I.console_ai() to rolematch_console', s);
end $$;
