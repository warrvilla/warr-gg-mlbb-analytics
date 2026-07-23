-- 016_team_meta_league_scope.sql
-- Per-competition team profile: placement, regular-season rank, win condition and
-- coach notes now belong to a specific league+season instead of the whole team,
-- so "MPL PH S18 Champion" no longer shows up under MSC. Only the team's logo and
-- social link stay global.
--
-- Storage: a single JSONB column keyed by "<league>::<season>", e.g.
--   { "MPL PH::Season 18": { "placement": "Champion", "rsRank": "1",
--                            "winCondition": "...", "coachNotes": "..." },
--     "MSC::2025":         { "placement": "4th Place" } }
-- The legacy flat columns (placement, rs_rank, win_condition, coach_notes) are
-- kept for backward compatibility but no longer drive the per-league display.

ALTER TABLE team_meta
  ADD COLUMN IF NOT EXISTS league_meta jsonb NOT NULL DEFAULT '{}'::jsonb;
