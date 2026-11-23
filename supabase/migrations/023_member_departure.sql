-- Leaving or being removed from an organisation (server/src/team.ts). The membership row is KEPT and marked, never deleted: documents, matches, batches
-- and settings history refer to it, so deleting it would fail for anyone who has done any work and would erase who did what. A marked member has no
-- access (every authority check reads left_at is null) and is never set up again from their old sign-up details. Additive; existing rows stay active.
alter table members add column if not exists left_at timestamptz;
