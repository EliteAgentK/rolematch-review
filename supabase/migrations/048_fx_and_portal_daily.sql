-- Two platform tables (docs/architecture/PLAN_CONSOLE_OPERATIONS.md):
--
-- fx_rates: the rand per US dollar for each day (owner, 12 Nov 2026: "the portals need to show in rands ... always be making that conversion. Always be
-- paying attention to the fluctuating exchange rates"). The AI is bought in dollars; each AI usage line is shown to a company in rands at the rate of its
-- own day, never a fixed rate (a fixed 18.5 overstated rands by about 12% on 12 Nov 2026, when the rate was 16.56). The rate is the European Central
-- Bank's reference rate, published each working day; a weekend or holiday keeps the last published one. Filled by the monitor (src/fx.ts).
--
-- portal_daily: one row per portal per day of what happened in it, so the console reads about a thousand rows a day at a thousand portals rather than
-- every action (owner, 12 Nov 2026: "we, as a system and a console, we just need to know what's going on in each portal"). Counts and cost only, never
-- what a record holds. Refreshed for today and yesterday every few minutes by the monitor (refresh_portal_daily). Days are Johannesburg's.
create table if not exists fx_rates (
  day date primary key,
  usd_zar numeric(12, 6) not null check (usd_zar > 0),
  published date not null,
  source text not null,
  fetched_at timestamptz not null default now()
);
alter table fx_rates enable row level security;
drop policy if exists fx_rates_read on fx_rates;
create policy fx_rates_read on fx_rates for select using (true);

/** The rate for a day: that day's, or the last one before it, or the first ever kept (a day before rates were kept). Null only while none is kept. */
create or replace function usd_zar_on(p_day date) returns numeric language sql stable security definer set search_path from current as $$
  select coalesce((select usd_zar from fx_rates where day <= p_day order by day desc limit 1), (select usd_zar from fx_rates order by day asc limit 1))
$$;

create table if not exists portal_daily (
  portal_id uuid not null references portals (id) on delete cascade,
  org_id uuid not null references orgs (id) on delete cascade,
  day date not null,
  cvs integer not null default 0,
  jobs integer not null default 0,
  matches integer not null default 0,
  shortlisted integer not null default 0,
  failed integer not null default 0,
  ai_calls integer not null default 0,
  ai_micro_usd bigint not null default 0,
  refreshed_at timestamptz not null default now(),
  primary key (portal_id, day)
);
create index if not exists portal_daily_day on portal_daily (day);
alter table portal_daily enable row level security;

/** Counts every portal's days from p_from to today again, from the records themselves, and writes them: run again, it gives the same rows. */
create or replace function refresh_portal_daily(p_from date) returns integer language plpgsql security definer set search_path from current as $$
declare n integer;
begin
  with zone as (select p_from as since, (p_from::timestamp at time zone 'Africa/Johannesburg') as since_at),
  ev as (
    select d.portal_id, d.org_id, (d.updated_at at time zone 'Africa/Johannesburg')::date as day,
           count(*) filter (where d.kind = 'cv' and d.status = 'published') as cvs, count(*) filter (where d.kind = 'jd' and d.status = 'published') as jobs,
           0 as matches, 0 as shortlisted, count(*) filter (where d.status = 'failed') as failed, 0 as ai_calls, 0::bigint as ai_micro_usd
      from documents d, zone where d.portal_id is not null and d.updated_at >= zone.since_at group by 1, 2, 3
    union all
    select m.portal_id, m.org_id, (m.created_at at time zone 'Africa/Johannesburg')::date, 0, 0, count(*), 0, 0, 0, 0
      from matches m, zone where m.portal_id is not null and m.created_at >= zone.since_at group by 1, 2, 3
    union all
    select e.portal_id, e.org_id, (e.created_at at time zone 'Africa/Johannesburg')::date, 0, 0, 0, count(*), 0, 0, 0
      from audit_events e, zone where e.portal_id is not null and e.action = 'application.status_changed' and e.detail->>'to' = 'shortlisted' and e.created_at >= zone.since_at group by 1, 2, 3
    union all
    select a.portal_id, a.org_id, (a.at at time zone 'Africa/Johannesburg')::date, 0, 0, 0, 0, 0, count(*) filter (where a.outcome = 'answered'), sum(a.cost_micro_usd)
      from ai_usage a, zone where a.portal_id is not null and a.at >= zone.since_at group by 1, 2, 3
  ),
  days as (
    select ev.portal_id, ev.org_id, ev.day, sum(cvs)::int as cvs, sum(jobs)::int as jobs, sum(matches)::int as matches, sum(shortlisted)::int as shortlisted,
           sum(failed)::int as failed, sum(ai_calls)::int as ai_calls, sum(ai_micro_usd)::bigint as ai_micro_usd
      from ev join portals p on p.id = ev.portal_id group by 1, 2, 3
  ),
  gone as (delete from portal_daily using zone where portal_daily.day >= zone.since and not exists (select 1 from days where days.portal_id = portal_daily.portal_id and days.day = portal_daily.day))
  insert into portal_daily (portal_id, org_id, day, cvs, jobs, matches, shortlisted, failed, ai_calls, ai_micro_usd, refreshed_at)
    select portal_id, org_id, day, cvs, jobs, matches, shortlisted, failed, ai_calls, ai_micro_usd, now() from days
  on conflict (portal_id, day) do update set cvs = excluded.cvs, jobs = excluded.jobs, matches = excluded.matches, shortlisted = excluded.shortlisted,
    failed = excluded.failed, ai_calls = excluded.ai_calls, ai_micro_usd = excluded.ai_micro_usd, refreshed_at = now();
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function refresh_portal_daily(date) from public;

-- The console reads both through its own role (it may read the totals, never the records behind them).
do $$ begin
  if exists (select from pg_roles where rolname = 'rolematch_console') then
    execute 'grant select on fx_rates, portal_daily to rolematch_console';
    execute 'drop policy if exists portal_daily_console on portal_daily';
    execute 'create policy portal_daily_console on portal_daily for select to rolematch_console using (true)';
  end if;
  if exists (select from pg_roles where rolname = 'rolematch_tenant') then
    -- A company may read its own portal's totals, as it reads its own records; never another's (test/tenant-separation.test.ts).
    execute 'grant select on portal_daily to rolematch_tenant';
    execute 'drop policy if exists own_portal on portal_daily';
    execute 'create policy own_portal on portal_daily for select to rolematch_tenant using (org_id = (select nullif(current_setting(''app.org_id'', true), '''')::uuid) and portal_id = (select nullif(current_setting(''app.portal_id'', true), '''')::uuid))';
    execute 'grant execute on function usd_zar_on(date) to rolematch_tenant';
  end if;
end $$;
