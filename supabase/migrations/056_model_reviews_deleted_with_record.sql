-- Code review, 16 Nov 2026, A-M9: deleting a candidate or a job left the AI's reviews of it in model_reviews for good. A match's score quotes passages of
-- the CV, and a reading holds what the document said, so a person who asked to be deleted was still in the database. server/src/deletion.ts now removes
-- them in the same transaction as the record. That transaction runs as the portal's own role, which could select, insert and update reviews but not
-- delete them; it may now delete them, within its own portal only (the row rule of migration 024 is unchanged).
do $$
declare s text := current_schema();
begin
  execute format('grant delete on %I.model_reviews to rolematch_tenant', s);
end $$;
