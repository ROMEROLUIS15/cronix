-- ─────────────────────────────────────────────────────────────────────────────
-- pgTAP Tests: who receives a win-back message (get_reengageable_clients_rpc)
-- Run via: supabase test db
--
-- Rule (decided by the owner of the product, 2026-11-22): the number of days the
-- business owner chooses is how long a client has gone without a visit. A visit is
-- any past appointment that was not cancelled and not marked as a no-show: if the
-- day came and it was not cancelled, the client was attended. The same number of
-- days is the wait before writing again to a client who still has not come back.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

SELECT plan(14);

INSERT INTO public.businesses (id, name, category, owner_id)
VALUES ('0e000000-0000-0000-0000-0000000000a1', 'Retention test', 'salon', '00000000-0000-0000-0000-000000000001');

INSERT INTO public.clients (id, business_id, name, phone, last_reengaged_at) VALUES
  ('0c000000-0000-0000-0000-000000000001', '0e000000-0000-0000-0000-0000000000a1', 'completed 20d',             '+58400000001', NULL),
  ('0c000000-0000-0000-0000-000000000002', '0e000000-0000-0000-0000-0000000000a1', 'pending past 20d',          '+58400000002', NULL),
  ('0c000000-0000-0000-0000-000000000003', '0e000000-0000-0000-0000-0000000000a1', 'confirmed past 20d',        '+58400000003', NULL),
  ('0c000000-0000-0000-0000-000000000004', '0e000000-0000-0000-0000-0000000000a1', 'completed 10d',             '+58400000004', NULL),
  ('0c000000-0000-0000-0000-000000000005', '0e000000-0000-0000-0000-0000000000a1', 'only cancelled 20d',        '+58400000005', NULL),
  ('0c000000-0000-0000-0000-000000000006', '0e000000-0000-0000-0000-0000000000a1', 'completed 40d + no_show 3d', '+58400000006', NULL),
  ('0c000000-0000-0000-0000-000000000007', '0e000000-0000-0000-0000-0000000000a1', 'completed 40d + pending 3d', '+58400000007', NULL),
  ('0c000000-0000-0000-0000-000000000008', '0e000000-0000-0000-0000-0000000000a1', 'completed 40d, written 10d', '+58400000008', now() - interval '10 days'),
  ('0c000000-0000-0000-0000-000000000009', '0e000000-0000-0000-0000-0000000000a1', 'completed 40d, written 16d', '+58400000009', now() - interval '16 days'),
  ('0c000000-0000-0000-0000-000000000010', '0e000000-0000-0000-0000-0000000000a1', 'completed 40d + future',    '+58400000010', NULL);

INSERT INTO public.appointments (business_id, client_id, start_at, end_at, status)
SELECT '0e000000-0000-0000-0000-0000000000a1', c::uuid, now() - ago, now() - ago + interval '30 minutes', s::appointment_status
FROM (VALUES
  ('0c000000-0000-0000-0000-000000000001', interval '20 days', 'completed'),
  ('0c000000-0000-0000-0000-000000000002', interval '20 days', 'pending'),
  ('0c000000-0000-0000-0000-000000000003', interval '20 days', 'confirmed'),
  ('0c000000-0000-0000-0000-000000000004', interval '10 days', 'completed'),
  ('0c000000-0000-0000-0000-000000000005', interval '20 days', 'cancelled'),
  ('0c000000-0000-0000-0000-000000000006', interval '40 days', 'completed'),
  ('0c000000-0000-0000-0000-000000000006', interval '3 days',  'no_show'),
  ('0c000000-0000-0000-0000-000000000007', interval '40 days', 'completed'),
  ('0c000000-0000-0000-0000-000000000007', interval '3 days',  'pending'),
  ('0c000000-0000-0000-0000-000000000008', interval '40 days', 'completed'),
  ('0c000000-0000-0000-0000-000000000009', interval '40 days', 'completed'),
  ('0c000000-0000-0000-0000-000000000010', interval '40 days', 'completed'),
  ('0c000000-0000-0000-0000-000000000010', interval '-5 days', 'confirmed')
) AS v(c, ago, s);

CREATE TEMP TABLE picked_15 AS
  SELECT name FROM public.get_reengageable_clients_rpc('0e000000-0000-0000-0000-0000000000a1', 15, 15);

-- 1. A visit is any past appointment that was not cancelled or a no-show.
SELECT ok(EXISTS (SELECT 1 FROM picked_15 WHERE name = 'completed 20d'),      'a completed visit 20 days ago qualifies at 15 days');
SELECT ok(EXISTS (SELECT 1 FROM picked_15 WHERE name = 'pending past 20d'),   'a past appointment still pending counts as a visit');
SELECT ok(EXISTS (SELECT 1 FROM picked_15 WHERE name = 'confirmed past 20d'), 'a past appointment still confirmed counts as a visit');
SELECT ok(NOT EXISTS (SELECT 1 FROM picked_15 WHERE name = 'completed 10d'),  'a visit 10 days ago does not qualify at 15 days');
SELECT ok(NOT EXISTS (SELECT 1 FROM picked_15 WHERE name = 'only cancelled 20d'), 'a client with only cancelled appointments never visited');
SELECT ok(EXISTS (SELECT 1 FROM picked_15 WHERE name = 'completed 40d + no_show 3d'), 'a no-show is not a visit: the last visit stays 40 days ago');
SELECT ok(NOT EXISTS (SELECT 1 FROM picked_15 WHERE name = 'completed 40d + pending 3d'), 'an unclosed appointment 3 days ago is the last visit');
SELECT ok(NOT EXISTS (SELECT 1 FROM picked_15 WHERE name = 'completed 40d + future'), 'a client with an upcoming appointment is left out');

-- 2. The wait before writing again is the days passed in, not a fixed value.
SELECT ok(NOT EXISTS (SELECT 1 FROM picked_15 WHERE name = 'completed 40d, written 10d'), 'written 10 days ago: not again before 15 days');
SELECT ok(EXISTS (SELECT 1 FROM picked_15 WHERE name = 'completed 40d, written 16d'), 'written 16 days ago: written again after 15 days');

-- 3. The number of days is whatever the owner chose.
SELECT is(
  (SELECT count(*)::int FROM public.get_reengageable_clients_rpc('0e000000-0000-0000-0000-0000000000a1', 25, 25)),
  1,
  'at 25 days only the client whose last visit was 40 days ago and was not written in 25 days'
);

-- 4. Only the cron (service role) may call it: it returns names and phones of any business.
SELECT ok(NOT has_function_privilege('authenticated', 'public.get_reengageable_clients_rpc(uuid,integer,integer)', 'EXECUTE'), 'a signed-in user cannot call it');
SELECT ok(NOT has_function_privilege('anon', 'public.get_reengageable_clients_rpc(uuid,integer,integer)', 'EXECUTE'), 'an anonymous user cannot call it');
SELECT ok(has_function_privilege('service_role', 'public.get_reengageable_clients_rpc(uuid,integer,integer)', 'EXECUTE'), 'the service role can call it');

SELECT * FROM finish();

ROLLBACK;
