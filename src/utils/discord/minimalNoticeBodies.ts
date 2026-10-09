import type { MinimalNoticeRef, ResolvedMinimalNoticeRefRow } from "@/types/db/schema";
import { minimalNoticeRefRepository } from "@/utils/db/repositories/MinimalNoticeRefRepository";
import { extractNoticeTextFromComponents } from "@/utils/discord/componentNoticeReader";
import { classifyProtocolTitle, isMinimalTitleKind } from "@/utils/discord/embedProtocol";
import { formatMemoryWithId } from "@/utils/memory/memoryId";
import { log } from "@/utils/misc/logger";

const RETENTION_DAYS = 30;
// Pruning piggybacks on the write path because production has no scheduled jobs.
const PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1000;

let lastPruneAt = 0;

/**
 * Remembers which memory or task a Minimal notice confirmed, so context rebuilding can restore the
 * body the card no longer shows. Failures are logged and swallowed: a lost row only leaves the
 * notice as a bare title.
 */
export async function recordMinimalNoticeRef(messageDiscId: string, ref: MinimalNoticeRef): Promise<void> {
  await minimalNoticeRefRepository.record(messageDiscId, ref);
  void pruneIfDue();
}

async function pruneIfDue(): Promise<void> {
  const now = Date.now();
  if (now - lastPruneAt < PRUNE_INTERVAL_MS) {
    return;
  }
  lastPruneAt = now;

  const deleted = await minimalNoticeRefRepository.pruneOlderThanDays(RETENTION_DAYS);
  if (deleted > 0) {
    log.info(`[MinimalNoticeRefs] Pruned ${deleted} rows older than ${RETENTION_DAYS} days`);
  }
}

function isBodylessMinimalNotice(components: readonly unknown[] | undefined): boolean {
  const notice = extractNoticeTextFromComponents(components);
  return Boolean(notice?.title && !notice.description && isMinimalTitleKind(classifyProtocolTitle(notice.title)));
}

/**
 * Renders a resolved reference in the same `ID:n` form the memory and pending-task context lines
 * use, so the model can match the notice to the row it already sees.
 */
export function formatMinimalNoticeBody(row: ResolvedMinimalNoticeRefRow): string | null {
  if (row.ref_kind === "task") {
    return row.reminder_purpose === null ? null : `ID:${row.ref_id} "${row.reminder_purpose}"`;
  }
  return row.memory_content === null ? null : formatMemoryWithId(row.ref_id, row.memory_content, row.memory_tags ?? []);
}

/**
 * Restores the bodies of Minimal notices in a history window from the live rows they reference.
 * Queries only when the window holds a title-only notice, so most context builds cost nothing.
 *
 * @returns message ID to body, for notices whose referenced row still exists
 */
export async function resolveMinimalNoticeBodies(
  messages: Iterable<{ id: string; components?: readonly unknown[] }>,
): Promise<Map<string, string>> {
  const candidateIds: string[] = [];
  for (const message of messages) {
    if (isBodylessMinimalNotice(message.components)) {
      candidateIds.push(message.id);
    }
  }

  const bodies = new Map<string, string>();
  if (candidateIds.length === 0) {
    return bodies;
  }

  const rows = await minimalNoticeRefRepository.resolveByMessageIds(candidateIds);
  for (const [messageDiscId, row] of rows) {
    const body = formatMinimalNoticeBody(row);
    if (body !== null) {
      bodies.set(messageDiscId, body);
    }
  }
  return bodies;
}
