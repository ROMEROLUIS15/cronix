-- ─────────────────────────────────────────────────────────────────────────────
-- Test: Does SET ROLE + RLS block INSERTs on remote SQL Editor?
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TEMP TABLE IF NOT EXISTS _test_results (
  test_name TEXT,
  result TEXT
);
TRUNCATE _test_results;

-- Test 1: anon INSERT into users
DO $$
DECLARE
  _result TEXT := 'UNKNOWN';
BEGIN
  SET LOCAL ROLE anon;
  BEGIN
    INSERT INTO public.users (id, name, email, business_id, role, is_active, status)
    VALUES (gen_random_uuid(), 'Hacker', 'h@test.com',
            'aaaaaaaa-0000-0000-0000-000000000001', 'employee', true, 'active');
    _result := 'FAIL — INSERT succeeded (RLS did not block)';
  EXCEPTION
    WHEN insufficient_privilege THEN
      _result := 'PASS — blocked with 42501';
    WHEN OTHERS THEN
      _result := 'ERROR — ' || SQLSTATE || ': ' || SQLERRM;
  END;
  -- Reset BEFORE writing to temp table
  RESET ROLE;
  INSERT INTO _test_results VALUES ('sec2_anon_insert_users', _result);
END $$;

-- Test 2: anon INSERT into businesses
DO $$
DECLARE
  _result TEXT := 'UNKNOWN';
BEGIN
  SET LOCAL ROLE anon;
  BEGIN
    INSERT INTO public.businesses (name, category, owner_id)
    VALUES ('Evil Corp', 'salon', gen_random_uuid());
    _result := 'FAIL — INSERT succeeded (RLS did not block)';
  EXCEPTION
    WHEN insufficient_privilege THEN
      _result := 'PASS — blocked with 42501';
    WHEN OTHERS THEN
      _result := 'ERROR — ' || SQLSTATE || ': ' || SQLERRM;
  END;
  RESET ROLE;
  INSERT INTO _test_results VALUES ('sec2_anon_insert_biz', _result);
END $$;

-- Test 3: authenticated INSERT users with different uid
DO $$
DECLARE
  _result TEXT := 'UNKNOWN';
BEGIN
  SET LOCAL ROLE authenticated;
  SET LOCAL "request.jwt.claims" TO '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
  BEGIN
    INSERT INTO public.users (id, name, email, business_id, role, is_active, status)
    VALUES (
      '00000000-0000-0000-0000-000000000099',
      'Impersonated', 'imp@test.com',
      'aaaaaaaa-0000-0000-0000-000000000001',
      'employee', true, 'active'
    );
    _result := 'FAIL — INSERT succeeded (RLS did not block)';
  EXCEPTION
    WHEN insufficient_privilege THEN
      _result := 'PASS — blocked with 42501';
    WHEN OTHERS THEN
      _result := 'ERROR — ' || SQLSTATE || ': ' || SQLERRM;
  END;
  RESET ROLE;
  INSERT INTO _test_results VALUES ('sec3_auth_diff_uid', _result);
END $$;

-- Test 4: Owner B INSERT reminder for business A
DO $$
DECLARE
  _result TEXT := 'UNKNOWN';
BEGIN
  SET LOCAL ROLE authenticated;
  SET LOCAL "request.jwt.claims" TO '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
  BEGIN
    INSERT INTO public.appointment_reminders
      (appointment_id, business_id, remind_at, minutes_before, status, channel)
    VALUES (
      'dddddddd-0000-0000-0000-000000000001',
      'aaaaaaaa-0000-0000-0000-000000000001',
      NOW() + INTERVAL '1 hour',
      60, 'pending', 'whatsapp'
    );
    _result := 'FAIL — INSERT succeeded (RLS did not block)';
  EXCEPTION
    WHEN insufficient_privilege THEN
      _result := 'PASS — blocked with 42501';
    WHEN OTHERS THEN
      _result := 'ERROR — ' || SQLSTATE || ': ' || SQLERRM;
  END;
  RESET ROLE;
  INSERT INTO _test_results VALUES ('sec9_ownerB_insert_reminder', _result);
END $$;

SELECT * FROM _test_results ORDER BY test_name;
