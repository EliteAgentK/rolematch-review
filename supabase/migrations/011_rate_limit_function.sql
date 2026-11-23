-- One database call per rate-limit check (the check, the lock that makes it exact under concurrency, and the recording of the attempt),
-- instead of several round trips. Returns the attempts still inside the window, as they were BEFORE this one, and records this one only
-- when it is allowed (the caller works out the same verdict from the returned list).
create or replace function rate_limit_take(p_key text, p_now bigint, p_window bigint, p_limit integer, p_hit boolean)
returns jsonb language plpgsql as $$
declare
  events jsonb;
  total integer;
begin
  perform pg_advisory_xact_lock(hashtext(p_key));
  select coalesce(jsonb_agg(jsonb_build_array(window_start, count) order by window_start), '[]'::jsonb), coalesce(sum(count), 0)
    into events, total from rate_limits where key = p_key and window_start > p_now - p_window;
  if p_hit and total < p_limit then
    insert into rate_limits (key, window_start, count) values (p_key, p_now, 1)
      on conflict (key, window_start) do update set count = rate_limits.count + 1;
  end if;
  return events;
end $$;
