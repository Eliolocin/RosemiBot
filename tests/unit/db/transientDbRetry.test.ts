import { beforeAll, describe, expect, it } from "bun:test";
import { withTransientDbRetry } from "@/utils/db/client";
import { useEnvSandbox } from "../../helpers/env";

useEnvSandbox(["POSTGRES_TRANSIENT_RETRY_DELAY_MS"]);

beforeAll(() => {
  process.env.POSTGRES_TRANSIENT_RETRY_DELAY_MS = "0";
});

function postgresError(code: string): Error & { code: string } {
  return Object.assign(new Error("Failed to read data"), { code });
}

/**
 * Builds a thunk that fails once with `code`, then succeeds, so a passing assertion on
 * the returned value proves a retry happened rather than the error propagating.
 */
function failOnceThen<T>(code: string, value: T): { run: () => Promise<T>; calls: () => number } {
  let calls = 0;
  return {
    run: async () => {
      calls++;
      if (calls === 1) throw postgresError(code);
      return value;
    },
    calls: () => calls,
  };
}

describe("withTransientDbRetry connection-retirement classification", () => {
  // Bun rejects in-flight queries from `#onClose` using whatever state its wire-protocol
  // reader stopped in, so one dead connection surfaces under several codes. Missing any
  // of them means a healthy query fails outright instead of retrying on a fresh socket.
  it.each([
    "ERR_POSTGRES_CONNECTION_CLOSED",
    "ERR_POSTGRES_LIFETIME_TIMEOUT",
    "ERR_POSTGRES_IDLE_TIMEOUT",
    "ERR_POSTGRES_INVALID_MESSAGE",
    "ERR_POSTGRES_UNSUPPORTED_INTEGER_SIZE",
  ])("retries %s on a fresh connection", async (code) => {
    const thunk = failOnceThen(code, "recovered");

    expect(await withTransientDbRetry(thunk.run, `retry ${code}`)).toBe("recovered");
    expect(thunk.calls()).toBe(2);
  });

  it("does not retry a genuine query fault", async () => {
    const thunk = failOnceThen("23505", "unreachable");

    await expect(withTransientDbRetry(thunk.run, "unique violation")).rejects.toThrow("Failed to read data");
    expect(thunk.calls()).toBe(1);
  });

  it("does not retry an error carrying no driver code", async () => {
    let calls = 0;

    await expect(
      withTransientDbRetry(async () => {
        calls++;
        throw new Error("ERR_POSTGRES_INVALID_MESSAGE");
      }, "message-only error"),
    ).rejects.toThrow("ERR_POSTGRES_INVALID_MESSAGE");
    expect(calls).toBe(1);
  });
});
