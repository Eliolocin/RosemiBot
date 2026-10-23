import { afterEach, beforeAll, describe, expect, it, spyOn } from "bun:test";
import type { ChatInputCommandInteraction, Client, ModalSubmitInteraction } from "discord.js";
import { execute as generateVideo } from "@/commands/generate/video";
import { supporterUsageStatisticsRepository } from "@/modules/supporter-billing/db/repositories";
import * as openrouterVideo from "@/providers/openrouter/openrouterVideoGeneration";
import { personaRepository, llmModelRepo, statRepository } from "@/utils/db/repositories";
import * as personalProviders from "@/utils/provider/personalProviderRuntime";
import * as credentials from "@/utils/provider/credentialResolver";
import * as modals from "@/utils/discord/ui/modals";
import { videoGenerationModelSchema } from "@/types/db/schema";
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

const VIDEO_MODEL = videoGenerationModelSchema.parse({
  video_model_id: 12,
  provider: "openrouter",
  codename: "synthetic/video",
});

const personalFunding = () =>
  createSupporterFunding({
    capability: "video",
    modelCodename: "synthetic/video",
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

function harness(): {
  interaction: ChatInputCommandInteraction;
  modal: ReturnType<typeof makeFakeInteraction>;
  calls: ReturnType<typeof makeFakeInteraction>["calls"];
} {
  const modal = makeFakeInteraction({ deferred: true, replied: true });
  const command = makeFakeInteraction({
    guild: { id: "synthetic-guild", name: "Synthetic guild" },
    channel: { id: "synthetic-channel" },
  });
  const persona = createPersona({
    llm: createLlmRow({ llm_provider: "openrouter", llm_codename: "synthetic/text" }),
    config: { videogen_enabled: true },
  });
  spies.push(spyOn(personaRepository, "loadState").mockResolvedValue(persona));
  spies.push(
    spyOn(personalProviders, "applyPersonalProviderSelectionsToTomoriState").mockResolvedValue({
      tomoriState: persona,
      activeConfigs: {},
    }),
  );
  spies.push(spyOn(llmModelRepo, "loadVideoGenerationModelById").mockResolvedValue(VIDEO_MODEL));
  spies.push(spyOn(statRepository, "recordStat").mockImplementation(() => undefined));
  spies.push(
    spyOn(modals, "promptWithRawModal").mockResolvedValue({
      outcome: "submit",
      interaction: modal.interaction as unknown as ModalSubmitInteraction,
      values: {
        prompt_input: "a fixture video",
        aspect_ratio_select: "16:9",
        duration_input: "5",
        fps_input: "24",
      },
    }),
  );
  return { interaction: command.interaction as unknown as ChatInputCommandInteraction, modal, calls: command.calls };
}

function replyPayloads(calls: Array<{ method: string; args: unknown[] }>): string {
  return JSON.stringify(
    calls.filter((call) => ["reply", "editReply", "followUp", "webhook.send"].includes(call.method)),
  );
}

function stubSuccessfulVideo(): void {
  spies.push(
    spyOn(openrouterVideo, "generateOpenRouterNativeVideo").mockResolvedValue({
      videoData: Buffer.from("synthetic-video"),
      mimeType: "video/mp4",
      filename: "guard.mp4",
      costUsd: 0.25,
      providerRequestId: "synthetic-video-job",
    }),
  );
}

describe("generate video command billing guards", () => {
  it("records one usage entry against the funding that paid for a successful generation", async () => {
    const { interaction } = harness();
    const funding = personalFunding();
    spies.push(
      spyOn(credentials, "resolveCapabilityCredentials").mockResolvedValue(
        createSupporterCredentials({ source: "personal", modelId: VIDEO_MODEL.video_model_id, funding: funding }),
      ),
    );
    stubSuccessfulVideo();
    const record = spyOn(supporterUsageStatisticsRepository, "record").mockResolvedValue(true);
    spies.push(record);

    await generateVideo({} as Client, interaction, createUserRow(), "en-US");

    expect(record.mock.calls).toHaveLength(1);
    expect(record.mock.calls[0]?.[0]).toEqual({
      supporterIdentityId: funding.sponsorIdentityId,
      fundingScope: "personal",
      serverId: null,
      capability: "video",
      modelCodename: "synthetic/video",
      costUsd: 0.25,
      providerRequestId: "synthetic-video-job",
      inputTokens: null,
      outputTokens: null,
    });
  });

  it("records nothing when the server's own key pays for a generation", async () => {
    const { interaction } = harness();
    spies.push(
      spyOn(credentials, "resolveCapabilityCredentials").mockResolvedValue(
        createUnfundedCredentials({ source: "personal", modelId: VIDEO_MODEL.video_model_id }),
      ),
    );
    stubSuccessfulVideo();
    const record = spyOn(supporterUsageStatisticsRepository, "record").mockResolvedValue(true);
    spies.push(record);

    await generateVideo({} as Client, interaction, createUserRow(), "en-US");

    expect(record).not.toHaveBeenCalled();
  });

  it("reports a credential-time subscription denial as the subscription copy", async () => {
    const { interaction, calls } = harness();
    spies.push(
      spyOn(credentials, "resolveCapabilityCredentials").mockRejectedValue(
        createSupporterDenial({ reason: "model_not_allowed", capability: "video", fundingScope: "personal" }),
      ),
    );

    await generateVideo({} as Client, interaction, createUserRow(), "en-US");

    const payload = replyPayloads(calls);
    expect(payload).toContain(localizedCopy("en-US", "commands.subscribe.request.scope.personal"));
    expect(payload).toContain(localizedCopy("en-US", "commands.subscribe.request.capabilities.video"));
    expect(payload).not.toContain(localizedCopy("en-US", "general.errors.api_key_missing_description"));
  });

  it("reports a request-time subscription denial as the subscription copy", async () => {
    const { interaction, modal } = harness();
    const funding = personalFunding();
    spies.push(
      spyOn(credentials, "resolveCapabilityCredentials").mockResolvedValue(
        createSupporterCredentials({
          source: "personal",
          modelId: VIDEO_MODEL.video_model_id,
          funding,
        }),
      ),
    );
    spies.push(
      spyOn(openrouterVideo, "generateOpenRouterNativeVideo").mockRejectedValue(createSupporterDenial({ funding })),
    );

    await generateVideo({} as Client, interaction, createUserRow(), "en-US");

    const payload = replyPayloads(modal.calls);
    expect(payload).toContain(localizedCopy("en-US", "commands.subscribe.request.scope.personal"));
    expect(payload).toContain(localizedCopy("en-US", "commands.subscribe.request.allowance_title"));
  });
});
