-- Any period, on every page of the console (owner, 12 Nov 2026: "I need to see last day, last 24 hours, last 7 days, last 30 days, last 3 months, and
-- then maybe even ... per month ... for every section ... there should be a way to toggle through each"). One function reads what happened between two
-- moments, hour by hour or day by day (Johannesburg's hours and days), against the period before it, and the same for each portal, each organisation, the
-- AI, and people; the console's pages draw whichever period the owner chose (server/src/console/period.ts). Counts, costs and times only, as before.
-- Sign-ins are counted from the sign-in service's own record of each one (auth.audit_log_entries), which exists from the move onto our own sign-in
-- (12 Nov 2026); 'signInsSince' says so, so a page never claims a count it could not make. console_organisations() gains each organisation's id.
do $$
declare s text := current_schema();
begin
  execute format($f$
    create or replace function %1$I.console_period(p_from timestamptz, p_to timestamptz, p_before timestamptz, p_step text) returns jsonb
      language plpgsql stable security definer set search_path = %1$I, auth, pg_catalog, pg_temp as $body$
    declare z constant text := 'Africa/Johannesburg'; v_to timestamptz;
    begin
      if p_step not in ('hour', 'day') then raise exception 'console_period: the step is hour or day'; end if;
      if p_from >= p_to or p_before > p_from or p_to - p_before > interval '800 days' then raise exception 'console_period: the period is not valid'; end if;
      -- A period that ends now ends at the database's own now: the console's clock and the database's may differ by a little, and what happened a moment
      -- ago must never fall outside "the last 24 hours".
      v_to := case when p_to > now() - interval '10 minutes' then greatest(p_to, now()) else p_to end;
      return (
        with b as (
          select g as t from generate_series(date_trunc(p_step, p_from at time zone z), date_trunc(p_step, (v_to - interval '1 microsecond') at time zone z), ('1 ' || p_step)::interval) g
        ),
        cv as (select date_trunc(p_step, x.updated_at at time zone z) t, count(*) n from documents x where x.kind = 'cv' and x.status = 'published' and x.updated_at >= p_from and x.updated_at < v_to group by 1),
        jd as (select date_trunc(p_step, x.updated_at at time zone z) t, count(*) n from documents x where x.kind = 'jd' and x.status = 'published' and x.updated_at >= p_from and x.updated_at < v_to group by 1),
        mt as (select date_trunc(p_step, x.created_at at time zone z) t, count(*) n from matches x where x.created_at >= p_from and x.created_at < v_to group by 1),
        sl as (select date_trunc(p_step, x.created_at at time zone z) t, count(*) n from audit_events x where x.action = 'application.status_changed' and x.detail->>'to' = 'shortlisted' and x.created_at >= p_from and x.created_at < v_to group by 1),
        pe as (select date_trunc(p_step, x.created_at at time zone z) t, count(*) n from members x where x.created_at >= p_from and x.created_at < v_to group by 1),
        ai as (select date_trunc(p_step, x.at at time zone z) t, sum(x.cost_micro_usd) n from ai_usage x where x.at >= p_from and x.at < v_to group by 1),
        u as (select * from ai_usage where at >= p_from and at < v_to),
        logins as (select (l.payload->>'actor_id') as who, l.created_at from auth.audit_log_entries l where l.payload->>'action' = 'login')
        select jsonb_build_object(
          'from', p_from, 'to', v_to, 'before', p_before, 'step', p_step, 'at', now(),
          'since', (select min(created_at) from orgs),
          'signInsSince', (select min(created_at) from logins),
          'series', (select coalesce(jsonb_agg(jsonb_build_object('at', to_char(b.t, 'YYYY-MM-DD"T"HH24:MI'),
              'cvs', coalesce(cv.n, 0), 'jobs', coalesce(jd.n, 0), 'matches', coalesce(mt.n, 0), 'shortlisted', coalesce(sl.n, 0),
              'people', coalesce(pe.n, 0), 'aiMicroUsd', coalesce(ai.n, 0)) order by b.t), '[]'::jsonb)
            from b left join cv on cv.t = b.t left join jd on jd.t = b.t left join mt on mt.t = b.t left join sl on sl.t = b.t left join pe on pe.t = b.t left join ai on ai.t = b.t),
          'previous', jsonb_build_object(
            'cvs', (select count(*) from documents x where x.kind = 'cv' and x.status = 'published' and x.updated_at >= p_before and x.updated_at < p_from),
            'jobs', (select count(*) from documents x where x.kind = 'jd' and x.status = 'published' and x.updated_at >= p_before and x.updated_at < p_from),
            'matches', (select count(*) from matches x where x.created_at >= p_before and x.created_at < p_from),
            'shortlisted', (select count(*) from audit_events x where x.action = 'application.status_changed' and x.detail->>'to' = 'shortlisted' and x.created_at >= p_before and x.created_at < p_from),
            'people', (select count(*) from members x where x.created_at >= p_before and x.created_at < p_from),
            'aiMicroUsd', (select coalesce(sum(x.cost_micro_usd), 0) from ai_usage x where x.at >= p_before and x.at < p_from)),
          -- each portal and each organisation in the period: what was added and what the AI cost
          'byPortal', (select coalesce(jsonb_object_agg(p.id::text, jsonb_build_object(
              'cvs', (select count(*) from documents x where x.portal_id = p.id and x.kind = 'cv' and x.status = 'published' and x.updated_at >= p_from and x.updated_at < v_to),
              'jobs', (select count(*) from documents x where x.portal_id = p.id and x.kind = 'jd' and x.status = 'published' and x.updated_at >= p_from and x.updated_at < v_to),
              'failed', (select count(*) from documents x where x.portal_id = p.id and x.status = 'failed' and x.updated_at >= p_from and x.updated_at < v_to),
              'matches', (select count(*) from matches x where x.portal_id = p.id and x.created_at >= p_from and x.created_at < v_to),
              'aiCalls', (select count(*) from u where u.portal_id = p.id),
              'aiMicroUsd', (select coalesce(sum(u.cost_micro_usd), 0) from u where u.portal_id = p.id))), '{}'::jsonb) from portals p),
          'byOrg', (select coalesce(jsonb_object_agg(g.id::text, jsonb_build_object(
              'cvs', (select count(*) from documents x where x.org_id = g.id and x.kind = 'cv' and x.status = 'published' and x.updated_at >= p_from and x.updated_at < v_to),
              'matches', (select count(*) from matches x where x.org_id = g.id and x.created_at >= p_from and x.created_at < v_to),
              'aiMicroUsd', (select coalesce(sum(u.cost_micro_usd), 0) from u where u.org_id = g.id))), '{}'::jsonb) from orgs g),
          -- the AI in the period, as console_ai() gives it for the month
          'ai', jsonb_build_object(
            'microUsd', (select coalesce(sum(cost_micro_usd), 0) from u), 'calls', (select count(*) from u),
            'inputTokens', (select coalesce(sum(input_tokens), 0) from u), 'outputTokens', (select coalesce(sum(output_tokens), 0) from u),
            'outcomes', (select coalesce(jsonb_object_agg(outcome, k), '{}'::jsonb) from (select outcome, count(*) k from u group by outcome) x),
            'byPurpose', (select coalesce(jsonb_agg(jsonb_build_object('name', purpose, 'microUsd', m, 'calls', k) order by m desc), '[]'::jsonb) from (select purpose, sum(cost_micro_usd) m, count(*) k from u group by purpose) x),
            'byModel', (select coalesce(jsonb_agg(jsonb_build_object('name', model, 'microUsd', m, 'calls', k) order by m desc), '[]'::jsonb) from (select model, sum(cost_micro_usd) m, count(*) k from u group by model) x),
            'byOrganisation', (select coalesce(jsonb_agg(jsonb_build_object('name', coalesce(g.name, 'The platform itself'), 'microUsd', m, 'calls', k) order by m desc), '[]'::jsonb)
                               from (select org_id, sum(cost_micro_usd) m, count(*) k from u group by org_id) x left join orgs g on g.id = x.org_id)),
          -- people in the period: who joined, who signed in (each sign-in, from the sign-in service's record), who joined by invitation
          'people', jsonb_build_object(
            'joined', (select count(*) from members x where x.created_at >= p_from and x.created_at < v_to),
            'signedIn', (select count(distinct who) from logins where created_at >= p_from and created_at < v_to),
            'signIns', (select count(*) from logins where created_at >= p_from and created_at < v_to),
            'invitationsAccepted', (select count(*) from portal_invitations where accepted_at >= p_from and accepted_at < v_to))
        ));
    end $body$ $f$, s);
  execute format('revoke all on function %I.console_period(timestamptz, timestamptz, timestamptz, text) from public', s);
  execute format('grant execute on function %I.console_period(timestamptz, timestamptz, timestamptz, text) to rolematch_console', s);

  -- Each organisation at a glance, as in migration 045, now with its id (the console joins each organisation's figures for the chosen period by it).
  execute format($f$
    create or replace function %1$I.console_organisations() returns jsonb language sql stable security definer set search_path = %1$I, pg_catalog, pg_temp as $body$
      select coalesce(jsonb_agg(o order by (o->>'lastActivity') desc nulls last, o->>'name'), '[]'::jsonb) from (
        select jsonb_build_object(
          'id', g.id, 'name', g.name, 'since', g.created_at,
          'portals', (select count(*) from portals p where p.org_id = g.id),
          'people', (select count(*) from members m where m.org_id = g.id and m.left_at is null),
          'cvs', (select count(*) from candidates c where c.org_id = g.id),
          'jobs', (select count(*) from jobs j where j.org_id = g.id),
          'matches', (select count(*) from matches x where x.org_id = g.id),
          'aiMicroUsdThisMonth', (select coalesce(sum(a.cost_micro_usd), 0) from ai_usage a where a.org_id = g.id and a.at >= date_trunc('month', now() at time zone 'Africa/Johannesburg') at time zone 'Africa/Johannesburg'),
          'lastActivity', (select max(e.created_at) from audit_events e where e.org_id = g.id)) as o
        from orgs g) x
    $body$ $f$, s);
end $$;
