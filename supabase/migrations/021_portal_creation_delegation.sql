-- Portal creation: organisation administrators always may; they can explicitly delegate it to a named member. Additive; default is "not delegated".
-- The right is read from the database at the moment a portal is created (never from a cached session), so a revocation takes effect at once.
alter table members add column if not exists can_create_portals boolean not null default false;
