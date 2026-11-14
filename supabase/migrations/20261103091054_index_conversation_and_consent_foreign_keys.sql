create index if not exists contact_consent_events_changed_by_idx
  on public.contact_consent_events (changed_by);
create index if not exists contact_consent_events_contact_id_idx
  on public.contact_consent_events (contact_id);
create index if not exists conversation_notes_author_id_idx
  on public.conversation_notes (author_id);
create index if not exists conversation_notes_conversation_id_idx
  on public.conversation_notes (conversation_id);
create index if not exists conversation_reads_conversation_id_idx
  on public.conversation_reads (conversation_id);
create index if not exists conversation_reads_user_id_idx
  on public.conversation_reads (user_id);
