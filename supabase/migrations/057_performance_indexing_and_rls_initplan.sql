-- ============================================================
-- Migration 057: Performance Indexing & RLS InitPlan Optimization (Phase 7B)
--
-- 1. Optimizes RLS evaluation paths by wrapping `auth.uid()` in scalar subqueries
--    `(SELECT auth.uid())`, enabling PostgreSQL initPlan query execution.
-- 2. Creates targeted covering indexes for foreign keys on high-traffic
--    hot paths (Inbox, Commercial Intelligence, Lead Scoring, Deals, Flows, Notifications).
-- ============================================================

-- ============================================================
-- SECTION 1: RLS INITPLAN OPTIMIZATION
-- ============================================================

-- 1.1 Profiles table RLS optimization
DROP POLICY IF EXISTS profiles_select ON public.profiles;
CREATE POLICY profiles_select ON public.profiles FOR SELECT
  USING ((SELECT auth.uid()) = user_id OR is_account_member(account_id));

DROP POLICY IF EXISTS profiles_update ON public.profiles;
CREATE POLICY profiles_update ON public.profiles FOR UPDATE
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS profiles_insert ON public.profiles;
CREATE POLICY profiles_insert ON public.profiles FOR INSERT
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- 1.2 Notifications table RLS optimization
DROP POLICY IF EXISTS notifications_select ON public.notifications;
CREATE POLICY notifications_select ON public.notifications FOR SELECT
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS notifications_update ON public.notifications;
CREATE POLICY notifications_update ON public.notifications FOR UPDATE
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);


-- ============================================================
-- SECTION 2: HIGH-TRAFFIC FOREIGN KEY COVERING INDEXES
-- ============================================================

-- 2.1 Commercial Intelligence & Runs FK Indexes
CREATE INDEX IF NOT EXISTS idx_conv_analysis_runs_config_rev
  ON public.conversation_analysis_runs(account_id, commercial_config_revision_id);

CREATE INDEX IF NOT EXISTS idx_conv_analysis_runs_catalog_ctx
  ON public.conversation_analysis_runs(account_id, analysis_catalog_context_id);

CREATE INDEX IF NOT EXISTS idx_conv_analysis_messages_run
  ON public.conversation_analysis_messages(account_id, conversation_id, analysis_run_id);

CREATE INDEX IF NOT EXISTS idx_conv_insights_supersede_lookup
  ON public.conversation_insights(account_id, conversation_id, supersedes_insight_id)
  WHERE supersedes_insight_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_conv_insight_evidence_lookup
  ON public.conversation_insight_evidence(account_id, conversation_id, insight_id);

CREATE INDEX IF NOT EXISTS idx_contact_commercial_provenance_run
  ON public.contact_commercial_provenance(account_id, projection_run_id);

-- 2.2 Lead Scoring FK Indexes
CREATE INDEX IF NOT EXISTS idx_contact_lead_scores_revision
  ON public.contact_lead_scores(account_id, scoring_revision_id);

CREATE INDEX IF NOT EXISTS idx_contact_lead_score_history_rev
  ON public.contact_lead_score_history(account_id, scoring_revision_id);

CREATE INDEX IF NOT EXISTS idx_lead_scoring_configs_rev
  ON public.lead_scoring_configs(account_id, current_revision_id);

-- 2.3 CRM Core & Operational Inbox FK Indexes
CREATE INDEX IF NOT EXISTS idx_deals_contact
  ON public.deals(account_id, contact_id);

CREATE INDEX IF NOT EXISTS idx_deals_conversation
  ON public.deals(account_id, conversation_id)
  WHERE conversation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_flow_runs_contact
  ON public.flow_runs(account_id, contact_id);

CREATE INDEX IF NOT EXISTS idx_flow_runs_conversation
  ON public.flow_runs(account_id, conversation_id)
  WHERE conversation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contact_notes_contact
  ON public.contact_notes(account_id, contact_id);

CREATE INDEX IF NOT EXISTS idx_contact_custom_values_field
  ON public.contact_custom_values(custom_field_id);

CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_contact
  ON public.broadcast_recipients(contact_id);
