import { afterEach, beforeAll, describe, expect, it, spyOn } from "bun:test";
import type { ChatInputCommandInteraction, Client, ModalSubmitInteraction } from "discord.js";
import { execute as generatePersona } from "@/commands/persona/generate";
import { supporterUsageStatisticsRepository } from "@/modules/supporter-billing/db/repositories";
import * as presetExecutors from "@/providers/utils/providerFeatureExecutors";
import { personaRepository } from "@/utils/db/repositories";
import * as personalProviders from "@/utils/provider/personalProviderRuntime";
import * as credentials from "@/utils/provider/credentialResolver";
import * as modelLimits from "@/utils/provider/modelLimits";
import * as rateLimiter from "@/utils/security/rateLimiter";
import * as modals from "@/utils/discord/ui/modals";
import { initializeLocalizer } from "@/utils/text/localizer";
import { createLlmRow, createPersona, createUserRow } from "../../../helpers/fixtures";
import { makeFakeInteraction } from "../../../helpers/fakeInteraction";
import { localizedCopy } from "../../../helpers/localeCases";
import {
  createSupporterCredentials,
  createSupporterDenial,
  createSupporterFunding,
  createUnfundedCredentials,
} from "./fundingFixtures";

const MODEL = "synthetic/preset";

function makeHarness(): {
  interaction: ChatInputCommandInteraction;
  modal: ReturnType<typeof makeFakeInteraction>;
} {
  const modal = makeFakeInteraction({ deferred: true, replied: true });
  const command = makeFakeInteraction({
    guild: { id: "synthetic-guild", name: "Synthetic guild" },
    channel: { id: "synthetic-channel", send: async () => ({ id: "notice" }) },
  });
  const persona = createPersona({
    llm: createLlmRow({ llm_provider: "openrouter", llm_codename: MODEL, supports_structoutput: true }),
    config: { api_key: Buffer.from("synthetic-encrypted-key") },
  });
  spies.push(spyOn(personaRepository, "loadState").mockResolvedValue(persona));
  spies.push(
    spyOn(personalProviders, "applyPersonalProviderSelectionsToTomoriState").mockResolvedValue({
      tomoriState: persona,
      activeConfigs: {},
    }),
  );
  spies.push(spyOn(modelLimits, "resolveModelLimits").mockResolvedValue({ maxOutputTokens: 1000 } as never));
  spies.push(spyOn(rateLimiter, "reservePersonaQuota").mockReturnValue({ allowed: true, resetAt: null } as never));
  spies.push(
    spyOn(modals, "promptWithRawModal").mockResolvedValue({
      outcome: "submit",
      interaction: modal.interaction as unknown as ModalSubmitInteraction,
      values: {
        character_name: "Mirri",
        character_info: "A synthetic character description",
        web_search: "no",
      },
    }),
  );
  return { interaction: command.interaction as unknown as ChatInputCommandInteraction, modal };
}

const spies: Array<{ mockRestore(): void }> = [];
afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore();
});

beforeAll(initializeLocalizer);

function modalPayload(modal: ReturnType<typeof makeFakeInteraction>): string {
  return JSON.stringify(
    modal.calls.filter((call) => ["reply", "editReply", "followUp", "webhook.send"].includes(call.method)),
  );
}

describe("generate persona command billing guards", () => {
  it("records one usage entry against the funding that paid for a funded generation", async () => {
    const { interaction } = makeHarness();
    const funding = createSupporterFunding({ modelCodename: MODEL });
    spies.push(
      spyOn(credentials, "resolveCapabilityCredentials").mockResolvedValue(
        createSupporterCredentials({ funding: funding }),
      ),
    );
    const generate = spyOn(presetExecutors, "generatePresetForProvider").mockImplementation(async (request) => {
      request.onUsage?.({ inputTokens: 120, outputTokens: 30, costUsd: 0.018 });
      return { error: "synthetic provider failure after reporting usage", errorType: "MODEL_ERROR" } as never;
    });
    spies.push(generate);
    const record = spyOn(supporterUsageStatisticsRepository, "record").mockResolvedValue(true);
    spies.push(record);

    await generatePersona({} as Client, interaction, createUserRow(), "en-US");

    expect(generate).toHaveBeenCalledTimes(1);
    expect(record.mock.calls).toHaveLength(1);
    expect(record.mock.calls[0]?.[0]).toEqual({
      supporterIdentityId: funding.sponsorIdentityId,
      fundingScope: "server",
      serverId: funding.serverId,
      capability: "text",
      modelCodename: MODEL,
      costUsd: 0.018,
      providerRequestId: null,
      inputTokens: 120,
      outputTokens: 30,
    });
  });

  it("records nothing when the server's own key pays for the generation", async () => {
    const { interaction } = makeHarness();
    spies.push(spyOn(credentials, "resolveCapabilityCredentials").mockResolvedValue(createUnfundedCredentials()));
    spies.push(
      spyOn(presetExecutors, "generatePresetForProvider").mockImplementation(async (request) => {
        request.onUsage?.({ inputTokens: 120, outputTokens: 30, costUsd: 0.018 });
        return { error: "synthetic provider failure after reporting usage", errorType: "MODEL_ERROR" } as never;
      }),
    );
    const record = spyOn(supporterUsageStatisticsRepository, "record").mockResolvedValue(true);
    spies.push(record);

    await generatePersona({} as Client, interaction, createUserRow(), "en-US");

    expect(record).not.toHaveBeenCalled();
  });

  it("reports a subscription denial raised by generation as the subscription copy", async () => {
    const { interaction, modal } = makeHarness();
    const funding = createSupporterFunding({ modelCodename: MODEL });
    spies.push(
      spyOn(credentials, "resolveCapabilityCredentials").mockResolvedValue(
        createSupporterCredentials({ funding: funding }),
      ),
    );
    spies.push(
      spyOn(presetExecutors, "generatePresetForProvider").mockResolvedValue({
        error: "denied",
        cause: createSupporterDenial({ reason: "model_not_allowed", funding }),
      } as never),
    );

    await generatePersona({} as Client, interaction, createUserRow(), "en-US");

    const payload = modalPayload(modal);
    expect(payload).toContain(localizedCopy("en-US", "commands.subscribe.request.scope.server"));
    expect(payload).toContain(localizedCopy("en-US", "commands.subscribe.request.capabilities.text"));
    expect(payload).not.toContain(localizedCopy("en-US", "commands.persona.generate.generation_failed_title"));
  });

  it("reports a credential-time subscription denial as the subscription copy", async () => {
    const { interaction, modal } = makeHarness();
    spies.push(
      spyOn(credentials, "resolveCapabilityCredentials").mockRejectedValue(
        createSupporterDenial({ reason: "inactive_entitlement", capability: "text", fundingScope: "server" }),
      ),
    );

    await generatePersona({} as Client, interaction, createUserRow(), "en-US");

    const payload = modalPayload(modal);
    expect(payload).toContain(localizedCopy("en-US", "commands.subscribe.sponsorship.errors.inactive"));
    expect(payload).not.toContain(localizedCopy("en-US", "general.errors.api_key_missing_description"));
  });
});
