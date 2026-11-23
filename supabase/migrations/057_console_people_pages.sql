-- Code review, 16 Nov 2026, D-M3: console_people() listed at most 1,000 accounts, an arbitrary 1,000 (the limit came before the order), and the owner's
-- actions found a person only inside that list. Past 1,000 accounts most people could not be opened, blocked, signed out or deleted from the console
-- ("No such person"), and the People page showed a partial, changing set. The owner's target is 5,000 to 30,000 people.
--
-- Now: console_person(id) reads one person, whoever they are, for their page and for every action on them; and console_people(page) lists everyone a page
-- of 500 at a time, most recently active first (then most recently signed in, then newest), ordered before the page is cut, with the total and the page.
-- The counts at the top are unchanged. Security definer, callable by rolematch_console alone, as before.
do $$
declare s text := current_schema();
begin
  execute format($f$
    create or replace function %1$I.console_person(p_id uuid) returns jsonb language sql stable security definer set search_path = %1$I, auth, pg_catalog, pg_temp as $body$
      select jsonb_build_object('id', m.user_id, 'orgId', m.org_id, 'name', m.name, 'email', u.email, 'organisation', g.name, 'role', m.role,
          'portals', (select count(*) from portal_members pm where pm.user_id = m.user_id), 'joined', m.created_at, 'lastSignIn', u.last_sign_in_at,
          'lastSeen', (select max(pm.last_seen_at) from portal_members pm where pm.user_id = m.user_id),
          'blocked', coalesce(u.banned_until > now(), false),
          'confirmed', u.email_confirmed_at is not null, 'left', m.left_at)
        from members m join orgs g on g.id = m.org_id left join auth.users u on u.id = m.user_id where m.user_id = p_id
    $body$ $f$, s);
  execute format('revoke all on function %I.console_person(uuid) from public', s);
  execute format('grant execute on function %I.console_person(uuid) to rolematch_console', s);
  execute format('comment on function %I.console_person(uuid) is %L', s,
    'One account for the owner''s console: who, where, role, portals, when joined, last signed in, last active, blocked, confirmed, left. Null if there is no such member.');

  -- The old one takes no page; a call without one now means the first page.
  execute format('drop function if exists %I.console_people()', s);
  execute format($f$
    create or replace function %1$I.console_people(p_page integer default 1) returns jsonb language sql stable security definer set search_path = %1$I, auth, pg_catalog, pg_temp as $body$
      with everyone as (
        select m.user_id, m.created_at, u.last_sign_in_at, (select max(pm.last_seen_at) from portal_members pm where pm.user_id = m.user_id) as last_seen
        from members m left join auth.users u on u.id = m.user_id),
      shown as (
        select user_id, row_number() over (order by last_seen desc nulls last, last_sign_in_at desc nulls last, created_at desc, user_id) as n
        from everyone order by n limit 500 offset (greatest(coalesce(p_page, 1), 1) - 1) * 500)
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
        'total', (select count(*) from members), 'page', greatest(coalesce(p_page, 1), 1), 'pageSize', 500,
        'people', (select coalesce(jsonb_agg(console_person(user_id) order by n), '[]'::jsonb) from shown))
    $body$ $f$, s);
  execute format('revoke all on function %I.console_people(integer) from public', s);
  execute format('grant execute on function %I.console_people(integer) to rolematch_console', s);
  execute format('comment on function %I.console_people(integer) is %L', s,
    'The console''s People page: the counts, the total, and one page of 500 accounts, most recently active first (then signed in, then joined). Page 1 when none is given.');
end $$;
