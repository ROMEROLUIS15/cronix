-- Win-back: who has gone N days without a visit, with N chosen by the owner.
--
-- Decided by the product owner on 2026-11-22:
--   * A visit is any past appointment that was not cancelled and not marked as a
--     no-show. If the day came and it was not cancelled, the client was attended;
--     owners do not close every appointment by hand. Before, only 'completed'
--     counted, and the dashboard turned expired appointments into 'completed' only
--     when the owner opened it, so who received the message depended on that.
--   * The same N is the wait before writing again (passed as antispam_days by the
--     use case); nothing is fixed at 30 days any more.
--
-- Security: the function is SECURITY DEFINER, takes any business id and returns
-- client names and phones, and it was executable by every signed-in user. Its only
-- caller is the win-back cron with the service role, so only that role keeps it.
--
-- Same signature and return columns (last_completed_at keeps its name and now
-- holds the last visit), so CREATE OR REPLACE replaces it instead of adding an
-- overload. Spec: docs/specs/modulo-retencion/manifest.md §2, §3, §4.

create or replace function public.get_reengageable_clients_rpc(
  biz_id         uuid,
  frequency_days integer,
  antispam_days  integer
)
returns table (
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
    max(a.start_at) filter (
      where a.start_at < now() and a.status not in ('cancelled', 'no_show')
    ) as last_completed_at
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
  having max(a.start_at) filter (
           where a.start_at < now() and a.status not in ('cancelled', 'no_show')
         ) < now() - make_interval(days => frequency_days)
  order by last_completed_at asc nulls last
  limit 100;
$$;

revoke all on function public.get_reengageable_clients_rpc(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.get_reengageable_clients_rpc(uuid, integer, integer) to service_role;
