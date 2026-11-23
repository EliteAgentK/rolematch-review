-- Every call to an outside AI service, metered (owner, 8 Nov 2026: Claude Sonnet 5.5 for matching, Claude Haiku 5.5 for extraction when the parser is unsure;
-- "not too much, that's the key"). One row per call: who it was for, why, which model, how many tokens, what it cost. No text of any question or answer.
-- It is what a company's monthly usage and bill are counted from, and what the monthly spending cap is checked against.
create table if not exists ai_usage (
  id bigint generated always as identity primary key,
  org_id uuid references orgs (id) on delete set null,          -- the organisation the work was for; null for platform work (tests, evaluation)
  purpose text not null check (purpose in ('extraction', 'matching', 'evaluation')),
  provider text not null,                                         -- 'anthropic'
  model text not null,
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  cost_micro_usd bigint not null default 0 check (cost_micro_usd >= 0),   -- millionths of a US dollar, from the provider's own token counts and our price table
  outcome text not null check (outcome in ('answered', 'refused', 'failed')),
  at timestamptz not null default now()
);
create index if not exists ai_usage_month on ai_usage (at);
create index if not exists ai_usage_org_month on ai_usage (org_id, at);

-- Platform only: the tenant role reads none of it (row security on, no policy). A company's own usage is shown to it through the API, counted from here.
alter table ai_usage enable row level security;
