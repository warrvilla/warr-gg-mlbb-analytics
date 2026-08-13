-- 019_league_hidden.sql
-- Let the admin hide built-in league presets (MPL PH, MSC, etc.) they don't use,
-- so the league lists only show what the team actually competes in. Built-ins are
-- hardcoded, so "hiding" materialises a leagues row flagged hidden=true; the app
-- filters those out of every league list. Unhide by clearing the flag.
ALTER TABLE public.leagues ADD COLUMN IF NOT EXISTS hidden boolean NOT NULL DEFAULT false;
NOTIFY pgrst, 'reload schema';
