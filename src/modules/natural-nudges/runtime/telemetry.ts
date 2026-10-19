import { metricSampleRepository } from "@/utils/db/repositories/MetricSampleRepository";

const NATURAL_NUDGE_EPISODE_METRIC = "natural_nudge_episode";

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
