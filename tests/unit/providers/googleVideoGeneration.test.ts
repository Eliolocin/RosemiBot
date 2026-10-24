import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { generateGoogleNativeVideo } from "@/providers/google/googleVideoGeneration";
import { ProviderVideoFilteredError } from "@/providers/utils/providerVideoErrors";
import { log } from "@/utils/misc/logger";
import { stubGlobalFetch } from "../../helpers/fetchStub";

const REQUEST = { apiKey: "synthetic-google-video-key", model: "veo-synthetic", prompt: "A quiet harbor" };

describe("Google video completion without videos", () => {
  const spies: Array<{ mockRestore(): void }> = [];
  let operation: Record<string, unknown>;
  let errorSpy: ReturnType<typeof spyOn<typeof log, "error">>;
  let warnSpy: ReturnType<typeof spyOn<typeof log, "warn">>;

  beforeEach(() => {
    errorSpy = spyOn(log, "error").mockResolvedValue(undefined);
    warnSpy = spyOn(log, "warn").mockImplementation(() => undefined);
    spies.push(
      errorSpy,
      warnSpy,
      stubGlobalFetch(() => Response.json(operation)),
    );
  });

  afterEach(() => {
    for (const spy of spies.splice(0)) spy.mockRestore();
  });

  it("throws the provider's operation error instead of returning an empty result", async () => {
    operation = {
      name: "operations/synthetic",
      done: true,
      error: { code: 3, message: "synthetic operation failure" },
    };
    await expect(generateGoogleNativeVideo(REQUEST)).rejects.toThrow("synthetic operation failure");
  });

  it("reports filter reasons as an expected refusal without an error log", async () => {
    operation = {
      name: "operations/synthetic",
      done: true,
      response: {
        generateVideoResponse: { raiMediaFilteredCount: 1, raiMediaFilteredReasons: ["synthetic filter reason"] },
      },
    };
    await expect(generateGoogleNativeVideo(REQUEST)).rejects.toBeInstanceOf(ProviderVideoFilteredError);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy.mock.calls.some(([message]) => message.includes("synthetic filter reason"))).toBe(true);
  });
});
