-- Rydding etter sikkerhetssjekken i Supabase.
-- Faste søkestier på hjelpefunksjoner.
alter function valid_signature(text) set search_path = public;
alter function login_email(text) set search_path = public;
-- Triggerfunksjoner skal ikke kunne kalles direkte via API-et.
revoke execute on function resolve_on_absence() from public, anon, authenticated;
revoke execute on function resolve_on_shift() from public, anon, authenticated;
revoke execute on function resolve_on_shift_request() from public, anon, authenticated;
revoke execute on function resolve_on_swap() from public, anon, authenticated;
revoke execute on function resolve_on_time_entry() from public, anon, authenticated;
