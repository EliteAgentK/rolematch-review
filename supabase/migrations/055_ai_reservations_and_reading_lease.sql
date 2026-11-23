-- Two billing faults found by the code review of 16 Nov 2026 (docs/reports/2026-11-16_CODE_REVIEW.md), fixed in server/src/ai/claude.ts and
-- server/src/aiJobRead.ts. The owner, 16 Nov: "Double billing. This needs to be fixed immediately."
--
-- B-M11: a company's monthly AI allowance was only checked, from a figure up to 30 seconds old, never reserved: twenty calls starting together each saw
-- room for themselves and all went ahead. Each call now writes its row before it is sent, as 'reserved' at the most it can cost, under a lock per company,
-- and the row is settled with what the call really cost once it answers. A reserved row whose call never came back keeps its reserved cost.
alter table ai_usage drop constraint if exists ai_usage_outcome_check;
alter table ai_usage add constraint ai_usage_outcome_check check (outcome in ('answered', 'refused', 'failed', 'reserved'));
create index if not exists ai_usage_reserved on ai_usage (org_id, at) where outcome = 'reserved';

-- B-M8: a job's reading counted as abandoned six minutes after it started, though one reading can take longer, so a second match took it over and paid
-- for it again. The reader now renews a lease while it works; only a reading whose lease has lapsed is taken over.
alter table model_reviews add column if not exists lease_at timestamptz;
comment on column model_reviews.lease_at is 'Renewed every 30 s by the process doing the work; a running review whose lease is more than 2 minutes old has been abandoned and may be taken over.';
