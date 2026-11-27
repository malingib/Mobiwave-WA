-- Cover the two remaining foreign keys on contact_consent_audit.
-- Keep the existing tenant/contact/time index; these indexes support FK
-- maintenance when referenced API keys or contacts are updated/deleted.
create index if not exists contact_consent_audit_api_key_id_idx
  on public.contact_consent_audit (api_key_id)
  where api_key_id is not null;

create index if not exists contact_consent_audit_contact_id_idx
  on public.contact_consent_audit (contact_id);
