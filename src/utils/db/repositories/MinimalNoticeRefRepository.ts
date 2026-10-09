import {
  type MinimalNoticeRef,
  resolvedMinimalNoticeRefSchema,
  type ResolvedMinimalNoticeRefRow,
} from "@/types/db/schema";
import { sql } from "@/utils/db/client";
import { log } from "@/utils/misc/logger";

/**
 * Persists which memory or task a Minimal tool notice confirmed, and resolves those references
 * against the live rows when context is rebuilt.
 */
class MinimalNoticeRefRepository {
  /** @returns false on error; a lost row only leaves that notice as a bare title in context. */
  async record(messageDiscId: string, ref: MinimalNoticeRef): Promise<boolean> {
    try {
      await sql`
        INSERT INTO minimal_notice_refs (message_disc_id, ref_kind, ref_id)
        VALUES (${messageDiscId}, ${ref.kind}, ${ref.id})
        ON CONFLICT (message_disc_id) DO NOTHING
      `;
      return true;
    } catch (error) {
      log.error(`Error recording minimal notice ref for message ${messageDiscId} (${ref.kind} ${ref.id}):`, error);
      return false;
    }
  }

  /**
   * Joins each referenced notice to its live memory or reminder row in one round trip.
   *
   * @returns an empty map on query failure, since a missing body only degrades context to the title
   */
  async resolveByMessageIds(messageDiscIds: string[]): Promise<Map<string, ResolvedMinimalNoticeRefRow>> {
    const result = new Map<string, ResolvedMinimalNoticeRefRow>();
    if (messageDiscIds.length === 0) {
      return result;
    }

    try {
      const rows = await sql<ResolvedMinimalNoticeRefRow[]>`
        SELECT
          r.message_disc_id,
          r.ref_kind,
          r.ref_id,
          COALESCE(sm.content, pm.content) AS memory_content,
          COALESCE(sm.tags, pm.tags) AS memory_tags,
          rem.reminder_purpose
        FROM minimal_notice_refs r
        LEFT JOIN server_memories sm
          ON r.ref_kind = 'server_memory' AND sm.server_memory_id = r.ref_id
        LEFT JOIN personal_memories pm
          ON r.ref_kind = 'personal_memory' AND pm.personal_memory_id = r.ref_id
        LEFT JOIN reminders rem
          ON r.ref_kind = 'task' AND rem.reminder_id = r.ref_id
        WHERE r.message_disc_id = ANY(${sql.array(messageDiscIds, "TEXT")})
      `;

      for (const row of rows) {
        const parsed = resolvedMinimalNoticeRefSchema.safeParse(row);
        if (!parsed.success) {
          log.warn(`Invalid minimal_notice_refs row for message ${row.message_disc_id}: ${parsed.error.message}`);
          continue;
        }
        result.set(parsed.data.message_disc_id, parsed.data);
      }
    } catch (error) {
      log.error(`Error resolving minimal notice refs (${messageDiscIds.length} ids):`, error);
    }
    return result;
  }

  /** @returns number of rows deleted, or 0 on error */
  async pruneOlderThanDays(retentionDays: number): Promise<number> {
    try {
      const rows = await sql<Array<{ message_disc_id: string }>>`
        DELETE FROM minimal_notice_refs
        WHERE created_at < NOW() - make_interval(days => ${retentionDays})
        RETURNING message_disc_id
      `;
      return rows.length;
    } catch (error) {
      log.error(`Error pruning minimal notice refs older than ${retentionDays} days:`, error);
      return 0;
    }
  }
}

export const minimalNoticeRefRepository = new MinimalNoticeRefRepository();
