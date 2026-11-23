-- The same file may be in two portals of one organisation: each portal is its own workspace, and portals do not see each other's documents. Uniqueness across the whole organisation crashed the second upload, because the duplicate it collided with is one the request's own row rules cannot see (found by 2,500 people in two portals, register R115).
alter table documents drop constraint if exists documents_org_id_kind_sha256_key;
alter table documents drop constraint if exists documents_portal_kind_sha256;
alter table documents add constraint documents_portal_kind_sha256 unique (portal_id, kind, sha256);
