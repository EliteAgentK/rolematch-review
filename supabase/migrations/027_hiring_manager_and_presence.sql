-- Owner's decision, 2026-11-05: the read-only role is the Hiring manager / HR, who sees only shortlisted candidates (server/src/hiringManager.ts). The name "viewer" goes completely.
-- Anyone who held it keeps the same read-only rights, narrowed to the shortlist. No account gains access.
-- Also: when someone was last in each portal, so the team can see who is in there. One time per person and portal, overwritten: never a trail of their movements.
alter table members drop constraint if exists members_role_check;
alter table portal_members drop constraint if exists portal_members_role_check;
alter table portal_invitations drop constraint if exists portal_invitations_role_check;
update members set role = 'hiring_manager' where role = 'viewer';
update portal_members set role = 'hiring_manager' where role = 'viewer';
update portal_invitations set role = 'hiring_manager' where role = 'viewer';
alter table members add constraint members_role_check check (role in ('admin', 'recruiter', 'hiring_manager'));
alter table portal_members add constraint portal_members_role_check check (role in ('admin', 'recruiter', 'hiring_manager'));
alter table portal_invitations add constraint portal_invitations_role_check check (role in ('admin', 'recruiter', 'hiring_manager'));
alter table portal_members add column if not exists last_seen_at timestamptz;
-- The activity list reads the newest lines of one portal or organisation: these keep that fast however long the log grows.
drop index if exists audit_events_portal;
create index if not exists audit_portal_time on audit_events (portal_id, created_at desc);
create index if not exists audit_org_time on audit_events (org_id, created_at desc);
