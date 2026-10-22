import { afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import type { ChatInputCommandInteraction, Client, ModalSubmitInteraction } from "discord.js";
import { execute, planImageHandling } from "@/commands/persona/generate";
import { personaRepository } from "@/utils/db/repositories/PersonaRepository";
import * as personalProviders from "@/utils/provider/personalProviderRuntime";
import * as credentials from "@/utils/provider/credentialResolver";
import * as interactions from "@/utils/discord/interactionHelper";
import * as rateLimiter from "@/utils/security/rateLimiter";
import * as modelLimits from "@/utils/provider/modelLimits";
import * as features from "@/providers/utils/providerFeatureExecutors";
import * as managedProvider from "@/modules/supporter-billing/runtime/managedProvider";
import * as spendGuard from "@/modules/supporter-billing/runtime/spendGuard";
import * as usageStatistics from "@/modules/supporter-billing/runtime/usageStatistics";
import type { SupporterFundingContext } from "@/modules/supporter-billing/runtime/types";
import { OpenRouterEngine } from "@/tools/webSearch/openrouterEngine";
import { initializeLocalizer } from "@/utils/text/localizer";
import { createLlmRow, createPersona, createUserRow } from "../../helpers/fixtures";
import { createRouteInteraction } from "../../helpers/routeInteraction";
import { useEnvSandbox } from "../../helpers/env";
import { collectTextDisplays } from "../../helpers/panelLimits";
import { localizedProse } from "../../helpers/localeCases";

useEnvSandbox(["RUN_ENV", "TEST_PRODUCTION", "TOMORI_SUPPORTER_BILLING_ENABLED"]);
beforeAll(initializeLocalizer);
const restore: Array<{ mockRestore(): void }> = [];
afterEach(() => {
  for (const spy of restore.splice(0).reverse()) spy.mockRestore();
});

/**
 * The four image cases `/persona generate` documents are decided here rather than inline in
 * the command, because the command branch is untestable without a Discord interaction and the
 * cases are the part that must not drift.
 */
describe("persona generate image handling", () => {
  test("case 2: no image never reaches this decision, and an unattachable image fails", () => {
    // No vision anywhere and nothing extracted is the only case that stops generation.
    expect(planImageHandling({ primarySeesImages: false, visionSeesImages: false, hasExtractedPreset: false })).toBe(
      "fail_no_vision",
    );
  });

  test("case 1: a non-vision primary with a vision model captions first", () => {
    expect(planImageHandling({ primarySeesImages: false, visionSeesImages: true, hasExtractedPreset: false })).toBe(
      "caption_then_generate",
    );
  });

  test("case 3: a vision-capable primary reads the image itself", () => {
    expect(planImageHandling({ primarySeesImages: true, visionSeesImages: false, hasExtractedPreset: false })).toBe(
      "primary_with_image",
    );

    // The vision row is irrelevant once the primary can see, even when both could read it.
    expect(planImageHandling({ primarySeesImages: true, visionSeesImages: true, hasExtractedPreset: false })).toBe(
      "primary_with_image",
    );
  });

  test("case 4: extracted card data replaces vision entirely", () => {
    expect(planImageHandling({ primarySeesImages: false, visionSeesImages: false, hasExtractedPreset: true })).toBe(
      "text_only_extracted",
    );
  });

  test("extracted card data replaces vision only when nothing can read the image", () => {
    expect(planImageHandling({ primarySeesImages: false, visionSeesImages: true, hasExtractedPreset: true })).toBe(
      "caption_then_generate",
    );
  });

  test("a vision-capable primary keeps the image even when card data was extracted", () => {
    // The primary can read the image, so the card is reference material rather than a
    // replacement for it.
    expect(planImageHandling({ primarySeesImages: true, visionSeesImages: false, hasExtractedPreset: true })).toBe(
      "primary_with_image",
    );
  });

  test("a card only rescues the case where no model can see the image", () => {
    expect(planImageHandling({ primarySeesImages: false, visionSeesImages: false, hasExtractedPreset: true })).toBe(
      "text_only_extracted",
    );
    expect(planImageHandling({ primarySeesImages: false, visionSeesImages: false, hasExtractedPreset: false })).toBe(
      "fail_no_vision",
    );
  });
});

test("persona web search uses the selected subscription's key and records its search usage", async () => {
  process.env.RUN_ENV = "production";
  process.env.TEST_PRODUCTION = "true";
  process.env.TOMORI_SUPPORTER_BILLING_ENABLED = "true";
  const state = createPersona({
    llm: createLlmRow({ llm_provider: "openrouter", llm_codename: "example/persona", supports_structoutput: true }),
    config: { api_key: null, web_search_enabled: true },
  });
  const fake = createRouteInteraction({ kind: "modal" });
  const common = {
    credentialSource: "supporter" as const,
    provider: "openrouter" as const,
    capability: "text" as const,
    modelCodename: state.llm.llm_codename,
    tierKey: "test_tier",
    sponsorIdentityId: 10,
    sponsorDiscordUserId: fake.user.id,
    entitlementId: 20,
    renewalAt: null,
  };
  const fundingCases: SupporterFundingContext[] = [
    { ...common, fundingScope: "personal", sponsorshipId: null, serverId: null, personalUserId: 1 },
    { ...common, fundingScope: "server", sponsorshipId: 40, serverId: 1, personalUserId: null },
  ];
  const load = spyOn(personaRepository, "loadState").mockResolvedValue(state);
  const overlay = spyOn(personalProviders, "applyPersonalProviderSelectionsToTomoriState").mockResolvedValue({
    tomoriState: state,
    activeConfigs: {},
  });
  const credential = spyOn(credentials, "resolveCapabilityCredentials");
  const modal = spyOn(interactions, "promptWithRawModal").mockResolvedValue({
    outcome: "submit",
    interaction: fake as unknown as ModalSubmitInteraction,
    values: { character_name: "Juno", character_info: "A fictional explorer.", web_search: "yes" },
  });
  const quota = spyOn(rateLimiter, "reservePersonaQuota").mockReturnValue({ allowed: true });
  const limits = spyOn(modelLimits, "resolveModelLimits").mockResolvedValue({
    contextWindow: 8192,
    maxOutputTokens: 4096,
  });
  const memberKey = spyOn(managedProvider, "resolveSupporterMemberKey").mockResolvedValue("fixture-member-key");
  const fetch = spyOn(spendGuard, "fetchWithSupporterSpend").mockImplementation(async () =>
    Response.json({
      id: "fixture-search",
      choices: [
        {
          message: {
            annotations: [
              { type: "url_citation", url_citation: { url: "https://example.com/explorer", title: "Explorer" } },
            ],
          },
        },
      ],
      usage: { cost: 0.007, prompt_tokens: 10, completion_tokens: 1 },
    }),
  );
  const usage = spyOn(usageStatistics, "recordSupporterUsage").mockImplementation(() => {});
  let searchSucceeded = false;
  const generation = spyOn(features, "generatePresetForProvider").mockImplementation(async ({ toolContext }) => {
    const engine = new OpenRouterEngine();
    if (toolContext && (await engine.available(toolContext))) {
      searchSucceeded = (await engine.search("Juno explorer", "text", toolContext, 1)).success;
    }
    return { error: "fixture_generation_unavailable", errorType: "VALIDATION_ERROR" };
  });
  restore.push(load, overlay, credential, modal, quota, limits, memberKey, fetch, usage, generation);
  for (const funding of fundingCases) {
    credential.mockResolvedValue({
      provider: "openrouter",
      apiKey: "fixture-member-key",
      keyVersion: 1,
      savedConfig: null,
      source: funding.fundingScope,
      supporterFunding: funding,
    });
    searchSucceeded = false;
    await execute(
      fake.client as unknown as Client,
      fake as unknown as ChatInputCommandInteraction,
      createUserRow(),
      "en-US",
    );
    expect(searchSucceeded).toBe(true);
    expect(memberKey.mock.calls.at(-1)?.[0]).toBe(funding);
    expect(new Headers(fetch.mock.calls.at(-1)?.[1]?.headers).get("Authorization")).toBe("Bearer fixture-member-key");
    expect(usage.mock.calls.at(-1)?.[0]).toBe(funding);
    expect(usage.mock.calls.at(-1)?.[1]).toMatchObject({ costUsd: 0.007, providerRequestId: "fixture-search" });
    const receipt = collectTextDisplays(fake.edits.at(-1)).join("\n");
    expect(receipt).toMatch(localizedProse("en-US", "commands.persona.generate.validation_failed_description"));
    expect(receipt).not.toMatch(
      localizedProse("en-US", "commands.persona.generate.generation_failed_description", {
        error: "fixture_generation_unavailable",
      }),
    );
  }
});
