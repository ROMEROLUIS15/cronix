-- ============================================================
-- VERIFICACIÓN 3: Constraint de teléfono único por negocio
-- Ejecutar en: Supabase Dashboard → SQL Editor
-- ============================================================

-- A) Verificar que el índice existe
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'clients'
  AND indexname = 'clients_business_phone_unique';

-- B) Verificar que no hay duplicados actuales
SELECT business_id, phone, COUNT(*) AS duplicados
FROM public.clients
WHERE phone IS NOT NULL AND deleted_at IS NULL
GROUP BY business_id, phone
HAVING COUNT(*) > 1;

-- C) Test: intentar insertar un teléfono duplicado (esto DEBE fallar)
-- ⚠️ Descomenta las líneas de abajo para probar.
-- Necesitas un business_id real y un teléfono que ya exista.
--
-- INSERT INTO public.clients (business_id, name, phone)
-- VALUES (
--   (SELECT business_id FROM public.users LIMIT 1),
--   'TEST DUPLICADO',
--   (SELECT phone FROM public.clients WHERE phone IS NOT NULL AND deleted_at IS NULL LIMIT 1)
-- );
-- Si funciona correctamente, dará error:
-- "duplicate key value violates unique constraint clients_business_phone_unique"
