-- Indexes for many organisations with many records each. Every query is scoped by org_id, so every index starts with it.
create index if not exists candidates_org_created on candidates (org_id, created_at desc);
create index if not exists jobs_org_created on jobs (org_id, created_at desc);
create index if not exists documents_org_status on documents (org_id, status, created_at desc);
create index if not exists documents_org_created on documents (org_id, created_at desc);
create index if not exists matches_org_candidate on matches (org_id, candidate_id, created_at desc);
create index if not exists matches_org_job on matches (org_id, job_id, created_at desc);
create index if not exists members_org on members (org_id);
create index if not exists queue_claim on queue (status, run_after, created_at);
