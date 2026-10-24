import {
  initializeSupporterBilling,
  isSupporterBillingEnabled,
  registerSupporterProviderExtensions,
} from "@/modules/supporter-billing";
import type { AppEnvironment } from "@/types/config";
import { log } from "@/utils/misc/logger";

export async function initSupporterBilling(environment: AppEnvironment): Promise<void> {
  registerSupporterProviderExtensions();
  if (!isSupporterBillingEnabled(environment)) {
    return;
  }

  log.section("Initializing Supporter Billing...");

  try {
    const result = await initializeSupporterBilling({ environment });
    if (result.enabled) {
      log.success("Supporter billing config validated and billing schema initialized");
    }
  } catch (error) {
    await log.error("Supporter billing initialization failed", error);
    process.exit(1);
  }
}
