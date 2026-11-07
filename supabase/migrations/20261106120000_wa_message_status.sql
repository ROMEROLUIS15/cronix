-- Delivery state of every WhatsApp message the platform sends.
--
-- Until now a reminder was marked 'sent' as soon as Meta accepted the request, and the
-- webhook dropped the status events Meta sends afterwards (sent, delivered, read, failed),
-- so a message Meta accepted but never delivered was invisible. Meta reports those
-- outcomes, with an error code on failure, only through the webhook.
--
-- Written only by Edge Functions with the service role: whatsapp-service when Meta accepts
-- a message, whatsapp-webhook when Meta reports its status.

create table if not exists public.wa_message_status (
  wamid          text primary key,
  business_id    uuid references public.businesses(id) on delete cascade,
  purpose        text check (purpose in ('client_reminder', 'owner_alert', 'owner_summary')),
  appointment_id uuid references public.appointments(id) on delete set null,
  template       text,
  status         text not null default 'accepted'
                 check (status in ('accepted', 'sent', 'delivered', 'read', 'failed')),
  error_code     integer,
  error_title    text,
  accepted_at    timestamptz,
  status_at      timestamptz,
  updated_at     timestamptz not null default now()
);

create index if not exists idx_wa_message_status_business_accepted
  on public.wa_message_status (business_id, accepted_at desc);
create index if not exists idx_wa_message_status_appointment
  on public.wa_message_status (appointment_id) where appointment_id is not null;

alter table public.wa_message_status enable row level security;
revoke all on table public.wa_message_status from public, anon, authenticated;
grant select, insert, update on table public.wa_message_status to service_role;

-- A status only moves forward: Meta does not guarantee the order of its events.
-- 'failed' replaces 'accepted' or 'sent', never 'delivered' or 'read'.
create or replace function public.fn_wa_status_rank(p_status text)
returns integer
language sql
immutable
set search_path = public
as $$
  select case p_status
    when 'accepted'  then 0
    when 'sent'      then 1
    when 'failed'    then 2
    when 'delivered' then 3
    when 'read'      then 4
    else -1
  end
$$;

-- A status event can arrive before whatsapp-service stores the accepted message: the row
-- is created here and whatsapp-service fills in its owner without touching the status.
create or replace function public.fn_record_wa_status(
  p_wamid       text,
  p_status      text,
  p_error_code  integer,
  p_error_title text,
  p_at          timestamptz
)
returns void
language sql
security invoker
set search_path = public
as $$
  insert into public.wa_message_status as m (wamid, status, error_code, error_title, status_at, updated_at)
  values (p_wamid, p_status, p_error_code, p_error_title, p_at, now())
  on conflict (wamid) do update set
    status      = excluded.status,
    error_code  = coalesce(excluded.error_code, m.error_code),
    error_title = coalesce(excluded.error_title, m.error_title),
    status_at   = excluded.status_at,
    updated_at  = now()
  where public.fn_wa_status_rank(excluded.status) > public.fn_wa_status_rank(m.status)
$$;

revoke all on function public.fn_wa_status_rank(text) from public, anon, authenticated;
revoke all on function public.fn_record_wa_status(text, text, integer, text, timestamptz) from public, anon, authenticated;
grant execute on function public.fn_wa_status_rank(text) to service_role;
grant execute on function public.fn_record_wa_status(text, text, integer, text, timestamptz) to service_role;
