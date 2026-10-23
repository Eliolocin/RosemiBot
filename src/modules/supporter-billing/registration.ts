import { registerSupporterProviderOption } from "@/modules/supporter-billing/discord/providerOption";
import { registerSupporterRequestHook } from "@/modules/supporter-billing/runtime/spendGuard";

/**
 * Registers the spend hold and the Subscription provider option; both read billing state per call, so
 * registration does not depend on whether billing is enabled yet.
 */
export function registerSupporterProviderExtensions(): () => void {
  const disposeRequestHook = registerSupporterRequestHook();
  const disposeOption = registerSupporterProviderOption();
  return () => {
    disposeOption();
    disposeRequestHook();
  };
}
