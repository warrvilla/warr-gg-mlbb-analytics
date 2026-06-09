-- ============================================================
-- Warr.GG — Hero Portrait Storage migration
-- ============================================================
-- Run this ONCE in Supabase Studio → SQL Editor.
-- After running, the admin can upload portraits via the homepage
-- "Manage Portraits" UI and all visitors will see them site-wide.
--
-- What this creates:
--   1. A public-read storage bucket called `hero-portraits`
--   2. Storage policies: anyone can SELECT (view), only the admin
--      (matched by email) can INSERT/UPDATE/DELETE
--   3. A small `hero_portrait_overrides` table that tells the app
--      which heroes have a cloud override (so it doesn't have to
--      probe Storage on every page load)
-- ============================================================

-- ── 1. STORAGE BUCKET ──
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'hero-portraits',
  'hero-portraits',
  true,
  524288,                                                    -- 512 KB max per file
  ARRAY['image/png','image/jpeg','image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ── 2. STORAGE POLICIES ──
-- (Drop first to keep this migration idempotent — safe to re-run.)
DROP POLICY IF EXISTS "Public read hero portraits" ON storage.objects;
DROP POLICY IF EXISTS "Admin upload hero portraits" ON storage.objects;
DROP POLICY IF EXISTS "Admin update hero portraits" ON storage.objects;
DROP POLICY IF EXISTS "Admin delete hero portraits" ON storage.objects;

CREATE POLICY "Public read hero portraits"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'hero-portraits');

CREATE POLICY "Admin upload hero portraits"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'hero-portraits'
    AND auth.jwt() ->> 'email' = 'wrrenvillapando@gmail.com'
  );

CREATE POLICY "Admin update hero portraits"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'hero-portraits'
    AND auth.jwt() ->> 'email' = 'wrrenvillapando@gmail.com'
  );

CREATE POLICY "Admin delete hero portraits"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'hero-portraits'
    AND auth.jwt() ->> 'email' = 'wrrenvillapando@gmail.com'
  );

-- ── 3. OVERRIDES METADATA TABLE ──
CREATE TABLE IF NOT EXISTS hero_portrait_overrides (
  hero_name   TEXT PRIMARY KEY,
  file_path   TEXT NOT NULL,         -- path inside the bucket, e.g. 'Aamon.png'
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_by  UUID REFERENCES auth.users(id)
);

ALTER TABLE hero_portrait_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read portrait overrides" ON hero_portrait_overrides;
DROP POLICY IF EXISTS "Admin write portrait overrides" ON hero_portrait_overrides;

CREATE POLICY "Public read portrait overrides"
  ON hero_portrait_overrides FOR SELECT
  USING (true);

CREATE POLICY "Admin write portrait overrides"
  ON hero_portrait_overrides FOR ALL
  USING (auth.jwt() ->> 'email' = 'wrrenvillapando@gmail.com')
  WITH CHECK (auth.jwt() ->> 'email' = 'wrrenvillapando@gmail.com');

-- ── DONE ──
-- After running this:
--   1. Reload your Warr.GG site (hard refresh: Cmd+Shift+R)
--   2. Sign in as wrrenvillapando@gmail.com
--   3. On the homepage, click the "Manage Portraits" button (top-right
--      of the hero banner — admin-only)
--   4. Click any hero → choose a PNG/JPG/WEBP → it's uploaded and live
--      site-wide.
