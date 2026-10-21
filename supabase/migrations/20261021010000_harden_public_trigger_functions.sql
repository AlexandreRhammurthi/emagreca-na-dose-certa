-- Security hardening for existing trigger helpers reported by Supabase Advisor.
-- This migration does not alter tables, rows, RLS policies, or trigger bindings.

begin;

-- Keep the timestamp trigger deterministic even when invoked by a role whose
-- search_path was changed. The function is shared by several existing triggers.
alter function public.set_updated_at()
  set search_path = pg_catalog, public;

-- handle_new_user is an auth.users trigger helper, not an API endpoint.
-- Retain SECURITY DEFINER for the auth trigger, but remove the automatic RPC
-- execution grants inherited by public, anonymous, and signed-in users.
revoke execute on function public.handle_new_user()
  from public, anon, authenticated;

commit;
