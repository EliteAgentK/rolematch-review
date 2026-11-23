-- Shared portal capacity: a portal reserves document slots for a WHOLE batch, held until the batch closes (replaces the per-person upload lock).
--
-- A batch's reservation (reserved_slots, state 'held') is taken atomically at admission, before any file is accepted, against the portal's ceiling
-- (PORTAL_SLOTS, 500 to start) summed over every person, document type and batch in the portal. A single upload is a batch of one. Documents finishing does
-- NOT release slots. The reservation is released exactly once, when the whole batch has closed: every admitted document has a recorded end state, nothing
-- can still publish a late result, and the batch is complete, cancelled or abandoned (src/batches.ts finishBatch). Human review never holds it open.
--
-- Existing batches (none on the shared project at the time of writing; any that exist are from testing) are marked released so no phantom reservation exists.
alter table upload_batches add column if not exists reserved_slots integer;
alter table upload_batches add column if not exists reservation_state text not null default 'held' check (reservation_state in ('held', 'released'));
alter table upload_batches add column if not exists released_at timestamptz;
alter table upload_batches add column if not exists finished_at timestamptz;
alter table upload_batches add column if not exists parent_batch_id uuid references upload_batches(id);   -- a manual retry after closure reserves anew, linked to the batch it retries
alter table upload_batches add column if not exists submitted_by_email text not null default '';           -- immutable snapshot at admission
alter table upload_batches add column if not exists request_key text;                                      -- the browser's key for this submission: a repeat reserves nothing new
update upload_batches b set reserved_slots = b.declared_files, reservation_state = 'released', released_at = b.created_at, finished_at = coalesce(b.finished_at, b.created_at),
  submitted_by_email = coalesce((select m.email from members m where m.user_id = b.created_by), '') where b.reserved_slots is null;
alter table upload_batches alter column reserved_slots set not null;
alter table upload_batches add constraint upload_batches_reserved_positive check (reserved_slots > 0);
create unique index if not exists upload_batches_request on upload_batches (portal_id, created_by, request_key) where request_key is not null;
create index if not exists upload_batches_held on upload_batches (portal_id) where reservation_state = 'held';

alter table documents add column if not exists uploaded_by_email text not null default '';   -- immutable snapshot of who uploaded it, at the time

-- Acknowledging a completion summary is per person: one person's acknowledgement changes nothing for anyone else.
create table if not exists batch_acknowledgements (
  batch_id uuid not null, portal_id uuid not null, org_id uuid not null,
  user_id uuid not null references members(user_id) on delete cascade,
  acknowledged_at timestamptz not null default now(),
  primary key (batch_id, user_id),
  foreign key (batch_id, portal_id) references upload_batches (id, portal_id),
  foreign key (portal_id, org_id) references portals (id, org_id)
);
alter table batch_acknowledgements alter column portal_id set default nullif(current_setting('app.portal_id', true), '')::uuid;
do $$
declare s text := current_schema();
  both_ text := 'org_id = nullif(current_setting(''app.org_id'', true), '''')::uuid and portal_id = nullif(current_setting(''app.portal_id'', true), '''')::uuid';
begin
  execute format('alter table %I.batch_acknowledgements enable row level security', s);
  execute format('revoke all on %I.batch_acknowledgements from anon, authenticated', s);
  execute format('grant select, insert, update, delete on %I.batch_acknowledgements to rolematch_tenant', s);
  execute format('drop policy if exists own_portal on %I.batch_acknowledgements', s);
  execute format('create policy own_portal on %I.batch_acknowledgements for all to rolematch_tenant using (%s) with check (%s)', s, both_, both_);
end $$;

-- The admission counter. The truth is the batches themselves (the sum of reserved_slots of held batches); this one row per portal is how a reservation is taken in a
-- SINGLE atomic statement without holding a connection: "add n if it still fits" is one UPDATE that PostgreSQL re-checks after any concurrent change to the row, and
-- the batch is only inserted when it succeeded. A release subtracts in the same statement that releases the batch, so it happens exactly once. The reconciler
-- recomputes the counter from the batches and reports any difference (there should never be one).
create table if not exists portal_capacity (
  portal_id uuid primary key, org_id uuid not null,
  reserved integer not null default 0 check (reserved >= 0),
  foreign key (portal_id, org_id) references portals (id, org_id)
);
insert into portal_capacity (portal_id, org_id, reserved)
  select p.id, p.org_id, coalesce((select sum(b.reserved_slots) from upload_batches b where b.portal_id = p.id and b.reservation_state = 'held'), 0) from portals p
  on conflict do nothing;
do $$
declare s text := current_schema();
  both_ text := 'org_id = nullif(current_setting(''app.org_id'', true), '''')::uuid and portal_id = nullif(current_setting(''app.portal_id'', true), '''')::uuid';
begin
  execute format('alter table %I.portal_capacity enable row level security', s);
  execute format('revoke all on %I.portal_capacity from anon, authenticated', s);
  execute format('grant select, insert, update on %I.portal_capacity to rolematch_tenant', s);
  execute format('drop policy if exists own_portal on %I.portal_capacity', s);
  execute format('create policy own_portal on %I.portal_capacity for all to rolematch_tenant using (%s) with check (%s)', s, both_, both_);
end $$;
