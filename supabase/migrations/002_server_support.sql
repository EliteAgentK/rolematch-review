-- Additions found while connecting the server to this schema.
alter table members add column if not exists email text;
alter table queue add column if not exists locked_at timestamptz;
create index if not exists queue_org_running on queue (org_id, status);
