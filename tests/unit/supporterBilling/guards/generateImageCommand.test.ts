import { afterEach, beforeAll, describe, expect, it, spyOn } from "bun:test";
import type { ChatInputCommandInteraction, Client, ModalSubmitInteraction } from "discord.js";
import { execute as generateImage } from "@/commands/generate/image";
import { supporterUsageStatisticsRepository } from "@/modules/supporter-billing/db/repositories";
import { personaRepository, llmModelRepo, statRepository } from "@/utils/db/repositories";
import * as personalProviders from "@/utils/provider/personalProviderRuntime";
import * as credentials from "@/utils/provider/credentialResolver";
import * as modals from "@/utils/discord/ui/modals";
import { diffusionModelSchema } from "@/types/db/schema";
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

const DIFFUSION_MODEL = diffusionModelSchema.parse({
  diffusion_model_id: 12,
  provider: "openrouter",
  codename: "synthetic/image",
});
const ONE_PIXEL_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const personalFunding = () =>
  createSupporterFunding({
    capability: "image",
    modelCodename: "synthetic/image",
    fundingScope: "personal",
    personalUserId: 1,
    serverId: null,
    sponsorshipId: null,
  });

const spies: Array<{ mockRestore(): void }> = [];
afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore();
});

beforeAll(initializeLocalizer);

interface Harness {
  interaction: ChatInputCommandInteraction;
  modal: ReturnType<typeof makeFakeInteraction>;
  calls: ReturnType<typeof makeFakeInteraction>["calls"];
}

function harness(): Harness {
  const modal = makeFakeInteraction({ deferred: true, replied: true });
  Object.assign(modal.interaction, { attachmentSizeLimit: 10 * 1024 * 1024 });
  const command = makeFakeInteraction({
    guild: { id: "synthetic-guild", name: "Synthetic guild" },
    channel: { id: "synthetic-channel" },
    user: { ...makeFakeInteraction().interaction.user, id: "synthetic-user" },
  });
  Object.assign(command.interaction.options, {
    getString: (name: string, _required?: boolean) => (name === "mode" ? "standard" : null),
  });
  const persona = createPersona({
    llm: createLlmRow({ llm_provider: "openrouter", llm_codename: "synthetic/text" }),
    config: { imagegen_enabled: true },
  });
  spies.push(spyOn(personaRepository, "loadState").mockResolvedValue(persona));
  spies.push(
    spyOn(personalProviders, "applyPersonalProviderSelectionsToTomoriState").mockResolvedValue({
      tomoriState: persona,
      activeConfigs: {},
    }),
  );
  spies.push(spyOn(llmModelRepo, "loadDiffusionModelById").mockResolvedValue(DIFFUSION_MODEL));
  spies.push(spyOn(statRepository, "recordStat").mockImplementation(() => undefined));
  spies.push(
    spyOn(modals, "promptWithRawModal").mockResolvedValue({
      outcome: "submit",
      interaction: modal.interaction as unknown as ModalSubmitInteraction,
      values: { prompt_input: "a fixture prompt", aspect_ratio_select: "1:1" },
    }),
  );
  return { interaction: command.interaction as unknown as ChatInputCommandInteraction, modal, calls: command.calls };
}

function replyPayloads(calls: Array<{ method: string; args: unknown[] }>): string {
  return JSON.stringify(
    calls.filter((call) => ["reply", "editReply", "followUp", "webhook.send"].includes(call.method)),
  );
}

function successfulImageFetch(): ReturnType<typeof spyOn<typeof globalThis, "fetch">> {
  return spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(async () => Response.json({ data: [{ b64_json: ONE_PIXEL_PNG }], usage: { cost: 0.0321 } }), {
      preconnect: () => undefined,
    }),
  );
}

describe("generate image command billing guards", () => {
  it("records one usage entry against the funding that paid for a successful generation", async () => {
    const { interaction } = harness();
    const funding = personalFunding();
    spies.push(
      spyOn(credentials, "resolveCapabilityCredentials").mockResolvedValue(
        createSupporterCredentials({
          source: "personal",
          modelId: DIFFUSION_MODEL.diffusion_model_id,
          funding: funding,
        }),
      ),
    );
    spies.push(successfulImageFetch());
    const record = spyOn(supporterUsageStatisticsRepository, "record").mockResolvedValue(true);
    spies.push(record);

    await generateImage({} as Client, interaction, createUserRow(), "en-US");

    expect(record.mock.calls).toHaveLength(1);
    expect(record.mock.calls[0]?.[0]).toEqual({
      supporterIdentityId: funding.sponsorIdentityId,
      fundingScope: "personal",
      serverId: null,
      capability: "image",
      modelCodename: "synthetic/image",
      costUsd: 0.0321,
      providerRequestId: null,
      inputTokens: null,
      outputTokens: null,
    });
  });

  it("records nothing when the server's own key pays for a generation", async () => {
    const { interaction } = harness();
    spies.push(
      spyOn(credentials, "resolveCapabilityCredentials").mockResolvedValue(
        createUnfundedCredentials({ source: "personal", modelId: DIFFUSION_MODEL.diffusion_model_id }),
      ),
    );
    spies.push(successfulImageFetch());
    const record = spyOn(supporterUsageStatisticsRepository, "record").mockResolvedValue(true);
    spies.push(record);

    await generateImage({} as Client, interaction, createUserRow(), "en-US");

    expect(record).not.toHaveBeenCalled();
  });

  it("reports a credential-time subscription denial as the subscription copy", async () => {
    const { interaction, calls } = harness();
    spies.push(
      spyOn(credentials, "resolveCapabilityCredentials").mockRejectedValue(
        createSupporterDenial({ reason: "model_not_allowed", capability: "image", fundingScope: "personal" }),
      ),
    );

    await generateImage({} as Client, interaction, createUserRow(), "en-US");

    const payload = replyPayloads(calls);
    expect(payload).toContain(localizedCopy("en-US", "commands.subscribe.request.scope.personal"));
    expect(payload).toContain(localizedCopy("en-US", "commands.subscribe.request.capabilities.image"));
    expect(payload).not.toContain(localizedCopy("en-US", "general.errors.api_key_missing_description"));
  });

  it("reports a request-time subscription denial as the subscription copy", async () => {
    const { interaction, modal } = harness();
    spies.push(
      spyOn(credentials, "resolveCapabilityCredentials").mockResolvedValue(
        createSupporterCredentials({
          source: "personal",
          modelId: DIFFUSION_MODEL.diffusion_model_id,
          funding: personalFunding(),
        }),
      ),
    );
    spies.push(
      spyOn(globalThis, "fetch").mockImplementation(
        Object.assign(
          async () => Response.json({ error: { metadata: { limit_source: "openrouter_key_limit" } } }, { status: 402 }),
          { preconnect: () => undefined },
        ),
      ),
    );

    await generateImage({} as Client, interaction, createUserRow(), "en-US");

    const payload = replyPayloads(modal.calls);
    expect(payload).toContain(localizedCopy("en-US", "commands.subscribe.request.scope.personal"));
    expect(payload).toContain(localizedCopy("en-US", "commands.subscribe.request.allowance_title"));
  });
});
