-- ============================================================
-- CLEANUP: Eliminar TODO excepto los 4 usuarios activos
--
-- Usuarios que se CONSERVAN (no se tocan):
--   496b9c96-c226-4df4-ada9-195fccb86984
--   9b707451-4f08-4e4f-98c1-833db7ae9a5c
--   e4bcae35-d47e-4e3b-8606-a510a21c682c
--   e26493f9-ce03-4309-a704-a71739d1e40f
--
-- Ejecutar en: Supabase Dashboard → SQL Editor
-- ============================================================

DO $$
DECLARE
  _safe_ids  uuid[] := ARRAY[
    '496b9c96-c226-4df4-ada9-195fccb86984',
    '9b707451-4f08-4e4f-98c1-833db7ae9a5c',
    'e4bcae35-d47e-4e3b-8606-a510a21c682c',
    'e26493f9-ce03-4309-a704-a71739d1e40f'
  ];
  _safe_biz   uuid[];   -- negocios de los usuarios seguros
  _nuke_biz   uuid[];   -- negocios a eliminar por completo
  _nuke_users uuid[];   -- usuarios a eliminar (en negocios seguros)
  _nuke_emails text[];   -- emails para limpiar auth.users
  _cnt        int;
BEGIN

  -- ── 1. Negocios que pertenecen a los usuarios seguros ──
  SELECT ARRAY_AGG(DISTINCT business_id) INTO _safe_biz
  FROM public.users
  WHERE id = ANY(_safe_ids) AND business_id IS NOT NULL;

  RAISE NOTICE 'Negocios seguros: %', _safe_biz;

  -- ── 2. Negocios que NO tienen ningún usuario seguro → eliminar completo ──
  SELECT ARRAY_AGG(id) INTO _nuke_biz
  FROM public.businesses
  WHERE id != ALL(COALESCE(_safe_biz, '{}'));

  RAISE NOTICE 'Negocios a eliminar: %', _nuke_biz;

  -- ── 3. Eliminar datos de negocios descartables (orden FK) ──
  IF _nuke_biz IS NOT NULL AND array_length(_nuke_biz, 1) > 0 THEN
    DELETE FROM public.appointment_reminders WHERE business_id = ANY(_nuke_biz);
    GET DIAGNOSTICS _cnt = ROW_COUNT; RAISE NOTICE 'appointment_reminders eliminados (biz nuke): %', _cnt;

    DELETE FROM public.transactions WHERE business_id = ANY(_nuke_biz);
    GET DIAGNOSTICS _cnt = ROW_COUNT; RAISE NOTICE 'transactions eliminados (biz nuke): %', _cnt;

    DELETE FROM public.appointments WHERE business_id = ANY(_nuke_biz);
    GET DIAGNOSTICS _cnt = ROW_COUNT; RAISE NOTICE 'appointments eliminados (biz nuke): %', _cnt;

    DELETE FROM public.expenses WHERE business_id = ANY(_nuke_biz);
    GET DIAGNOSTICS _cnt = ROW_COUNT; RAISE NOTICE 'expenses eliminados (biz nuke): %', _cnt;

    DELETE FROM public.services WHERE business_id = ANY(_nuke_biz);
    GET DIAGNOSTICS _cnt = ROW_COUNT; RAISE NOTICE 'services eliminados (biz nuke): %', _cnt;

    DELETE FROM public.clients WHERE business_id = ANY(_nuke_biz);
    GET DIAGNOSTICS _cnt = ROW_COUNT; RAISE NOTICE 'clients eliminados (biz nuke): %', _cnt;

    -- Recoger emails antes de borrar users
    SELECT ARRAY_AGG(email) INTO _nuke_emails
    FROM public.users
    WHERE business_id = ANY(_nuke_biz) AND id != ALL(_safe_ids);

    DELETE FROM public.users WHERE business_id = ANY(_nuke_biz) AND id != ALL(_safe_ids);
    GET DIAGNOSTICS _cnt = ROW_COUNT; RAISE NOTICE 'users eliminados (biz nuke): %', _cnt;

    DELETE FROM public.businesses WHERE id = ANY(_nuke_biz);
    GET DIAGNOSTICS _cnt = ROW_COUNT; RAISE NOTICE 'businesses eliminados: %', _cnt;
  END IF;

  -- ── 4. Usuarios sobrantes en negocios seguros (empleados que no son los 4) ──
  SELECT ARRAY_AGG(id) INTO _nuke_users
  FROM public.users
  WHERE id != ALL(_safe_ids);

  IF _nuke_users IS NOT NULL AND array_length(_nuke_users, 1) > 0 THEN
    RAISE NOTICE 'Usuarios extra a eliminar de negocios seguros: %', _nuke_users;

    -- Recoger sus emails
    SELECT ARRAY_AGG(email) INTO _nuke_emails
    FROM (
      SELECT email FROM public.users WHERE id = ANY(_nuke_users) AND email IS NOT NULL
      UNION
      SELECT unnest(COALESCE(_nuke_emails, '{}'))
    ) combined;

    -- Desasociar citas asignadas a estos usuarios (poner NULL, no borrar la cita)
    UPDATE public.appointments SET assigned_user_id = NULL
    WHERE assigned_user_id = ANY(_nuke_users);
    GET DIAGNOSTICS _cnt = ROW_COUNT; RAISE NOTICE 'appointments reasignados (assigned_user_id → NULL): %', _cnt;

    -- Desasociar gastos creados por estos usuarios
    UPDATE public.expenses SET created_by = NULL
    WHERE created_by = ANY(_nuke_users);
    GET DIAGNOSTICS _cnt = ROW_COUNT; RAISE NOTICE 'expenses reasignados (created_by → NULL): %', _cnt;

    DELETE FROM public.users WHERE id = ANY(_nuke_users);
    GET DIAGNOSTICS _cnt = ROW_COUNT; RAISE NOTICE 'users eliminados (extras en biz seguro): %', _cnt;
  END IF;

  -- ── 5. Limpiar auth.users (CASCADE borra passkeys y challenges) ──
  IF _nuke_emails IS NOT NULL AND array_length(_nuke_emails, 1) > 0 THEN
    RAISE NOTICE 'Emails auth a eliminar: %', _nuke_emails;

    DELETE FROM auth.users
    WHERE email = ANY(_nuke_emails);
    GET DIAGNOSTICS _cnt = ROW_COUNT; RAISE NOTICE 'auth.users eliminados: %', _cnt;
  ELSE
    -- Fallback: borrar cualquier auth.users que no tenga usuario en public.users
    DELETE FROM auth.users
    WHERE id NOT IN (SELECT id FROM public.users);
    GET DIAGNOSTICS _cnt = ROW_COUNT; RAISE NOTICE 'auth.users huérfanos eliminados: %', _cnt;
  END IF;

  RAISE NOTICE '✅ Limpieza completada. Solo quedan los 4 usuarios activos.';
END;
$$;
