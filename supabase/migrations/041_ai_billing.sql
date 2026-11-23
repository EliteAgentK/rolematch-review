-- AI use billed per portal (owner, 8 Nov 2026: "being able to bill per portal is the key"; "every new organisation needs to come with an isolated bill").
-- 1. Every organisation has its own billing account, opened by the database itself when the organisation is created (and now for every existing one).
-- 2. Every AI call is recorded against that account AND the portal it was for, with the tokens Anthropic counted (cache reads and writes apart, since they
--    are priced apart). A call outside a portal is refused by the server before anything is sent (src/ai/claude.ts), so nothing goes unbilled.
-- 3. Row rules: a company reads only its own account and its own lines; inside a portal, only that portal's lines. Nothing here holds the text of a question.
-- 4. ai_rate: the platform's shared per-minute count of what has been asked of each model, so every server together stays under Anthropic's limits.
create table if not exists billing_accounts (
  org_id uuid primary key references orgs (id) on delete cascade,
  id uuid not null unique default gen_random_uuid(),   -- the account's own number, never reused
  opened_at timestamptz not null default now()
);
insert into billing_accounts (org_id) select id from orgs on conflict (org_id) do nothing;

alter table ai_usage add column if not exists portal_id uuid references portals (id) on delete set null;
alter table ai_usage add column if not exists account_id uuid references billing_accounts (id) on delete set null;
alter table ai_usage add column if not exists cache_read_tokens integer not null default 0 check (cache_read_tokens >= 0);
alter table ai_usage add column if not exists cache_write_tokens integer not null default 0 check (cache_write_tokens >= 0);
create index if not exists ai_usage_portal_month on ai_usage (portal_id, at);
create index if not exists ai_usage_account_month on ai_usage (account_id, at);

create table if not exists ai_rate (
  model text not null,
  minute timestamptz not null,
  requests integer not null default 0,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  primary key (model, minute)
);

do $$
declare s text := current_schema();
  -- Read once per statement, as every row rule is since migration 032.
  own_org text := 'org_id = (select nullif(current_setting(''app.org_id'', true), '''')::uuid)';
  own_lines text := 'org_id = (select nullif(current_setting(''app.org_id'', true), '''')::uuid) and ((select nullif(current_setting(''app.portal_id'', true), '''')) is null or portal_id = (select nullif(current_setting(''app.portal_id'', true), '''')::uuid))';
begin
  -- The account opens with the organisation, in the same transaction: there is never an organisation without one.
  execute format($f$
    create or replace function %1$I.open_billing_account() returns trigger language plpgsql security definer set search_path = %1$I, pg_catalog, pg_temp as $body$
    begin insert into %1$I.billing_accounts (org_id) values (new.id) on conflict (org_id) do nothing; return new; end $body$ $f$, s);
  execute format('revoke all on function %I.open_billing_account() from public', s);
  execute format('drop trigger if exists orgs_open_billing_account on %I.orgs', s);
  execute format('create trigger orgs_open_billing_account after insert on %I.orgs for each row execute function %I.open_billing_account()', s, s);

  execute format('alter table %I.billing_accounts enable row level security', s);
  execute format('revoke all on %I.billing_accounts from anon, authenticated', s);
  execute format('grant select on %I.billing_accounts to rolematch_tenant', s);
  execute format('drop policy if exists own_org on %I.billing_accounts', s);
  execute format('create policy own_org on %I.billing_accounts for select to rolematch_tenant using (%s)', s, own_org);

  -- ai_usage had row security with no policy (platform only). A company now reads its own lines, never writes them: only the platform meters.
  execute format('revoke all on %I.ai_usage from anon, authenticated', s);
  execute format('grant select on %I.ai_usage to rolematch_tenant', s);
  execute format('drop policy if exists own_org on %I.ai_usage', s);
  execute format('create policy own_org on %I.ai_usage for select to rolematch_tenant using (%s)', s, own_lines);

  execute format('alter table %I.ai_rate enable row level security', s);
  execute format('revoke all on %I.ai_rate from anon, authenticated', s);
end $$;

-- The queue takes turns between portals by counting each portal's running jobs; with a thousand portals that count needs its own index.
create index if not exists queue_portal_running on queue (portal_id, status);
-- ...and, to take turns by who was served lately (src/queue.ts), the jobs taken in the last minute.
create index if not exists queue_claimed on queue (locked_at);
-- A saved match waiting on the AI is found by the question it is waiting for (src/aiMatch.ts markPair); only waiting ones are indexed, so the index stays small.
create index if not exists matches_waiting_on_ai on matches ((result->'ai'->>'pair')) where result->'ai'->>'state' = 'pending';
