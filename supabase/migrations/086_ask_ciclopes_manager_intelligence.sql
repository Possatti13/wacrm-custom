-- Migration: 086_ask_ciclopes_manager_intelligence.sql
-- Description: Schema and security rules for Ask Ciclopes Grounded Manager Intelligence (V1.5)
-- Date: 2026-08-30

-- 1. Create Threads Table
CREATE TABLE IF NOT EXISTS public.manager_ai_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'Nova conversa',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Create Turns Table
CREATE TABLE IF NOT EXISTS public.manager_ai_turns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID NOT NULL REFERENCES public.manager_ai_threads(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  resolved_intent TEXT NOT NULL,
  resolved_period JSONB NOT NULL DEFAULT '{}'::jsonb,
  tool_calls JSONB NOT NULL DEFAULT '[]'::jsonb,
  fact_packet JSONB NOT NULL DEFAULT '{}'::jsonb,
  fact_packet_hash TEXT NOT NULL,
  answer TEXT NOT NULL,
  claims JSONB NOT NULL DEFAULT '[]'::jsonb,
  recommendations JSONB NOT NULL DEFAULT '[]'::jsonb,
  drilldowns JSONB NOT NULL DEFAULT '[]'::jsonb,
  opaque_entities JSONB NOT NULL DEFAULT '{}'::jsonb,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  cached BOOLEAN NOT NULL DEFAULT false,
  planner_tokens JSONB DEFAULT NULL,
  synthesis_tokens JSONB DEFAULT NULL,
  latency_ms INTEGER DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Indexes for fast retrieval and cache lookup
CREATE INDEX IF NOT EXISTS idx_manager_ai_threads_acc_user_created 
  ON public.manager_ai_threads (account_id, user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_manager_ai_turns_thread_created 
  ON public.manager_ai_turns (thread_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_manager_ai_turns_acc_hash 
  ON public.manager_ai_turns (account_id, fact_packet_hash);

-- 4. Enable Row Level Security (RLS)
ALTER TABLE public.manager_ai_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manager_ai_turns ENABLE ROW LEVEL SECURITY;

-- 5. Helper function to verify manager role (owner/admin) within the active account
CREATE OR REPLACE FUNCTION public.is_manager_of_account(p_account_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 
    FROM public.profiles 
    WHERE user_id = auth.uid()
      AND account_id = p_account_id
      AND account_role IN ('owner', 'admin')
  );
$$;

-- 6. RLS Policies for manager_ai_threads
CREATE POLICY "Manager threads select for owner and admin"
  ON public.manager_ai_threads
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid() 
    AND public.is_manager_of_account(account_id)
  );

CREATE POLICY "Manager threads insert for owner and admin"
  ON public.manager_ai_threads
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid() 
    AND public.is_manager_of_account(account_id)
  );

CREATE POLICY "Manager threads update for owner and admin"
  ON public.manager_ai_threads
  FOR UPDATE
  TO authenticated
  USING (
    user_id = auth.uid() 
    AND public.is_manager_of_account(account_id)
  )
  WITH CHECK (
    user_id = auth.uid() 
    AND public.is_manager_of_account(account_id)
  );

CREATE POLICY "Manager threads delete for owner and admin"
  ON public.manager_ai_threads
  FOR DELETE
  TO authenticated
  USING (
    user_id = auth.uid() 
    AND public.is_manager_of_account(account_id)
  );

-- 7. RLS Policies for manager_ai_turns
CREATE POLICY "Manager turns select for owner and admin"
  ON public.manager_ai_turns
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid() 
    AND public.is_manager_of_account(account_id)
  );

CREATE POLICY "Manager turns insert for owner and admin"
  ON public.manager_ai_turns
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid() 
    AND public.is_manager_of_account(account_id)
  );

CREATE POLICY "Manager turns delete for owner and admin"
  ON public.manager_ai_turns
  FOR DELETE
  TO authenticated
  USING (
    user_id = auth.uid() 
    AND public.is_manager_of_account(account_id)
  );

-- 8. Grants and Revokes
REVOKE ALL ON public.manager_ai_threads FROM anon;
REVOKE ALL ON public.manager_ai_turns FROM anon;
REVOKE ALL ON FUNCTION public.is_manager_of_account(UUID) FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.manager_ai_threads TO authenticated, service_role;
GRANT SELECT, INSERT, DELETE ON public.manager_ai_turns TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_manager_of_account(UUID) TO authenticated, service_role;
