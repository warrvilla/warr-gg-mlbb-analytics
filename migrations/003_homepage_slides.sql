-- ============================================================
-- Warr.GG — Homepage Slides cloud sync
-- ============================================================
-- Run this ONCE in Supabase Studio → SQL Editor.
--
-- Until this is in place, hero-banner slides are saved to the
-- admin's browser localStorage only — other visitors see the
-- hardcoded defaults. After this migration, the admin's edits in
-- Profile → Hero Banner Slides go to the cloud and every visitor
-- sees the same carousel.
--
-- Schema is a single row keyed by id='default' so the entire
-- slides array round-trips as one JSONB value.
-- ============================================================

CREATE TABLE IF NOT EXISTS homepage_slides (
  id          TEXT PRIMARY KEY DEFAULT 'default',
  slides      JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_by  UUID REFERENCES auth.users(id)
);

ALTER TABLE homepage_slides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read homepage slides" ON homepage_slides;
DROP POLICY IF EXISTS "Admin write homepage slides" ON homepage_slides;

CREATE POLICY "Public read homepage slides"
  ON homepage_slides FOR SELECT
  USING (true);

CREATE POLICY "Admin write homepage slides"
  ON homepage_slides FOR ALL
  USING (auth.jwt() ->> 'email' = 'wrrenvillapando@gmail.com')
  WITH CHECK (auth.jwt() ->> 'email' = 'wrrenvillapando@gmail.com');

-- ── DONE ──
-- After running:
--   1. Hard-refresh the site (Cmd+Shift+R)
--   2. Sign in as admin
--   3. Profile → Hero Banner Slides → Open Slide Editor → Save Slides
--   4. Open the site in an incognito window or different device — same
--      slides should be visible.
