-- The console's Database page (docs/database/21_PLATFORM_V1.md, B1): how the database itself is doing, for the owner.
-- Security definer, so it may read the statistics views the console role cannot; it returns numbers, times and table names only: never the text of a
-- query, a row, a user name or an address, because a query's text can carry personal data. Callable by rolematch_console alone.
do $$
declare s text := current_schema();
begin
  execute format($f$
    create or replace function %1$I.console_database() returns jsonb language sql stable security definer set search_path = %1$I, pg_catalog, pg_temp as $body$
      select jsonb_build_object(
        'at', now(),
        'version', current_setting('server_version'),
        'sizeBytes', pg_database_size(current_database()),
        'startedAt', pg_postmaster_start_time(),
        'connections', (select count(*) from pg_stat_activity where datname = current_database()),
        'maxConnections', current_setting('max_connections')::int,
        'activeNow', (select count(*) from pg_stat_activity where datname = current_database() and state = 'active' and pid <> pg_backend_pid()),
        'longestActiveSec', (select coalesce(max(extract(epoch from now() - query_start)), 0) from pg_stat_activity
                             where datname = current_database() and state = 'active' and pid <> pg_backend_pid() and backend_type = 'client backend'),
        'idleInTransaction', (select count(*) from pg_stat_activity where datname = current_database() and state like 'idle in transaction%%'),
        'waitingOnLocks', (select count(*) from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'),
        'cacheHitPct', (select round(100.0 * blks_hit / nullif(blks_hit + blks_read, 0), 2) from pg_stat_database where datname = current_database()),
        'deadlocks', (select deadlocks from pg_stat_database where datname = current_database()),
        'archiver', (select jsonb_build_object('archived', archived_count, 'lastArchivedAt', last_archived_time, 'failed', failed_count, 'lastFailedAt', last_failed_time)
                     from pg_stat_archiver),
        'archiveMode', current_setting('archive_mode'),
        'tables', (select coalesce(jsonb_agg(t order by (t->>'bytes')::bigint desc), '[]'::jsonb) from (
                     select jsonb_build_object('name', relname, 'bytes', pg_total_relation_size(relid), 'rows', n_live_tup, 'dead', n_dead_tup,
                                               'lastVacuum', greatest(last_vacuum, last_autovacuum), 'lastAnalyze', greatest(last_analyze, last_autoanalyze)) as t
                     from pg_stat_user_tables where schemaname = %1$L) x),
        'migrations', (select jsonb_build_object('applied', count(*), 'latest', max(name), 'latestAt', max(applied_at)) from schema_migrations),
        'appliedNames', (select coalesce(jsonb_agg(name order by name), '[]'::jsonb) from schema_migrations))
    $body$ $f$, s);
  execute format('revoke all on function %I.console_database() from public', s);
  execute format('grant execute on function %I.console_database() to rolematch_console', s);
end $$;
