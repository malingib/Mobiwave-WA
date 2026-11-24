-- Allow tenant members to read only the non-secret Meta connection status fields.
-- The encrypted access token, app secret, and webhook verification hash remain
-- inaccessible to authenticated clients; the existing tenant_members SELECT
-- policy continues to enforce workspace isolation.
grant select (
  tenant_id,
  phone_number_id,
  waba_id,
  display_phone_number,
  verified,
  enabled,
  verified_name,
  last_error_code,
  last_health_check_at,
  webhook_verified_at,
  waba_timezone,
  messaging_limit_tier,
  quality_rating,
  last_capability_update_at
) on table public.meta_integrations to authenticated;
