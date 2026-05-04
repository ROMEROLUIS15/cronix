-- ─────────────────────────────────────────────────────────────────────────────
-- Fix protect_platform_admin_role trigger to allow service_role assignment
-- Goal: Allow the Playwright globalSetup (running as service_role) to assign
--   role = platform_admin to the E2E test user, while still blocking
--   self-promotion by regular authenticated users.
--
-- Root cause: The original trigger blocked ALL callers except the hardcoded
--   platform owner UUID. This inadvertently broke the E2E test infrastructure
--   because supabase.auth.admin calls run as service_role, not authenticated,
--   and should bypass user-level role protection.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.protect_platform_admin_role()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_catalog
AS $$
BEGIN
  -- Allow service_role (admin/CI) to assign any role freely.
  -- auth.role() returns 'service_role' when called via the service key.
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Prevent regular authenticated users from assigning platform_admin
  -- to anyone other than the hardcoded platform owner.
  IF NEW.role = 'platform_admin' THEN
    IF NEW.id != '4ff958ce-4422-4d1a-a126-3ca4649fbab5' THEN
      RAISE EXCEPTION 'Acceso denegado: No tienes permiso para asignar el rol de plataforma.';
    END IF;
  END IF;

  -- Prevent users from changing their own role via a normal authenticated call.
  IF OLD.role != NEW.role AND auth.role() = 'authenticated' AND auth.uid() = NEW.id THEN
    RAISE EXCEPTION 'No puedes cambiar tu propio rol de usuario.';
  END IF;

  RETURN NEW;
END;
$$;
