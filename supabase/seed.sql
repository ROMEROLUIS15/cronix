-- ─────────────────────────────────────────────────────────────────────────────
-- Seed data for local development and pgTAP tests
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Businesses
INSERT INTO public.businesses (id, name, category, owner_id)
VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Business A', 'salon',      '00000000-0000-0000-0000-000000000001'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'Business B', 'barbershop', '00000000-0000-0000-0000-000000000002')
ON CONFLICT (id) DO NOTHING;

-- 2. Auth Users (FK constraint required by public.users.id → auth.users.id)
INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data, aud, role)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'a@test.com',     '{"provider":"email","providers":["email"]}', '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-000000000002', 'b@test.com',     '{"provider":"email","providers":["email"]}', '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-000000000003', 'admin@test.com', '{"provider":"email","providers":["email"]}', '{}', 'authenticated', 'authenticated')
ON CONFLICT (id) DO NOTHING;

-- 3. Public Users
-- platform_admin (user 3) has no business (business_id nullable).
-- Required for security_alerts RLS tests: policy checks role IN ('owner','platform_admin').
INSERT INTO public.users (id, name, email, business_id, role, status)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'Owner A',        'a@test.com',     'aaaaaaaa-0000-0000-0000-000000000001', 'owner',          'active'),
  ('00000000-0000-0000-0000-000000000002', 'Owner B',        'b@test.com',     'bbbbbbbb-0000-0000-0000-000000000002', 'owner',          'active'),
  ('00000000-0000-0000-0000-000000000003', 'Platform Admin', 'admin@test.com', NULL,                                  'platform_admin', 'active')
ON CONFLICT (id) DO NOTHING;
