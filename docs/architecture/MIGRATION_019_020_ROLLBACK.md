# Rollback guidance for migrations 019 (portals) and 020 (shared capacity)

Neither migration deletes or rewrites existing records. Both are intended to be applied only by an explicit `npm run migrate` after approval; starting a server on the shared project does **not** apply them (`AUTO_MIGRATE`, `server/src/config.ts`).

**Before applying to a shared database:** take a backup or point-in-time marker (the dev project has no backup or point-in-time recovery configured; see PRODUCTION_READINESS.md), and run the application version that matches the migration (older application code cannot write portal tables: `portal_id` is NOT NULL).

**Rolling back 020:** drop table `batch_acknowledgements`; drop the columns `reserved_slots`, `reservation_state`, `released_at`, `finished_at`, `parent_batch_id`, `submitted_by_email`, `request_key` from `upload_batches` and `uploaded_by_email` from `documents`; delete the row `020_...` from `schema_migrations`.

**Rolling back 019:** drop the composite foreign keys and unique constraints it adds (`*_portal_org_fk`, `*_id_portal`, `*_document_portal_fk`, `matches_*_portal_fk`, `documents_batch_portal_fk`); restore the policies `own_org` on each portal table (organisation only, as in migration 014/015/018); restore `defect_groups` primary key (`org_id, defect_key`); drop `portal_id` from `documents, candidates, jobs, matches, upload_batches, error_occurrences, defect_groups, error_register, queue, audit_events`; drop tables `portal_invitations, portal_members, portals`; delete the row `019_...` from `schema_migrations`. Data in the original columns is untouched. Anything written to a **second** portal after the migration would be merged into one organisation-wide view by this rollback: roll back only before a second portal is used, or accept that merge.

**What cannot be rolled back:** audit entries and any invitations or memberships created after the migration (they refer to tables being dropped). Exported reports are unaffected.
