-- 017_private_leagues.sql
-- Private leagues: a league whose MATCH DATA is visible only to the owner and
-- the emails they share it with. Competitive scrim/scout intel stays inside the
-- team. Enforced server-side by RLS on scout_matches (the sensitive data) — the
-- leagues table itself is left as-is (only a visibility flag is added) so league
-- creation/management keeps working exactly as before.
--
-- Run in Supabase → SQL Editor.

-- 1) Mark a league public (default) or private.
ALTER TABLE public.leagues
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'public';

-- 2) Who can see a private league — by email (plus the owner, implicitly).
CREATE TABLE IF NOT EXISTS public.league_members (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_name text NOT NULL,
  email       text NOT NULL,
  added_by    uuid REFERENCES auth.users(id),
  created_at  timestamptz DEFAULT now(),
  UNIQUE (league_name, email)
);
ALTER TABLE public.league_members ENABLE ROW LEVEL SECURITY;

-- Read a membership row if: you added it, it's your own email, or you own the league.
DROP POLICY IF EXISTS "league_members_select" ON public.league_members;
CREATE POLICY "league_members_select" ON public.league_members FOR SELECT USING (
  added_by = auth.uid()
  OR lower(email) = lower(auth.jwt()->>'email')
  OR EXISTS (SELECT 1 FROM public.leagues l WHERE l.name = league_members.league_name AND l.created_by = auth.uid())
);
-- Manage members only if you own the league (or you created the row).
DROP POLICY IF EXISTS "league_members_write" ON public.league_members;
CREATE POLICY "league_members_write" ON public.league_members FOR ALL USING (
  added_by = auth.uid()
  OR EXISTS (SELECT 1 FROM public.leagues l WHERE l.name = league_members.league_name AND l.created_by = auth.uid())
) WITH CHECK (
  added_by = auth.uid()
  OR EXISTS (SELECT 1 FROM public.leagues l WHERE l.name = league_members.league_name AND l.created_by = auth.uid())
);

-- 3) Rewrite the match-read policy to respect private leagues.
--    A match is readable if:
--      (a) you logged it (own), OR
--      (b) its league is a normal shared league (not a private one, and not a
--          personal bucket Scrims/Other/AI Battle), OR
--      (c) its league is private AND you own it or your email is a member.
DROP POLICY IF EXISTS "scout_matches_select" ON public.scout_matches;
CREATE POLICY "scout_matches_select" ON public.scout_matches FOR SELECT USING (
  created_by = auth.uid()
  OR (
    COALESCE(data->>'league','') NOT IN ('Scrims','Other','AI Battle')
    AND NOT EXISTS (
      SELECT 1 FROM public.leagues l
      WHERE l.name = data->>'league' AND COALESCE(l.visibility,'public') = 'private'
    )
  )
  OR EXISTS (
    SELECT 1 FROM public.leagues l
    WHERE l.name = data->>'league'
      AND COALESCE(l.visibility,'public') = 'private'
      AND ( l.created_by = auth.uid()
            OR EXISTS (SELECT 1 FROM public.league_members m
                       WHERE m.league_name = l.name
                         AND lower(m.email) = lower(auth.jwt()->>'email')) )
  )
);

NOTIFY pgrst, 'reload schema';
