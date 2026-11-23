-- A queued file removal is never lost with the queue row that carried it (code review, 16 Nov 2026, D-M4). Deleting a CV queues the removal of its
-- original file (server/src/deletion.ts, 'delete-object'); deleting the portal or the company in the console then deleted every queue row of the portal,
-- that job included, so the file stayed in private storage for good while the console said its files were gone. Whatever deletes a removal job that
-- has not finished (the console, a cleanup, a person at the database), its path now goes to file_removals first, which the monitor works through
-- until the file is gone (server/src/scripts/monitor.ts). A path already waiting there is not added twice.
do $$
declare s text := current_schema();
begin
  execute format($f$
    create or replace function %1$I.keep_file_removal() returns trigger language plpgsql security definer set search_path = %1$I, pg_catalog, pg_temp as $body$
    begin
      if old.status <> 'done' and coalesce(old.payload->>'path', '') <> '' then
        insert into file_removals (path) values (old.payload->>'path') on conflict (path) do nothing;
      end if;
      return old;
    end $body$ $f$, s);
  execute format('revoke all on function %I.keep_file_removal() from public', s);
end $$;

drop trigger if exists queue_keeps_file_removals on queue;
create trigger queue_keeps_file_removals before delete on queue for each row when (old.type = 'delete-object') execute function keep_file_removal();
