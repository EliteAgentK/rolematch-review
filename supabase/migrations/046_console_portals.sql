-- The console's Portals page (owner, 11 Nov 2026: "a page for me to see all the portals that have been created and the email of the administrator, as
-- well as how much usage that portal has been using ... always multi tenancy and portal isolation"). One row per portal, read portal by portal: its
-- company, when and by whom it was made, its administrators' e-mail addresses, its people, CVs, jobs and matches as counts, its AI calls and their cost
-- this month (Johannesburg's calendar month) and in all, its last activity, and its last ten changes of who runs it. Counts, costs, e-mail addresses
-- and the names of portals and companies only: never a CV, a job, a note or a match's reasons.
-- Security definer, callable by rolematch_console alone, as console_overview() and console_people() are: the console's two-step sign-in guards it.
do $$
declare s text := current_schema();
begin
  execute format($f$
    create or replace function %1$I.console_portals() returns jsonb language sql stable security definer set search_path = %1$I, auth, pg_catalog, pg_temp as $body$
      with m as (select (date_trunc('month', now() at time zone 'Africa/Johannesburg') at time zone 'Africa/Johannesburg') as since)
      select coalesce(jsonb_agg(x order by (x->>'aiMicroUsdMonth')::bigint desc, x->>'company', x->>'name'), '[]'::jsonb) from (
        select jsonb_build_object(
          'id', p.id, 'name', p.name, 'company', g.name, 'since', p.created_at,
          'createdBy', (select u.email from auth.users u where u.id = p.created_by),
          'admins', (select coalesce(jsonb_agg(u.email order by pm.created_at), '[]'::jsonb) from portal_members pm join auth.users u on u.id = pm.user_id
                     where pm.portal_id = p.id and pm.role = 'admin'),
          'people', (select count(*) from portal_members pm where pm.portal_id = p.id),
          'cvs', (select count(*) from candidates c where c.portal_id = p.id),
          'jobs', (select count(*) from jobs j where j.portal_id = p.id),
          'matches', (select count(*) from matches x where x.portal_id = p.id),
          'aiCallsMonth', (select count(*) from ai_usage a, m where a.portal_id = p.id and a.at >= m.since),
          'aiMicroUsdMonth', (select coalesce(sum(a.cost_micro_usd), 0) from ai_usage a, m where a.portal_id = p.id and a.at >= m.since),
          'aiCallsAll', (select count(*) from ai_usage a where a.portal_id = p.id),
          'aiMicroUsdAll', (select coalesce(sum(a.cost_micro_usd), 0) from ai_usage a where a.portal_id = p.id),
          'byPurposeMonth', (select coalesce(jsonb_object_agg(z.purpose, z.u), '{}'::jsonb) from (select a.purpose, sum(a.cost_micro_usd) u from ai_usage a, m
                             where a.portal_id = p.id and a.at >= m.since group by 1) z),
          'lastActivity', (select max(e.created_at) from audit_events e where e.portal_id = p.id),
          'history', (select coalesce(jsonb_agg(h.v order by h.at desc), '[]'::jsonb) from (
                        select e.created_at as at, jsonb_build_object('at', e.created_at, 'action', e.action, 'by', (select u.email from auth.users u where u.id = e.actor_id)) as v
                        from audit_events e where (e.portal_id = p.id or (e.entity_type = 'portal' and e.entity_id::text = p.id::text))
                          and e.action in ('portal.created', 'portal.admin_appointed', 'portal.member_role_changed', 'portal.member_left', 'portal.member_removed')
                        order by e.created_at desc limit 10) h)
        ) as x
        from portals p join orgs g on g.id = p.org_id) y
    $body$ $f$, s);
  execute format('revoke all on function %I.console_portals() from public', s);
  execute format('grant execute on function %I.console_portals() to rolematch_console', s);
end $$;
