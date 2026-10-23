import { afterEach, beforeAll, describe, expect, it, spyOn } from "bun:test";
import type { ChatInputCommandInteraction, Client } from "discord.js";
import { execute as initializeExpressions } from "@/commands/expressions/initialize";
import { supporterUsageStatisticsRepository } from "@/modules/supporter-billing/db/repositories";
import { getAllEmotionKeys } from "@/types/misc/emotions";
import * as presetExecutors from "@/providers/utils/providerFeatureExecutors";
import { personaRepository, serverRepository } from "@/utils/db/repositories";
import * as emojiSync from "@/utils/cache/emojiLazySync";
import * as stickerSync from "@/utils/cache/stickerLazySync";
import * as emojiStickerCache from "@/utils/cache/emojiStickerCache";
import * as capabilityResolver from "@/utils/provider/providerCapabilityResolver";
import * as personalProviders from "@/utils/provider/personalProviderRuntime";
import * as credentials from "@/utils/provider/credentialResolver";
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

const MODEL = "synthetic/expressions";
const EMOJI_ID = "12345678901234567";

const spies: Array<{ mockRestore(): void }> = [];
afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore();
});

beforeAll(initializeLocalizer);

function harness(): {
  interaction: ChatInputCommandInteraction;
  calls: ReturnType<typeof makeFakeInteraction>["calls"];
} {
  const command = makeFakeInteraction({
    guild: { id: "synthetic-guild", name: "Synthetic guild" },
    channel: { id: "synthetic-channel" },
    memberPermissions: { has: () => true },
  });
  Object.assign(command.interaction.options, { getBoolean: () => false });
  const persona = createPersona({
    llm: createLlmRow({
      llm_provider: "openrouter",
      llm_codename: MODEL,
      sees_images: true,
      supports_structoutput: true,
    }),
  });
  spies.push(spyOn(personaRepository, "loadState").mockResolvedValue(persona));
  spies.push(
    spyOn(personalProviders, "applyPersonalProviderSelectionsToTomoriState").mockResolvedValue({
      tomoriState: persona,
      activeConfigs: {},
    }),
  );
  spies.push(spyOn(emojiSync, "lazySyncGuildEmojis").mockResolvedValue(true));
  spies.push(spyOn(stickerSync, "lazySyncGuildStickers").mockResolvedValue(true));
  spies.push(spyOn(capabilityResolver, "resolveStructuredOutputCapability").mockResolvedValue(null));
  spies.push(
    spyOn(serverRepository, "loadEmojisForClassification").mockResolvedValue([
      { emoji_disc_id: EMOJI_ID, emoji_name: "synthetic_emoji", is_animated: false },
    ]),
  );
  spies.push(spyOn(serverRepository, "loadStickersForClassification").mockResolvedValue([]));
  spies.push(
    spyOn(serverRepository, "initializeExpressions").mockResolvedValue({
      emojiDiscIds: [EMOJI_ID],
      stickerDiscIds: [],
    }),
  );
  spies.push(spyOn(emojiStickerCache, "invalidateEmojiStickerCache").mockImplementation(() => undefined));
  return { interaction: command.interaction as unknown as ChatInputCommandInteraction, calls: command.calls };
}

function successfulBatch(request: Parameters<typeof presetExecutors.callExpressionInitializationForProvider>[0]) {
  request.onUsage?.({ inputTokens: 80, outputTokens: 20, costUsd: 0.0025 });
  return {
    success: true,
    data: {
      expressions: [
        {
          name: "synthetic_emoji",
          emotion_key: getAllEmotionKeys()[0],
          description: "A synthetic expression used by the guard test.",
        },
      ],
    },
  } as never;
}

function payload(calls: Array<{ method: string; args: unknown[] }>): string {
  return JSON.stringify(calls.filter((call) => ["reply", "editReply", "followUp"].includes(call.method)));
}

describe("initialize expressions command billing guards", () => {
  it("records one usage entry against the funding that paid for a successful batch", async () => {
    const { interaction } = harness();
    const funding = createSupporterFunding({ modelCodename: MODEL });
    spies.push(
      spyOn(credentials, "resolveCapabilityCredentials").mockResolvedValue(
        createSupporterCredentials({ funding: funding }),
      ),
    );
    spies.push(
      spyOn(presetExecutors, "callExpressionInitializationForProvider").mockImplementation(
        async (request) => successfulBatch(request) as never,
      ),
    );
    const record = spyOn(supporterUsageStatisticsRepository, "record").mockResolvedValue(true);
    spies.push(record);

    await initializeExpressions({} as Client, interaction, createUserRow(), "en-US");

    expect(record.mock.calls).toHaveLength(1);
    expect(record.mock.calls[0]?.[0]).toEqual({
      supporterIdentityId: funding.sponsorIdentityId,
      fundingScope: "server",
      serverId: funding.serverId,
      capability: "text",
      modelCodename: MODEL,
      costUsd: 0.0025,
      providerRequestId: null,
      inputTokens: 80,
      outputTokens: 20,
    });
  });

  it("records nothing when the server's own key pays for the batch", async () => {
    const { interaction } = harness();
    spies.push(spyOn(credentials, "resolveCapabilityCredentials").mockResolvedValue(createUnfundedCredentials()));
    spies.push(
      spyOn(presetExecutors, "callExpressionInitializationForProvider").mockImplementation(
        async (request) => successfulBatch(request) as never,
      ),
    );
    const record = spyOn(supporterUsageStatisticsRepository, "record").mockResolvedValue(true);
    spies.push(record);

    await initializeExpressions({} as Client, interaction, createUserRow(), "en-US");

    expect(record).not.toHaveBeenCalled();
  });

  it("reports a request-time denial with this request's funding capability", async () => {
    const { interaction, calls } = harness();
    const funding = createSupporterFunding({ modelCodename: MODEL });
    spies.push(
      spyOn(credentials, "resolveCapabilityCredentials").mockResolvedValue(
        createSupporterCredentials({ funding: funding }),
      ),
    );
    spies.push(
      spyOn(presetExecutors, "callExpressionInitializationForProvider").mockResolvedValue({
        success: false,
        error: "denied",
        cause: createSupporterDenial({ reason: "model_not_allowed", funding }),
      } as never),
    );

    await initializeExpressions({} as Client, interaction, createUserRow(), "en-US");

    const callsPayload = payload(calls);
    expect(callsPayload).toContain(localizedCopy("en-US", "commands.subscribe.request.scope.server"));
    expect(callsPayload).toContain(localizedCopy("en-US", "commands.subscribe.request.capabilities.text"));
    expect(callsPayload).not.toContain(localizedCopy("en-US", "commands.subscribe.request.capabilities.vision"));
    expect(callsPayload).not.toContain(localizedCopy("en-US", "general.errors.unknown_error_description"));
  });

  it("reports a credential-time denial as the subscription copy", async () => {
    const { interaction, calls } = harness();
    spies.push(
      spyOn(credentials, "resolveCapabilityCredentials").mockRejectedValue(
        createSupporterDenial({ reason: "inactive_entitlement", capability: "text" }),
      ),
    );

    await initializeExpressions({} as Client, interaction, createUserRow(), "en-US");

    expect(payload(calls)).toContain(localizedCopy("en-US", "commands.subscribe.sponsorship.errors.inactive"));
  });
});
