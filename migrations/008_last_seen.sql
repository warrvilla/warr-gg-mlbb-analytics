-- Warr.GG — 008: activity heartbeat for the analytics board
-- profiles.last_seen_at is pinged (throttled) by warr-lib on page load,
-- powering Active 7d / 30d numbers in the admin analytics.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;
