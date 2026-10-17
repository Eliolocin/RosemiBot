import { afterEach, beforeAll, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { AutocompleteInteraction, ChatInputCommandInteraction, Client } from "discord.js";
import { autocomplete, configureSubcommand, execute } from "@/commands/personal/message-proxy";
import { PrivacyLevel, type UserRow } from "@/types/db/schema";
import { personalSettingsExportDataSchema } from "@/types/db/dataExport";
import { userRepository } from "@/utils/db/repositories";
import { messageProxyInstanceRepository } from "@/utils/db/repositories/MessageProxyInstanceRepository";
import * as oauthTokens from "@/utils/messageProxy/services/pluralbuddy/oauthTokens";
import { localizedCopy } from "../../helpers/localeCases";
import { initializeLocalizer } from "@/utils/text/localizer";
import { makeFakeInteraction } from "../../helpers/fakeInteraction";

const originalSetter = userRepository.setMessageProxyService;

beforeAll(async () => {
  await initializeLocalizer();
});

afterEach(() => {
  userRepository.setMessageProxyService = originalSetter;
  mock.restore();
});

beforeEach(() => {
  spyOn(messageProxyInstanceRepository, "getEnabled").mockImplementation(async (serviceId, instanceId) => ({
    serviceId,
    instanceId: instanceId ?? `${serviceId}:official`,
    origin: serviceId === "pluralkit" ? "https://api.pluralkit.me" : "https://pluralbuddy.app",
    displayName: serviceId === "pluralkit" ? "PluralKit" : "PluralBuddy",
  }));
});

function user(service: string | null): UserRow {
  return {
    user_id: 42,
    user_disc_id: "user-42",
    user_nickname: "Mirri",
    language_pref: "en-US",
    registration_locale: "en-US",
    privacy_level: PrivacyLevel.MINIMAL,
    personal_memories: [],
    physical_appearance_tags: [],
    nai_char_ref_url: null,
    impersonation_prompt: null,
    shortterm_cache_crossserver_opt_in: false,
    personal_dtm: "follow",
    personal_deliberate_tool_mode: "follow",
    personal_server_fallback_enabled: true,
    timezone_offset: null,
    message_proxy_service: service,
    message_proxy_instance_id: service === "pluralkit" || service === "pluralbuddy" ? `${service}:official` : null,
  };
}

function interactionFor(service: string, instanceId: string | null = null) {
  return makeFakeInteraction({
    options: {
      getString: (name: string) => (name === "service" ? service : instanceId),
      getBoolean: () => null,
    },
  });
}

describe("/personal message-proxy", () => {
  it("builds the required registry-derived service choices", () => {
    const choices: Array<{ name: string; value: string }> = [];
    const option = {
      setName: () => option,
      setDescription: () => option,
      setRequired: () => option,
      setAutocomplete: () => option,
      addChoices: (...values: Array<{ name: string; value: string }>) => {
        choices.push(...values);
        return option;
      },
    };
    const subcommand = {
      setName: () => subcommand,
      setDescription: () => subcommand,
      addStringOption: (configure: (value: typeof option) => typeof option) => {
        configure(option);
        return subcommand;
      },
    };

    configureSubcommand(subcommand as never);

    expect(choices.map(({ value }) => value)).toEqual(["none", "pluralkit", "pluralbuddy"]);
  });

  it("defers before persisting a changed selection", async () => {
    const writes: Array<{ userId: number; serviceId: string | null }> = [];
    userRepository.setMessageProxyService = async (userId, serviceId) => {
      writes.push({ userId, serviceId });
      return true;
    };
    const { interaction, calls } = interactionFor("pluralkit");

    await execute({} as Client, interaction as unknown as ChatInputCommandInteraction, user(null), "en-US");

    expect(calls[0]?.method).toBe("deferReply");
    expect(writes).toEqual([{ userId: 42, serviceId: "pluralkit" }]);
    const editReply = calls.find(({ method }) => method === "editReply");
    expect(JSON.stringify(editReply?.args)).toContain("in case PluralKit deletes and reposts it");
  });

  it("is idempotent when the requested selection is already stored", async () => {
    let writes = 0;
    userRepository.setMessageProxyService = async () => {
      writes += 1;
      return true;
    };
    const { interaction, calls } = interactionFor("none");

    await execute({} as Client, interaction as unknown as ChatInputCommandInteraction, user("none"), "ja");

    expect(calls[0]?.method).toBe("deferReply");
    expect(writes).toBe(0);
    expect(calls.some(({ method }) => method === "editReply")).toBe(true);
  });

  it("leaves the selection unchanged when PluralBuddy authorization is unavailable", async () => {
    spyOn(oauthTokens, "getPluralBuddyAccessToken").mockResolvedValue(null);
    let writes = 0;
    userRepository.setMessageProxyService = async () => {
      writes += 1;
      return true;
    };
    const { interaction, calls } = interactionFor("pluralbuddy");

    await execute({} as Client, interaction as unknown as ChatInputCommandInteraction, user(null), "en-US");

    expect(calls[0]?.method).toBe("deferReply");
    expect(writes).toBe(0);
    const editReply = calls.find(({ method }) => method === "editReply");
    expect(JSON.stringify(editReply?.args)).toContain(
      localizedCopy("en-US", "commands.personal.message-proxy.pluralbuddy_unavailable_description"),
    );
  });

  it("allows a host with an unavailable custom selection to choose the official instance", async () => {
    const writes: string[] = [];
    userRepository.setMessageProxyService = async (_userId, serviceId) => {
      writes.push(serviceId ?? "null");
      return true;
    };
    const { interaction } = interactionFor("pluralkit");
    await execute(
      {} as Client,
      interaction as unknown as ChatInputCommandInteraction,
      { ...user("pluralkit"), message_proxy_instance_id: "pluralkit:11111111-2222-4333-8444-555555555555" },
      "en-US",
    );
    expect(writes).toEqual(["pluralkit"]);
  });

  it("stores an approved custom instance and refuses one disabled before writing", async () => {
    const instanceId = "pluralkit:11111111-2222-4333-8444-555555555555";
    const writes: string[] = [];
    userRepository.setMessageProxyService = async (_userId, _serviceId, selectedInstanceId) => {
      writes.push(selectedInstanceId ?? "missing");
      return true;
    };
    const enabled = interactionFor("pluralkit", instanceId);
    await execute({} as Client, enabled.interaction as unknown as ChatInputCommandInteraction, user(null), "en-US");
    expect(writes).toEqual([instanceId]);

    spyOn(messageProxyInstanceRepository, "getEnabled").mockResolvedValue(null);
    const disabled = interactionFor("pluralkit", instanceId);
    await execute({} as Client, disabled.interaction as unknown as ChatInputCommandInteraction, user(null), "en-US");
    expect(writes).toEqual([instanceId]);
    expect(JSON.stringify(disabled.calls.find(({ method }) => method === "editReply")?.args)).toContain(
      localizedCopy("en-US", "commands.personal.message-proxy.instance_unavailable_description"),
    );
  });

  it("offers only enabled instances of the chosen service in autocomplete", async () => {
    const list = spyOn(messageProxyInstanceRepository, "listEnabled").mockResolvedValue([
      {
        serviceId: "pluralkit",
        instanceId: "pluralkit:official",
        origin: "https://api.pluralkit.me",
        displayName: "PluralKit",
      },
    ]);
    const replies: unknown[] = [];
    await autocomplete(
      {} as Client,
      {
        options: { getString: () => "pluralkit", getFocused: () => "Plural" },
        respond: async (choices: unknown) => {
          replies.push(choices);
        },
      } as unknown as AutocompleteInteraction,
    );
    expect(list).toHaveBeenCalledWith("pluralkit", "Plural");
    expect(replies).toEqual([
      [
        {
          name: "PluralKit (https://api.pluralkit.me)",
          value: "pluralkit:official",
        },
      ],
    ]);
  });

  it("accepts all storage states in the portable settings schema", () => {
    for (const serviceId of [null, "none", "pluralkit", "removed_service"] as const) {
      expect(
        personalSettingsExportDataSchema.safeParse({
          user_nickname: "Mirri",
          language_pref: "en-US",
          physical_appearance_tags: [],
          message_proxy_service: serviceId,
        }).success,
      ).toBe(true);
    }
  });
});
