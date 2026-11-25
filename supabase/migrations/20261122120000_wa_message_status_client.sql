-- Win-back messages in wa_message_status: who they went to.
--
-- A reminder points at its appointment; a win-back message has no appointment, so
-- until now its delivery status was stored with no business, no purpose and no
-- recipient (the row is created by fn_record_wa_status when Meta reports a status).
-- whatsapp-service now records the client a win-back message was sent to.
--
-- Additive only: a nullable column, a new allowed purpose, an index. Existing rows
-- and the forward-only status functions are untouched.
-- Spec: docs/specs/modulo-notificaciones/manifest.md §8, modulo-retencion §7.1.

alter table public.wa_message_status
  add column if not exists client_id uuid references public.clients(id) on delete set null;

alter table public.wa_message_status drop constraint if exists wa_message_status_purpose_check;
alter table public.wa_message_status
  add constraint wa_message_status_purpose_check
  check (purpose in ('client_reminder', 'owner_alert', 'owner_summary', 'client_winback'));

create index if not exists idx_wa_message_status_client
  on public.wa_message_status (client_id) where client_id is not null;
