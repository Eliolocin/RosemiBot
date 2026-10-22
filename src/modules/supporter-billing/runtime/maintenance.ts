import { OAuthStateRepository } from "@/utils/db/repositories/OAuthStateRepository";
import type { SQL } from "bun";
import { SupporterWebhookEventRepository, SupporterUsageStatisticsRepository } from "@/modules/supporter-billing/db";
import { sql as defaultSql } from "@/utils/db/client";
import { log } from "@/utils/misc/logger";
import { MemberKeyRepository, withMemberKeyLock } from "@/modules/supporter-billing/db/repositories/memberKeys";

export interface SupporterBillingMaintenanceResult {
  /** Finished (expired/consumed) OAuth-state rows deleted this run. */
  purgedOAuthStates: number;
  /** Aged webhook-event idempotency rows deleted this run. */
  purgedWebhookEvents: number;
  purgedUsageStatistics: number;
}

export interface RunSupporterBillingMaintenanceOptions {
  now?: Date;
  /** DB client used to construct the default repositories (ignored when a repository is injected). */
  client?: SQL;
  oauthStateRepository?: Pick<OAuthStateRepository, "purgeFinishedStates">;
  webhookEventRepository?: Pick<SupporterWebhookEventRepository, "purgeAgedEvents">;
  usageStatisticsRepository?: Pick<SupporterUsageStatisticsRepository, "purgeAgedStatistics">;
}

const MILLISECONDS_PER_SECOND = 1000;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * MILLISECONDS_PER_SECOND;
const USAGE_STATISTICS_RETENTION_DAYS = 90;
const OAUTH_STATE_RETENTION_SECONDS = 3600;
const WEBHOOK_EVENT_RETENTION_DAYS = 30;

export async function runSupporterBillingMaintenance(
  options: RunSupporterBillingMaintenanceOptions = {},
): Promise<SupporterBillingMaintenanceResult> {
  const now = options.now ?? new Date();
  const client = options.client ?? defaultSql;

  const oauthStateRepository = options.oauthStateRepository ?? new OAuthStateRepository(client);
  const webhookEventRepository = options.webhookEventRepository ?? new SupporterWebhookEventRepository(client);

  const result: SupporterBillingMaintenanceResult = {
    purgedOAuthStates: 0,
    purgedWebhookEvents: 0,
    purgedUsageStatistics: 0,
  };

  try {
    const oauthCutoff = new Date(now.getTime() - OAUTH_STATE_RETENTION_SECONDS * MILLISECONDS_PER_SECOND);
    const purge = await oauthStateRepository.purgeFinishedStates(oauthCutoff);
    result.purgedOAuthStates = purge.purgedStates;
    log.metric("supporter_oauth_state_purge", { purgedStates: purge.purgedStates });
  } catch (error) {
    log.error("Supporter periodic OAuth-state purge failed", error);
  }

  try {
    const webhookCutoff = new Date(now.getTime() - WEBHOOK_EVENT_RETENTION_DAYS * MILLISECONDS_PER_DAY);
    const purge = await webhookEventRepository.purgeAgedEvents(webhookCutoff);
    result.purgedWebhookEvents = purge.purgedEvents;
    log.metric("supporter_webhook_event_purge", { purgedEvents: purge.purgedEvents });
  } catch (error) {
    log.error("Supporter periodic webhook-event purge failed", error);
  }

  try {
    const statistics = options.usageStatisticsRepository ?? new SupporterUsageStatisticsRepository(client);
    result.purgedUsageStatistics = await statistics.purgeAgedStatistics(
      new Date(now.getTime() - USAGE_STATISTICS_RETENTION_DAYS * MILLISECONDS_PER_DAY),
    );
  } catch (error) {
    log.error("Supporter periodic usage-statistics purge failed", error);
  }

  try {
    const purged = await withMemberKeyLock(client, (connection) =>
      new MemberKeyRepository(connection).purgeDetachedAccounting(now),
    );
    log.metric("supporter_detached_accounting_purge", { purgedRecords: purged });
  } catch (error) {
    log.error("Supporter periodic detached-accounting purge failed", error);
  }

  return result;
}
