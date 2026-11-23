-- Every confirmed correction is a chance to learn, under control. The error register keeps doing what it does and now also says what the row is allowed to become. Three scopes: the record, the organisation, and the product. A suspected error is not a label: nothing leaves 'record' scope until a person has verified it, and a row reaching 'general' carries only a reference to a fictional reproduction, so no organisation's document or terms reach anyone else.
alter table error_register
  add column if not exists scope text not null default 'record' check (scope in ('record', 'organisation', 'general')),
  add column if not exists permitted_use text not null default 'this_organisation' check (permitted_use in ('this_organisation', 'evaluation', 'fictional_reproduction_only')),
  add column if not exists component text,
  add column if not exists component_version text,
  add column if not exists evidence_ref jsonb,
  add column if not exists label_provenance text not null default 'person_correction',
  add column if not exists experiment text,
  add column if not exists regression_case text,
  add column if not exists decision text not null default 'pending' check (decision in ('pending', 'promoted', 'rejected')),
  add column if not exists dedupe_key text;
-- A retry or a duplicate upload is one lesson, not several.
create unique index if not exists error_register_one_lesson on error_register (org_id, dedupe_key) where dedupe_key is not null;
-- Something general must say what stands in for the real document, and must have been verified.
alter table error_register drop constraint if exists error_register_general_is_fictional;
alter table error_register add constraint error_register_general_is_fictional check (scope <> 'general' or (status = 'verified' and regression_case is not null and permitted_use = 'fictional_reproduction_only'));
create index if not exists error_register_org_scope on error_register (org_id, scope, status);
