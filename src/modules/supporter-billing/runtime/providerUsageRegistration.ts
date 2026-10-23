import { findSupporterRequestDeniedError } from "@/modules/supporter-billing/runtime/funding";
import { getSupporterFundingFromUsageContext } from "@/modules/supporter-billing/runtime/types";
import { recordSupporterUsage } from "@/modules/supporter-billing/runtime/usageStatistics";
import {
  registerProviderRequestDenialTranslator,
  registerProviderUsageReporter,
  type ProviderRequestDeniedError,
  type ProviderUsageContext,
  type ProviderUsageReport,
} from "@/utils/provider/providerUsage";

export function recordSupporterProviderUsage(context: ProviderUsageContext, report: ProviderUsageReport): void {
  recordSupporterUsage(context.supporterFunding, report);
}

export function translateSupporterProviderDenial(
  error: unknown,
  context: ProviderUsageContext,
): ProviderRequestDeniedError | null {
  const funding = getSupporterFundingFromUsageContext(context);
  return funding ? findSupporterRequestDeniedError(error, funding) : null;
}

// The reporter and translator must exist before the first funded request, even if billing is enabled after this module loads.
registerProviderUsageReporter(recordSupporterProviderUsage);
registerProviderRequestDenialTranslator(translateSupporterProviderDenial);
