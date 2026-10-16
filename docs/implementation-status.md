# Implementation status

## Branch: `feat/knowledge-builder-foundation`

This branch adds the first React/Vite frontend foundation for MobiWave WhatsApp, focused on the source-restricted knowledge builder and curated AI memory.

### Implemented in this branch
- Responsive dashboard shell and navigation.
- Knowledge-source list with URL validation, duplicate detection, local add/remove, search and crawl-scope selection.
- AI memory review screen with local approve/remove interactions.
- Chatbot settings preview for AI pause, approved-knowledge-only behaviour and handoff intent.
- Overview checklist and clear UI labels where services are not connected.
- Product and architecture documentation for submitted-source-only ingestion and tenant-isolated memory.

### Not implemented yet
- Authentication, persistent database, tenant memberships and RLS.
- Real website crawling, SSRF-safe fetch worker, extraction, deduplication, embeddings or search.
- Persistent AI memory, approval audit trail or conversation-based memory suggestions.
- Meta WhatsApp Cloud API, webhook verification, outbound messages, campaigns and shared inbox.
- Production secrets, hosting, monitoring, CI build checks and end-to-end tests.

### Important
The sample entries are clearly labelled as sample data and browser state only. Adding a URL does not fetch or index it. The application must not claim a source is indexed until a backend ingestion job has completed successfully.
