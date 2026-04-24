-- ─────────────────────────────────────────────────────────────────
-- Warr.GG — Add a `role` column to `public.players` so each roster
-- player can be tagged with their MLBB role (Gold / Jungle / Mid /
-- EXP / Roam). Used by team_manager.html roster + All Players views.
--
-- Run this in Supabase → SQL Editor → New query → Run.
-- Safe to re-run: uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS.
-- ─────────────────────────────────────────────────────────────────

-- Add the column (nullable so existing rows stay valid)
ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS role text;

-- Enforce the allowed role set
ALTER TABLE public.players
  DROP CONSTRAINT IF EXISTS players_role_chk;
ALTER TABLE public.players
  ADD  CONSTRAINT players_role_chk
  CHECK (role IS NULL OR role IN ('Gold','Jungle','Mid','EXP','Roam'));

-- Helpful index when filtering a roster by role
CREATE INDEX IF NOT EXISTS players_team_role_idx
  ON public.players (team_name, role);

-- Tell PostgREST to reload so the new column is queryable immediately
NOTIFY pgrst, 'reload schema';

-- Quick verify — lists column + its nullability
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'players'
ORDER BY ordinal_position;
