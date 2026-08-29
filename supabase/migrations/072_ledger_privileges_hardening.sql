-- ============================================================
-- Migration 072: Ledger Least Privilege Hardening (V1.1.2)
--
-- Revokes all non-essential table privileges (INSERT, UPDATE, DELETE,
-- TRUNCATE, TRIGGER, REFERENCES) from PUBLIC, anon, and authenticated
-- on conversation_assignment_history.
--
-- Only SELECT is granted to authenticated (guarded by RLS policy cah_select).
-- Full administrative privileges remain strictly for service_role and postgres.
-- ============================================================

REVOKE ALL PRIVILEGES ON TABLE public.conversation_assignment_history FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.conversation_assignment_history TO authenticated;
GRANT ALL PRIVILEGES ON TABLE public.conversation_assignment_history TO service_role, postgres;
