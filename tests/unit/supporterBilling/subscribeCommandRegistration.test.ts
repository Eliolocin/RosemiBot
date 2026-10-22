import { afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { loadCommandData, resetCommandDataCache, ROOT_COMMAND_EXECUTION_KEY } from "@/utils/discord/commandLoader";
import { initializeLocalizer } from "@/utils/text/localizer";

type EnvSnapshot = {
  runEnv: string | undefined;
  supporterBillingEnabled: string | undefined;
};

function snapshotEnv(): EnvSnapshot {
  return {
    runEnv: process.env.RUN_ENV,
    supporterBillingEnabled: process.env.TOMORI_SUPPORTER_BILLING_ENABLED,
  };
}

const envSnapshot = snapshotEnv();

describe("supporter subscribe command registration", () => {
  beforeAll(async () => {
    await initializeLocalizer();
  });

  // The isolation-hygiene gate matches each mutated key textually against the restore-hook
  // body, so these assignments must stay inlined here rather than behind a restoreEnv() call.
  afterEach(() => {
    if (envSnapshot.runEnv === undefined) {
      delete process.env.RUN_ENV;
    } else {
      process.env.RUN_ENV = envSnapshot.runEnv;
    }

    if (envSnapshot.supporterBillingEnabled === undefined) {
      delete process.env.TOMORI_SUPPORTER_BILLING_ENABLED;
    } else {
      process.env.TOMORI_SUPPORTER_BILLING_ENABLED = envSnapshot.supporterBillingEnabled;
    }
  });

  beforeEach(() => {
    // `loadCommandData()` memoizes its result behind a single-flight promise
    // (TDZ-race guard). Each case here loads under a DIFFERENT billing-flag env,
    // so the cache must be dropped or the second case would assert against the
    // first case's command set.
    resetCommandDataCache();
  });

  it("omits /subscribe registration data when supporter billing is disabled", async () => {
    process.env.RUN_ENV = "production";
    process.env.TOMORI_SUPPORTER_BILLING_ENABLED = "false";

    const { registrationData, executionMap } = await loadCommandData();
    const registrationJson = JSON.stringify(registrationData);

    expect(registrationData.map((command) => command.name)).not.toContain("subscribe");
    expect(executionMap.has("subscribe")).toBe(false);
    expect(registrationJson).not.toContain("/subscribe");
    expect(registrationJson).not.toContain("Supporter provider");
    expect(registrationData.map((command) => command.name)).toContain("tool");
  }, 15000);

  it("registers /subscribe as a true root command when supporter billing is enabled", async () => {
    process.env.RUN_ENV = "production";
    process.env.TOMORI_SUPPORTER_BILLING_ENABLED = "true";

    const { registrationData, executionMap } = await loadCommandData();
    const subscribeCommand = registrationData.find((command) => command.name === "subscribe");
    const subscribeOptions =
      subscribeCommand && "options" in subscribeCommand && Array.isArray(subscribeCommand.options)
        ? subscribeCommand.options
        : [];

    expect(subscribeCommand).toBeDefined();
    expect(subscribeOptions).toHaveLength(0);
    expect(executionMap.get("subscribe")?.has(ROOT_COMMAND_EXECUTION_KEY)).toBe(true);
  }, 15000);
});
