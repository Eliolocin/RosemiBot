import type { SQL } from "bun";
import type { z } from "zod";
import { PrivacyLevel } from "@/types/db/schema";
import { sql } from "@/utils/db/client";
import { log } from "@/utils/misc/logger";
import { NATURAL_NUDGE_FAILURE_STOP_THRESHOLD } from "@/modules/natural-nudges/runtime/tuning";
import {
  customIdleNudgeRowSchema,
  defaultServerNaturalNudgeConfig,
  DEFAULT_NATURAL_NUDGE_TALKATIVENESS,
  enabledIdleNudgeServerSchema,
  fireRowSchema,
  personaNaturalNudgeConfigSchema,
  pingUserCandidateSchema,
  runtimeStateSchema,
  serverNaturalNudgeConfigSchema,
  type CustomIdleNudgeInput,
  type CustomIdleNudgeRow,
  type EnabledIdleNudgeServer,
  type NaturalNudgeFireRow,
  type NaturalNudgeInterest,
  type NaturalNudgeRuntimeState,
  type NewActiveNudgeFireRow,
  type NewFireRow,
  type PersonaNaturalNudgeConfig,
  type PingUserCandidate,
  type ServerNaturalNudgeConfig,
  type ServerNaturalNudgeConfigPatch,
} from "@/modules/natural-nudges/db/types";

function parseRows<T>(schema: z.ZodType<T>, rows: unknown[], label: string): T[] {
  const parsed: T[] = [];
  for (const row of rows) {
    const result = schema.safeParse(row);
    if (result.success) parsed.push(result.data);
    else
      log.warn(`Natural Nudges: dropped an unreadable ${label} row`, undefined, {
        metadata: { issues: result.error.issues.length },
      });
  }
  return parsed;
}

const idleNudgeServerRowSchema = enabledIdleNudgeServerSchema.extend({
  config: serverNaturalNudgeConfigSchema.nullable(),
});

class NaturalNudgeRepository {
  async loadServerConfig(serverId: number, client: SQL = sql): Promise<ServerNaturalNudgeConfig> {
    const rows = await client`
      SELECT server_id, idle_nudges_enabled, active_nudges_enabled, channel_disc_ids, llm_id,
        idle_nudge_frequency, active_nudge_frequency, disabled_builtin_idle_nudges
      FROM server_natural_nudge_configs WHERE server_id = ${serverId}
    `;
    const [row] = parseRows(serverNaturalNudgeConfigSchema, rows, "server config");
    return row ?? defaultServerNaturalNudgeConfig(serverId);
  }

  async saveServerConfig(serverId: number, patch: ServerNaturalNudgeConfigPatch, client: SQL = sql): Promise<boolean> {
    const next = { ...(await this.loadServerConfig(serverId, client)), ...patch, server_id: serverId };
    try {
      await client`
        INSERT INTO server_natural_nudge_configs (
          server_id, idle_nudges_enabled, active_nudges_enabled, channel_disc_ids, llm_id,
          idle_nudge_frequency, active_nudge_frequency, disabled_builtin_idle_nudges
        ) VALUES (
          ${serverId}, ${next.idle_nudges_enabled}, ${next.active_nudges_enabled}, ${sql.array(next.channel_disc_ids, "TEXT")},
          ${next.llm_id}, ${next.idle_nudge_frequency}, ${next.active_nudge_frequency},
          ${sql.array(next.disabled_builtin_idle_nudges, "TEXT")}
        )
        ON CONFLICT (server_id) DO UPDATE SET
          idle_nudges_enabled = EXCLUDED.idle_nudges_enabled,
          active_nudges_enabled = EXCLUDED.active_nudges_enabled,
          channel_disc_ids = EXCLUDED.channel_disc_ids,
          llm_id = EXCLUDED.llm_id,
          idle_nudge_frequency = EXCLUDED.idle_nudge_frequency,
          active_nudge_frequency = EXCLUDED.active_nudge_frequency,
          disabled_builtin_idle_nudges = EXCLUDED.disabled_builtin_idle_nudges
      `;
      return true;
    } catch (error) {
      await log.error("Natural Nudges: failed to save server config", error, { metadata: { serverId } });
      return false;
    }
  }

  /**
   * Guild servers with `message_sent` since `since` whose idle nudges are not turned off. Starting from
   * heat rather than config rows is what makes the on-by-default rule reach servers that never saved
   * settings; those get the column defaults.
   */
  async listEnabledIdleNudgeServers(since: Date): Promise<EnabledIdleNudgeServer[]> {
    const rows = await sql`
      SELECT s.server_id, s.server_disc_id, scc.timezone_offset,
        CASE WHEN c.server_id IS NULL THEN NULL ELSE json_build_object(
          'server_id', c.server_id, 'idle_nudges_enabled', c.idle_nudges_enabled,
          'active_nudges_enabled', c.active_nudges_enabled,
          'channel_disc_ids', c.channel_disc_ids, 'llm_id', c.llm_id,
          'idle_nudge_frequency', c.idle_nudge_frequency, 'active_nudge_frequency', c.active_nudge_frequency,
          'disabled_builtin_idle_nudges', c.disabled_builtin_idle_nudges
        ) END AS config
      FROM servers s
      LEFT JOIN server_natural_nudge_configs c ON c.server_id = s.server_id
      LEFT JOIN server_chat_configs scc ON scc.server_id = s.server_id
      WHERE COALESCE(s.is_dm_channel, false) = false
        AND COALESCE(c.idle_nudges_enabled, true)
        AND EXISTS (
          SELECT 1 FROM stat_counters sc
          WHERE sc.server_id = s.server_id
            AND sc.metric = 'message_sent'
            AND sc.bucket >= ${since.toISOString().slice(0, 10)}::date
        )
    `;
    return parseRows(idleNudgeServerRowSchema, rows, "enabled server").map((row) => ({
      ...row,
      config: row.config ?? defaultServerNaturalNudgeConfig(row.server_id),
    }));
  }

  /** Channels with a turn since `since`, minus roleplay channels, where in-character talk is not a lull to fill. */
  async loadAutomaticChannelIds(serverId: number, since: Date): Promise<string[]> {
    const rows = await sql<{ metric_key: string }[]>`
      SELECT DISTINCT sc.metric_key
      FROM stat_counters sc
      LEFT JOIN server_channel_scope_configs scope ON scope.server_id = sc.server_id
      WHERE sc.server_id = ${serverId}
        AND sc.metric = 'channel_turn'
        AND sc.bucket >= ${since.toISOString().slice(0, 10)}::date
        AND NOT (sc.metric_key = ANY(COALESCE(scope.rp_channel_ids, '{}')))
      ORDER BY sc.metric_key
    `;
    return rows.map((row) => row.metric_key);
  }

  async listCustomIdleNudges(serverId: number, client: SQL = sql): Promise<CustomIdleNudgeRow[]> {
    const rows = await client`
      SELECT custom_idle_nudge_id, server_id, category, title, brief, agenda_hint, prerequisites, recommended_tools, enabled
      FROM server_natural_nudge_custom_idle_nudges
      WHERE server_id = ${serverId}
      ORDER BY custom_idle_nudge_id
    `;
    return parseRows(customIdleNudgeRowSchema, rows, "custom idle nudge");
  }

  /** Returns null when the server already holds the maximum number of custom idle nudges. */
  async insertCustomIdleNudge(serverId: number, input: CustomIdleNudgeInput, limit: number): Promise<number | null> {
    try {
      const [row] = await sql<Array<{ custom_idle_nudge_id: number }>>`
        INSERT INTO server_natural_nudge_custom_idle_nudges
          (server_id, category, title, brief, agenda_hint, prerequisites, recommended_tools, enabled)
        SELECT ${serverId}, ${input.category}, ${input.title}, ${input.brief}, ${input.agenda_hint},
          ${sql.array(input.prerequisites, "TEXT")}, ${sql.array(input.recommended_tools, "TEXT")}, ${input.enabled}
        WHERE (SELECT COUNT(*) FROM server_natural_nudge_custom_idle_nudges WHERE server_id = ${serverId}) < ${limit}
        RETURNING custom_idle_nudge_id
      `;
      return row?.custom_idle_nudge_id ?? null;
    } catch (error) {
      await log.error("Natural Nudges: failed to add a custom idle nudge", error, { metadata: { serverId } });
      return null;
    }
  }

  async updateCustomIdleNudge(serverId: number, idleNudgeId: number, input: CustomIdleNudgeInput): Promise<boolean> {
    try {
      const rows = await sql`
        UPDATE server_natural_nudge_custom_idle_nudges SET
          category = ${input.category}, title = ${input.title}, brief = ${input.brief},
          agenda_hint = ${input.agenda_hint}, prerequisites = ${sql.array(input.prerequisites, "TEXT")},
          recommended_tools = ${sql.array(input.recommended_tools, "TEXT")}, enabled = ${input.enabled}
        WHERE server_id = ${serverId} AND custom_idle_nudge_id = ${idleNudgeId}
        RETURNING custom_idle_nudge_id
      `;
      return rows.length > 0;
    } catch (error) {
      await log.error("Natural Nudges: failed to update a custom idle nudge", error, {
        metadata: { serverId, idleNudgeId },
      });
      return false;
    }
  }

  async deleteCustomIdleNudge(serverId: number, idleNudgeId: number): Promise<boolean> {
    try {
      const rows = await sql`
        DELETE FROM server_natural_nudge_custom_idle_nudges
        WHERE server_id = ${serverId} AND custom_idle_nudge_id = ${idleNudgeId}
        RETURNING custom_idle_nudge_id
      `;
      return rows.length > 0;
    } catch (error) {
      await log.error("Natural Nudges: failed to remove a custom idle nudge", error, {
        metadata: { serverId, idleNudgeId },
      });
      return false;
    }
  }

  /** Workspace import replaces the whole collection inside the caller's transaction. */
  async replaceCustomIdleNudges(serverId: number, idleNudges: CustomIdleNudgeInput[], client: SQL): Promise<void> {
    await client`DELETE FROM server_natural_nudge_custom_idle_nudges WHERE server_id = ${serverId}`;
    for (const idleNudge of idleNudges) {
      await client`
        INSERT INTO server_natural_nudge_custom_idle_nudges
          (server_id, category, title, brief, agenda_hint, prerequisites, recommended_tools, enabled)
        VALUES (${serverId}, ${idleNudge.category}, ${idleNudge.title}, ${idleNudge.brief}, ${idleNudge.agenda_hint},
          ${sql.array(idleNudge.prerequisites, "TEXT")}, ${sql.array(idleNudge.recommended_tools, "TEXT")},
          ${idleNudge.enabled})
      `;
    }
  }

  /**
   * Effective persona settings: a stored row wins; an unforked preset pointer reads its preset's
   * defaults live; anything else uses the column defaults.
   */
  async loadPersonaConfigs(personaIds: readonly number[]): Promise<Map<number, PersonaNaturalNudgeConfig>> {
    const configs = new Map<number, PersonaNaturalNudgeConfig>();
    if (personaIds.length === 0) return configs;
    const rows = await sql`
      SELECT p.persona_id,
        COALESCE(c.talkativeness, CASE WHEN p.is_pointer THEN pp.natural_nudge_talkativeness END,
          ${DEFAULT_NATURAL_NUDGE_TALKATIVENESS}) AS talkativeness,
        COALESCE(c.interests, CASE WHEN p.is_pointer THEN pp.natural_nudge_interests END, '[]'::jsonb) AS interests,
        c.persona_id IS NOT NULL AS has_override
      FROM personas p
      LEFT JOIN persona_natural_nudge_configs c ON c.persona_id = p.persona_id
      LEFT JOIN persona_presets pp ON p.is_pointer = true
        AND pp.preset_lineage_id = p.preset_lineage_id
        AND pp.preset_language = p.preset_language
      WHERE p.persona_id = ANY(${sql.array([...personaIds], "INT")})
    `;
    for (const config of parseRows(personaNaturalNudgeConfigSchema, rows, "persona config")) {
      configs.set(config.persona_id, config);
    }
    return configs;
  }

  async savePersonaConfig(
    personaId: number,
    config: { talkativeness: number; interests: NaturalNudgeInterest[] },
    client: SQL = sql,
  ): Promise<boolean> {
    try {
      await client`
        INSERT INTO persona_natural_nudge_configs (persona_id, talkativeness, interests)
        VALUES (${personaId}, ${config.talkativeness}, ${config.interests}::jsonb)
        ON CONFLICT (persona_id) DO UPDATE SET
          talkativeness = EXCLUDED.talkativeness,
          interests = EXCLUDED.interests
      `;
      return true;
    } catch (error) {
      await log.error("Natural Nudges: failed to save persona config", error, { metadata: { personaId } });
      return false;
    }
  }

  /** Freezes the preset's defaults into the persona's own row when a pointer materializes. */
  async copyPresetDefaults(
    client: SQL,
    personaId: number,
    defaults: { talkativeness: number; interests: NaturalNudgeInterest[] },
  ): Promise<void> {
    await client`
      INSERT INTO persona_natural_nudge_configs (persona_id, talkativeness, interests)
      VALUES (${personaId}, ${defaults.talkativeness}, ${defaults.interests}::jsonb)
      ON CONFLICT (persona_id) DO NOTHING
    `;
  }

  /** Re-pointing a persona at a preset drops its own row so it reads the preset's defaults live again. */
  async clearPersonaConfig(client: SQL, personaId: number): Promise<void> {
    await client`DELETE FROM persona_natural_nudge_configs WHERE persona_id = ${personaId}`;
  }

  async deletePersonaConfig(personaId: number): Promise<boolean> {
    try {
      await this.clearPersonaConfig(sql, personaId);
      return true;
    } catch (error) {
      await log.error("Natural Nudges: failed to clear persona config", error, { metadata: { personaId } });
      return false;
    }
  }

  async loadRuntimeState(serverId: number): Promise<NaturalNudgeRuntimeState> {
    const rows = await sql`
      SELECT server_id, idle_nudge_jitter, consecutive_failures, stopped_at
      FROM server_natural_nudge_runtime_state WHERE server_id = ${serverId}
    `;
    const [row] = parseRows(runtimeStateSchema, rows, "runtime state");
    return row ?? { server_id: serverId, idle_nudge_jitter: 1, consecutive_failures: 0, stopped_at: null };
  }

  async setIdleNudgeJitter(serverId: number, jitter: number): Promise<void> {
    await sql`
      INSERT INTO server_natural_nudge_runtime_state (server_id, idle_nudge_jitter)
      VALUES (${serverId}, ${jitter})
      ON CONFLICT (server_id) DO UPDATE SET idle_nudge_jitter = EXCLUDED.idle_nudge_jitter, updated_at = NOW()
    `;
  }

  /** Counts one failure and stamps `stopped_at` when the run reaches the stop threshold. */
  async recordFailure(serverId: number): Promise<NaturalNudgeRuntimeState | null> {
    const rows = await sql`
      INSERT INTO server_natural_nudge_runtime_state (server_id, consecutive_failures, stopped_at)
      VALUES (${serverId}, 1, NULL)
      ON CONFLICT (server_id) DO UPDATE SET
        consecutive_failures = server_natural_nudge_runtime_state.consecutive_failures + 1,
        stopped_at = CASE
          WHEN server_natural_nudge_runtime_state.consecutive_failures + 1 >= ${NATURAL_NUDGE_FAILURE_STOP_THRESHOLD}
            THEN COALESCE(server_natural_nudge_runtime_state.stopped_at, NOW())
          ELSE server_natural_nudge_runtime_state.stopped_at
        END,
        updated_at = NOW()
      RETURNING server_id, idle_nudge_jitter, consecutive_failures, stopped_at
    `;
    return parseRows(runtimeStateSchema, rows, "runtime state")[0] ?? null;
  }

  async clearFailures(serverId: number): Promise<void> {
    await sql`
      UPDATE server_natural_nudge_runtime_state
      SET consecutive_failures = 0, stopped_at = NULL, updated_at = NOW()
      WHERE server_id = ${serverId} AND (consecutive_failures <> 0 OR stopped_at IS NOT NULL)
    `;
  }

  /** Fires inside the lookback window plus the newest idle nudges beyond it, enough for every derived meter. */
  async loadFireHistory(
    serverId: number,
    since: Date,
    latestIdleNudgeCount: number,
  ): Promise<{ recent: NaturalNudgeFireRow[]; latestIdleNudges: NaturalNudgeFireRow[] }> {
    const [recentRows, latestRows] = await Promise.all([
      sql`
        SELECT fire_id, server_id, channel_disc_id, persona_id, mode, category, idle_nudge_key, target_user_id,
          opener_message_disc_id, answered, fired_at
        FROM natural_nudge_fires
        WHERE server_id = ${serverId} AND fired_at >= ${since}
        ORDER BY fired_at DESC
      `,
      sql`
        SELECT fire_id, server_id, channel_disc_id, persona_id, mode, category, idle_nudge_key, target_user_id,
          opener_message_disc_id, answered, fired_at
        FROM natural_nudge_fires
        WHERE server_id = ${serverId} AND mode = 'idle'
        ORDER BY fired_at DESC
        LIMIT ${latestIdleNudgeCount}
      `,
    ]);
    return {
      recent: parseRows(fireRowSchema, recentRows, "fire"),
      latestIdleNudges: parseRows(fireRowSchema, latestRows, "fire"),
    };
  }

  async setFireAnswered(fireId: number, answered: boolean): Promise<void> {
    await sql`UPDATE natural_nudge_fires SET answered = ${answered} WHERE fire_id = ${fireId} AND answered IS NULL`;
  }

  /**
   * The fire row and its agendas land together, so a persona never pursues an agenda that has no fire.
   * A Play Scene passes one agenda per speaker, all anchored to the opener.
   */
  async recordIdleNudgeFire(
    fire: NewFireRow,
    agendas: ReadonlyArray<{ personaId: number; agenda: string }>,
  ): Promise<boolean> {
    try {
      await sql.transaction(async (tx) => {
        await tx`
          INSERT INTO natural_nudge_fires
            (server_id, channel_disc_id, persona_id, mode, category, idle_nudge_key, target_user_id,
              opener_message_disc_id)
          VALUES (${fire.serverId}, ${fire.channelDiscId}, ${fire.personaId}, 'idle', ${fire.category},
            ${fire.idleNudgeKey}, ${fire.targetUserId}, ${fire.openerMessageDiscId})
        `;
        for (const { personaId, agenda } of agendas) {
          await tx`
            INSERT INTO natural_nudge_agendas (message_disc_id, persona_id, agenda, target_user_id)
            VALUES (${fire.openerMessageDiscId}, ${personaId}, ${agenda}, ${fire.targetUserId})
            ON CONFLICT (message_disc_id, persona_id) DO UPDATE
            SET agenda = EXCLUDED.agenda, target_user_id = EXCLUDED.target_user_id
          `;
        }
        await tx`
          UPDATE server_natural_nudge_runtime_state
          SET consecutive_failures = 0, updated_at = NOW()
          WHERE server_id = ${fire.serverId} AND consecutive_failures <> 0
        `;
      });
      return true;
    } catch (error) {
      await log.error("Natural Nudges: failed to record an idle nudge fire", error, {
        metadata: { serverId: fire.serverId, personaId: fire.personaId },
      });
      return false;
    }
  }

  async recordActiveNudgeFire(fire: NewActiveNudgeFireRow): Promise<boolean> {
    try {
      await sql.transaction(async (tx) => {
        await tx`
          INSERT INTO natural_nudge_fires
            (server_id, channel_disc_id, persona_id, mode, opener_message_disc_id, detour)
          VALUES (${fire.serverId}, ${fire.channelDiscId}, ${fire.personaId}, 'active',
            ${fire.openerMessageDiscId}, ${fire.detour})
        `;
        await tx`
          UPDATE server_natural_nudge_runtime_state
          SET consecutive_failures = 0, updated_at = NOW()
          WHERE server_id = ${fire.serverId} AND consecutive_failures <> 0
        `;
      });
      return true;
    } catch (error) {
      await log.error("Natural Nudges: failed to record an Active Nudge fire", error, {
        metadata: { serverId: fire.serverId, personaId: fire.personaId },
      });
      return false;
    }
  }

  /** Read fresh, never through `userCache`, so an opt-out made a moment ago already excludes the user. */
  async listPingUserCandidates(args: {
    serverId: number;
    personaId: number;
    personaLineageId: number;
    interactedSince: Date;
    memorySince: Date;
    onlyUserId?: number;
  }): Promise<PingUserCandidate[]> {
    const rows = await sql`
      WITH turns_here AS (
        SELECT sc.user_id, SUM(sc.count) AS turns
        FROM stat_counters sc
        WHERE sc.server_id = ${args.serverId}
          AND sc.metric = 'message_sent'
          AND sc.persona_lineage_id = ${args.personaLineageId}
          AND sc.bucket >= ${args.interactedSince.toISOString().slice(0, 10)}::date
        GROUP BY sc.user_id
      )
      SELECT u.user_id, u.user_disc_id, COALESCE(u.privacy_level, 0) AS privacy_level,
        turns_here.turns AS local_turns, COALESCE(memory.recent, 0) AS ltm_recent
      FROM turns_here
      JOIN users u ON u.user_id = turns_here.user_id
      LEFT JOIN user_personalization_configs upc ON upc.user_id = u.user_id
      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS recent
        FROM personal_memories pm
        WHERE pm.user_id = u.user_id AND pm.persona_lineage_id IN (${args.personaLineageId}, 0)
          AND GREATEST(pm.created_at, pm.updated_at) >= ${args.memorySince}
      ) memory ON true
      WHERE turns_here.turns > 0
        ${args.onlyUserId === undefined ? sql`` : sql`AND u.user_id = ${args.onlyUserId}`}
        AND NOT COALESCE(upc.natural_nudge_opt_out, false)
        AND COALESCE(u.privacy_level, 0) <> ${PrivacyLevel.FULL}
        AND NOT EXISTS (
          SELECT 1 FROM personalization_blacklist pb
          WHERE pb.server_id = ${args.serverId} AND pb.user_disc_id = u.user_disc_id
        )
        AND NOT EXISTS (
          SELECT 1 FROM persona_user_blocks pub
          WHERE pub.server_id = ${args.serverId} AND pub.persona_id = ${args.personaId}
            AND pub.user_disc_id = u.user_disc_id AND pub.expires_at > NOW()
        )
    `;
    return parseRows(pingUserCandidateSchema, rows, "Ping User nudge candidate");
  }

  /** Agendas owned by one persona among the given messages, keyed by message ID. */
  async loadAgendas(personaId: number, messageDiscIds: readonly string[]): Promise<Map<string, string>> {
    const agendas = new Map<string, string>();
    if (messageDiscIds.length === 0) return agendas;
    const rows = await sql<Array<{ message_disc_id: string; agenda: string }>>`
      SELECT message_disc_id, agenda FROM natural_nudge_agendas
      WHERE persona_id = ${personaId} AND message_disc_id = ANY(${sql.array([...messageDiscIds], "TEXT")})
    `;
    for (const row of rows) agendas.set(row.message_disc_id, row.agenda);
    return agendas;
  }

  async pruneBefore(firesBefore: Date, agendasBefore: Date): Promise<{ fires: number; agendas: number }> {
    const [fires, agendas] = await Promise.all([
      sql`DELETE FROM natural_nudge_fires WHERE fired_at < ${firesBefore} RETURNING fire_id`,
      sql`DELETE FROM natural_nudge_agendas WHERE created_at < ${agendasBefore} RETURNING message_disc_id`,
    ]);
    return { fires: fires.length, agendas: agendas.length };
  }
}

export const naturalNudgeRepository = new NaturalNudgeRepository();
