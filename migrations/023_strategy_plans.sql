-- 023_strategy_plans.sql
-- Playbook / Strategy Board: teams plan on the map (hero tokens, arrows, drawings,
-- wards, notes) and save named plans. Plans are private to their creator and the
-- emails they share with (async collaboration — no live editing). Enforced by RLS.
--
-- Run in Supabase → SQL Editor.

-- 1) The plans themselves. `data` holds the full board (tokens + drawings) as JSON.
CREATE TABLE IF NOT EXISTS public.strategy_plans (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  team_name  text,
  league     text,
  data       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id) DEFAULT auth.uid(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE public.strategy_plans ENABLE ROW LEVEL SECURITY;

-- 2) Who a plan is shared with (by email).
CREATE TABLE IF NOT EXISTS public.strategy_plan_members (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id    uuid NOT NULL REFERENCES public.strategy_plans(id) ON DELETE CASCADE,
  email      text NOT NULL,
  added_by   uuid REFERENCES auth.users(id) DEFAULT auth.uid(),
  created_at timestamptz DEFAULT now(),
  UNIQUE (plan_id, email)
);
ALTER TABLE public.strategy_plan_members ENABLE ROW LEVEL SECURITY;

-- Members: readable by the plan owner, the adder, or the person it's addressed to.
DROP POLICY IF EXISTS "strategy_plan_members_select" ON public.strategy_plan_members;
CREATE POLICY "strategy_plan_members_select" ON public.strategy_plan_members FOR SELECT USING (
  added_by = auth.uid()
  OR lower(email) = lower(auth.jwt()->>'email')
  OR EXISTS (SELECT 1 FROM public.strategy_plans p WHERE p.id = plan_id AND p.created_by = auth.uid())
);
-- Only the plan owner manages sharing.
DROP POLICY IF EXISTS "strategy_plan_members_write" ON public.strategy_plan_members;
CREATE POLICY "strategy_plan_members_write" ON public.strategy_plan_members FOR ALL
  USING ( EXISTS (SELECT 1 FROM public.strategy_plans p WHERE p.id = plan_id AND p.created_by = auth.uid()) )
  WITH CHECK ( EXISTS (SELECT 1 FROM public.strategy_plans p WHERE p.id = plan_id AND p.created_by = auth.uid()) );

-- 3) Plans: readable by creator, shared emails, or any admin. Writable by creator
--    or admin (co-admins can help build the playbook).
DROP POLICY IF EXISTS "strategy_plans_select" ON public.strategy_plans;
CREATE POLICY "strategy_plans_select" ON public.strategy_plans FOR SELECT USING (
  created_by = auth.uid()
  OR public.is_warr_admin()
  OR EXISTS (SELECT 1 FROM public.strategy_plan_members m
             WHERE m.plan_id = id AND lower(m.email) = lower(auth.jwt()->>'email'))
);
DROP POLICY IF EXISTS "strategy_plans_write" ON public.strategy_plans;
CREATE POLICY "strategy_plans_write" ON public.strategy_plans FOR ALL
  USING ( created_by = auth.uid() OR public.is_warr_admin() )
  WITH CHECK ( created_by = auth.uid() OR public.is_warr_admin() );

NOTIFY pgrst, 'reload schema';
