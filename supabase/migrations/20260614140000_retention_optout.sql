-- Módulo de Retención — Fase 5: opt-out permanente (Meta marketing requirement).
-- Spec: docs/specs/modulo-retencion/manifest.md §8.
-- Aplicada en prod 2026-06-14 (vía MCP); este archivo deja el repo en paridad.

alter table public.clients
  add column if not exists retention_opted_out boolean not null default false;

comment on column public.clients.retention_opted_out is
  'Cliente pidió no recibir reenganches (STOP). Exclusión permanente — módulo retención §8.';

-- Recreate the candidates RPC adding the opt-out exclusion. Identical to v1
-- (20260613150000_retention_v1) except for the `and not c.retention_opted_out`
-- predicate.
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
    and not c.retention_opted_out
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
