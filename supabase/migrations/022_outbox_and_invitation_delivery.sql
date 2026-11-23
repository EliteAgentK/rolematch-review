-- Durable event delivery (transactional outbox). An event is written in the SAME statement that commits the change it announces, so a crash can never leave
-- an invitation without its e-mail. A dispatcher claims events with "for update skip locked", retries a bounded number of times, and a crashed claim is taken
-- back after a lease. dedupe_key makes writing the same event twice a no-op. Events carry no secrets: an invitation e-mail carries only the invitation id and the
-- link version, and the link itself is rebuilt at send time after re-checking that the invitation is still valid.
create table if not exists outbox (
  id uuid primary key, org_id uuid not null, portal_id uuid not null,
  kind text not null, aggregate_id uuid not null, version integer not null default 1,
  dedupe_key text not null unique,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'previewed', 'skipped', 'expired', 'dead')),
  class text not null default 'invitation', priority smallint not null default 1, expires_at timestamptz,   -- authentication = 0, invitation = 1; an expired message is never sent late
  attempts integer not null default 0, max_attempts integer not null default 5,
  run_after timestamptz not null default now(), locked_at timestamptz,
  last_error text, created_at timestamptz not null default now(), done_at timestamptz,
  foreign key (portal_id, org_id) references portals (id, org_id)
);
create index if not exists outbox_due on outbox (status, priority, run_after);
do $$
declare s text := current_schema();
  both_ text := 'org_id = nullif(current_setting(''app.org_id'', true), '''')::uuid and portal_id = nullif(current_setting(''app.portal_id'', true), '''')::uuid';
begin
  execute format('alter table %I.outbox enable row level security', s);
  execute format('revoke all on %I.outbox from anon, authenticated', s);
  execute format('grant select, insert, update on %I.outbox to rolematch_tenant', s);
  execute format('drop policy if exists own_portal on %I.outbox', s);
  execute format('create policy own_portal on %I.outbox for all to rolematch_tenant using (%s) with check (%s)', s, both_, both_);
end $$;

-- Each invitation records its own e-mail lifecycle. 'accepted' means the mail server ACCEPTED the message; delivery to the inbox is not confirmed (no bounce feedback is connected), and the product says so. Existing invitations were never e-mailed: 'not_sent'.
alter table portal_invitations add column if not exists token_version integer not null default 1;      -- bumped by a resend: the previous link stops working
alter table portal_invitations add column if not exists email_state text not null default 'not_sent' check (email_state in ('not_sent', 'queued', 'accepted', 'previewed', 'failed', 'expired'));
alter table portal_invitations add column if not exists email_attempts integer not null default 0;
alter table portal_invitations add column if not exists email_sent_at timestamptz;
alter table portal_invitations add column if not exists email_last_error text;
alter table portal_invitations add column if not exists resend_count integer not null default 0;

-- One row per SMTP attempt (a retry is a new attempt of the SAME outbox message, never a new invitation). Recipients are stored as a KEYED hash plus their domain, so this
-- operational table holds no readable addresses; the invitation and account tables are where addresses live. Like every table with org_id, it has an own-organisation row rule: an
-- organisation's role may READ its own rows (for an administrator's delivery view) and nothing else; verification attempts carry no organisation and are visible to no tenant.
create table if not exists mail_attempts (
  id uuid primary key, outbox_id uuid references outbox(id) on delete set null, org_id uuid, portal_id uuid,
  class text not null, template text not null, template_version text not null, transport text not null, simulated boolean not null default false,
  recipient_hash text not null, recipient_domain text not null,
  started_at timestamptz not null default now(), finished_at timestamptz,
  outcome text not null default 'attempting' check (outcome in ('attempting', 'accepted', 'temporary_failure', 'permanent_failure', 'uncertain', 'unavailable', 'suppressed', 'cancelled', 'blocked')),
  smtp_code integer, error_class text, message_id text, response text
);
create index if not exists mail_attempts_recent on mail_attempts (started_at);
create table if not exists mail_suppressions (
  recipient_hash text primary key, reason text not null, enhanced_status text, created_at timestamptz not null default now(), expires_at timestamptz not null
);
-- One row per verification code ISSUED. Supabase Auth stays the authority for whether a code is correct and for single use; this row binds the issue time, replacement and consumption
-- to the specific code, so a newer code can never extend an older one's life and an old code is refused as soon as it is replaced. Only a keyed hash of the code is kept, never the code.
create table if not exists signup_challenges (
  id uuid primary key, email text not null, code_hash text not null,
  issued_at timestamptz not null default now(), superseded_at timestamptz, consumed_at timestamptz,
  unique (email, code_hash)
);
do $$
declare s text := current_schema(); t text;
begin
  foreach t in array array['mail_attempts', 'mail_suppressions', 'signup_challenges'] loop
    execute format('alter table %I.%I enable row level security', s, t);
    execute format('revoke all on %I.%I from anon, authenticated, rolematch_tenant', s, t);
  end loop;
  execute format('grant select on %I.mail_attempts to rolematch_tenant', s);
  execute format('drop policy if exists own_org on %I.mail_attempts', s);
  execute format('create policy own_org on %I.mail_attempts for select to rolematch_tenant using (org_id = nullif(current_setting(''app.org_id'', true), '''')::uuid)', s);
end $$;
