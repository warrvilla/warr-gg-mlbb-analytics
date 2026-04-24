-- ─────────────────────────────────────────────────────────────────
-- Warr.GG — Tighten `scout_matches` SELECT policy so private leagues
-- (Scrims, Other, AI Battle, any admin-added custom leagues) are
-- only visible to the user who created them. Public competition
-- leagues (MPL PH/MY/ID/SG, MSC, M-Series) remain readable by
-- every signed-in user.
--
-- Run this in Supabase → SQL Editor → New query → Run.
-- Safe to re-run: uses DROP POLICY IF EXISTS.
--
-- Before this migration: any authenticated user could SELECT every
-- row in scout_matches, meaning scrim data was only soft-private
-- (enforced client-side in WDB.loadMatches). This closes that gap
-- at the Postgres layer so even a direct Supabase client query
-- cannot return another user's scrims.
-- ─────────────────────────────────────────────────────────────────

-- Drop the old permissive SELECT policy (whichever name it was created under)
DROP POLICY IF EXISTS "All users can read matches"           ON public.scout_matches;
DROP POLICY IF EXISTS "All users read"                       ON public.scout_matches;
DROP POLICY IF EXISTS "scout_matches_public_read"            ON public.scout_matches;
DROP POLICY IF EXISTS "Read public leagues or own matches"   ON public.scout_matches;

-- New SELECT policy: public leagues OR you created it
-- Mirrors the JS check in warr-lib.js → WDB.loadMatches / WDB.PUBLIC_LEAGUES.
CREATE POLICY "Read public leagues or own matches"
  ON public.scout_matches
  FOR SELECT
  USING (
    (data->>'league') IN (
      'MPL PH','MPL MY','MPL ID','MPL SG','MSC','M-Series'
    )
    OR created_by = auth.uid()
  );

-- INSERT / UPDATE / DELETE policies are unchanged from the original
-- setup (creator-only writes, admin-safe via OR created_by IS NULL
-- for legacy rows). Re-declare them here idempotently so a fresh
-- project gets the full policy set in one migration.
DROP POLICY IF EXISTS "All users can insert matches"  ON public.scout_matches;
DROP POLICY IF EXISTS "scout_matches_auth_insert"     ON public.scout_matches;
CREATE POLICY "scout_matches_auth_insert"
  ON public.scout_matches
  FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Creator can update match"   ON public.scout_matches;
DROP POLICY IF EXISTS "scout_matches_own_update"   ON public.scout_matches;
CREATE POLICY "scout_matches_own_update"
  ON public.scout_matches
  FOR UPDATE
  USING (auth.uid() = created_by OR created_by IS NULL);

DROP POLICY IF EXISTS "Creator can delete match"   ON public.scout_matches;
DROP POLICY IF EXISTS "scout_matches_own_delete"   ON public.scout_matches;
CREATE POLICY "scout_matches_own_delete"
  ON public.scout_matches
  FOR DELETE
  USING (auth.uid() = created_by OR created_by IS NULL);

-- Make sure RLS is actually enabled (it should be already, but this
-- is a no-op if it is, and protects against a table that somehow
-- got RLS disabled).
ALTER TABLE public.scout_matches ENABLE ROW LEVEL SECURITY;

-- Tell PostgREST to reload its schema cache
NOTIFY pgrst, 'reload schema';

-- Quick verify — you should see exactly 4 policies on scout_matches
-- (1 SELECT, 1 INSERT, 1 UPDATE, 1 DELETE).
SELECT policyname, cmd
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'scout_matches'
ORDER BY cmd, policyname;
