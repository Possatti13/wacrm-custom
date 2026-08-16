-- ============================================================
-- 038_authenticated_table_grants.sql
--
-- Supabase RLS policies are not enough by themselves: Postgres
-- roles still need table privileges before policies can run.
-- Local db reset exposed missing grants as:
--   permission denied for table profiles
--   permission denied for table whatsapp_config
--
-- Grant app roles access to public schema objects; RLS continues to
-- enforce account/user scoping per table policy.
-- ============================================================

grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
grant execute on all functions in schema public to authenticated, service_role;

-- Keep future migrations from reintroducing local permission denials.
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated, service_role;

alter default privileges in schema public
  grant usage, select on sequences to authenticated, service_role;

alter default privileges in schema public
  grant execute on functions to authenticated, service_role;
