import type { ResolvedRangeSelection } from "@/types/discord/panel";
import { log } from "@/utils/misc/logger";
import { DISCORD_SELECT_OPTIONS_MAX } from "@/utils/discord/ui/componentsV2Limits";

export {
  ComponentsV2LimitError,
  deliverGuardedPanel,
  buildPanelFallbackPayload,
  isProductionEnvironment,
  validateAndFallbackPanelPayload,
  type GuardedPanelDeliveryTarget,
  type GuardedPanelDeliveryMethod,
  type GuardedPanelDeliveryOptions,
} from "@/utils/discord/ui/interactionCore";

export const MODERATION_PANEL_RANGE_SIZE = 10;

/**
 * Discord closes the initial-response window three seconds after an interaction is created.
 */
const INTERACTION_ACK_DEADLINE_MS = 3_000;

/**
 * How long an acknowledgement may take before the deadline is treated as unreachable.
 *
 * Reported, never enforced: cancelling the request would trade a slow ack for no ack at all, and
 * the request that lands after this still beats the deadline. Nothing downstream of the ack is
 * affected, so the only cost of a late one is the operator response.
 */
const INTERACTION_ACK_WARN_MS = 1_500;

export interface PanelInteractionStart<T> {
  /**
   * The acknowledgement itself, raised before any authorization or state load.
   *
   * A step rather than a direct `deferUpdate()` so the timing guard lives in one place;
   * defaults to `interaction.deferUpdate()`.
   */
  acknowledge?(): Promise<unknown>;
  authorize(): boolean | Promise<boolean>;
  onDenied(): Promise<unknown>;
  load(): Promise<T | null>;
  onMissing(): Promise<unknown>;
}

export interface DeferredPanelInteraction {
  deferUpdate(): Promise<unknown>;
  /**
   * When Discord created the interaction, used to measure how much of the three-second window an
   * acknowledgement consumed. Absent on hand-rolled test doubles.
   */
  createdTimestamp?: number;
}

/**
 * Acknowledges a routed panel interaction and records how late it was.
 *
 * `route` is carried into the metric because the interaction's custom id already names the
 * namespace, and the failing routes are distinguished by action rather than by panel.
 */
export async function acknowledgePanelInteraction(
  interaction: DeferredPanelInteraction & { deferUpdate(): Promise<unknown> },
  route: string,
): Promise<void> {
  const startedAt = interaction.createdTimestamp;
  await interaction.deferUpdate();

  if (typeof startedAt !== "number") return;

  const elapsedMs = Date.now() - startedAt;
  if (elapsedMs >= INTERACTION_ACK_WARN_MS) {
    log.rateLimit("Panel interaction acknowledged late", {
      route,
      ackLatencyMs: elapsedMs,
      deadlineMs: INTERACTION_ACK_DEADLINE_MS,
    });
  }
}

export async function beginPanelInteraction<T>(
  interaction: DeferredPanelInteraction,
  steps: PanelInteractionStart<T>,
): Promise<T | null> {
  await (steps.acknowledge?.() ?? interaction.deferUpdate());

  if (!(await steps.authorize())) {
    await steps.onDenied();
    return null;
  }
  const state = await steps.load();
  if (!state) {
    await steps.onMissing();
    return null;
  }
  return state;
}

export async function performPanelAction<TResult, TState>(
  action: () => Promise<TResult>,
  reload: () => Promise<TState | null>,
): Promise<{ result: TResult; state: TState | null }> {
  const result = await action();
  return { result, state: await reload() };
}

export function resolveRangeSelection<T>(
  items: readonly T[],
  requestedRange = 0,
  range: number | { reservedOptions: number } = MODERATION_PANEL_RANGE_SIZE,
): ResolvedRangeSelection<T> {
  const rangeSize = typeof range === "number" ? range : DISCORD_SELECT_OPTIONS_MAX - range.reservedOptions;
  if (rangeSize < 1) throw new RangeError("Select actions leave no room for records");
  const rangeCount = Math.max(1, Math.ceil(items.length / rangeSize));
  const rangeIndex = Math.min(Math.max(requestedRange, 0), rangeCount - 1);
  const start = rangeIndex * rangeSize;

  return {
    rangeIndex,
    rangeCount,
    totalCount: items.length,
    visibleItems: items.slice(start, start + rangeSize),
  };
}
