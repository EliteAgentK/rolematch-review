-- From the Supabase project's own review, and measured under load: functions fixed to a search path, foreign keys that deletes and joins walk given indexes, and row rules that read the request's tenant once per statement rather than once per row. No rule changes meaning: the isolation tests prove that.
do $$
declare s text := current_schema(); r record; q text; c text;
begin
  execute format('alter function %I.upload_history_immutable() set search_path = %I, pg_temp', s, s);
  execute format('alter function %I.audit_immutable() set search_path = %I, pg_temp', s, s);
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = s and p.proname = 'rate_limit_take' loop
    execute format('alter function %s set search_path = %I, pg_temp', r.sig, s);
  end loop;
  -- one reading of the tenant for the whole statement
  for r in select schemaname, tablename, policyname, qual, with_check from pg_policies where schemaname = s and coalesce(qual, '') || coalesce(with_check, '') like '%current_setting%' loop
    q := regexp_replace(r.qual, $re$\(NULLIF\(current_setting\('app\.(org_id|portal_id)'::text, true\), ''::text\)\)::uuid$re$, $to$(select nullif(current_setting('app.\1', true), '')::uuid)$to$, 'g');
    c := regexp_replace(r.with_check, $re$\(NULLIF\(current_setting\('app\.(org_id|portal_id)'::text, true\), ''::text\)\)::uuid$re$, $to$(select nullif(current_setting('app.\1', true), '')::uuid)$to$, 'g');
    if q is not null then execute format('alter policy %I on %I.%I using (%s)', r.policyname, r.schemaname, r.tablename, q); end if;
    if c is not null then execute format('alter policy %I on %I.%I with check (%s)', r.policyname, r.schemaname, r.tablename, c); end if;
  end loop;
end $$;
create index if not exists candidates_document on candidates (document_id);
create index if not exists jobs_document on jobs (document_id);
create index if not exists matches_candidate on matches (candidate_id);
create index if not exists matches_job on matches (job_id);
create index if not exists documents_batch on documents (batch_id);
create index if not exists model_proposals_review on model_proposals (review_id);
create index if not exists upload_batches_parent on upload_batches (parent_batch_id);
create index if not exists mail_attempts_outbox on mail_attempts (outbox_id);
