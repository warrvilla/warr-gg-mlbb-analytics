-- ─────────────────────────────────────────────────────────────────
-- Warr.GG — Add `current_season` column to public.leagues so each
-- league can mark its active season. Scout's season dropdown will
-- pre-select this value when you click the league, while keeping
-- previous seasons one click away.
--
-- Run this in Supabase → SQL Editor → New query → Run.
-- Safe to re-run: uses ADD COLUMN IF NOT EXISTS.
-- ─────────────────────────────────────────────────────────────────

ALTER TABLE public.leagues
  ADD COLUMN IF NOT EXISTS current_season text;

COMMENT ON COLUMN public.leagues.current_season IS
  'Free-text season name (e.g. "Season 16") that Scout pre-selects when this league is filtered. Should match a value present in scout_matches.data->>''season'' — the admin UI restricts input to existing seasons.';

-- Tell PostgREST to reload so the new column is queryable
NOTIFY pgrst, 'reload schema';

-- Quick verify — column should appear with text type
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'leagues'
ORDER BY ordinal_position;
