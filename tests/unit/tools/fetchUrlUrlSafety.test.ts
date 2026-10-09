import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { validateFetchUrlTarget } from "@/tools/fetchUrl/urlSafety";
import { FetchUrlTool } from "@/tools/fetchUrl/fetchUrlTool";
import type { ToolContext } from "@/types/tool/interfaces";
import { FETCH_LIMITS } from "@/utils/security/rateLimiter";
import { initializeLocalizer } from "@/utils/text/localizer";
import { createPersona } from "../../helpers/fixtures";
import { stubGlobalFetch } from "../../helpers/fetchStub";

await initializeLocalizer();

const ENV_NAME = "FETCH_URL_ALLOW_PRIVATE_NETWORK";
const RUN_ENV_NAME = "RUN_ENV";
const originalAllowPrivateNetwork = process.env[ENV_NAME];
const originalRunEnv = process.env[RUN_ENV_NAME];
const ENGINE_ORDER_ENV_NAME = "FETCH_URL_ENGINE_ORDER";
const CRAWL4AI_BASE_URL_ENV_NAME = "CRAWL4AI_BASE_URL";
const originalEngineOrder = process.env[ENGINE_ORDER_ENV_NAME];
const originalCrawl4aiBaseUrl = process.env[CRAWL4AI_BASE_URL_ENV_NAME];

function restoreEnv(name: string, original: string | undefined): void {
  if (original === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = original;
}

afterEach(() => {
  restoreEnv(ENV_NAME, originalAllowPrivateNetwork);
  restoreEnv(RUN_ENV_NAME, originalRunEnv);
  restoreEnv(ENGINE_ORDER_ENV_NAME, originalEngineOrder);
  restoreEnv(CRAWL4AI_BASE_URL_ENV_NAME, originalCrawl4aiBaseUrl);
});

// The blocklist only engages in production; pin RUN_ENV so these cases
// exercise the guarded path rather than the dev auto-relax.
describe("validateFetchUrlTarget in production", () => {
  beforeEach(() => {
    process.env[RUN_ENV_NAME] = "production";
  });

  it("blocks loopback IPv4 targets by default with an env-specific error", async () => {
    delete process.env[ENV_NAME];

    const result = await validateFetchUrlTarget("http://127.0.0.1:11235/");

    expect(result.allowed).toBe(false);
    expect(result.failureCode).toBe("PRIVATE_NETWORK_BLOCKED");
    expect(result.error).toContain("FETCH_URL_ALLOW_PRIVATE_NETWORK=true");
  });

  it("blocks IPv4-mapped IPv6 loopback targets", async () => {
    delete process.env[ENV_NAME];

    const result = await validateFetchUrlTarget("http://[::ffff:127.0.0.1]/");

    expect(result.allowed).toBe(false);
    expect(result.failureCode).toBe("PRIVATE_NETWORK_BLOCKED");
    expect(result.error).toContain("127.0.0.1");
  });

  it("blocks the Azure Instance Metadata Service address", async () => {
    delete process.env[ENV_NAME];

    const result = await validateFetchUrlTarget("http://169.254.169.254/metadata/identity/oauth2/token");

    expect(result.allowed).toBe(false);
    expect(result.failureCode).toBe("PRIVATE_NETWORK_BLOCKED");
    // IMDS is caught by the always-on cloud-metadata denylist, which runs
    // ahead of the general private-network blocklist.
    expect(result.error).toContain("cloud instance-metadata");
  });

  it("allows public IP literals", async () => {
    delete process.env[ENV_NAME];

    const result = await validateFetchUrlTarget("https://93.184.216.34/");

    expect(result.allowed).toBe(true);
  });

  it("allows private targets when explicitly opted in", async () => {
    process.env[ENV_NAME] = "true";

    const result = await validateFetchUrlTarget("http://192.168.1.10/");

    expect(result.allowed).toBe(true);
  });

  it("keeps the size preflight for allowed private targets and refuses blocked targets before transport", async () => {
    const context: ToolContext = {
      channel: { id: "fixture-channel" } as ToolContext["channel"],
      client: {} as ToolContext["client"],
      locale: "en-US",
      provider: "google",
      tomoriState: createPersona({ config: { web_search_enabled: true } }),
      suppressProgressNotices: true,
    };
    const requests: Array<{ url: string; method: string | undefined }> = [];
    const fetchSpy = stubGlobalFetch((input, init) => {
      requests.push({ url: String(input), method: init?.method });
      return new Response(null, {
        headers: { "content-length": String((FETCH_LIMITS.MAX_FETCH_SIZE_MB + 1) * 1024 * 1024) },
      });
    });
    try {
      for (const runEnv of ["production", "development"]) {
        process.env[RUN_ENV_NAME] = runEnv;
        if (runEnv === "production") process.env[ENV_NAME] = "true";
        else delete process.env[ENV_NAME];
        const result = await new FetchUrlTool().execute({ url: "https://127.0.0.1/oversized" }, context);
        expect(result.success).toBe(false);
        expect(result.error).toContain(String(FETCH_LIMITS.MAX_FETCH_SIZE_MB + 1));
      }
      expect(requests).toEqual([
        { url: "https://127.0.0.1/oversized", method: "HEAD" },
        { url: "https://127.0.0.1/oversized", method: "HEAD" },
      ]);

      process.env[RUN_ENV_NAME] = "production";
      delete process.env[ENV_NAME];
      const blocked = await new FetchUrlTool().execute({ url: "https://127.0.0.1/oversized" }, context);
      expect(blocked.success).toBe(false);
      expect(blocked.error).toContain("FETCH_URL_ALLOW_PRIVATE_NETWORK");
      expect(requests).toHaveLength(2);
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

// Outside production the guard auto-relaxes so local development can reach
// private endpoints with no configuration.
describe("validateFetchUrlTarget outside production", () => {
  beforeEach(() => {
    delete process.env[RUN_ENV_NAME];
    delete process.env[ENV_NAME];
  });

  it("allows private targets without any opt-in", async () => {
    const result = await validateFetchUrlTarget("http://127.0.0.1:11235/");

    expect(result.allowed).toBe(true);
  });

  it("still blocks cloud-metadata addresses despite the dev auto-relax", async () => {
    const result = await validateFetchUrlTarget("http://169.254.169.254/metadata/identity/oauth2/token");

    expect(result.allowed).toBe(false);
    expect(result.failureCode).toBe("PRIVATE_NETWORK_BLOCKED");
    expect(result.error).toContain("metadata");
  });

  it("refuses an unresolvable host before dispatching to the external Crawl4AI browser", async () => {
    process.env[ENGINE_ORDER_ENV_NAME] = "crawl4ai,safe_http";
    process.env[CRAWL4AI_BASE_URL_ENV_NAME] = "http://127.0.0.1:11235";
    const context: ToolContext = {
      channel: { id: "fixture-channel" } as ToolContext["channel"],
      client: {} as ToolContext["client"],
      locale: "en-US",
      provider: "google",
      tomoriState: createPersona({ config: { web_search_enabled: true } }),
      suppressProgressNotices: true,
    };
    const requests: string[] = [];
    const fetchSpy = stubGlobalFetch((input) => {
      requests.push(String(input));
      return new Response("unexpected");
    });
    try {
      // RFC 6761 reserves .invalid, so this name never resolves.
      const result = await new FetchUrlTool().execute({ url: "https://tomori-fixture.invalid/page" }, context);

      expect(result.success).toBe(false);
      expect(requests).toEqual([]);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("still blocks cloud-metadata addresses even with an explicit opt-in", async () => {
    process.env[ENV_NAME] = "true";

    const result = await validateFetchUrlTarget("http://169.254.169.254/");

    expect(result.allowed).toBe(false);
    expect(result.failureCode).toBe("PRIVATE_NETWORK_BLOCKED");
  });
});
