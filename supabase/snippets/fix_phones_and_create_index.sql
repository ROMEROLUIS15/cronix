-- ============================================================
-- FIX: Normalizar teléfonos existentes + crear índice único
--
-- Problemas encontrados:
--   1. Doble dial code: "+58 +58 424-7616594"
--   2. Guiones en números: "+58 424-7840667"
--   3. Duplicados por formato inconsistente
--
-- Ejecutar en: Supabase Dashboard → SQL Editor
-- ============================================================

DO $$
DECLARE
  _cnt int;
BEGIN

  -- ── 1. Normalizar teléfonos: quitar guiones, puntos, paréntesis ──
  UPDATE public.clients
  SET phone = regexp_replace(
    phone,
    '(\+\d+)\s+(.+)',                         -- grupo1=dial, grupo2=local
    '\1 ' || regexp_replace(                   -- dial + espacio + local limpio
      substring(phone from '\+\d+\s+(.+)'),   -- extraer local
      '[-.()\s]+', '', 'g'                     -- quitar guiones/espacios/puntos
    )
  )
  WHERE phone IS NOT NULL
    AND phone ~ '[-.()\s]{2,}|[-.]';          -- solo los que tienen basura
  GET DIAGNOSTICS _cnt = ROW_COUNT;
  RAISE NOTICE 'Teléfonos normalizados (guiones/espacios): %', _cnt;

  -- ── 2. Arreglar doble dial code: "+58 +58 424..." → "+58 424..." ──
  UPDATE public.clients
  SET phone = regexp_replace(phone, '^(\+\d+)\s+\1\s*', '\1 ')
  WHERE phone ~ '^\+\d+\s+\+\d+';
  GET DIAGNOSTICS _cnt = ROW_COUNT;
  RAISE NOTICE 'Teléfonos con doble dial code arreglados: %', _cnt;

  -- ── 3. Segunda pasada de normalización (por si el doble dial dejó basura) ──
  UPDATE public.clients
  SET phone = regexp_replace(phone, '^(\+\d+)\s+', '\1 ') -- un solo espacio después del dial
  WHERE phone IS NOT NULL
    AND phone ~ '^\+\d+\s{2,}';
  GET DIAGNOSTICS _cnt = ROW_COUNT;
  RAISE NOTICE 'Espacios extras corregidos: %', _cnt;

  -- ── 4. Verificar resultado ──
  RAISE NOTICE '--- Teléfonos después de normalización ---';
  -- (los RAISE NOTICE de la siguiente query no funcionan en DO block,
  --  pero la query de verificación se corre aparte)

  -- ── 5. Soft-delete duplicados (mantener el más antiguo) ──
  UPDATE public.clients a
  SET deleted_at = NOW()
  FROM public.clients b
  WHERE a.business_id  = b.business_id
    AND a.phone         = b.phone
    AND a.phone        IS NOT NULL
    AND a.deleted_at   IS NULL
    AND b.deleted_at   IS NULL
    AND a.created_at    > b.created_at;
  GET DIAGNOSTICS _cnt = ROW_COUNT;
  RAISE NOTICE 'Duplicados soft-deleted (se mantuvo el más antiguo): %', _cnt;

  -- ── 6. Drop index si existe (por si se intentó crear antes) ──
  DROP INDEX IF EXISTS public.clients_business_phone_unique;

  -- ── 7. Crear índice único parcial ──
  CREATE UNIQUE INDEX clients_business_phone_unique
    ON public.clients (business_id, phone)
    WHERE phone IS NOT NULL AND deleted_at IS NULL;

  RAISE NOTICE '✅ Índice clients_business_phone_unique creado correctamente.';
  RAISE NOTICE '✅ Proceso completado.';
END;
$$;

-- ── Verificación: ver todos los teléfonos actuales ──
SELECT id, name, phone, deleted_at
FROM public.clients
WHERE phone IS NOT NULL
ORDER BY phone;
