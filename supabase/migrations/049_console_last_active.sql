-- When each portal and each person was last active (owner, 12 Nov 2026: "I always need to see when last a portal was active ... like Instagram where it
-- takes 5 minutes of no activity"). Active is having used RoleMatch: portal_members.last_seen_at, which the service sets as a person works (at most every
-- 2 minutes, src/portals.ts). A portal's last active is its most recent person's; someone seen in the last 5 minutes is active now; otherwise the time
-- stands where they stopped until they come back. Times only: never what anyone did. The two console functions are the same as before with these added,
-- and with each row's id, which the owner's actions in the console need (docs/architecture/PLAN_CONSOLE_OPERATIONS.md).
do $$
declare s text := current_schema();
begin
  execute format($f$
    create or replace function %1$I.console_portals() returns jsonb language sql stable security definer set search_path = %1$I, auth, pg_catalog, pg_temp as $body$
      with m as (select (date_trunc('month', now() at time zone 'Africa/Johannesburg') at time zone 'Africa/Johannesburg') as since)
      select coalesce(jsonb_agg(x order by (x->>'aiMicroUsdMonth')::bigint desc, x->>'company', x->>'name'), '[]'::jsonb) from (
        select jsonb_build_object(
          'id', p.id, 'orgId', p.org_id, 'name', p.name, 'company', g.name, 'since', p.created_at,
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
          'lastSeen', (select max(pm.last_seen_at) from portal_members pm where pm.portal_id = p.id),
          'activeNow', (select count(*) from portal_members pm where pm.portal_id = p.id and pm.last_seen_at > now() - interval '5 minutes'),
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

  execute format($f$
    create or replace function %1$I.console_people() returns jsonb language sql stable security definer set search_path = %1$I, auth, pg_catalog, pg_temp as $body$
      select jsonb_build_object(
        'accounts', (select count(*) from auth.users),
        'confirmed', (select count(*) from auth.users where email_confirmed_at is not null),
        'signedIn7d', (select count(*) from auth.users where last_sign_in_at > now() - interval '7 days'),
        'signedIn30d', (select count(*) from auth.users where last_sign_in_at > now() - interval '30 days'),
        'neverSignedIn', (select count(*) from auth.users where last_sign_in_at is null),
        'sessionsActive', (select count(*) from auth.sessions where coalesce(refreshed_at, updated_at, created_at) > now() - interval '1 day'),
        'activeNow', (select count(distinct pm.user_id) from portal_members pm where pm.last_seen_at > now() - interval '5 minutes'),
        'invitationsOpen', (select count(*) from portal_invitations where accepted_at is null and revoked_at is null and expires_at > now()),
        'invitationsLapsed', (select count(*) from portal_invitations where accepted_at is null and revoked_at is null and expires_at <= now()),
        'invitationsAccepted30d', (select count(*) from portal_invitations where accepted_at > now() - interval '30 days'),
        'people', (select coalesce(jsonb_agg(p order by (p->>'lastSeen') desc nulls last, (p->>'lastSignIn') desc nulls last), '[]'::jsonb) from (
          select jsonb_build_object('id', m.user_id, 'orgId', m.org_id, 'name', m.name, 'email', u.email, 'organisation', g.name, 'role', m.role,
            'portals', (select count(*) from portal_members pm where pm.user_id = m.user_id), 'joined', m.created_at, 'lastSignIn', u.last_sign_in_at,
            'lastSeen', (select max(pm.last_seen_at) from portal_members pm where pm.user_id = m.user_id),
            'blocked', coalesce(u.banned_until > now(), false),
            'confirmed', u.email_confirmed_at is not null, 'left', m.left_at) as p
          from members m join orgs g on g.id = m.org_id left join auth.users u on u.id = m.user_id limit 1000) x))
    $body$ $f$, s);
  execute format('revoke all on function %I.console_people() from public', s);
  execute format('grant execute on function %I.console_people() to rolematch_console', s);
end $$;
