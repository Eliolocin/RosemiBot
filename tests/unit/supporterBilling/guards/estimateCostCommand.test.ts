import { afterEach, beforeAll, describe, expect, it, spyOn } from "bun:test";
import type { ChatInputCommandInteraction, Client } from "discord.js";
import { execute as estimateCost } from "@/commands/tool/estimate/cost";
import { supporterUsageStatisticsRepository } from "@/modules/supporter-billing/db/repositories";
import { OpenrouterProvider, type OpenrouterProviderConfig } from "@/providers/openrouter/openrouterProvider";
import { OpenrouterStreamAdapter } from "@/providers/openrouter/openrouterStreamAdapter";
import * as stateCache from "@/utils/cache/tomoriStateCache";
import * as channelPromptCache from "@/utils/cache/channelPromptCache";
import * as openrouterCache from "@/utils/cache/openrouterCapabilityCache";
import * as contextBudget from "@/utils/provider/contextBudget";
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

const MODEL = "synthetic/estimate";

const spies: Array<{ mockRestore(): void }> = [];
afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore();
});

beforeAll(initializeLocalizer);

function harness(): {
  interaction: ChatInputCommandInteraction;
  client: Client;
  calls: ReturnType<typeof makeFakeInteraction>["calls"];
} {
  const command = makeFakeInteraction({
    guild: { id: "synthetic-guild", name: "Synthetic guild" },
    guildId: "synthetic-guild",
    channelId: "synthetic-channel",
    channel: {
      id: "synthetic-channel",
      name: "synthetic",
      topic: null,
      isTextBased: () => true,
      isThread: () => false,
      client: { user: { id: "synthetic-bot" } },
      messages: { fetch: async () => new Map() },
    },
    deferred: true,
  });
  const persona = createPersona({
    llm: createLlmRow({
      llm_provider: "openrouter",
      llm_codename: MODEL,
      supports_structoutput: true,
      input_price_per_million: 1,
      output_price_per_million: 2,
    }),
  });
  spies.push(spyOn(stateCache, "getCachedTomoriState").mockResolvedValue(persona));
  spies.push(spyOn(stateCache, "getCachedAllPersonas").mockResolvedValue([persona]));
  spies.push(
    spyOn(personalProviders, "applyPersonalProviderSelectionsToTomoriState").mockResolvedValue({
      tomoriState: persona,
      activeConfigs: {},
    }),
  );
  spies.push(spyOn(channelPromptCache, "getCachedChannelPrompt").mockResolvedValue(null));
  spies.push(spyOn(contextBudget, "applyProviderContextTruncation").mockImplementation(async (items) => items));
  spies.push(
    spyOn(openrouterCache, "getOpenRouterPricing").mockReturnValue({
      promptPricePerMillion: 1,
      completionPricePerMillion: 2,
    } as never),
  );
  const client = { user: { id: "synthetic-bot" }, guilds: { cache: new Map() } } as unknown as Client;
  return { interaction: command.interaction as unknown as ChatInputCommandInteraction, client, calls: command.calls };
}

function stubProvider(): void {
  spies.push(
    spyOn(OpenrouterProvider.prototype, "createConfig").mockResolvedValue({
      apiKey: "synthetic-key",
      model: MODEL,
      temperature: 0.7,
      tools: [],
      seesImages: false,
      seesVideos: false,
    } as OpenrouterProviderConfig),
  );
  spies.push(spyOn(OpenrouterStreamAdapter.prototype, "buildProbeMessages").mockResolvedValue([]));
}

function successfulProbe(): void {
  spies.push(
    spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(
        async (input: string | URL | Request) => {
          const url = String(input);
          return url.includes("/generation/")
            ? Response.json({ data: { native_prompt_tokens: 90 } })
            : Response.json({ id: "synthetic-generation", usage: { prompt_tokens: 100, cost: 0.001 } });
        },
        { preconnect: () => undefined },
      ),
    ),
  );
}

function payload(calls: Array<{ method: string; args: unknown[] }>): string {
  return JSON.stringify(calls.filter((call) => ["reply", "editReply", "followUp"].includes(call.method)));
}

describe("estimate cost command billing guards", () => {
  it("records one usage entry against the funding that paid for the live probe", async () => {
    const { interaction, client } = harness();
    stubProvider();
    const funding = createSupporterFunding({ modelCodename: MODEL });
    spies.push(
      spyOn(credentials, "resolveCapabilityCredentials").mockResolvedValue(
        createSupporterCredentials({ funding: funding }),
      ),
    );
    successfulProbe();
    const record = spyOn(supporterUsageStatisticsRepository, "record").mockResolvedValue(true);
    spies.push(record);

    await estimateCost(client, interaction, createUserRow(), "en-US");

    expect(record.mock.calls).toHaveLength(1);
    expect(record.mock.calls[0]?.[0]).toEqual({
      supporterIdentityId: funding.sponsorIdentityId,
      fundingScope: "server",
      serverId: funding.serverId,
      capability: "text",
      modelCodename: MODEL,
      costUsd: 0.001,
      providerRequestId: null,
      inputTokens: 100,
      outputTokens: 0,
    });
  });

  it("records nothing when the server's own key pays for the probe", async () => {
    const { interaction, client } = harness();
    stubProvider();
    spies.push(spyOn(credentials, "resolveCapabilityCredentials").mockResolvedValue(createUnfundedCredentials()));
    successfulProbe();
    const record = spyOn(supporterUsageStatisticsRepository, "record").mockResolvedValue(true);
    spies.push(record);

    await estimateCost(client, interaction, createUserRow(), "en-US");

    expect(record).not.toHaveBeenCalled();
  });

  it("reports a request-time denial as the subscription copy", async () => {
    const { interaction, client, calls } = harness();
    stubProvider();
    spies.push(
      spyOn(credentials, "resolveCapabilityCredentials").mockResolvedValue(
        createSupporterCredentials({ funding: createSupporterFunding({ modelCodename: MODEL }) }),
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

    await estimateCost(client, interaction, createUserRow(), "en-US");

    const rendered = payload(calls);
    expect(rendered).toContain(localizedCopy("en-US", "commands.subscribe.request.scope.server"));
    expect(rendered).toContain(localizedCopy("en-US", "commands.subscribe.request.allowance_title"));
  });

  it("reports a credential-time denial as the subscription copy", async () => {
    const { interaction, client, calls } = harness();
    spies.push(
      spyOn(credentials, "resolveCapabilityCredentials").mockRejectedValue(
        createSupporterDenial({ reason: "inactive_entitlement", capability: "text" }),
      ),
    );

    await estimateCost(client, interaction, createUserRow(), "en-US");

    expect(payload(calls)).toContain(localizedCopy("en-US", "commands.subscribe.sponsorship.errors.inactive"));
  });
});
