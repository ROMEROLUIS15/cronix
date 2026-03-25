-- ============================================================
-- VERIFICACIÓN 2: Detalle de usuarios que quedaron
-- Ejecutar en: Supabase Dashboard → SQL Editor
-- ============================================================

-- public.users
SELECT u.id, u.name, u.email, u.role, u.status, b.name AS business_name
FROM public.users u
LEFT JOIN public.businesses b ON b.id = u.business_id
ORDER BY u.created_at;

-- auth.users (deben coincidir con public.users)
SELECT id, email, created_at
FROM auth.users
ORDER BY created_at;
