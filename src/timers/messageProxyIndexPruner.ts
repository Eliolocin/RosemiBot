import { messageProxyRepository } from "@/utils/db/repositories/MessageProxyRepository";
import { parsePositiveIntegerEnv } from "@/utils/misc/envFlags";
import { log } from "@/utils/misc/logger";

const DEFAULT_RETENTION_DAYS = 30;
const DEFAULT_PRUNE_INTERVAL_HOURS = 24;
const MS_PER_HOUR = 3_600_000;

let pruneInterval: ReturnType<typeof setInterval> | null = null;

/** The repository logs failures and returns 0, so a failed pass never disturbs the interval. */
async function runPrunePass(retentionDays: number): Promise<void> {
  const deleted = await messageProxyRepository.pruneMessageIndexOlderThanDays(retentionDays);
  if (deleted > 0) {
    log.info(`Pruned ${deleted} message-proxy message-index row(s) older than ${retentionDays} day(s)`);
  }
}

/** The index only needs rows as far back as context building can read. */
export function initializeMessageProxyIndexPruner(): void {
  if (pruneInterval) {
    log.warn("Message proxy index pruner is already running");
    return;
  }

  const retentionDays =
    parsePositiveIntegerEnv(process.env.MESSAGE_PROXY_MESSAGE_INDEX_RETENTION_DAYS) ?? DEFAULT_RETENTION_DAYS;
  const intervalHours =
    parsePositiveIntegerEnv(process.env.MESSAGE_PROXY_MESSAGE_INDEX_PRUNE_INTERVAL_HOURS) ??
    DEFAULT_PRUNE_INTERVAL_HOURS;

  // Sweeps at startup as well so downtime cannot leave a backlog until the first interval. Never
  // awaited: a slow DB must not delay startup readiness.
  void runPrunePass(retentionDays);

  pruneInterval = setInterval(() => {
    void runPrunePass(retentionDays);
  }, intervalHours * MS_PER_HOUR);

  log.info(
    `Message-proxy index pruner started (retention ${retentionDays} day(s), sweep every ${intervalHours} hour(s))`,
  );
}

export function stopMessageProxyIndexPruner(): void {
  if (pruneInterval) {
    clearInterval(pruneInterval);
    pruneInterval = null;
  }
}
