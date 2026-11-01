-- Trigger functions are invoked by the trigger and must not be callable directly
-- by browser roles. Keep execution limited to trusted database contexts.
revoke all on function public.log_contact_consent_change() from public, anon, authenticated;
