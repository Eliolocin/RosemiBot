import { metricSampleRepository } from "@/utils/db/repositories/MetricSampleRepository";

const NATURAL_NUDGE_EPISODE_METRIC = "natural_nudge_episode";
const NATURAL_NUDGE_CHIME_IN_METRIC = "natural_nudge_chime_in";

type EpisodeOutcome = "fired" | "aborted" | "failed";
type EpisodePhase = "a" | "b" | "c";

export interface EpisodeSample {
  serverId: number;
  outcome: EpisodeOutcome;
  phase: EpisodePhase;
  /** Fixed-set reason key such as `planner_declined` or `channel_busy`. */
  reason: string;
  heat?: number;
  category?: string;
  /** Built-in key, or `custom` so free-text titles never reach telemetry. */
  episodeKey?: string;
  plannerModel?: string;
  plannerInputTokens?: number;
  plannerOutputTokens?: number;
}

/**
 * One row per episode attempt. Fields are fixed-set strings and numbers only, never message text,
 * persona prose, or names; `recordSample` never throws, so telemetry cannot delay a nudge.
 */
export function recordEpisodeSample(sample: EpisodeSample): void {
  const fields: Record<string, number | string> = {
    server_id: sample.serverId,
    outcome: sample.outcome,
    phase: sample.phase,
    reason: sample.reason,
  };
  if (sample.heat !== undefined) fields.heat = Math.round(sample.heat * 10) / 10;
  if (sample.category) fields.category = sample.category;
  if (sample.episodeKey) fields.episode_key = sample.episodeKey.startsWith("custom:") ? "custom" : sample.episodeKey;
  if (sample.plannerModel) fields.planner_model = sample.plannerModel;
  if (sample.plannerInputTokens !== undefined) fields.planner_tokens_in = sample.plannerInputTokens;
  if (sample.plannerOutputTokens !== undefined) fields.planner_tokens_out = sample.plannerOutputTokens;
  void metricSampleRepository.recordSample(NATURAL_NUDGE_EPISODE_METRIC, fields);
}

export interface ChimeInSample {
  serverId: number;
  outcome: EpisodeOutcome;
  /** `a` before the matcher answers, `c` after the delay. */
  phase: "a" | "c";
  /** Fixed-set reason key such as `matcher_none` or `winner_spoke`. */
  reason: string;
  heat: number;
  matcherKind?: "decision" | "llm";
  matcherModel?: string;
  optionCount?: number;
  margin?: number;
  detour?: boolean;
  /** True when human messages after the delay forced a second matcher call. */
  rematched: boolean;
  matcherInputTokens?: number;
  matcherOutputTokens?: number;
  rematchInputTokens?: number;
  rematchOutputTokens?: number;
}

/** One row per Chime-in check, under the same rules as episode rows: no text, prose, or names. */
export function recordChimeInSample(sample: ChimeInSample): void {
  const fields: Record<string, number | string> = {
    server_id: sample.serverId,
    outcome: sample.outcome,
    phase: sample.phase,
    reason: sample.reason,
    heat: Math.round(sample.heat * 10) / 10,
  };
  if (sample.matcherKind) fields.matcher_kind = sample.matcherKind;
  if (sample.matcherModel) fields.matcher_model = sample.matcherModel;
  if (sample.optionCount !== undefined) fields.option_count = sample.optionCount;
  if (sample.margin !== undefined) fields.margin = Math.round(sample.margin * 1000) / 1000;
  if (sample.detour !== undefined) fields.detour = sample.detour ? 1 : 0;
  fields.rematched = sample.rematched ? 1 : 0;
  if (sample.matcherInputTokens !== undefined) fields.matcher_tokens_in = sample.matcherInputTokens;
  if (sample.matcherOutputTokens !== undefined) fields.matcher_tokens_out = sample.matcherOutputTokens;
  if (sample.rematchInputTokens !== undefined) fields.rematch_tokens_in = sample.rematchInputTokens;
  if (sample.rematchOutputTokens !== undefined) fields.rematch_tokens_out = sample.rematchOutputTokens;
  void metricSampleRepository.recordSample(NATURAL_NUDGE_CHIME_IN_METRIC, fields);
}
