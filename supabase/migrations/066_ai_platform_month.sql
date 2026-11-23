-- The platform's monthly AI budget, held exactly (independent audit, 20 Nov 2026). A company's own allowance was already reserved call by call (055), but
-- the platform-wide budget was checked against a total each process re-read every 30 seconds and never reserved, so calls from several companies or
-- workers starting together could all pass it. The month's total is now kept in one row per Johannesburg month, maintained by the database on every
-- write to ai_usage (so it is always the sum of the rows, however they were written), and a call reserves against it under that row's lock
-- (server/src/ai/claude.ts reserve). A reserved call's row counts as held until it is settled; one never settled stays held, which is what it may have cost.
-- 'uncertain': a call that failed in a way that may still have been charged (it timed out, the connection broke, the AI service failed). It keeps the
-- most it could have cost, recorded apart from what was answered or refused, so it is never counted as free and can be reconciled with the provider.
alter table ai_usage drop constraint if exists ai_usage_outcome_check;
alter table ai_usage add constraint ai_usage_outcome_check check (outcome in ('answered', 'refused', 'failed', 'reserved', 'uncertain'));

create table if not exists ai_platform_month (
  month timestamptz primary key,                 -- the month's first moment in Johannesburg (sast_month_start)
  settled_micro bigint not null default 0,       -- what calls this month cost, or may have cost (uncertain)
  held_micro bigint not null default 0           -- reserved for calls still running
);
comment on table ai_platform_month is 'The platform''s AI spend per Johannesburg month, kept by the trigger on ai_usage; the platform budget is reserved against it.';
-- Platform only: the tenant role reads none of it (row security on, no policy), as ai_usage.
alter table ai_platform_month enable row level security;

create or replace function ai_platform_month_track() returns trigger language plpgsql as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    update ai_platform_month set settled_micro = settled_micro - case when old.outcome = 'reserved' then 0 else old.cost_micro_usd end,
                                 held_micro = held_micro - case when old.outcome = 'reserved' then old.cost_micro_usd else 0 end
      where month = sast_month_start(old.at);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    insert into ai_platform_month (month, settled_micro, held_micro)
      values (sast_month_start(new.at), case when new.outcome = 'reserved' then 0 else new.cost_micro_usd end, case when new.outcome = 'reserved' then new.cost_micro_usd else 0 end)
      on conflict (month) do update set settled_micro = ai_platform_month.settled_micro + excluded.settled_micro, held_micro = ai_platform_month.held_micro + excluded.held_micro;
  end if;
  return null;
end $$;
drop trigger if exists ai_usage_platform_month on ai_usage;
create trigger ai_usage_platform_month after insert or update of outcome, cost_micro_usd, at or delete on ai_usage for each row execute function ai_platform_month_track();

-- The months so far, from the rows themselves; no write to ai_usage can land between the count and the trigger taking over.
lock table ai_usage in share row exclusive mode;
insert into ai_platform_month (month, settled_micro, held_micro)
  select sast_month_start(at), coalesce(sum(cost_micro_usd) filter (where outcome <> 'reserved'), 0), coalesce(sum(cost_micro_usd) filter (where outcome = 'reserved'), 0)
  from ai_usage group by 1
  on conflict (month) do update set settled_micro = excluded.settled_micro, held_micro = excluded.held_micro;
