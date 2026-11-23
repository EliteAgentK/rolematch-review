-- History is permanent (register R101). Deleting a candidate or job removes the person's data, so its upload line used to vanish with the document. This keeps a line saying who uploaded it, who deleted it and when,
-- with no name and no file name, so a privacy deletion can still be honoured. Append-only, like the audit log. Additive: old code ignores the table.
create table if not exists upload_history_removed (
  id uuid primary key,   -- the document's id, so the line stays the same line in the history
  org_id uuid not null, portal_id uuid not null,
  kind text not null, uploaded_by text not null default '', uploaded_at timestamptz not null, via_batch boolean not null default false,
  deleted_by text not null default '', deleted_at timestamptz not null default now(),
  foreign key (portal_id, org_id) references portals (id, org_id)
);
create index if not exists upload_history_removed_portal on upload_history_removed (org_id, portal_id, uploaded_at desc);
create or replace function upload_history_immutable() returns trigger language plpgsql as $$ begin raise exception 'upload_history_removed is append-only'; end $$;
drop trigger if exists upload_history_no_change on upload_history_removed;
create trigger upload_history_no_change before update or delete on upload_history_removed for each row execute function upload_history_immutable();
do $$
declare s text := current_schema();
  both_ text := 'org_id = nullif(current_setting(''app.org_id'', true), '''')::uuid and portal_id = nullif(current_setting(''app.portal_id'', true), '''')::uuid';
begin
  execute format('alter table %I.upload_history_removed enable row level security', s);
  execute format('revoke all on %I.upload_history_removed from anon, authenticated', s);
  execute format('grant select, insert on %I.upload_history_removed to rolematch_tenant', s);
  execute format('drop policy if exists own_portal on %I.upload_history_removed', s);
  execute format('create policy own_portal on %I.upload_history_removed for all to rolematch_tenant using (%s) with check (%s)', s, both_, both_);
end $$;
