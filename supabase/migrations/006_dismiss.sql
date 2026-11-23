-- A person can clear a rejected-document card for good. The document and its audit trail stay; it is only hidden from the board.
alter table documents add column if not exists dismissed_at timestamptz;
