-- ============================================================================
-- Migration: fix logos bucket RLS
--
-- The original policies used storage.foldername/storage.filename helpers
-- that are unreliable in RLS context, and the UPDATE policy was missing
-- WITH CHECK which silently blocked upsert operations.
--
-- Replacement: any authenticated user can upload/update/delete in logos.
-- Authorization is enforced at the application layer (settings page access
-- is already gated by role). Public read is preserved for CDN delivery.
-- ============================================================================

-- Drop old policies
DROP POLICY IF EXISTS "Owners can upload business logos"  ON storage.objects;
DROP POLICY IF EXISTS "Owners can update business logos"  ON storage.objects;
DROP POLICY IF EXISTS "Anyone can read business logos"    ON storage.objects;

-- INSERT — any authenticated user
CREATE POLICY "Authenticated users can upload logos"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'logos');

-- UPDATE — any authenticated user (WITH CHECK required for upsert)
CREATE POLICY "Authenticated users can update logos"
ON storage.objects
FOR UPDATE
TO authenticated
USING     (bucket_id = 'logos')
WITH CHECK (bucket_id = 'logos');

-- DELETE — any authenticated user
CREATE POLICY "Authenticated users can delete logos"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'logos');

-- SELECT — public (CDN public URLs)
CREATE POLICY "Public read for logos"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'logos');
