-- 016 was applied to the shared dev project (by a server start) before it gained these two columns. Adding them here keeps every database, old or
-- new, on the same shape. Safe to run repeatedly.
alter table upload_batches add column if not exists last_activity_at timestamptz not null default now();   -- last file accepted: the upload-lock lease
alter table upload_batches add column if not exists closed_at timestamptz;                                -- the person dismissed the progress panel
alter table documents add column if not exists batch_id uuid references upload_batches(id);
alter table documents add column if not exists manual_retries integer not null default 0;
create index if not exists documents_batch on documents (org_id, batch_id) where batch_id is not null;
