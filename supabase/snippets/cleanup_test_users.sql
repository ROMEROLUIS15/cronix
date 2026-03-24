-- ============================================================
-- CLEANUP: Eliminar datos de usuarios de prueba
-- Emails: luisromerohernandez70@gmail.com
--         romeroluis.dev@gmail.com
--         lueduar15@gmail.com
--         soportecronix@gmail.com
--
-- Ejecutar en: Supabase Dashboard → SQL Editor
-- ============================================================

DO $$
DECLARE
  _emails   text[] := ARRAY[
    'luisromerohernandez70@gmail.com',
    'romeroluis.dev@gmail.com',
    'lueduar15@gmail.com',
    'soportecronix@gmail.com'
  ];
  _user_ids uuid[];
  _biz_ids  uuid[];
BEGIN

  -- 1. IDs de public.users por email
  SELECT ARRAY_AGG(id) INTO _user_ids
  FROM public.users
  WHERE email = ANY(_emails);

  -- 2. IDs de negocios propios de esos usuarios
  --    (owner_id coincide, o el usuario tiene business_id apuntando a ese negocio)
  SELECT ARRAY_AGG(DISTINCT b.id) INTO _biz_ids
  FROM public.businesses b
  WHERE b.owner_id = ANY(_user_ids)
     OR b.id IN (
         SELECT business_id
         FROM public.users
         WHERE id = ANY(_user_ids)
           AND business_id IS NOT NULL
       );

  RAISE NOTICE 'Usuarios encontrados: %',  _user_ids;
  RAISE NOTICE 'Negocios encontrados: %',  _biz_ids;

  -- 3. Borrar en orden correcto (respetando FK sin CASCADE)
  DELETE FROM public.appointment_reminders WHERE business_id = ANY(_biz_ids);
  DELETE FROM public.transactions           WHERE business_id = ANY(_biz_ids);
  DELETE FROM public.appointments           WHERE business_id = ANY(_biz_ids);
  DELETE FROM public.expenses               WHERE business_id = ANY(_biz_ids);
  DELETE FROM public.services               WHERE business_id = ANY(_biz_ids);
  DELETE FROM public.clients                WHERE business_id = ANY(_biz_ids);

  -- Todos los usuarios de esos negocios (empleados incluidos) + los dueños
  DELETE FROM public.users
  WHERE business_id = ANY(_biz_ids)
     OR id = ANY(_user_ids);

  DELETE FROM public.businesses WHERE id = ANY(_biz_ids);

  -- 4. Eliminar de auth.users (CASCADE borra user_passkeys y passkey_challenges)
  DELETE FROM auth.users WHERE email = ANY(_emails);

  RAISE NOTICE 'Limpieza completada correctamente.';
END;
$$;
