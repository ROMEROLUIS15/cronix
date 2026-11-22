-- A service's name in English, entered by the business in the dashboard (optional).
--
-- The phone agent says it in a call held in English (phone-agent-api calls/start returns
-- it as `name_en`), and falls back to `name` when it is null. Additive and nullable: no
-- backfill, every existing service keeps working with `name` alone.
--
-- Security: nothing to change. The table-level grants and the row policy `services_all`
-- (business_id = current_business_id()) already cover every column, this one included.

alter table public.services
  add column if not exists name_en text;

-- Same limit the dashboard applies to `name` (CreateServiceSchema, max 100). A blank value
-- is stored as null by the dashboard and read as null by phone-agent-api.
alter table public.services
  drop constraint if exists services_name_en_length;
alter table public.services
  add constraint services_name_en_length check (name_en is null or char_length(name_en) <= 100);
