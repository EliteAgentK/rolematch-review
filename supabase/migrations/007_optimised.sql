-- Large scanned PDFs are re-encoded to a smaller file for speed. The stored file is the smaller one; we record that it happened and how big it was.
alter table documents add column if not exists original_size bigint;
alter table documents add column if not exists optimised boolean not null default false;
