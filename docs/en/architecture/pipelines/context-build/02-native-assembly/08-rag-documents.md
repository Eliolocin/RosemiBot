---
title: "02.8: RAG Documents"
---

The RAG document contributor injects relevant text chunks from server-uploaded documents into the prompt using vector similarity retrieval.

## Flow and ownership

The contributor `buildServerDocumentContextItem` in `src/utils/text/context/rag.ts` retrieves document chunks for the user's latest query:

1. **Preconditions**:
   - `isRagAvailable()` must return true (pgvector support enabled).
   - Server must have an active `server_id`.
   - Returns `null` if system memory pressure is `critical` (`memoryGuard.getStatus() === "critical"`).
2. **Query extraction**:
   - Scans recent history for the latest non-system user message.
   - Truncates query text to `DOCUMENT_QUERY_MAX_LENGTH` (1,000 characters). Queries shorter than `DOCUMENT_QUERY_MIN_LENGTH` (3 characters) return `null`.
3. **Scope and credentials**:
   - Checks `serverMemoryRepository.hasDocumentInScope(serverId, personaId)`. If no documents exist for the persona or server, returns `null`.
   - Resolves embedding credentials via `resolveCapabilityCredentials`, supporting server-wide keys or personal BYOK credentials.
   - Loads the configured embedding model via `llmModelRepo.loadEmbeddingModelById`.
4. **Vector retrieval**:
   - Calls `ragRepository.retrieveRelevantChunks` with a similarity threshold of `DOCUMENT_MIN_SIMILARITY` (0.5) and a result limit of `DOCUMENT_MAX_RESULTS` (6 chunks).
   - When `channel_memory_enabled` is true, retrieval filters by the active channel name.
5. **Formatting and emission**:
   - `ragRepository.formatChunksForPrompt` formats matching chunks into document sections.
   - Emits a `user`-role item tagged `KNOWLEDGE_SERVER_DOCUMENTS`.

## Constraints and rationale

- **Memory guard short-circuit**: Under critical host memory pressure, RAG retrieval aborts immediately. This avoids high-memory vector and embedding operations during traffic spikes.
- **Fail-safe fallback**: Database or embedding API failures log a warning and return `null`, allowing context assembly to finish without document chunks.
- **Preset reassembly**: Tagged as `KNOWLEDGE_SERVER_DOCUMENTS`. SillyTavern preset reassembly maps this to `worldInfoBefore`/`worldInfoAfter` markers or flushes it before the first dialogue anchor.

## Source pointers

- `src/utils/text/context/rag.ts`: `buildServerDocumentContextItem` and query extraction.
- `src/utils/db/repositories/RagRepository.ts`: `retrieveRelevantChunks` and chunk formatting.
- `src/utils/db/ragAvailability.ts`: `isRagAvailable` capability check.
- `src/utils/security/rateLimiter.ts`: `memoryGuard` memory pressure status.
