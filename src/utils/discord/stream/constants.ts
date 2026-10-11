// Maximum number of empty-response regeneration attempts scheduled by
// maybeScheduleEmptyResponseRetry (postTurnEffects). Lives here (a leaf module) so the stream
// segment processor can consult the remaining retry budget without importing the chat pipeline.
export const MAX_EMPTY_RESPONSE_RETRIES = 2;
// Held drafting prose for one turn. Retention is bounded while collecting because a runaway provider
// would otherwise grow memory until the reviewer rejects it; 64 KiB is far above any Discord reply.
// The segment ceiling covers blank or discarded segments, which retain replay entries but no bytes.
export const MAX_PENDING_RESPONSE_BYTES = 64 * 1024;
export const MAX_PENDING_RESPONSE_SEGMENTS = 4096;
export const STREAM_CHUNK_DEDUP_TAIL_CHARS = 4096;
export const STREAM_CHUNK_DEDUP_MIN_CHARS = 8;
export const ORPHAN_PUNCTUATION_REGEX = /^[.,!?;。！？、，…]+$/;
