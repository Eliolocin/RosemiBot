import type { StreamResult } from "@/types/provider/interfaces";

/** Room left for held prose in the current turn, shared across tool-loop passes. */
export interface PendingResponseLimit {
  maxBytes: number;
  maxSegments: number;
}

/**
 * Why collection stopped before the provider finished. The first two mirror the caps ordinary
 * streaming applies while sending; `retention_limit` is the fixed ceiling for held text.
 */
export type PendingResponseTruncation = "send_message_limit" | "flush_limit" | "retention_limit";

/** Normalized public prose and its original presentation, held until the turn chooses it. */
export interface PendingStreamResponse {
  text: string;
  /** UTF-8 bytes of the raw replay segments, counted against the turn's retention ceiling. */
  retainedBytes: number;
  segments: number;
  truncation?: PendingResponseTruncation;
  deliver(abortSignal?: AbortSignal): Promise<StreamResult>;
}
