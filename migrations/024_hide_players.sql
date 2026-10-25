-- 024_hide_players.sql
-- Lets the admin switch off player stats where the player tags are wrong, for a
-- whole league or for specific teams in it. Reports then show per-role stats
-- instead. The tags themselves stay in the games, so it can be switched back on.
--   leagues.hide_players = { "all": true }                 -- whole league
--   leagues.hide_players = { "teams": ["Team A", "Team B"] } -- only these teams
-- Built-in leagues (MPL PH, MSC, …) get a row the first time this is set.
-- Run in Supabase → SQL Editor → New query → Run. Safe to re-run.
ALTER TABLE public.leagues ADD COLUMN IF NOT EXISTS hide_players jsonb;
NOTIFY pgrst, 'reload schema';
