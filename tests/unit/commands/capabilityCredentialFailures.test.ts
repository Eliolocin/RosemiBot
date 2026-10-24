import { afterEach, beforeAll, describe, expect, it, spyOn } from "bun:test";
import type { ChatInputCommandInteraction, Client, ModalSubmitInteraction } from "discord.js";
import { execute as generatePersona } from "@/commands/persona/generate";
import { execute as initializeExpressions } from "@/commands/expressions/initialize";
import { execute as estimateCost } from "@/commands/tool/estimate/cost";
import { executeCompactCommand } from "@/utils/compaction/compact/commandImplementation";
import { personaRepository } from "@/utils/db/repositories";
import * as stateCache from "@/utils/cache/tomoriStateCache";
import * as personalProviders from "@/utils/provider/personalProviderRuntime";
import * as credentials from "@/utils/provider/credentialResolver";
import * as modals from "@/utils/discord/ui/modals";
import * as emojiSync from "@/utils/cache/emojiLazySync";
import * as stickerSync from "@/utils/cache/stickerLazySync";
import * as capabilityResolver from "@/utils/provider/providerCapabilityResolver";
import * as quotas from "@/utils/security/rateLimiter";
import { SupporterRequestDeniedError } from "@/modules/supporter-billing/runtime/funding";
import { log } from "@/utils/misc/logger";
import { initializeLocalizer } from "@/utils/text/localizer";
import { createPersona, createUserRow, createLlmRow } from "../../helpers/fixtures";
import { makeFakeInteraction } from "../../helpers/fakeInteraction";
import { localizedCopy } from "../../helpers/localeCases";
import { useEnvSandbox } from "../../helpers/env";

beforeAll(initializeLocalizer);
const spies: Array<{ mockRestore(): void }> = [];
afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore();
});

describe("capability command credential failures", () => {
  useEnvSandbox(["RUN_ENV", "TOMORI_SUPPORTER_BILLING_ENABLED"]);

  it("renders expected denials without operational errors and preserves persona modal input", async () => {
    process.env.RUN_ENV = "development";
    process.env.TOMORI_SUPPORTER_BILLING_ENABLED = "false";
    const persona = createPersona({
      llm: createLlmRow({ llm_provider: "google", sees_images: true, supports_structoutput: true }),
      config: { api_key: Buffer.from("synthetic-encrypted-key") },
    });
    spies.push(spyOn(personaRepository, "loadState").mockResolvedValue(persona));
    spies.push(spyOn(stateCache, "getCachedTomoriState").mockResolvedValue(persona));
    spies.push(
      spyOn(personalProviders, "applyPersonalProviderSelectionsToTomoriState").mockResolvedValue({
        tomoriState: persona,
        activeConfigs: {},
      }),
    );
    spies.push(spyOn(emojiSync, "lazySyncGuildEmojis").mockResolvedValue(true));
    spies.push(spyOn(stickerSync, "lazySyncGuildStickers").mockResolvedValue(true));
    spies.push(spyOn(capabilityResolver, "resolveStructuredOutputCapability").mockResolvedValue(null));
    const resolver = spyOn(credentials, "resolveCapabilityCredentials");
    spies.push(resolver);
    const errors = spyOn(log, "error").mockImplementation(async () => {});
    spies.push(errors);
    const quota = spyOn(quotas, "reservePersonaQuota");
    spies.push(quota);
    const modal = makeFakeInteraction({ deferred: true });
    const prompt = spyOn(modals, "promptWithRawModal").mockImplementation(async () => {
      expect(resolver).not.toHaveBeenCalled();
      return {
        outcome: "submit",
        interaction: modal.interaction as unknown as ModalSubmitInteraction,
        values: { character_name: "Mirri", character_info: "Synthetic character input", web_search: "no" },
      };
    });
    spies.push(prompt);
    const cases = [
      {
        error: new credentials.CredentialUnavailableError("google", "text", "no_saved_config"),
        key: "general.errors.api_key_missing_description",
      },
      {
        error: new credentials.CredentialUnavailableError("google", "text", "decryption_failed"),
        key: "general.errors.api_key_error_description",
      },
      {
        error: new credentials.CredentialUnavailableError("google", "text", "decryption_failed", "personal"),
        key: "general.errors.personal_provider_credentials_error_description",
      },
      {
        error: new credentials.PersonalProviderRequiredError("text"),
        key: "general.errors.personal_provider_required_description",
      },
      {
        error: new SupporterRequestDeniedError("inactive_entitlement"),
        key: "commands.subscribe.sponsorship.errors.inactive",
      },
    ];
    for (const command of [generatePersona, initializeExpressions, executeCompactCommand, estimateCost]) {
      for (const { error, key } of cases) {
        resolver.mockClear();
        resolver.mockRejectedValue(error);
        modal.calls.length = 0;
        const fake = makeFakeInteraction({
          guild: { id: "synthetic-guild", name: "Synthetic guild" },
          channel: {},
          memberPermissions: { has: () => true },
        });
        Object.assign(fake.interaction.options, {
          getChannel: () => null,
          getString: (name: string) => (name === "type" ? "conversation" : null),
        });
        await command(
          {} as Client,
          fake.interaction as unknown as ChatInputCommandInteraction,
          createUserRow(),
          "en-US",
        );
        expect(resolver).toHaveBeenCalledTimes(1);
        const payloads = [...fake.calls, ...modal.calls].filter((call) => call.method === "editReply");
        const serialized = JSON.stringify(payloads);
        if (
          command === estimateCost &&
          error instanceof credentials.CredentialUnavailableError &&
          error.reason === "no_saved_config" &&
          error.source === "server"
        ) {
          expect(serialized).toContain(localizedCopy("en-US", "commands.tool.estimate.cost.fallback_notice_value"));
        } else {
          expect(serialized).toContain(localizedCopy("en-US", key));
        }
        expect(serialized).not.toContain(error.message);
        if (command === generatePersona) {
          const payload = modal.calls.at(-1)?.args[0] as { files?: Array<{ attachment: Buffer }> };
          expect(payload.files?.[0]?.attachment.toString()).toContain("Synthetic character input");
        }
      }
    }
    expect(errors).not.toHaveBeenCalled();
    expect(quota).not.toHaveBeenCalled();
  });
});
