-- ============================================================
-- 039_harden_chat_media_storage.sql
--
-- Hardens the `chat-media` bucket:
-- 1. Sets the bucket to private (public = false).
-- 2. Revokes the unauthenticated "Chat media is publicly readable" policy.
-- 3. Restricts SELECT on chat-media storage objects strictly to members
--    of the owning account via RLS:
--    ('account-' || p.account_id::text) = (storage.foldername(name))[1]
-- ============================================================

-- 1. Ensure bucket is private
UPDATE storage.buckets
SET public = FALSE
WHERE id = 'chat-media';

-- 2. Replace public read policy with account-scoped member read policy
DROP POLICY IF EXISTS "Chat media is publicly readable" ON storage.objects;
DROP POLICY IF EXISTS "Members can view own account chat media" ON storage.objects;

CREATE POLICY "Members can view own account chat media"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'chat-media'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );
