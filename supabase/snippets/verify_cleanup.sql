-- ============================================================
-- VERIFICACIÓN 1: Estado de la base de datos después de limpieza
-- Ejecutar en: Supabase Dashboard → SQL Editor
-- ============================================================

-- Usuarios en public.users (deben ser exactamente 4)
SELECT 'public.users' AS tabla, COUNT(*) AS total FROM public.users
UNION ALL
SELECT 'auth.users', COUNT(*) FROM auth.users
UNION ALL
SELECT 'businesses', COUNT(*) FROM public.businesses
UNION ALL
SELECT 'clients', COUNT(*) FROM public.clients
UNION ALL
SELECT 'services', COUNT(*) FROM public.services
UNION ALL
SELECT 'appointments', COUNT(*) FROM public.appointments
UNION ALL
SELECT 'transactions', COUNT(*) FROM public.transactions
UNION ALL
SELECT 'expenses', COUNT(*) FROM public.expenses
UNION ALL
SELECT 'appointment_reminders', COUNT(*) FROM public.appointment_reminders
ORDER BY tabla;
