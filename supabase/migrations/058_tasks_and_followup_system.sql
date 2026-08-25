-- ============================================================
-- Migration 058: Tasks & Follow-up Operational System (Phase 9)
--
-- Introduces operational tasks, follow-up scheduling, and AI suggestion
-- provenance linking to contacts, conversations, and deals with strict
-- multi-tenant isolation and composite foreign key safety.
-- ============================================================

-- 1. TASKS TABLE
CREATE TABLE IF NOT EXISTS public.tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES public.conversations(id) ON DELETE SET NULL,
  deal_id UUID REFERENCES public.deals(id) ON DELETE SET NULL,

  assigned_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  title TEXT NOT NULL,
  description TEXT,
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled')),

  due_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'intelligence', 'automation', 'flow')),
  ai_suggestion_provenance JSONB DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_tasks_account_id UNIQUE (account_id, id)
);

-- 2. COMPOSITE FOREIGN KEYS (Cross-Tenant Integrity)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_tasks_contact_same_account') THEN
    ALTER TABLE public.tasks
      ADD CONSTRAINT fk_tasks_contact_same_account
      FOREIGN KEY (account_id, contact_id)
      REFERENCES public.contacts(account_id, id)
      ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_tasks_conversation_same_account') THEN
    ALTER TABLE public.tasks
      ADD CONSTRAINT fk_tasks_conversation_same_account
      FOREIGN KEY (account_id, conversation_id)
      REFERENCES public.conversations(account_id, id)
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_tasks_deal') THEN
    ALTER TABLE public.tasks
      ADD CONSTRAINT fk_tasks_deal
      FOREIGN KEY (deal_id)
      REFERENCES public.deals(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- 3. COVERING INDEXES
CREATE INDEX IF NOT EXISTS idx_tasks_account_status_due
  ON public.tasks(account_id, status, due_at);

CREATE INDEX IF NOT EXISTS idx_tasks_account_assigned
  ON public.tasks(account_id, assigned_user_id, status);

CREATE INDEX IF NOT EXISTS idx_tasks_account_contact
  ON public.tasks(account_id, contact_id);

CREATE INDEX IF NOT EXISTS idx_tasks_account_conversation
  ON public.tasks(account_id, conversation_id);

CREATE INDEX IF NOT EXISTS idx_tasks_account_deal
  ON public.tasks(account_id, deal_id);

-- 4. ROW LEVEL SECURITY
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tasks_select ON public.tasks;
CREATE POLICY tasks_select ON public.tasks
  FOR SELECT USING (is_account_member(account_id, 'viewer'));

DROP POLICY IF EXISTS tasks_insert ON public.tasks;
CREATE POLICY tasks_insert ON public.tasks
  FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS tasks_update ON public.tasks;
CREATE POLICY tasks_update ON public.tasks
  FOR UPDATE USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS tasks_delete ON public.tasks;
CREATE POLICY tasks_delete ON public.tasks
  FOR DELETE USING (is_account_member(account_id, 'admin'));

-- 5. TRIGGER FOR UPDATED_AT
DROP TRIGGER IF EXISTS trg_tasks_updated_at ON public.tasks;
CREATE TRIGGER trg_tasks_updated_at
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- 6. GRANTS
REVOKE ALL ON public.tasks FROM PUBLIC;
REVOKE ALL ON public.tasks FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tasks TO authenticated;
GRANT ALL ON public.tasks TO service_role;
