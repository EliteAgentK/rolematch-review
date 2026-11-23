-- The business runs on South African time (code review, 16 Nov 2026, C-M5; G4 in docs/architecture/PLAN_PORTAL_BILLING.md). The database runs on UTC,
-- so a month or a day cut with date_trunc(..., now()) starts two hours late: from 00:00 to 02:00 SAST on the 1st, a company's AI allowance, the Overview's
-- credits, the unusual-activity allowance and the AI bill still counted last month, and activity after 22:00 SAST landed on the next day. These three
-- functions are the one place that says where a Johannesburg day and month begin; the service (server/src/sast.ts) and the console functions use them.
-- South Africa keeps no summer time, so a day there always starts at 00:00 +02:00.

/** The Johannesburg date of a moment (today's, by default). */
create or replace function sast_day(p_at timestamptz default now()) returns date language sql stable set search_path = pg_catalog, pg_temp as $$
  select (p_at at time zone 'Africa/Johannesburg')::date
$$;
/** The moment a Johannesburg date begins. */
create or replace function sast_day_start(p_day date) returns timestamptz language sql stable set search_path = pg_catalog, pg_temp as $$
  select p_day::timestamp at time zone 'Africa/Johannesburg'
$$;
/** The moment the Johannesburg month holding a moment began (this month's, by default). */
create or replace function sast_month_start(p_at timestamptz default now()) returns timestamptz language sql stable set search_path = pg_catalog, pg_temp as $$
  select date_trunc('month', p_at at time zone 'Africa/Johannesburg') at time zone 'Africa/Johannesburg'
$$;
revoke all on function sast_day(timestamptz) from public;
revoke all on function sast_day_start(date) from public;
revoke all on function sast_month_start(timestamptz) from public;
do $$ begin
  if exists (select from pg_roles where rolname = 'rolematch_tenant') then
    execute 'grant execute on function sast_day(timestamptz), sast_day_start(date), sast_month_start(timestamptz) to rolematch_tenant';
  end if;
  if exists (select from pg_roles where rolname = 'rolematch_console') then
    execute 'grant execute on function sast_day(timestamptz), sast_day_start(date), sast_month_start(timestamptz) to rolematch_console';
  end if;
end $$;

-- The two console functions that still cut at UTC, the same as before (035, 050) with Johannesburg's day and month.
do $$
declare s text := current_schema();
begin
  execute format($f$
    create or replace function %1$I.console_overview() returns jsonb language sql stable security definer set search_path = %1$I, pg_temp as $body$
      select jsonb_build_object(
        'organisations', (select count(*) from orgs),
        'people', (select count(*) from members where left_at is null),
        'peopleJoinedToday', (select count(*) from members where created_at >= sast_day_start(sast_day())),
        'organisationsToday', (select count(*) from orgs where created_at >= sast_day_start(sast_day())),
        'documentsPublished24h', (select count(*) from documents where status = 'published' and updated_at >= now() - interval '24 hours'),
        'documentsFailed24h', (select count(*) from documents where status = 'exception' and updated_at >= now() - interval '24 hours'),
        'documentsProcessing', (select count(*) from documents where status = 'processing'),
        'correctionsRecorded24h', (select count(*) from error_register where created_at >= now() - interval '24 hours'),
        'at', now())
    $body$ $f$, s);
  execute format($f$
    create or replace function %1$I.console_company(p_org uuid) returns jsonb language sql stable security definer set search_path = %1$I, pg_catalog, pg_temp as $body$
      select jsonb_build_object('id', g.id, 'name', g.name, 'allowanceUsd', g.ai_monthly_cap_usd,
        'spentMonthMicroUsd', (select coalesce(sum(a.cost_micro_usd), 0) from ai_usage a where a.org_id = g.id and a.at >= sast_month_start()),
        'portals', (select count(*) from portals p where p.org_id = g.id), 'people', (select count(*) from members m where m.org_id = g.id))
      from orgs g where g.id = p_org
    $body$ $f$, s);
end $$;
