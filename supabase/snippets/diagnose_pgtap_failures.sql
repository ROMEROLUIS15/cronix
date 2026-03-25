-- ─────────────────────────────────────────────────────────────────────────────
-- Diagnostic: identify which pgTAP sections fail and why
-- Single result set — copy/paste ALL of this into the SQL Editor
-- ─────────────────────────────────────────────────────────────────────────────

-- Ensure test data exists
DO $$
DECLARE
  uid_a UUID := '00000000-0000-0000-0000-000000000001';
  uid_b UUID := '00000000-0000-0000-0000-000000000002';
  biz_a UUID := 'aaaaaaaa-0000-0000-0000-000000000001';
  biz_b UUID := 'bbbbbbbb-0000-0000-0000-000000000002';
BEGIN
  INSERT INTO auth.users (id, email, role, aud, created_at, updated_at)
  VALUES
    (uid_a, 'owner_a@test.com', 'authenticated', 'authenticated', NOW(), NOW()),
    (uid_b, 'owner_b@test.com', 'authenticated', 'authenticated', NOW(), NOW())
  ON CONFLICT DO NOTHING;

  INSERT INTO public.businesses (id, name, category, owner_id)
  VALUES
    (biz_a, 'Negocio A', 'salon', uid_a),
    (biz_b, 'Negocio B', 'salon', uid_b)
  ON CONFLICT DO NOTHING;

  INSERT INTO public.users (id, name, email, business_id, role, is_active, status)
  VALUES
    (uid_a, 'Owner A', 'owner_a@test.com', biz_a, 'owner', true, 'active'),
    (uid_b, 'Owner B', 'owner_b@test.com', biz_b, 'owner', true, 'active')
  ON CONFLICT DO NOTHING;
END $$;

-- All diagnostics in one query
SELECT * FROM (

  -- ── RLS enabled on tables ──────────────────────────────────────────────────
  SELECT 'sec1_rls_' || c.relname AS test_name,
         CASE WHEN c.relrowsecurity THEN 'ENABLED' ELSE 'DISABLED' END AS result
  FROM pg_class c
  WHERE c.relname IN ('users','businesses','appointments','clients','appointment_reminders')
    AND c.relnamespace = 'public'::regnamespace

  UNION ALL

  -- ── All policies on key tables (name, cmd, roles) ─────────────────────────
  SELECT 'policy_' || tablename || '_' || policyname AS test_name,
         'cmd=' || cmd || ' roles=' || roles::text AS result
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN ('users','businesses','appointments','clients','appointment_reminders')

  UNION ALL

  -- ── Policy WITH CHECK details for INSERT policies ─────────────────────────
  SELECT 'with_check_' || tablename || '_' || policyname AS test_name,
         COALESCE(with_check, 'NULL') AS result
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN ('users','businesses','appointment_reminders')
    AND cmd = 'INSERT'

  UNION ALL

  -- ── Section 11: exact policy name existence ───────────────────────────────
  SELECT test_name, CASE WHEN EXISTS(
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=t AND policyname=p
  ) THEN 'EXISTS' ELSE 'MISSING' END AS result
  FROM (VALUES
    ('sec11_users_insert',      'users',                  'users_insert'),
    ('sec11_users_update',      'users',                  'users_update'),
    ('sec11_biz_select',        'businesses',             'businesses_select'),
    ('sec11_appt_all',          'appointments',           'appointments_all'),
    ('sec11_reminders_select',  'appointment_reminders',  'reminders_select_own_business')
  ) AS checks(test_name, t, p)

  UNION ALL

  -- ── Section 12: phone uniqueness index ────────────────────────────────────
  SELECT 'sec12_phone_index' AS test_name,
         CASE WHEN EXISTS(
           SELECT 1 FROM pg_indexes WHERE tablename='clients' AND indexname='clients_business_phone_unique'
         ) THEN 'EXISTS' ELSE 'MISSING' END AS result

  UNION ALL

  -- ── Roles exist ───────────────────────────────────────────────────────────
  SELECT 'role_' || r AS test_name,
         CASE WHEN EXISTS(SELECT 1 FROM pg_roles WHERE rolname = r) THEN 'EXISTS' ELSE 'MISSING' END AS result
  FROM (VALUES ('anon'), ('authenticated'), ('service_role')) AS roles(r)

  UNION ALL

  -- ── Test data verification ────────────────────────────────────────────────
  SELECT 'data_test_users' AS test_name,
         (SELECT COUNT(*)::text FROM public.users WHERE id IN ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002')) AS result

  UNION ALL

  SELECT 'data_test_businesses' AS test_name,
         (SELECT COUNT(*)::text FROM public.businesses WHERE id IN ('aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000002')) AS result

) AS diagnostics
ORDER BY test_name;
