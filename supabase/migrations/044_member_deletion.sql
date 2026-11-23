-- An account can be deleted (owner, 10 Nov 2026: a deleted person "must be gone"; docs/architecture/PLAN_PEOPLE_AND_PORTALS.md). Until now the records
-- a member added referred to them with no rule for deletion, so deleting the sign-in account was refused by the database ("Database error deleting user").
-- From here, when a member goes, the records they added stay with their portal and their reference to the person becomes empty: credited to no one.
-- Nothing else changes: who did what is still in the audit log by account id, which names no one once the member record has gone.
alter table documents drop constraint if exists documents_created_by_fkey,
  alter column created_by drop not null,
  add constraint documents_created_by_fkey foreign key (created_by) references members (user_id) on delete set null;
alter table matches drop constraint if exists matches_created_by_fkey,
  alter column created_by drop not null,
  add constraint matches_created_by_fkey foreign key (created_by) references members (user_id) on delete set null;
alter table upload_batches drop constraint if exists upload_batches_created_by_fkey,
  alter column created_by drop not null,
  add constraint upload_batches_created_by_fkey foreign key (created_by) references members (user_id) on delete set null;
alter table org_settings drop constraint if exists org_settings_updated_by_fkey,
  add constraint org_settings_updated_by_fkey foreign key (updated_by) references members (user_id) on delete set null;
alter table org_settings_history drop constraint if exists org_settings_history_changed_by_fkey,
  add constraint org_settings_history_changed_by_fkey foreign key (changed_by) references members (user_id) on delete set null;
