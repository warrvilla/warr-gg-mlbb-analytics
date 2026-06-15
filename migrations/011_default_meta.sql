-- Warr.GG — 011: admin-set default league + season for Heroes/Meta views
-- Stored on the public-readable leagues table so every user can read the
-- default, while writes stay authenticated (admin UI). One league row is
-- flagged is_default_meta; default_season names the season to preselect.
ALTER TABLE public.leagues ADD COLUMN IF NOT EXISTS is_default_meta boolean DEFAULT false;
ALTER TABLE public.leagues ADD COLUMN IF NOT EXISTS default_season  text;

-- Only one league can be the default — clear others when one is set.
CREATE OR REPLACE FUNCTION public.one_default_meta()
RETURNS trigger AS $$
BEGIN
  IF NEW.is_default_meta THEN
    UPDATE public.leagues SET is_default_meta = false WHERE id <> NEW.id AND is_default_meta;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_one_default_meta ON public.leagues;
CREATE TRIGGER trg_one_default_meta
  AFTER INSERT OR UPDATE OF is_default_meta ON public.leagues
  FOR EACH ROW WHEN (NEW.is_default_meta)
  EXECUTE FUNCTION public.one_default_meta();
