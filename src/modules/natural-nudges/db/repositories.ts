import type { SQL } from "bun";
import type { z } from "zod";
import { sql } from "@/utils/db/client";
import { log } from "@/utils/misc/logger";
import { NATURAL_NUDGE_FAILURE_STOP_THRESHOLD } from "@/modules/natural-nudges/runtime/tuning";
import {
  customEpisodeRowSchema,
  defaultServerNaturalNudgeConfig,
  DEFAULT_NATURAL_NUDGE_TALKATIVENESS,
  enabledEpisodeServerSchema,
  fireRowSchema,
  personaNaturalNudgeConfigSchema,
  runtimeStateSchema,
  serverNaturalNudgeConfigSchema,
  type CustomEpisodeInput,
  type CustomEpisodeRow,
  type EnabledEpisodeServer,
  type NaturalNudgeFireRow,
  type NaturalNudgeInterest,
  type NaturalNudgeRuntimeState,
  type NewFireRow,
  type PersonaNaturalNudgeConfig,
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

const episodeServerRowSchema = enabledEpisodeServerSchema.extend({
  config: serverNaturalNudgeConfigSchema.nullable(),
});

class NaturalNudgeRepository {
  async loadServerConfig(serverId: number, client: SQL = sql): Promise<ServerNaturalNudgeConfig> {
    const rows = await client`
      SELECT server_id, episodes_enabled, channel_disc_ids, llm_id,
        reach_out_weight, revive_weight, new_topic_weight, alter_talk_weight,
        daily_episode_cap, episode_frequency, disabled_builtin_episodes
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
          server_id, episodes_enabled, channel_disc_ids, llm_id,
          reach_out_weight, revive_weight, new_topic_weight, alter_talk_weight,
          daily_episode_cap, episode_frequency, disabled_builtin_episodes
        ) VALUES (
          ${serverId}, ${next.episodes_enabled}, ${sql.array(next.channel_disc_ids, "TEXT")}, ${next.llm_id},
          ${next.reach_out_weight}, ${next.revive_weight}, ${next.new_topic_weight}, ${next.alter_talk_weight},
          ${next.daily_episode_cap}, ${next.episode_frequency}, ${sql.array(next.disabled_builtin_episodes, "TEXT")}
        )
        ON CONFLICT (server_id) DO UPDATE SET
          episodes_enabled = EXCLUDED.episodes_enabled,
          channel_disc_ids = EXCLUDED.channel_disc_ids,
          llm_id = EXCLUDED.llm_id,
          reach_out_weight = EXCLUDED.reach_out_weight,
          revive_weight = EXCLUDED.revive_weight,
          new_topic_weight = EXCLUDED.new_topic_weight,
          alter_talk_weight = EXCLUDED.alter_talk_weight,
          daily_episode_cap = EXCLUDED.daily_episode_cap,
          episode_frequency = EXCLUDED.episode_frequency,
          disabled_builtin_episodes = EXCLUDED.disabled_builtin_episodes
      `;
      return true;
    } catch (error) {
      await log.error("Natural Nudges: failed to save server config", error, { metadata: { serverId } });
      return false;
    }
  }

  /**
   * Guild servers with `message_sent` since `since` whose episodes are not turned off. Starting from
   * heat rather than config rows is what makes the on-by-default rule reach servers that never saved
   * settings; those get the column defaults.
   */
  async listEnabledEpisodeServers(since: Date): Promise<EnabledEpisodeServer[]> {
    const rows = await sql`
      SELECT s.server_id, s.server_disc_id, scc.timezone_offset,
        CASE WHEN c.server_id IS NULL THEN NULL ELSE json_build_object(
          'server_id', c.server_id, 'episodes_enabled', c.episodes_enabled,
          'channel_disc_ids', c.channel_disc_ids, 'llm_id', c.llm_id,
          'reach_out_weight', c.reach_out_weight, 'revive_weight', c.revive_weight,
          'new_topic_weight', c.new_topic_weight, 'alter_talk_weight', c.alter_talk_weight,
          'daily_episode_cap', c.daily_episode_cap, 'episode_frequency', c.episode_frequency,
          'disabled_builtin_episodes', c.disabled_builtin_episodes
        ) END AS config
      FROM servers s
      LEFT JOIN server_natural_nudge_configs c ON c.server_id = s.server_id
      LEFT JOIN server_chat_configs scc ON scc.server_id = s.server_id
      WHERE COALESCE(s.is_dm_channel, false) = false
        AND COALESCE(c.episodes_enabled, true)
        AND EXISTS (
          SELECT 1 FROM stat_counters sc
          WHERE sc.server_id = s.server_id
            AND sc.metric = 'message_sent'
            AND sc.bucket >= ${since.toISOString().slice(0, 10)}::date
        )
    `;
    return parseRows(episodeServerRowSchema, rows, "enabled server").map((row) => ({
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

  async listCustomEpisodes(serverId: number, client: SQL = sql): Promise<CustomEpisodeRow[]> {
    const rows = await client`
      SELECT episode_id, server_id, category, title, brief, agenda_hint, prerequisites, recommended_tools, enabled
      FROM server_natural_nudge_episodes
      WHERE server_id = ${serverId}
      ORDER BY episode_id
    `;
    return parseRows(customEpisodeRowSchema, rows, "custom episode");
  }

  /** Returns null when the server already holds the maximum number of custom episodes. */
  async insertCustomEpisode(serverId: number, input: CustomEpisodeInput, limit: number): Promise<number | null> {
    try {
      const [row] = await sql<Array<{ episode_id: number }>>`
        INSERT INTO server_natural_nudge_episodes
          (server_id, category, title, brief, agenda_hint, prerequisites, recommended_tools, enabled)
        SELECT ${serverId}, ${input.category}, ${input.title}, ${input.brief}, ${input.agenda_hint},
          ${sql.array(input.prerequisites, "TEXT")}, ${sql.array(input.recommended_tools, "TEXT")}, ${input.enabled}
        WHERE (SELECT COUNT(*) FROM server_natural_nudge_episodes WHERE server_id = ${serverId}) < ${limit}
        RETURNING episode_id
      `;
      return row?.episode_id ?? null;
    } catch (error) {
      await log.error("Natural Nudges: failed to add a custom episode", error, { metadata: { serverId } });
      return null;
    }
  }

  async updateCustomEpisode(serverId: number, episodeId: number, input: CustomEpisodeInput): Promise<boolean> {
    try {
      const rows = await sql`
        UPDATE server_natural_nudge_episodes SET
          category = ${input.category}, title = ${input.title}, brief = ${input.brief},
          agenda_hint = ${input.agenda_hint}, prerequisites = ${sql.array(input.prerequisites, "TEXT")},
          recommended_tools = ${sql.array(input.recommended_tools, "TEXT")}, enabled = ${input.enabled}
        WHERE server_id = ${serverId} AND episode_id = ${episodeId}
        RETURNING episode_id
      `;
      return rows.length > 0;
    } catch (error) {
      await log.error("Natural Nudges: failed to update a custom episode", error, {
        metadata: { serverId, episodeId },
      });
      return false;
    }
  }

  async deleteCustomEpisode(serverId: number, episodeId: number): Promise<boolean> {
    try {
      const rows = await sql`
        DELETE FROM server_natural_nudge_episodes
        WHERE server_id = ${serverId} AND episode_id = ${episodeId}
        RETURNING episode_id
      `;
      return rows.length > 0;
    } catch (error) {
      await log.error("Natural Nudges: failed to remove a custom episode", error, {
        metadata: { serverId, episodeId },
      });
      return false;
    }
  }

  /** Workspace import replaces the whole collection inside the caller's transaction. */
  async replaceCustomEpisodes(serverId: number, episodes: CustomEpisodeInput[], client: SQL): Promise<void> {
    await client`DELETE FROM server_natural_nudge_episodes WHERE server_id = ${serverId}`;
    for (const episode of episodes) {
      await client`
        INSERT INTO server_natural_nudge_episodes
          (server_id, category, title, brief, agenda_hint, prerequisites, recommended_tools, enabled)
        VALUES (${serverId}, ${episode.category}, ${episode.title}, ${episode.brief}, ${episode.agenda_hint},
          ${sql.array(episode.prerequisites, "TEXT")}, ${sql.array(episode.recommended_tools, "TEXT")},
          ${episode.enabled})
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
      SELECT server_id, episode_jitter, consecutive_failures, stopped_at
      FROM server_natural_nudge_runtime_state WHERE server_id = ${serverId}
    `;
    const [row] = parseRows(runtimeStateSchema, rows, "runtime state");
    return row ?? { server_id: serverId, episode_jitter: 1, consecutive_failures: 0, stopped_at: null };
  }

  async setEpisodeJitter(serverId: number, jitter: number): Promise<void> {
    await sql`
      INSERT INTO server_natural_nudge_runtime_state (server_id, episode_jitter)
      VALUES (${serverId}, ${jitter})
      ON CONFLICT (server_id) DO UPDATE SET episode_jitter = EXCLUDED.episode_jitter, updated_at = NOW()
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
      RETURNING server_id, episode_jitter, consecutive_failures, stopped_at
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

  /** Fires inside the lookback window plus the newest episodes beyond it, enough for every derived meter. */
  async loadFireHistory(
    serverId: number,
    since: Date,
    latestEpisodeCount: number,
  ): Promise<{ recent: NaturalNudgeFireRow[]; latestEpisodes: NaturalNudgeFireRow[] }> {
    const [recentRows, latestRows] = await Promise.all([
      sql`
        SELECT fire_id, server_id, channel_disc_id, persona_id, mode, category, episode_key,
          opener_message_disc_id, answered, fired_at
        FROM natural_nudge_fires
        WHERE server_id = ${serverId} AND fired_at >= ${since}
        ORDER BY fired_at DESC
      `,
      sql`
        SELECT fire_id, server_id, channel_disc_id, persona_id, mode, category, episode_key,
          opener_message_disc_id, answered, fired_at
        FROM natural_nudge_fires
        WHERE server_id = ${serverId} AND mode = 'episode'
        ORDER BY fired_at DESC
        LIMIT ${latestEpisodeCount}
      `,
    ]);
    return {
      recent: parseRows(fireRowSchema, recentRows, "fire"),
      latestEpisodes: parseRows(fireRowSchema, latestRows, "fire"),
    };
  }

  async setFireAnswered(fireId: number, answered: boolean): Promise<void> {
    await sql`UPDATE natural_nudge_fires SET answered = ${answered} WHERE fire_id = ${fireId} AND answered IS NULL`;
  }

  /** The fire row and its agenda land together, so a persona never pursues an agenda that has no fire. */
  async recordEpisodeFire(fire: NewFireRow, agenda: string | null): Promise<boolean> {
    try {
      await sql.transaction(async (tx) => {
        await tx`
          INSERT INTO natural_nudge_fires
            (server_id, channel_disc_id, persona_id, mode, category, episode_key, opener_message_disc_id)
          VALUES (${fire.serverId}, ${fire.channelDiscId}, ${fire.personaId}, 'episode', ${fire.category},
            ${fire.episodeKey}, ${fire.openerMessageDiscId})
        `;
        if (agenda) {
          await tx`
            INSERT INTO natural_nudge_agendas (message_disc_id, persona_id, agenda)
            VALUES (${fire.openerMessageDiscId}, ${fire.personaId}, ${agenda})
            ON CONFLICT (message_disc_id, persona_id) DO UPDATE SET agenda = EXCLUDED.agenda
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
      await log.error("Natural Nudges: failed to record an episode fire", error, {
        metadata: { serverId: fire.serverId, personaId: fire.personaId },
      });
      return false;
    }
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
