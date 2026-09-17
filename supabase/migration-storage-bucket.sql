-- ============================================
-- STORAGE: Create images bucket for product uploads
-- Run this in Supabase SQL Editor
-- ============================================

-- Create storage bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'images',
  'images',
  true,
  5242880,  -- 5MB limit
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
) ON CONFLICT (id) DO NOTHING;

-- Allow public read access
CREATE POLICY "Public read access for images"
ON storage.objects FOR SELECT
USING (bucket_id = 'images');

-- Allow authenticated upload
CREATE POLICY "Allow upload for authenticated"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'images');

-- Allow upload for anon (POS app)
CREATE POLICY "Allow anon upload for images"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'images');

-- Allow delete for anon
CREATE POLICY "Allow anon delete for images"
ON storage.objects FOR DELETE
USING (bucket_id = 'images');

-- Allow update for anon
CREATE POLICY "Allow anon update for images"
ON storage.objects FOR UPDATE
USING (bucket_id = 'images');
