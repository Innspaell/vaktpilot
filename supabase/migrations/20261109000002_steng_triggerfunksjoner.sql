-- Triggerfunksjoner skal ikke kunne kalles direkte via API-et.
revoke execute on function public.audit_trigger(), public.guard_time_entry() from authenticated, anon, public;
