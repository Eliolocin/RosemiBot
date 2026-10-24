import { naturalNudgeRepository } from "@/modules/natural-nudges/db/repositories";
import type { ServerNaturalNudgeConfig } from "@/modules/natural-nudges/db/types";
import { resolveEffectiveChannelIds } from "@/modules/natural-nudges/runtime/channels";
import { computeHeat, heatWindowStart } from "@/modules/natural-nudges/runtime/meters";
import { getCachedAllPersonas } from "@/utils/cache/tomoriStateCache";
import { statRepository } from "@/utils/db/repositories";
import { log } from "@/utils/misc/logger";

/** Heat and automatic channels move over days, so five minutes stale costs a few counted messages at most. */
const GATE_TTL_MS = 5 * 60 * 1000;

/** What the Active Nudge counter needs on every message, so the hot path never queries the database. */
export interface ActiveNudgeGate {
  serverId: number;
  config: ServerNaturalNudgeConfig;
  channelIds: ReadonlySet<string>;
  heat: number;
}

interface GateEntry {
  expiresAt: number;
  /** Shared by every message that arrives while the first read is still loading. */
  gate: Promise<ActiveNudgeGate | null>;
  serverId: number | null;
}

const entries = new Map<string, GateEntry>();

async function loadGate(guildId: string, now: Date): Promise<ActiveNudgeGate | null> {
  const personas = await getCachedAllPersonas(guildId);
  const serverId = personas[0]?.server_id;
  if (serverId === undefined) return null;
  const config = await naturalNudgeRepository.loadServerConfig(serverId);
  if (!config.active_nudges_enabled) return { serverId, config, channelIds: new Set(), heat: 0 };
  const [channelIds, dailyCounts] = await Promise.all([
    resolveEffectiveChannelIds(serverId, config, now),
    statRepository.getServerDailyMessageCounts({ serverId, from: heatWindowStart(now) }),
  ]);
  return { serverId, config, channelIds: new Set(channelIds), heat: computeHeat(dailyCounts, now) };
}

/** Null for a guild with no workspace; a failed read is not cached, so the next message retries. */
export function readActiveNudgeGate(guildId: string): Promise<ActiveNudgeGate | null> {
  const now = new Date();
  const cached = entries.get(guildId);
  if (cached && cached.expiresAt > now.getTime()) return cached.gate;
  const entry: GateEntry = { expiresAt: now.getTime() + GATE_TTL_MS, gate: Promise.resolve(null), serverId: null };
  entry.gate = loadGate(guildId, now).then(
    (gate) => {
      entry.serverId = gate?.serverId ?? null;
      return gate;
    },
    (error) => {
      if (entries.get(guildId) === entry) entries.delete(guildId);
      log.warn("Natural Nudges: could not read Active Nudge settings", error, { metadata: { guildId } });
      return null;
    },
  );
  entries.set(guildId, entry);
  return entry.gate;
}

/** Call after a successful settings write; entries still loading are dropped too, since they may predate it. */
export function invalidateNaturalNudgeConfigCache(serverId: number): void {
  for (const [guildId, entry] of entries) {
    if (entry.serverId === serverId || entry.serverId === null) entries.delete(guildId);
  }
}
