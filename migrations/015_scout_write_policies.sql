-- Warr.GG — 015: lock down who can WRITE scout matches (server-enforced)
--
-- Problem: client-side checks (lock icons, admin gating) can be bypassed. The
-- real protection is RLS. This makes the rule authoritative:
--   • Official / custom leagues (the curated scout DB) → ONLY the admin can
--     insert / update / delete.
--   • Private buckets (Scrims / Other / AI Battle) → a logged-in user may
--     manage ONLY their own rows (created_by = themselves).
-- A normal user can therefore never edit or delete your official scout report.
--
-- Read policy stays as defined in 009 (everything shared except private buckets).

ALTER TABLE public.scout_matches ENABLE ROW LEVEL SECURITY;

-- helper: the admin email
-- (Supabase exposes the signed-in user's email in the JWT)

-- ── INSERT ──
DROP POLICY IF EXISTS "scout_matches_insert" ON public.scout_matches;
CREATE POLICY "scout_matches_insert"
  ON public.scout_matches
  FOR INSERT
  WITH CHECK (
    created_by = auth.uid()
    AND (
      COALESCE(data->>'league','') IN ('Scrims','Other','AI Battle')   -- users log their own private data
      OR (auth.jwt() ->> 'email') = 'wrrenvillapando@gmail.com'        -- only admin writes official leagues
    )
  );

-- ── UPDATE ── own row, or admin (covers all official rows the admin created)
DROP POLICY IF EXISTS "scout_matches_update" ON public.scout_matches;
CREATE POLICY "scout_matches_update"
  ON public.scout_matches
  FOR UPDATE
  USING ( created_by = auth.uid() OR (auth.jwt() ->> 'email') = 'wrrenvillapando@gmail.com' )
  WITH CHECK ( created_by = auth.uid() OR (auth.jwt() ->> 'email') = 'wrrenvillapando@gmail.com' );

-- ── DELETE ── own row, or admin
DROP POLICY IF EXISTS "scout_matches_delete" ON public.scout_matches;
CREATE POLICY "scout_matches_delete"
  ON public.scout_matches
  FOR DELETE
  USING ( created_by = auth.uid() OR (auth.jwt() ->> 'email') = 'wrrenvillapando@gmail.com' );
