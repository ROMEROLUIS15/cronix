-- ============================================================================
-- Migration: logos storage bucket
--
-- Creates a public bucket for business logo uploads.
-- Path convention: business-logos/{business_id}.{ext}
--
-- RLS:
--   INSERT/UPDATE — business owner only (owner_id = auth.uid())
--   SELECT        — public (logos are served via CDN public URLs)
-- ============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'logos',
  'logos',
  true,
  2097152,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO NOTHING;
CREATE POLICY "Owners can upload business logos"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'logos'
  AND (storage.foldername(name))[1] = 'business-logos'
  AND EXISTS (
    SELECT 1 FROM public.businesses
    WHERE id::text = split_part(storage.filename(name), '.', 1)
      AND owner_id = auth.uid()
  )
);
CREATE POLICY "Owners can update business logos"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'logos'
  AND (storage.foldername(name))[1] = 'business-logos'
  AND EXISTS (
    SELECT 1 FROM public.businesses
    WHERE id::text = split_part(storage.filename(name), '.', 1)
      AND owner_id = auth.uid()
  )
);
CREATE POLICY "Anyone can read business logos"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'logos');
