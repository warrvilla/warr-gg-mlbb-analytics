-- Warr.GG — 009: future-proof scout match privacy
--
-- The old SELECT policy hard-listed the public official leagues, so newer
-- leagues (MPL KH) and any admin-created custom leagues were accidentally
-- private-to-creator. Invert the rule: EVERYTHING is shared EXCEPT the
-- private buckets (Scrims / Other) — which stay visible only to the coach
-- who logged them. This both (a) keeps your scrim intel private — your
-- team's and your enemy's scrim data is yours alone — and (b) makes every
-- official/custom league shared automatically, no policy edits per league.

DROP POLICY IF EXISTS "Read public leagues or own matches" ON public.scout_matches;
DROP POLICY IF EXISTS "scout_matches_public_read"          ON public.scout_matches;
DROP POLICY IF EXISTS "scout_matches_select"               ON public.scout_matches;

CREATE POLICY "scout_matches_select"
  ON public.scout_matches
  FOR SELECT
  USING (
    COALESCE(data->>'league','') NOT IN ('Scrims','Other','AI Battle')
    OR created_by = auth.uid()
  );
