-- Módulo de Retención / Win-back — v1
-- Spec: docs/specs/modulo-retencion/manifest.md
--
-- Añade (aditivo, seguro): frecuencia por defecto del negocio + guard anti-spam
-- por cliente, y el RPC determinista de candidatos a reenganche. Supersede al
-- get_inactive_clients_rpc (60d fijo, LIMIT 5, sin anti-spam, sin excluir
-- citas futuras) — sin callers en la app, se deja morir.

-- ── Columnas v1 ──────────────────────────────────────────────────────────────
alter table public.businesses
  add column if not exists default_attendance_frequency_days integer not null default 30;

alter table public.clients
  add column if not exists last_reengaged_at timestamptz;

comment on column public.businesses.default_attendance_frequency_days is
  'Frecuencia de visita por defecto (días) del negocio — módulo retención v1.';
comment on column public.clients.last_reengaged_at is
  'Último WhatsApp de reenganche enviado — guard anti-spam (módulo retención).';

-- ── RPC: candidatos a reenganche ─────────────────────────────────────────────
-- Candidato = tuvo cita 'completed' pasada hace > frequency_days, SIN cita
-- futura activa, fuera del anti-spam, con teléfono y no borrado. Multi-tenant
-- por business_id. SECURITY DEFINER + search_path '' (convención del repo).
create or replace function public.get_reengageable_clients_rpc(
  biz_id          uuid,
  frequency_days  integer,
  antispam_days   integer
)
returns table(
  id                uuid,
  name              text,
  phone             text,
  last_visit_at     timestamptz,
  last_completed_at timestamptz
)
language sql
security definer
set search_path = ''
as $$
  select
    c.id, c.name, c.phone, c.last_visit_at,
    max(a.start_at) filter (where a.status = 'completed' and a.start_at < now()) as last_completed_at
  from public.clients c
  join public.appointments a
    on a.client_id = c.id and a.business_id = biz_id
  where c.business_id = biz_id
    and c.deleted_at is null
    and c.phone is not null
    and c.phone <> ''
    and (c.last_reengaged_at is null
         or c.last_reengaged_at < now() - make_interval(days => antispam_days))
    and not exists (
      select 1 from public.appointments f
      where f.client_id  = c.id
        and f.business_id = biz_id
        and f.start_at   > now()
        and f.status in ('pending', 'confirmed')
    )
  group by c.id, c.name, c.phone, c.last_visit_at
  having max(a.start_at) filter (where a.status = 'completed' and a.start_at < now())
         < now() - make_interval(days => frequency_days)
  order by last_completed_at asc nulls last
  limit 100;
$$;

revoke all on function public.get_reengageable_clients_rpc(uuid, integer, integer) from public, anon;
grant execute on function public.get_reengageable_clients_rpc(uuid, integer, integer) to authenticated, service_role;
