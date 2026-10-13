import { afterAll, beforeAll, describe, expect, it, spyOn } from "bun:test";
import { isSearxngAvailable } from "@/tools/restAPIs/searxng/searxngService";
import { log } from "@/utils/misc/logger";
import { useEnvSandbox } from "../../helpers/env";

const BASE_URL_ENV = "SEARXNG_BASE_URL";
const originalFetch = globalThis.fetch;

/** Records every `log.error`, which is the only level the production JSONL sink keeps. */
const errorTypes: string[] = [];

let healthy = true;

useEnvSandbox([BASE_URL_ENV]);

beforeAll(() => {
  process.env[BASE_URL_ENV] = "http://searxng:8080/";

  spyOn(log, "error").mockImplementation(async (_msg, _err, context) => {
    errorTypes.push((context?.errorType as string) ?? "");
  });
  // Only /healthz is probed here, so the stub can ignore the request entirely.
  globalThis.fetch = (async (_input: string | URL | Request, _init?: RequestInit) =>
    new Response(null, { status: healthy ? 200 : 503 })) as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

/**
 * Driven as one ordered scenario because the transition state is module-level: asserting the
 * sequence is also what proves the de-duplication, which a per-case reset would hide.
 *
 * `force` skips the 60s health cache so each step actually re-probes.
 */
describe("SearXNG availability transition logging", () => {
  it("reports each flip once and stays quiet in between", async () => {
    healthy = false;
    expect(await isSearxngAvailable(true)).toBe(false);
    // An outage present at the first resolution still has to be announced: `dispatcher.ts`
    // skips an unavailable engine silently, so nothing else would surface it.
    expect(errorTypes).toEqual(["SearxngUnavailable"]);

    expect(await isSearxngAvailable(true)).toBe(false);
    expect(errorTypes).toEqual(["SearxngUnavailable"]);

    healthy = true;
    expect(await isSearxngAvailable(true)).toBe(true);
    expect(errorTypes).toEqual(["SearxngUnavailable", "SearxngRecovered"]);

    expect(await isSearxngAvailable(true)).toBe(true);
    expect(errorTypes).toEqual(["SearxngUnavailable", "SearxngRecovered"]);
  });

  it("stays silent when no SearXNG server is configured", async () => {
    const before = errorTypes.length;
    delete process.env[BASE_URL_ENV];

    expect(await isSearxngAvailable(true)).toBe(false);
    // An unset base URL means SearXNG was never enabled, which is not an outage.
    expect(errorTypes.length).toBe(before);
  });
});
