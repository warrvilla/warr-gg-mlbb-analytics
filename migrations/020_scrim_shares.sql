-- 020_scrim_shares.sql
-- Let a user share ALL of their scrims with specific people (by email). Scrims
-- are otherwise hard-private (only the creator can read them). A share row says
-- "owner lets email see all my Scrims-bucket matches." Enforced server-side by
-- RLS on scout_matches.
--
-- Run in Supabase → SQL Editor.

-- 1) Who each user shares their scrims with.
CREATE TABLE IF NOT EXISTS public.scrim_shares (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner      uuid NOT NULL REFERENCES auth.users(id) DEFAULT auth.uid(),
  email      text NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE (owner, email)
);
ALTER TABLE public.scrim_shares ENABLE ROW LEVEL SECURITY;

-- Read a share row if you own it or it's addressed to your email.
DROP POLICY IF EXISTS "scrim_shares_select" ON public.scrim_shares;
CREATE POLICY "scrim_shares_select" ON public.scrim_shares FOR SELECT USING (
  owner = auth.uid() OR lower(email) = lower(auth.jwt()->>'email')
);
-- Only the owner may add / remove their own shares.
DROP POLICY IF EXISTS "scrim_shares_write" ON public.scrim_shares;
CREATE POLICY "scrim_shares_write" ON public.scrim_shares FOR ALL
  USING ( owner = auth.uid() )
  WITH CHECK ( owner = auth.uid() );

-- 2) Rewrite the match-read policy to also allow shared scrims.
--    A match is readable if:
--      (a) you logged it (own), OR
--      (b) its league is a normal shared league (not private, not a personal
--          bucket Scrims/Other/AI Battle), OR
--      (c) its league is private AND you own it or your email is a member, OR
--      (d) it's a Scrims match whose creator shared their scrims with your email.
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
  OR (
    COALESCE(data->>'league','') = 'Scrims'
    AND EXISTS (
      SELECT 1 FROM public.scrim_shares s
      WHERE s.owner = scout_matches.created_by
        AND lower(s.email) = lower(auth.jwt()->>'email')
    )
  )
);

NOTIFY pgrst, 'reload schema';
