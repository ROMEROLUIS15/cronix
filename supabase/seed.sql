-- ─────────────────────────────────────────────────────────────────────────────
-- Seed data for local development and pgTAP tests
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Businesses
INSERT INTO public.businesses (id, name, category, owner_id)
VALUES 
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Business A', 'salon', '00000000-0000-0000-0000-000000000001'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'Business B', 'barbershop', '00000000-0000-0000-0000-000000000002')
ON CONFLICT (id) DO NOTHING;

-- 2. Auth Users (Necessary for FK constraints in local tests)
INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data, aud, role)
VALUES 
  ('00000000-0000-0000-0000-000000000001', 'a@test.com', '{"provider":"email","providers":["email"]}', '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-000000000002', 'b@test.com', '{"provider":"email","providers":["email"]}', '{}', 'authenticated', 'authenticated')
ON CONFLICT (id) DO NOTHING;

-- 3. Public Users
INSERT INTO public.users (id, name, email, business_id, role, status)
VALUES 
  ('00000000-0000-0000-0000-000000000001', 'Owner A', 'a@test.com', 'aaaaaaaa-0000-0000-0000-000000000001', 'owner', 'active'),
  ('00000000-0000-0000-0000-000000000002', 'Owner B', 'b@test.com', 'bbbbbbbb-0000-0000-0000-000000000002', 'owner', 'active')
ON CONFLICT (id) DO NOTHING;
