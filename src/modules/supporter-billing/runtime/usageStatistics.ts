import {
  supporterUsageStatisticsRepository,
  type SupporterUsageStatisticsRepository,
} from "@/modules/supporter-billing/db";
import type { SupporterFundingContext } from "@/modules/supporter-billing/runtime/types";
import { log } from "@/utils/misc/logger";
import type { ProviderUsageReport } from "@/utils/provider/providerUsage";
import type { TokenUsage } from "@/utils/text/tokenEstimate";

export function createSupporterUsageRecorder(
  funding: SupporterFundingContext | null | undefined,
  modelCodename: string,
): ((usage: TokenUsage) => void) | undefined {
  return funding
    ? (usage) => recordSupporterUsage(funding, { modelCodename, ...usage, costUsd: usage.costUsd })
    : undefined;
}

export type SupporterUsageReport = ProviderUsageReport;

/**
 * Records a member-funded response's reported cost without awaiting storage, because statistics must
 * never delay or fail the inference that produced them.
 */
export function recordSupporterUsage(
  funding: SupporterFundingContext | null | undefined,
  report: SupporterUsageReport,
  repository: Pick<SupporterUsageStatisticsRepository, "record"> = supporterUsageStatisticsRepository,
): void {
  const costUsd = report.costUsd;
  if (!funding || typeof costUsd !== "number" || !Number.isFinite(costUsd) || costUsd < 0) return;
  void repository
    .record({
      supporterIdentityId: funding.sponsorIdentityId,
      fundingScope: funding.fundingScope,
      serverId: funding.serverId,
      capability: funding.capability,
      modelCodename: report.modelCodename,
      costUsd,
      providerRequestId: report.providerRequestId ?? null,
      inputTokens: report.inputTokens ?? null,
      outputTokens: report.outputTokens ?? null,
    })
    .catch((error: unknown) =>
      log.warn("Failed to record subscription usage statistics", error, {
        metadata: { capability: funding.capability, fundingScope: funding.fundingScope },
      }),
    );
}
