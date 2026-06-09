-- ============================================================
-- Warr.GG — Hero Portrait Variants migration
-- ============================================================
-- Run this ONCE in Supabase Studio → SQL Editor *after* you've
-- already run migrations/001_hero_portrait_storage.sql.
--
-- What this adds:
--   - A `variant` column on hero_portrait_overrides (default 'icon')
--   - Composite PK on (hero_name, variant) — so each hero can have
--     multiple uploaded portrait variants (icon + portrait, etc.)
--   - Backfills existing rows as 'icon' variant
--   - Re-creates the public read + admin write RLS policies
--
-- After running, the Profile → Admin → Hero Portraits modal will let
-- you upload separate images for:
--   • icon (square, 1:1) — small thumbs in pickers / stats
--   • portrait (3:4 or 4:5) — big aesthetic cards on the homepage
-- ============================================================

-- ── 1. ADD variant COLUMN + COMPOSITE PK ──
ALTER TABLE hero_portrait_overrides
  ADD COLUMN IF NOT EXISTS variant TEXT NOT NULL DEFAULT 'icon';

-- Drop the old single-column PK (if it exists)
ALTER TABLE hero_portrait_overrides
  DROP CONSTRAINT IF EXISTS hero_portrait_overrides_pkey;

-- New composite primary key
ALTER TABLE hero_portrait_overrides
  ADD PRIMARY KEY (hero_name, variant);

-- ── 2. RLS unchanged but re-applied for idempotency ──
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

-- ── 3. STORAGE bucket policies unchanged — files now live in
--      subpaths inside the bucket:
--        hero-portraits/icon/<Hero>.png
--        hero-portraits/portrait/<Hero>.png
--      The bucket already allows public read + admin write so no
--      change needed here.

-- ── DONE ──
-- After running:
--   1. Hard-refresh the site (Cmd+Shift+R)
--   2. Sign in as wrrenvillapando@gmail.com
--   3. Profile → Admin → Hero Portraits → Open Portraits Manager
--   4. Each hero card now shows TWO upload slots: Icon and Portrait.
--      Upload separate images for each variant.
