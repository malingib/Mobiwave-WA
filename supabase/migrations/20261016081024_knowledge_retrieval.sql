-- Retrieval RPC for relevant indexed content. It is invoker-security and only callable by service_role.
create or replace function public.search_knowledge_chunks(
  p_tenant_id uuid,
  p_query text,
  p_limit integer default 6
)
returns table (
  chunk_id uuid,
  content text,
  metadata jsonb,
  title text,
  canonical_url text,
  score real
)
language sql
stable
security invoker
set search_path = public
as $$
  select kc.id, kc.content, kc.metadata, kd.title, kd.canonical_url,
         ts_rank_cd(kc.search_vector, websearch_to_tsquery('simple', left(coalesce(p_query, ''), 2000))) as score
  from public.knowledge_chunks kc
  join public.knowledge_documents kd
    on kd.id = kc.document_id
   and kd.tenant_id = kc.tenant_id
  where kc.tenant_id = p_tenant_id
    and kd.is_current = true
    and length(trim(coalesce(p_query, ''))) > 0
    and kc.search_vector @@ websearch_to_tsquery('simple', left(coalesce(p_query, ''), 2000))
  order by score desc, kc.created_at desc
  limit greatest(1, least(coalesce(p_limit, 6), 12));
$$;

revoke all on function public.search_knowledge_chunks(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.search_knowledge_chunks(uuid, text, integer) to service_role;
