-- Retention for our own sign-in (data-classes.json, src/ownIdentity.ts): an ended session is deleted 90 days after it ended, a code 2 days after it was
-- issued. The deletions run when a session starts or a code is issued, as the other sign-in codes' do; these indexes keep them from reading every row.
create index if not exists identity_sessions_finished on identity_sessions ((coalesce(ended_at, ends_at)));
create index if not exists identity_codes_issued on identity_codes (issued_at);
