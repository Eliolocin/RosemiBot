import { beforeAll, describe, expect, it, spyOn } from "bun:test";
import * as managedProvider from "@/modules/supporter-billing/runtime/managedProvider";
import { SupporterRequestDeniedError } from "@/modules/supporter-billing/runtime/funding";
import { getSupporterUsageContext } from "@/modules/supporter-billing/runtime/types";
import { speechModelSchema } from "@/types/db/schema";
import type { SpeechTargetResult } from "@/utils/provider/speechEndpointResolver";
import { synthesizeVoiceMessage } from "@/utils/speech/voiceMessageSynthesis";
import { initializeLocalizer } from "@/utils/text/localizer";
import {
  captureUsageRecords,
  createServerFunding,
  installSpendHarness,
  settleUsage,
} from "./guards/utils-fundingFixtures";

beforeAll(initializeLocalizer);

describe("speech request ownership after preflight", () => {
  it("uses fresh preflight funding for a spend refusal and preserves unscoped credential refusals", async () => {
    const harness = installSpendHarness();
    const key = harness.register({ appliedLimit: 0, funding: createServerFunding({ capability: "voice" }) });
    const originalFunding = { ...key.funding };
    const target: Extract<SpeechTargetResult, { kind: "hosted-model" }> = {
      kind: "hosted-model",
      endpoint: null,
      owner: { kind: "server", ownerId: key.funding.serverId ?? 7 },
      credentialId: 11,
      credentialRevision: 1,
      apiKey: key.apiKey,
      usageContext: getSupporterUsageContext(originalFunding),
      model: speechModelSchema.parse({
        speech_model_id: 5,
        provider: "openrouter",
        codename: "fixture/voice",
        voice_mode: "design",
      }),
    };
    const resolve = spyOn(managedProvider, "resolveSupporterCapabilityCredentials").mockResolvedValue({
      apiKey: key.apiKey,
      funding: key.funding,
    });
    const fetch = spyOn(globalThis, "fetch").mockRejectedValue(new Error("Unexpected provider request"));
    const usage = captureUsageRecords();
    const request = {
      target,
      endpoint: null,
      endpointApiKey: "",
      elevenLabsApiKey: "",
      source: { kind: "design" as const, designPrompt: "A warm narrator.", personaId: 1 },
      script: "Hello from the fixture.",
    };
    try {
      const result = await synthesizeVoiceMessage(request);
      expect(result.requestDenied?.usageContext).toBe(getSupporterUsageContext(key.funding));
      expect(result.requestDenied).toMatchObject({ reason: "allowance_exhausted" });
      const refusal = new SupporterRequestDeniedError("inactive_entitlement", undefined, "voice", "server");
      resolve.mockRejectedValueOnce(refusal);
      const unavailable = await synthesizeVoiceMessage(request);
      expect(unavailable.requestDenied).toBe(refusal);
      await settleUsage();
      expect(fetch).not.toHaveBeenCalled();
      expect(usage.rows).toHaveLength(0);
    } finally {
      usage.restore();
      fetch.mockRestore();
      resolve.mockRestore();
      harness.restore();
    }
  });
});
