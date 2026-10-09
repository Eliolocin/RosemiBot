import { beforeAll, describe, expect, it, spyOn } from "bun:test";
import { readFileSync } from "node:fs";
import {
  ButtonStyle,
  ComponentType,
  MessageFlags,
  type ActionRowData,
  type ButtonComponentData,
  type Client,
  type ComponentInContainerData,
  type ContainerComponentData,
  type InteractionButtonComponentData,
  type TextDisplayComponentData,
} from "discord.js";
import { PrivacyLevel, type UserRow, type TomoriState, type UserSavedProviderConfigRow } from "@/types/db/schema";
import type { RawDiscordComponent } from "@/types/discord/rawApiTypes";
import type { PersonalSpotlightStatus } from "@/utils/db/repositories/UserRepository";
import { createPersonalConfigInteractionRoute } from "@/utils/discord/interactions/personalConfigRoutes";
import type { PersonalConfigRouteDependencies } from "@/utils/discord/interactions/personalConfigRouteContext";
import {
  personalConfigOperations,
  type PersonalConfigOperations,
} from "@/utils/discord/interactions/personalConfigOperations";
import { llmModelRepo, llmProviderRepo, userNamingRepository, userRepository } from "@/utils/db/repositories";
import {
  buildPersonalConfigRouteId,
  computeSpotlightRemoveFingerprint,
  computeSpotlightSetFingerprint,
  decodeSpotlightMask,
  encodeSpotlightMask,
  decodeProviderParam,
  encodeProviderParam,
  decodeProviderRangeValue,
  parsePersonalConfigPanelRoute,
  PERSONAL_CONFIG_ROUTE_CODECS,
  type PersonalConfigAction,
  type PersonalConfigCategory,
  type PersonalConfigPage,
  type PersonalConfigPanelRoute,
  SPOTLIGHT_PERSONA_PAGE_SIZE,
} from "@/utils/discord/personalConfigPanelCatalog";
import {
  buildLanguageModal,
  buildModelSelectModal,
  buildPersonalConfigModalFieldId,
  buildSpotlightAutoTriggerModal,
  buildSpotlightRemoveModal,
  buildSpotlightSetModal,
  buildSpotlightStep1Modal,
} from "@/utils/discord/ui/personalConfigModals";
import {
  buildPersonalConfigPanelPayload,
  type PersonalConfigModelDisplayInfo,
  type PersonalConfigPanelPayload,
  type PersonalConfigRoutingRow,
} from "@/utils/discord/ui/personalConfigPanel";
import { formatPanelProse } from "@/utils/discord/ui/panelProse";
import type { ThinkingLevelValue } from "@/constants/thinkingLevels";
import type { ModelParameterOptions } from "@/utils/discord/modelParametersConfigMapping";
import type { PersonalConfigManagedCapability } from "@/utils/discord/personalConfigPanelCatalog";
import {
  type GlobalRoutableInteraction,
  parseInteractionRoute,
  type ParsedInteractionRoute,
} from "@/utils/discord/interactions/routeRegistry";
import { dispatchGlobalInteraction } from "@/utils/discord/interactions/router";
import { getRegisterableLocales, initializeLocalizer, localizer } from "@/utils/text/localizer";
import { loadCommandData } from "@/utils/discord/commandLoader";
import type { UserPersonaNamingPreference } from "@/types/personaNaming";
import { localizedProse, localizedCopy } from "../../helpers/localeCases";
import { createPersona, createUserRow } from "../../helpers/fixtures";
import {
  createRouteInteraction,
  type RouteGuildChannel,
  type RouteInteraction,
  type RouteInteractionOptions,
} from "../../helpers/routeInteraction";

beforeAll(async () => initializeLocalizer());

/**
 * The single place this suite says which channels are text channels in the fake guild. Routes that
 * confirm a spotlight channel read `guild.channels.cache`, so a channel missing here is rejected as
 * not a text channel in this guild.
 */
function makeChannelCache(channelIds: string[]): Map<string, RouteGuildChannel> {
  // ChannelType.GuildText is 0; the route guard rejects anything else.
  return new Map(channelIds.map((id) => [id, { type: 0, name: `channel-${id.slice(-4)}` }]));
}

/**
 * Every source file that compares `route.action`. The handler-parity gate unions their matches, so a
 * slice that moves handler branches into a new module adds its path here instead of editing the
 * assertion it would otherwise have to weaken.
 */
const PERSONAL_CONFIG_HANDLER_SOURCES = [
  "src/utils/discord/interactions/personalConfigRoutes.ts",
  "src/utils/discord/interactions/personalConfigModalOpenRoutes.ts",
  "src/utils/discord/interactions/personalConfigNavigationRoutes.ts",
  "src/utils/discord/interactions/personalConfigProfileRoutes.ts",
  "src/utils/discord/interactions/personalConfigModelRoutes.ts",
  "src/utils/discord/interactions/personalConfigResponseRoutes.ts",
  "src/utils/discord/interactions/personalConfigSpotlightRoutes.ts",
] as const;

function requireRoute(customId: string): ParsedInteractionRoute {
  const parsed = parseInteractionRoute(customId);
  if (!parsed) throw new Error(`Failed to parse route for customId: ${customId}`);
  return parsed;
}

interface ObservedComponent {
  type?: number;
  customId?: string;
  placeholder?: string;
  label?: string;
  disabled?: boolean;
  options?: Array<{ value?: string; label?: string; default?: boolean }>;
}

function collectComponents(value: unknown): ObservedComponent[] {
  if (Array.isArray(value)) return value.flatMap(collectComponents);
  if (typeof value !== "object" || value === null) return [];

  const record = value as Record<string, unknown>;
  const current: ObservedComponent[] =
    typeof record.type === "number"
      ? [
          {
            type: record.type,
            customId: typeof record.customId === "string" ? record.customId : undefined,
            placeholder: typeof record.placeholder === "string" ? record.placeholder : undefined,
            label: typeof record.label === "string" ? record.label : undefined,
            disabled: typeof record.disabled === "boolean" ? record.disabled : undefined,
            options: Array.isArray(record.options)
              ? record.options.map((option) => {
                  const entry = option as Record<string, unknown>;
                  return {
                    value: typeof entry.value === "string" ? entry.value : undefined,
                    label: typeof entry.label === "string" ? entry.label : undefined,
                    default: typeof entry.default === "boolean" ? entry.default : undefined,
                  };
                })
              : undefined,
          },
        ]
      : [];
  return [...current, ...Object.values(record).flatMap(collectComponents)];
}

/**
 * The suite pins its actor's Discord snowflake because spotlight fingerprints bind the writable
 * scope to it, so the shared row arrives with this suite's actor and nothing else overridden. The
 * routes read the numeric id as required while the schema types it optional, so the row the suite
 * hands over carries the shared fixture's id explicitly.
 */
function makeUser(overrides: Partial<UserRow> = {}): UserRow & { user_id: number } {
  const row = createUserRow({ user_disc_id: "user-123", ...overrides });
  return { ...row, user_id: row.user_id ?? 1 };
}

const SUITE_ACTOR: RouteInteraction["user"] = {
  id: "user-123",
  username: "tester",
  displayName: "Tester",
  globalName: "Tester",
  displayAvatarURL: () => "https://cdn.example.invalid/tester.png",
};

/** The shared route fake, typed as the interaction the personal routes and global router accept. */
type PersonalInteraction = RouteInteraction & GlobalRoutableInteraction;

/**
 * A route interaction from this suite's actor in this suite's guild. `resolveScope` answers
 * `guild-123`/`user-123` whatever the interaction says, so a fake left on the shared factory's own
 * identity would dispatch as a different actor than the scope the route writes for.
 */
function makePersonalInteraction(options: RouteInteractionOptions = {}): PersonalInteraction {
  return createRouteInteraction({
    guildId: "guild-123",
    ...options,
    overrides: { user: SUITE_ACTOR, ...options.overrides },
  }) as PersonalInteraction;
}

/**
 * Positional wrapper over {@link createPersona}. The suite names personas by the lineage IDs it
 * asserts on, so the wrapper keeps those call sites reading as identity triples while the row shape
 * itself lives in the shared factory.
 */
function makePersona(personaId: number, lineageId: number, name: string, isAlter = false): TomoriState {
  return createPersona({
    persona_id: personaId,
    persona_lineage_id: lineageId,
    persona_nickname: name,
    is_alter: isAlter,
  });
}

function makeParameterConfig(provider: string): UserSavedProviderConfigRow {
  return {
    provider,
    llm_temperature: 0.7,
    llm_min_p: 0.05,
    llm_top_p: 0.95,
    llm_top_k: 0,
    llm_frequency_penalty: 0,
    llm_presence_penalty: 0,
    llm_max_output_tokens: 4096,
    thinking_level: "auto",
  } as unknown as UserSavedProviderConfigRow;
}

/**
 * A complete active-spotlight row. Production reads `channelDiscId`, `personaIds`,
 * `autoTriggerPersonaId`, and `expiresAt` from these rows, and the suite's own guild and actor fill
 * the three identity columns, so a call site states only the channel and the persona selection.
 */
function makeSpotlight(
  channelDiscId: string,
  overrides: Partial<PersonalSpotlightStatus> = {},
): PersonalSpotlightStatus {
  return {
    serverId: 42,
    userId: 1,
    channelDiscId,
    personaIds: [],
    autoTriggerPersonaId: null,
    expiresAt: null,
    createdAt: null,
    updatedAt: null,
    ...overrides,
  };
}

/** What the loaders report per capability when the account has no saved provider for it. */
const EMPTY_ROUTING_ROWS: Record<PersonalConfigManagedCapability, PersonalConfigRoutingRow> = {
  text: { capability: "text", activeModelName: null, storedProvider: null, storedModelName: null },
  vision: { capability: "vision", activeModelName: null, storedProvider: null, storedModelName: null },
  embedding: { capability: "embedding", activeModelName: null, storedProvider: null, storedModelName: null },
  image: { capability: "image", activeModelName: null, storedProvider: null, storedModelName: null },
  image_nai: { capability: "image_nai", activeModelName: null, storedProvider: null, storedModelName: null },
  video: { capability: "video", activeModelName: null, storedProvider: null, storedModelName: null },
};

const EMPTY_CAPABILITY_PROVIDERS: Record<PersonalConfigManagedCapability, string[]> = {
  text: [],
  vision: [],
  embedding: [],
  image: [],
  image_nai: [],
  video: [],
};

/**
 * Display info for an account with no saved providers. The loader always reports every capability
 * key, so a fixture that only varies the Fallbacks fields states those and inherits the rest rather
 * than omitting keys the rendered page does not read.
 */
function makeModelDisplayInfo(
  overrides: Partial<Omit<PersonalConfigModelDisplayInfo, "routingRows" | "eligibleProvidersForCapability">> & {
    routingRows?: Partial<Record<PersonalConfigManagedCapability, PersonalConfigRoutingRow>>;
    eligibleProvidersForCapability?: Partial<Record<PersonalConfigManagedCapability, string[]>>;
  } = {},
): PersonalConfigModelDisplayInfo {
  const { routingRows, eligibleProvidersForCapability, ...rest } = overrides;
  return {
    routingRows: { ...EMPTY_ROUTING_ROWS, ...routingRows },
    availableCapabilities: [],
    eligibleProvidersForCapability: { ...EMPTY_CAPABILITY_PROVIDERS, ...eligibleProvidersForCapability },
    parametersProviders: [],
    fallbacksProviders: [],
    fallbackSlots: [],
    randomizerEnabled: false,
    canEnableRandomizer: false,
    ...rest,
  };
}

function makeDependencies(
  calls: string[],
  overrides: Partial<PersonalConfigRouteDependencies> = {},
): {
  dependencies: PersonalConfigRouteDependencies;
  user: UserRow;
  personaPrefs: Map<string, UserPersonaNamingPreference>;
  telemetry: string[];
} {
  const user = makeUser();
  const personaPrefs = new Map<string, UserPersonaNamingPreference>();
  const telemetry: string[] = [];

  const operations: PersonalConfigOperations = {
    setLanguage: async (input) => {
      calls.push(`setLanguage:${input.language}`);
      user.language_pref = input.language;
      return { status: "success" };
    },
    setTimezone: async (input) => {
      calls.push(`setTimezone:${input.offset}`);
      user.timezone_offset = input.offset;
      return { status: "success" };
    },
    setNaming: async (input) => {
      calls.push(`setNaming:${input.nickname}:${input.prefix}:${input.suffix}`);
      user.user_nickname = input.nickname;
      user.prefix_override = input.prefix;
      user.suffix_override = input.suffix;
      return { status: "success" };
    },
    setPersonaNaming: async (input) => {
      calls.push(`setPersonaNaming:${input.personaLineageId}:${input.nickname}:${input.prefix}:${input.suffix}`);
      personaPrefs.set(`${input.userId}:${input.personaLineageId}`, {
        user_id: input.userId,
        persona_lineage_id: input.personaLineageId,
        nickname_override: input.nickname,
        prefix_override: input.prefix,
        suffix_override: input.suffix,
        created_at: new Date(),
        updated_at: new Date(),
      });
      return { status: "success" };
    },
    setAbout: async (input) => {
      calls.push(`setAbout:${input.genderIdentity}:${input.pronouns}:${input.addressingStyle}`);
      user.gender_identity = input.genderIdentity;
      user.pronouns = input.pronouns;
      user.addressing_style = input.addressingStyle;
      return { status: "success" };
    },
    setAppearance: async (input) => {
      calls.push(`setAppearance:${input.rawTags}`);
      const tags = input.rawTags.trim() ? input.rawTags.split(",").map((t) => t.trim()) : [];
      user.physical_appearance_tags = tags;
      return { status: "success", tags };
    },
    replaceCharacterReference: async (input) => {
      calls.push(`replaceCharacterReference:${input.attachment ? "set" : "clear"}`);
      user.nai_char_ref_url = input.attachment ? "data:image/png;base64,stored" : null;
      return { status: "success", cleared: !input.attachment };
    },
    setPrivacyLevel: async (input) => {
      calls.push(`setPrivacyLevel:${input.level}`);
      user.privacy_level = input.level;
      return { status: "success" };
    },
    toggleCrossServerStm: async (_input) => {
      calls.push("toggleCrossServerStm");
      user.shortterm_cache_crossserver_opt_in = !user.shortterm_cache_crossserver_opt_in;
      return { status: "success", enabled: user.shortterm_cache_crossserver_opt_in };
    },
    setCrossServerStm: async (input) => {
      calls.push(`setCrossServerStm:${input.enabled}`);
      user.shortterm_cache_crossserver_opt_in = input.enabled;
      return { status: "success", enabled: input.enabled };
    },
    setCapabilityModel: async (input) => {
      calls.push(`setCapabilityModel:${input.capability}:${input.provider}:${input.modelId}`);
      return { status: "success" };
    },
    setCapabilityEnabled: async (input) => {
      calls.push(`setCapabilityEnabled:${input.capability}:${input.enabled}`);
      return { status: "success" };
    },
    setQuickToggleRouting: async (input) => {
      calls.push(`setQuickToggleRouting:${Array.from(input.selectedCapabilities).sort().join(",")}`);
      return { status: "success" };
    },
    setParameters: async (input) => {
      calls.push(`setParameters:${input.provider}:${JSON.stringify(input.patch)}`);
      return { status: "success" };
    },
    setFallbacks: async (input) => {
      calls.push(`setFallbacks:${input.provider}:${input.slotValues.join(",")}`);
      return { status: "success", fallbacks: [] };
    },
    setRandomizer: async (input) => {
      calls.push(`setRandomizer:${input.provider}:${input.enabled}`);
      return { status: "success", enabled: input.enabled };
    },
    setTriggerMode: async (input) => {
      calls.push(`setTriggerMode:${input.mode}`);
      user.personal_dtm = input.mode;
      return { status: "success" };
    },
    setToolMode: async (input) => {
      calls.push(`setToolMode:${input.mode}`);
      user.personal_deliberate_tool_mode = input.mode;
      return { status: "success" };
    },
    setServerModelFallback: async (input) => {
      calls.push(`setServerModelFallback:${input.current}:${input.enabled}`);
      user.personal_server_fallback_enabled = input.enabled;
      return { status: "success", enabled: input.enabled };
    },
    setImpersonationPrompt: async (input) => {
      calls.push(`setImpersonationPrompt:${input.prompt}`);
      user.impersonation_prompt = input.prompt;
      return { status: "success" };
    },
    setSpotlight: async (input) => {
      calls.push(`setSpotlight:${input.channelId}:${input.personaIds.join(",")}:${input.autoTriggerPersonaId}`);
      return { status: "success" };
    },
    removeSpotlights: async (input) => {
      calls.push(`removeSpotlights:${input.channelIds.join(",")}`);
      return { status: "success", removedCount: input.channelIds.length };
    },
  };

  const dependencies: PersonalConfigRouteDependencies = {
    resolveScope: async () => ({
      userId: user.user_id,
      userDiscId: user.user_disc_id,
      guildId: "guild-123",
      workspaceId: "guild-123",
      internalServerId: 42,
      user,
      resolvedNickname: user.user_nickname ?? "LiveUser",
      personas: [makePersona(1, 10, "Tomori"), makePersona(2, 20, "Anon")],
      readStatus: "fresh",
    }),
    loadPersonaNamingPreference: async (userId, lineageId) => personaPrefs.get(`${userId}:${lineageId}`) ?? null,
    getPersonaAvatarData: async () => ({ url: "https://cdn.example.invalid/persona.png", files: [] }),
    getMemoryCount: async () => 3,
    getStmCount: async () => 2,
    loadUserSavedProviders: async () => [
      {
        user_saved_config_id: 1,
        user_id: 1,
        provider: "openrouter",
        key_version: 1,
        api_key: null,
        llm_id: 101,
        diffusion_model_id: 201,
        embedding_model_id: 301,
        nai_diffusion_model_id: 202,
        video_model_id: 401,
        vision_llm_id: 102,
        nai_preset_name: null,
        llm_temperature: 0.7,
        llm_top_p: 0.95,
        llm_top_k: 0,
        llm_frequency_penalty: 0,
        llm_presence_penalty: 0,
        llm_min_p: 0.05,
        llm_max_output_tokens: 4096,
        llm_disabled_params: [],
        llm_logit_biases: [],
        thinking_level: "auto",
        model_randomizer_enabled: false,
        enabled_capabilities: ["text", "vision", "embedding", "image", "video"],
        assigned_capabilities: ["text", "vision", "embedding", "image", "video"],
        fallback_model_refs: [{ type: "llm", id: 103 }],
      } as unknown as UserSavedProviderConfigRow,
    ],
    loadPersonalModelDisplayInfo: async () => ({
      routingRows: {
        text: {
          capability: "text",
          activeModelName: "Claude 3.5 Sonnet",
          storedProvider: "openrouter",
          storedModelName: "Claude 3.5 Sonnet",
        },
        vision: {
          capability: "vision",
          activeModelName: "GPT-4o",
          storedProvider: "openrouter",
          storedModelName: "GPT-4o",
        },
        embedding: {
          capability: "embedding",
          activeModelName: "text-embedding-3",
          storedProvider: "openrouter",
          storedModelName: "text-embedding-3",
        },
        image: {
          capability: "image",
          activeModelName: "Flux.1 Schnell",
          storedProvider: "openrouter",
          storedModelName: "Flux.1 Schnell",
        },
        image_nai: {
          capability: "image_nai",
          activeModelName: "NAI Diffusion V3",
          storedProvider: "novelai",
          storedModelName: "NAI Diffusion V3",
        },
        video: {
          capability: "video",
          activeModelName: "VideoGen 1",
          storedProvider: "openrouter",
          storedModelName: "VideoGen 1",
        },
      },
      availableCapabilities: ["text", "vision", "embedding", "image", "image_nai", "video"],
      eligibleProvidersForCapability: {
        text: ["openrouter"],
        vision: ["openrouter"],
        embedding: ["openrouter"],
        image: ["openrouter"],
        image_nai: ["novelai"],
        video: ["openrouter"],
      },
      parametersProviders: ["openrouter"],
      selectedParametersConfig: {
        user_saved_config_id: 1,
        user_id: 1,
        provider: "openrouter",
        key_version: 1,
        api_key: null,
        llm_id: 101,
        diffusion_model_id: 201,
        embedding_model_id: 301,
        nai_diffusion_model_id: null,
        video_model_id: null,
        vision_llm_id: null,
        nai_preset_name: null,
        llm_temperature: 0.7,
        llm_top_p: 0.95,
        llm_top_k: 0,
        llm_frequency_penalty: 0,
        llm_presence_penalty: 0,
        llm_min_p: 0.05,
        llm_max_output_tokens: 4096,
        llm_disabled_params: [],
        llm_logit_biases: [],
        thinking_level: "auto",
        model_randomizer_enabled: false,
        enabled_capabilities: ["text"],
        assigned_capabilities: ["text"],
        fallback_model_refs: [{ type: "llm", id: 103 }],
      } as unknown as UserSavedProviderConfigRow,
      fallbacksProviders: ["openrouter"],
      selectedFallbacksConfig: {
        user_saved_config_id: 1,
        user_id: 1,
        provider: "openrouter",
        key_version: 1,
        api_key: null,
        llm_id: 101,
        diffusion_model_id: 201,
        embedding_model_id: 301,
        nai_diffusion_model_id: null,
        video_model_id: null,
        vision_llm_id: null,
        nai_preset_name: null,
        llm_temperature: 0.7,
        llm_top_p: 0.95,
        llm_top_k: 0,
        llm_frequency_penalty: 0,
        llm_presence_penalty: 0,
        llm_min_p: 0.05,
        llm_max_output_tokens: 4096,
        llm_disabled_params: [],
        llm_logit_biases: [],
        thinking_level: "auto",
        model_randomizer_enabled: false,
        enabled_capabilities: ["text"],
        assigned_capabilities: ["text"],
        fallback_model_refs: [{ type: "llm", id: 103 }],
      } as unknown as UserSavedProviderConfigRow,
      primaryModelName: "Claude 3.5 Sonnet",
      fallbackSlots: [
        { slot: 1, modelName: "Claude 3 Haiku" },
        { slot: 2, modelName: null },
        { slot: 3, modelName: null },
        { slot: 4, modelName: null },
        { slot: 5, modelName: null },
      ],
      randomizerEnabled: false,
      canEnableRandomizer: true,
    }),
    loadAvailableModelsForCapability: async () => [
      { id: 101, name: "Claude 3.5 Sonnet" },
      { id: 102, name: "Claude 3 Opus" },
    ],
    loadActiveSpotlights: async () => [makeSpotlight("ch-100", { personaIds: [1] })],
    loadGuildPersonas: async () => [
      { id: 1, name: "Tomori", isAlter: false },
      { id: 2, name: "Anon", isAlter: true },
    ],
    loadTomoriState: async () => null,
    loadServerTriggerBehavior: async () => null,
    operations,
    recordAction: (input) => {
      telemetry.push(input.action);
    },
    createNonce: () => "nonce123456",
    showLanguageModal: async () => {},
    showTimezoneModal: async () => {},
    showNamingModal: async () => {},
    showPersonaNamingModal: async () => {},
    showAboutModal: async () => {},
    showAppearanceModal: async () => {},
    showCharacterReferenceModal: async () => {},
    showPrivacyLevelModal: async () => {},
    showQuickToggleModal: async () => {},
    showModelSelectModal: async () => {},
    showParameters1Modal: async () => {},
    showParameters2Modal: async () => {},
    showFallbacksModal: async () => {},
    showImpersonationModal: async () => {},
    showSpotlightStep1Modal: async () => {},
    showSpotlightSetModal: async () => {},
    showSpotlightAutoTriggerModal: async () => {},
    showSpotlightRemoveModal: async () => {},
  };

  // Spreading a `Partial` over the defaults widens every dependency to `| undefined`, so the
  // overrides are applied to the completed object, which keeps each key's declared type.
  Object.assign(dependencies, overrides);

  return { dependencies, user, personaPrefs, telemetry };
}

describe("personalConfigPanelCatalog", () => {
  it("builds and parses category and page routes", () => {
    const categoryId = buildPersonalConfigRouteId({
      action: "category",
      locale: "en-US",
      category: "privacy",
      page: "controls",
    });
    const parsedCategory = parsePersonalConfigPanelRoute(requireRoute(categoryId));
    expect(parsedCategory).toEqual({
      action: "category",
      locale: "en-US",
      category: "privacy",
      page: "controls",
    });

    const pageId = buildPersonalConfigRouteId({
      action: "page",
      locale: "en-US",
      category: "profile",
      page: "appearance",
    });
    const parsedPage = parsePersonalConfigPanelRoute(requireRoute(pageId));
    expect(parsedPage).toEqual({
      action: "page",
      locale: "en-US",
      category: "profile",
      page: "appearance",
    });
  });

  it("round-trips a Discord locale without an authored translation", () => {
    const route = { action: "category" as const, locale: "de", category: "profile" as const, page: "general" as const };
    const customId = buildPersonalConfigRouteId(route);
    expect(parsePersonalConfigPanelRoute(requireRoute(customId))).toEqual(route);
  });

  /**
   * Route objects whose every field must survive a build and parse. One row per route so a codec
   * regression names the field it lost instead of failing one 543-line test.
   */
  const MODAL_AND_CONTROL_ROUTES: ReadonlyArray<readonly [string, PersonalConfigPanelRoute]> = [
    ["language-open", { action: "language-open", locale: "en-US" }],
    ["language-submit", { action: "language-submit", locale: "en-US", nonce: "nonce123456" }],
    [
      "persona-naming-submit",
      { action: "persona-naming-submit", locale: "en-US", lineageId: 10, nonce: "nonce123456" },
    ],
    ["crossserver-toggle", { action: "crossserver-toggle", locale: "en-US" }],
    ["trigger-mode-set", { action: "trigger-mode-set", locale: "en-US", mode: "on" }],
    ["tool-mode-set", { action: "tool-mode-set", locale: "en-US", mode: "off" }],
    ["impersonation-open", { action: "impersonation-open", locale: "en-US" }],
    ["impersonation-submit", { action: "impersonation-submit", locale: "en-US", nonce: "nonce123456" }],
    ["impersonation-clear-view", { action: "impersonation-clear-view", locale: "en-US" }],
    ["impersonation-clear-confirm", { action: "impersonation-clear-confirm", locale: "en-US", nonce: "nonce123456" }],
    ["spotlight-set-open", { action: "spotlight-set-open", locale: "en-US" }],
    [
      "spotlight-set-submit",
      {
        action: "spotlight-set-submit",
        locale: "en-US",
        channelId: "123456789012345678",
        hours: 0,
        blockIdx: 0,
        fp: "a1b2c3d4",
        nonce: "nonce123456",
      },
    ],
    [
      "spot-set-auto",
      {
        action: "spot-set-auto",
        locale: "en-US",
        channelId: "123456789012345678",
        hours: 24,
        blockIdx: 0,
        mask: "3",
        fp: "a1b2c3d4",
        nonce: "nonce123456",
      },
    ],
    [
      "spot-set-auto-sub",
      {
        action: "spot-set-auto-sub",
        locale: "en-US",
        channelId: "123456789012345678",
        hours: 24,
        blockIdx: 0,
        mask: "3",
        fp: "a1b2c3d4",
        nonce: "nonce123456",
      },
    ],
    [
      "spot-set-cf",
      {
        action: "spot-set-cf",
        locale: "en-US",
        channelId: "123456789012345678",
        hours: 24,
        autoIdx: 7,
        blockIdx: 0,
        mask: "3",
        fp: "a1b2c3d4",
        nonce: "nonce123456",
      },
    ],
    ["spotlight-remove-open", { action: "spotlight-remove-open", locale: "en-US" }],
    ["spot-rem-range", { action: "spot-rem-range", locale: "en-US", start: 50, fp: "a1b2c3d4" }],
    [
      "spotlight-remove-submit",
      { action: "spotlight-remove-submit", locale: "en-US", start: 50, fp: "a1b2c3d4", nonce: "nonce123456" },
    ],
  ];

  it.each(MODAL_AND_CONTROL_ROUTES)("builds and parses the %s route", (_label, route) => {
    expect(parsePersonalConfigPanelRoute(requireRoute(buildPersonalConfigRouteId(route)))).toEqual(route);
  });

  // Pins the personal-config v2 wire contract: each literal custom ID and the exact route it must
  // decode to. Encoding and decoding through one shared codec table cannot catch a field reordering,
  // because both sides move together and a round-trip still succeeds; only literal bytes can. These
  // strings were generated from the parser before the codec table existed, so they are the record of
  // what already-open panels in a client will send. Regenerating them from the code under test would
  // defeat the point.
  const WIRE_CONTRACT_V2: ReadonlyArray<readonly [string, PersonalConfigPanelRoute]> = [
    [
      "personal-config:v2:category:en-US:profile:general",
      { action: "category", locale: "en-US", category: "profile", page: "general" },
    ],
    [
      "personal-config:v2:page:en-US:models:switch",
      { action: "page", locale: "en-US", category: "models", page: "switch" },
    ],
    ["personal-config:v2:persona-select:en-US:7", { action: "persona-select", locale: "en-US", lineageId: 7 }],
    ["personal-config:v2:trigger-mode-set:en-US:on", { action: "trigger-mode-set", locale: "en-US", mode: "on" }],
    ["personal-config:v2:tool-mode-set:en-US:follow", { action: "tool-mode-set", locale: "en-US", mode: "follow" }],
    ["personal-config:v2:language-open:en-US", { action: "language-open", locale: "en-US" }],
    ["personal-config:v2:timezone-open:en-US", { action: "timezone-open", locale: "en-US" }],
    ["personal-config:v2:timezone-server:en-US", { action: "timezone-server", locale: "en-US" }],
    ["personal-config:v2:naming-open:en-US", { action: "naming-open", locale: "en-US" }],
    ["personal-config:v2:about-open:en-US", { action: "about-open", locale: "en-US" }],
    ["personal-config:v2:appearance-open:en-US", { action: "appearance-open", locale: "en-US" }],
    ["personal-config:v2:character-reference-open:en-US", { action: "character-reference-open", locale: "en-US" }],
    ["personal-config:v2:character-reference-clear:en-US", { action: "character-reference-clear", locale: "en-US" }],
    ["personal-config:v2:privacy-level-open:en-US", { action: "privacy-level-open", locale: "en-US" }],
    ["personal-config:v2:crossserver-toggle:en-US", { action: "crossserver-toggle", locale: "en-US" }],
    ["personal-config:v2:crossserver-set:en-US:on", { action: "crossserver-set", locale: "en-US", enabled: true }],
    ["personal-config:v2:quick-toggle-open:en-US", { action: "quick-toggle-open", locale: "en-US" }],
    ["personal-config:v2:model-act-cancel:en-US", { action: "model-act-cancel", locale: "en-US" }],
    ["personal-config:v2:parameters-provider-select:en-US", { action: "parameters-provider-select", locale: "en-US" }],
    ["personal-config:v2:fallbacks-provider-select:en-US", { action: "fallbacks-provider-select", locale: "en-US" }],
    ["personal-config:v2:impersonation-open:en-US", { action: "impersonation-open", locale: "en-US" }],
    ["personal-config:v2:impersonation-clear-view:en-US", { action: "impersonation-clear-view", locale: "en-US" }],
    ["personal-config:v2:impersonation-clear-cancel:en-US", { action: "impersonation-clear-cancel", locale: "en-US" }],
    ["personal-config:v2:spotlight-set-open:en-US", { action: "spotlight-set-open", locale: "en-US" }],
    ["personal-config:v2:spotlight-set-cancel:en-US", { action: "spotlight-set-cancel", locale: "en-US" }],
    ["personal-config:v2:spotlight-remove-open:en-US", { action: "spotlight-remove-open", locale: "en-US" }],
    ["personal-config:v2:spotlight-remove-cancel:en-US", { action: "spotlight-remove-cancel", locale: "en-US" }],
    [
      "personal-config:v2:language-submit:en-US:nonce1234567",
      { action: "language-submit", locale: "en-US", nonce: "nonce1234567" },
    ],
    [
      "personal-config:v2:language-only-submit:en-US:nonce1234567",
      { action: "language-only-submit", locale: "en-US", nonce: "nonce1234567" },
    ],
    [
      "personal-config:v2:timezone-submit:en-US:nonce1234567",
      { action: "timezone-submit", locale: "en-US", nonce: "nonce1234567" },
    ],
    [
      "personal-config:v2:naming-submit:en-US:nonce1234567",
      { action: "naming-submit", locale: "en-US", nonce: "nonce1234567" },
    ],
    [
      "personal-config:v2:about-submit:en-US:nonce1234567",
      { action: "about-submit", locale: "en-US", nonce: "nonce1234567" },
    ],
    [
      "personal-config:v2:appearance-submit:en-US:nonce1234567",
      { action: "appearance-submit", locale: "en-US", nonce: "nonce1234567" },
    ],
    [
      "personal-config:v2:character-reference-submit:en-US:nonce1234567",
      { action: "character-reference-submit", locale: "en-US", nonce: "nonce1234567" },
    ],
    [
      "personal-config:v2:privacy-level-submit:en-US:nonce1234567",
      { action: "privacy-level-submit", locale: "en-US", nonce: "nonce1234567" },
    ],
    [
      "personal-config:v2:quick-toggle-submit:en-US:nonce1234567",
      { action: "quick-toggle-submit", locale: "en-US", nonce: "nonce1234567" },
    ],
    [
      "personal-config:v2:impersonation-submit:en-US:nonce1234567",
      { action: "impersonation-submit", locale: "en-US", nonce: "nonce1234567" },
    ],
    [
      "personal-config:v2:impersonation-clear-confirm:en-US:nonce1234567",
      { action: "impersonation-clear-confirm", locale: "en-US", nonce: "nonce1234567" },
    ],
    [
      "personal-config:v2:s-step1:en-US:nonce1234567",
      { action: "spotlight-set-step1", locale: "en-US", nonce: "nonce1234567" },
    ],
    [
      "personal-config:v2:s-blk:en-US:123456789012345678:12:a1b2c3d4:1",
      {
        action: "spotlight-set-block",
        locale: "en-US",
        channelId: "123456789012345678",
        hours: 12,
        fp: "a1b2c3d4",
        blockIdx: 1,
      },
    ],
    [
      "personal-config:v2:s-blk-p:en-US:123456789012345678:12:a1b2c3d4:1",
      {
        action: "spotlight-set-block-page",
        locale: "en-US",
        channelId: "123456789012345678",
        hours: 12,
        fp: "a1b2c3d4",
        chooserPage: 1,
      },
    ],
    [
      "personal-config:v2:s-blk-s:en-US:123456789012345678:12:a1b2c3d4",
      {
        action: "spotlight-set-block-select",
        locale: "en-US",
        channelId: "123456789012345678",
        hours: 12,
        fp: "a1b2c3d4",
      },
    ],
    [
      "personal-config:v2:s-set-sub:en-US:123456789012345678:12:1:a1b2c3d4:nonce1234567",
      {
        action: "spotlight-set-submit",
        locale: "en-US",
        channelId: "123456789012345678",
        hours: 12,
        blockIdx: 1,
        fp: "a1b2c3d4",
        nonce: "nonce1234567",
      },
    ],
    [
      "personal-config:v2:s-cf:en-US:123456789012345678:12:3:1:b33j9ynrb3:a1b2c3d4:nonce1234567",
      {
        action: "spot-set-cf",
        locale: "en-US",
        channelId: "123456789012345678",
        hours: 12,
        autoIdx: 3,
        blockIdx: 1,
        mask: "b33j9ynrb3",
        fp: "a1b2c3d4",
        nonce: "nonce1234567",
      },
    ],
    [
      "personal-config:v2:s-auto:en-US:123456789012345678:12:1:b33j9ynrb3:a1b2c3d4:nonce1234567",
      {
        action: "spot-set-auto",
        locale: "en-US",
        channelId: "123456789012345678",
        hours: 12,
        blockIdx: 1,
        mask: "b33j9ynrb3",
        fp: "a1b2c3d4",
        nonce: "nonce1234567",
      },
    ],
    [
      "personal-config:v2:s-asub:en-US:123456789012345678:12:1:b33j9ynrb3:a1b2c3d4:nonce1234567",
      {
        action: "spot-set-auto-sub",
        locale: "en-US",
        channelId: "123456789012345678",
        hours: 12,
        blockIdx: 1,
        mask: "b33j9ynrb3",
        fp: "a1b2c3d4",
        nonce: "nonce1234567",
      },
    ],
    [
      "personal-config:v2:s-auto-r:en-US:123456789012345678:12:1:b33j9ynrb3:a1b2c3d4:25",
      {
        action: "spot-set-auto-range",
        locale: "en-US",
        channelId: "123456789012345678",
        hours: 12,
        blockIdx: 1,
        mask: "b33j9ynrb3",
        fp: "a1b2c3d4",
        start: 25,
      },
    ],
    [
      "personal-config:v2:s-auto-p:en-US:123456789012345678:12:1:b33j9ynrb3:a1b2c3d4:2",
      {
        action: "spot-set-auto-page",
        locale: "en-US",
        channelId: "123456789012345678",
        hours: 12,
        blockIdx: 1,
        mask: "b33j9ynrb3",
        fp: "a1b2c3d4",
        chooserPage: 2,
      },
    ],
    [
      "personal-config:v2:s-auto-s:en-US:123456789012345678:12:1:b33j9ynrb3:a1b2c3d4",
      {
        action: "spot-set-auto-select",
        locale: "en-US",
        channelId: "123456789012345678",
        hours: 12,
        blockIdx: 1,
        mask: "b33j9ynrb3",
        fp: "a1b2c3d4",
      },
    ],
    [
      "personal-config:v2:s-auto-c:en-US:123456789012345678:12:1:b33j9ynrb3:a1b2c3d4",
      {
        action: "spot-set-auto-cancel",
        locale: "en-US",
        channelId: "123456789012345678",
        hours: 12,
        blockIdx: 1,
        mask: "b33j9ynrb3",
        fp: "a1b2c3d4",
      },
    ],
    [
      "personal-config:v2:s-rem-r:en-US:50:a1b2c3d4",
      { action: "spot-rem-range", locale: "en-US", start: 50, fp: "a1b2c3d4" },
    ],
    [
      "personal-config:v2:s-rem-p:en-US:2:a1b2c3d4",
      { action: "spotlight-remove-page", locale: "en-US", chooserPage: 2, fp: "a1b2c3d4" },
    ],
    [
      "personal-config:v2:s-rem-s:en-US:a1b2c3d4",
      { action: "spotlight-remove-select", locale: "en-US", fp: "a1b2c3d4" },
    ],
    [
      "personal-config:v2:s-rem-sub:en-US:50:a1b2c3d4:nonce1234567",
      { action: "spotlight-remove-submit", locale: "en-US", start: 50, fp: "a1b2c3d4", nonce: "nonce1234567" },
    ],
    [
      "personal-config:v2:persona-naming-open:en-US:7",
      { action: "persona-naming-open", locale: "en-US", lineageId: 7 },
    ],
    [
      "personal-config:v2:persona-naming-submit:en-US:7:nonce1234567",
      { action: "persona-naming-submit", locale: "en-US", lineageId: 7, nonce: "nonce1234567" },
    ],
    [
      "personal-config:v2:model-provider-select:en-US:text",
      { action: "model-provider-select", locale: "en-US", capability: "text" },
    ],
    [
      "personal-config:v2:model-provider-page:en-US:text:openrouter:24",
      { action: "model-provider-page", locale: "en-US", capability: "text", provider: "openrouter", start: 24 },
    ],
    [
      "personal-config:v2:model-provider-range-open:en-US:text:25",
      { action: "model-provider-range-open", locale: "en-US", capability: "text", start: 25 },
    ],
    [
      "personal-config:v2:model-provider-range-page:en-US:text:2",
      { action: "model-provider-range-page", locale: "en-US", capability: "text", chooserPage: 2 },
    ],
    [
      "personal-config:v2:model-range-open:en-US:text:openrouter:25",
      { action: "model-range-open", locale: "en-US", capability: "text", provider: "openrouter", start: 25 },
    ],
    [
      "personal-config:v2:model-range-page:en-US:text:openrouter:2",
      { action: "model-range-page", locale: "en-US", capability: "text", provider: "openrouter", chooserPage: 2 },
    ],
    [
      "personal-config:v2:model-modal-submit:en-US:text:openrouter:nonce1234567",
      {
        action: "model-modal-submit",
        locale: "en-US",
        capability: "text",
        provider: "openrouter",
        nonce: "nonce1234567",
      },
    ],
    [
      "personal-config:v2:parameters-1-open:en-US:openrouter",
      { action: "parameters-1-open", locale: "en-US", provider: "openrouter" },
    ],
    [
      "personal-config:v2:parameters-2-open:en-US:openrouter",
      { action: "parameters-2-open", locale: "en-US", provider: "openrouter" },
    ],
    [
      "personal-config:v2:randomizer-toggle:en-US:openrouter",
      { action: "randomizer-toggle", locale: "en-US", provider: "openrouter" },
    ],
    [
      "personal-config:v2:randomizer-set:en-US:openrouter:on",
      { action: "randomizer-set", locale: "en-US", provider: "openrouter", enabled: true },
    ],
    [
      "personal-config:v2:server-fallback-set:en-US:on",
      { action: "server-fallback-set", locale: "en-US", enabled: true },
    ],
    [
      "personal-config:v2:fallbacks-page:en-US:openrouter:24",
      { action: "fallbacks-page", locale: "en-US", provider: "openrouter", start: 24 },
    ],
    [
      "personal-config:v2:fallbacks-range-open:en-US:openrouter:25",
      { action: "fallbacks-range-open", locale: "en-US", provider: "openrouter", start: 25 },
    ],
    [
      "personal-config:v2:fallbacks-range-page:en-US:openrouter:2",
      { action: "fallbacks-range-page", locale: "en-US", provider: "openrouter", chooserPage: 2 },
    ],
    [
      "personal-config:v2:parameters-1-submit:en-US:openrouter:nonce1234567",
      { action: "parameters-1-submit", locale: "en-US", provider: "openrouter", nonce: "nonce1234567" },
    ],
    [
      "personal-config:v2:parameters-2-submit:en-US:openrouter:nonce1234567",
      { action: "parameters-2-submit", locale: "en-US", provider: "openrouter", nonce: "nonce1234567" },
    ],
    [
      "personal-config:v2:fallbacks-submit:en-US:openrouter:nonce1234567",
      { action: "fallbacks-submit", locale: "en-US", provider: "openrouter", nonce: "nonce1234567" },
    ],
    [
      "personal-config:v2:retry:en-US:profile:general",
      { action: "retry", locale: "en-US", category: "profile", page: "general" },
    ],
    [
      "personal-config:v2:retry:en-US:profile:persona:7",
      { action: "retry", locale: "en-US", category: "profile", page: "persona", lineageId: 7 },
    ],
    [
      "personal-config:v2:refresh:en-US:models:switch",
      { action: "refresh", locale: "en-US", category: "models", page: "switch" },
    ],
  ];

  it.each(WIRE_CONTRACT_V2)("decodes the pinned wire string %s to its exact route", (customId, expected) => {
    expect(customId.length).toBeLessThanOrEqual(100);
    expect(parsePersonalConfigPanelRoute(requireRoute(customId))).toEqual(expected);
  });

  it("covers every personal-config action in the pinned wire contract", () => {
    const pinned = new Set<string>(WIRE_CONTRACT_V2.map(([, route]) => route.action));
    // The codec table's mapped type requires one key per member of the action union, so its keys
    // are the declared actions without reading the union's source text.
    const declared = Object.keys(PERSONAL_CONFIG_ROUTE_CODECS);
    expect(declared.length).toBe(76);
    expect(declared.filter((action) => !pinned.has(action))).toEqual([]);
  });

  /**
   * The retry and refresh codecs accept a four-segment form (no lineage) and a five-segment form
   * (lineage present). Each pair is one case: the round-trip proves the field survives, and the
   * field-absence assertions prove the shorter form does not fabricate the longer form's fields.
   */
  const RETRY_AND_REFRESH_ROUTES: ReadonlyArray<
    readonly [string, PersonalConfigPanelRoute, PersonalConfigPanelRoute, readonly string[]]
  > = [
    [
      "retry without a lineage",
      { action: "retry", locale: "en-US", category: "profile", page: "general" },
      { action: "retry", locale: "en-US", category: "profile", page: "persona", lineageId: 10 },
      ["lineageId", "capability", "provider"],
    ],
    [
      "refresh without a lineage",
      { action: "refresh", locale: "en-US", category: "models", page: "switch" },
      { action: "refresh", locale: "en-US", category: "profile", page: "persona", lineageId: 42 },
      ["lineageId", "capability", "provider"],
    ],
  ];

  it.each(
    RETRY_AND_REFRESH_ROUTES,
  )("round-trips the %s form and enforces exact arity", (_label, fourSegment, fiveSegment, absentFromFour) => {
    const parsedFour = parsePersonalConfigPanelRoute(requireRoute(buildPersonalConfigRouteId(fourSegment)));
    expect(parsedFour).toEqual(fourSegment);
    for (const field of absentFromFour) {
      expect(field in (parsedFour ?? {})).toBe(false);
    }

    const parsedFive = parsePersonalConfigPanelRoute(requireRoute(buildPersonalConfigRouteId(fiveSegment)));
    expect(parsedFive).toEqual(fiveSegment);
    // The longer form carries lineageId, so only the fields it never declares must be absent.
    for (const field of absentFromFour.filter((candidate) => candidate !== "lineageId")) {
      expect(field in (parsedFive ?? {})).toBe(false);
    }
  });

  function buildRoutesForAction(action: PersonalConfigAction, isWorstCase = false): PersonalConfigPanelRoute[] {
    const locale = isWorstCase ? "zh-Hans" : "en-US";
    const nonce = "nonce1234567";
    const snowflake = isWorstCase ? "12345678901234567890" : "123456789012345678";
    const hours = isWorstCase ? 999999 : 12;
    const blockIdx = isWorstCase ? 999 : 1;
    const chooserPage = isWorstCase ? 999 : 2;
    const start = isWorstCase ? 99999 : 25;
    const autoIdx = isWorstCase ? 50 : 3;
    const mask = "b33j9ynrb3";
    const fp = "a1b2c3d4";
    const lineageId = isWorstCase ? 9999999 : 7;
    const provider = isWorstCase ? "custom~endpoint~provider" : "openrouter";
    const capability: PersonalConfigManagedCapability = isWorstCase ? "embedding" : "text";
    const category: PersonalConfigCategory = isWorstCase ? "advanced" : "profile";
    const page: PersonalConfigPage = isWorstCase ? "response-modes" : "general";
    const mode = isWorstCase ? "follow" : "on";

    switch (action) {
      case "category":
        return [{ action, locale, category, page }];
      case "page":
        return [{ action, locale, category, page }];
      case "persona-select":
        return [{ action, locale, lineageId }];
      case "language-open":
      case "timezone-open":
      case "timezone-server":
      case "naming-open":
      case "about-open":
      case "appearance-open":
      case "character-reference-open":
      case "character-reference-clear":
      case "privacy-level-open":
      case "crossserver-toggle":
      case "quick-toggle-open":
      case "model-act-cancel":
      case "parameters-provider-select":
      case "fallbacks-provider-select":
      case "impersonation-open":
      case "impersonation-clear-view":
      case "impersonation-clear-cancel":
      case "spotlight-set-open":
      case "spotlight-set-cancel":
      case "spotlight-remove-open":
      case "spotlight-remove-cancel":
        return [{ action, locale }];
      case "language-submit":
      case "language-only-submit":
      case "timezone-submit":
      case "naming-submit":
      case "about-submit":
      case "appearance-submit":
      case "character-reference-submit":
      case "privacy-level-submit":
      case "quick-toggle-submit":
      case "impersonation-submit":
      case "impersonation-clear-confirm":
      case "spotlight-set-step1":
        return [{ action, locale, nonce }];
      case "persona-naming-open":
        return [{ action, locale, lineageId }];
      case "persona-naming-submit":
        return [{ action, locale, lineageId, nonce }];
      case "model-provider-select":
        return [{ action, locale, capability }];
      case "model-provider-page":
        return [{ action, locale, capability, provider, start }];
      case "model-provider-range-open":
        return [{ action, locale, capability, start }];
      case "model-provider-range-page":
        return [{ action, locale, capability, chooserPage }];
      case "model-range-open":
        return [{ action, locale, capability, provider, start }];
      case "model-range-page":
        return [{ action, locale, capability, provider, chooserPage }];
      case "model-modal-submit":
        return [{ action, locale, capability, provider, nonce }];
      case "parameters-1-open":
      case "parameters-2-open":
      case "randomizer-toggle":
        return [{ action, locale, provider }];
      case "parameters-1-submit":
      case "parameters-2-submit":
      case "fallbacks-submit":
        return [{ action, locale, provider, nonce }];
      case "fallbacks-page":
      case "fallbacks-range-open":
        return [{ action, locale, provider, start }];
      case "fallbacks-range-page":
        return [{ action, locale, provider, chooserPage }];
      case "trigger-mode-set":
      case "tool-mode-set":
        return [{ action, locale, mode }];
      case "crossserver-set":
        return [{ action, locale, enabled: !isWorstCase }];
      case "server-fallback-set":
        return [{ action, locale, enabled: !isWorstCase }];
      case "randomizer-set":
        return [{ action, locale, provider, enabled: !isWorstCase }];
      case "spotlight-set-block":
        return [{ action, locale, channelId: snowflake, hours, fp, blockIdx }];
      case "spotlight-set-block-page":
        return [{ action, locale, channelId: snowflake, hours, fp, chooserPage }];
      case "spotlight-set-block-select":
        return [{ action, locale, channelId: snowflake, hours, fp }];
      case "spotlight-set-submit":
        return [{ action, locale, channelId: snowflake, hours, blockIdx, fp, nonce }];
      case "spot-set-cf":
        return [{ action, locale, channelId: snowflake, hours, autoIdx, blockIdx, mask, fp, nonce }];
      case "spot-set-auto":
        return [{ action, locale, channelId: snowflake, hours, blockIdx, mask, fp, nonce }];
      case "spot-set-auto-range":
        return [{ action, locale, channelId: snowflake, hours, blockIdx, mask, fp, start }];
      case "spot-set-auto-page":
        return [{ action, locale, channelId: snowflake, hours, blockIdx, mask, fp, chooserPage }];
      case "spot-set-auto-select":
        return [{ action, locale, channelId: snowflake, hours, blockIdx, mask, fp }];
      case "spot-set-auto-cancel":
        return [{ action, locale, channelId: snowflake, hours, blockIdx, mask, fp }];
      case "spot-set-auto-sub":
        return [{ action, locale, channelId: snowflake, hours, blockIdx, mask, fp, nonce }];
      case "spot-rem-range":
        return [{ action, locale, start, fp }];
      case "spotlight-remove-page":
        return [{ action, locale, chooserPage, fp }];
      case "spotlight-remove-select":
        return [{ action, locale, fp }];
      case "spotlight-remove-submit":
        return [{ action, locale, start, fp, nonce }];
      case "retry":
      case "refresh":
        return isWorstCase
          ? [{ action, locale, category, page, lineageId }]
          : [
              { action, locale, category: "profile", page: "general" },
              { action, locale, category: "profile", page: "persona", lineageId },
            ];
    }
  }

  it("round-trips every action in the codec table", () => {
    const actions = Object.keys(PERSONAL_CONFIG_ROUTE_CODECS) as PersonalConfigAction[];
    expect(actions.length).toBe(76);

    for (const action of actions) {
      const routes = buildRoutesForAction(action, false);
      for (const route of routes) {
        const customId = buildPersonalConfigRouteId(route);
        const parsed = parsePersonalConfigPanelRoute(requireRoute(customId));
        expect(parsed).toEqual(route);
        if (route.action === "retry" || route.action === "refresh") {
          if (route.lineageId === undefined) {
            expect("lineageId" in (parsed ?? {})).toBe(false);
          }
        }
      }
    }
  });

  it("keeps worst-case custom ID length at or below 100 characters for every action", () => {
    // Realistic maxima justification:
    // - locale: 7 characters ("zh-Hans") gives language expansion headroom for BCP-47 tags.
    // - channelId: 20 digits covers the maximum unsigned 64-bit snowflake ID.
    // - hours: 6 digits (999999) matches the max_length constraint of the duration modal text input.
    // - blockIdx: 3 digits (999) covers up to 50,000 personas in 50-persona blocks.
    // - chooserPage: 3 digits (999) covers up to 1,000 range pages.
    // - start: 5 digits (99999) covers pagination offsets up to 100,000 rows.
    // - autoIdx: 2 digits (50) is bounded by SPOTLIGHT_PERSONA_PAGE_SIZE (50).
    // - mask: 10 characters ("b33j9ynrb3") is the full 50-bit base36 mask for a 50-persona block.
    // - fp: 8 characters ("a1b2c3d4") produced by SHA-256 base64url fingerprint prefix.
    // - nonce: 12 characters ("nonce1234567") produced by createNonce.
    // - lineageId: 7 digits (9999999) covers auto-increment database primary keys.
    // - provider: 24 characters ("custom~endpoint~provider") covers realistic custom provider identifiers.
    // - capability: "embedding" (9 chars) is the longest PersonalConfigManagedCapability.
    // - category: "advanced" (8 chars) is the longest PersonalConfigCategory.
    // - page: "response-modes" (14 chars) is the longest PersonalConfigPage.
    // - mode: "follow" (6 chars) is the longest deliberate trigger/tool mode.
    const actions = Object.keys(PERSONAL_CONFIG_ROUTE_CODECS) as PersonalConfigAction[];
    expect(actions.length).toBe(76);

    for (const action of actions) {
      const routes = buildRoutesForAction(action, true);
      for (const route of routes) {
        const customId = buildPersonalConfigRouteId(route);
        expect(customId.length).toBeLessThanOrEqual(100);
      }
    }
  });

  it("proves table actions and handler comparisons in personalConfigRoutes agree", () => {
    const handlerSources = PERSONAL_CONFIG_HANDLER_SOURCES.map((relativePath) => {
      const source = readFileSync(new URL(`../../../${relativePath}`, import.meta.url), "utf8");
      expect(source.length).toBeGreaterThan(0);
      return source;
    });

    const tableActions = new Set<string>(Object.keys(PERSONAL_CONFIG_ROUTE_CODECS));
    const handlerActions = new Set(
      handlerSources.flatMap((source) => [...source.matchAll(/route\.action === "([a-z0-9-]+)"/g)].map((m) => m[1])),
    );

    expect(tableActions.size).toBe(76);
    expect(handlerActions.size).toBe(76);
    expect([...tableActions].filter((a) => !handlerActions.has(a))).toEqual([]);
    expect([...handlerActions].filter((a) => !tableActions.has(a))).toEqual([]);
  });

  it("fails closed when dropping or appending a segment for every action in the table", () => {
    const actions = Object.keys(PERSONAL_CONFIG_ROUTE_CODECS) as PersonalConfigAction[];
    expect(actions.length).toBe(76);

    for (const action of actions) {
      const routes = buildRoutesForAction(action, false);
      for (const route of routes) {
        const validId = buildPersonalConfigRouteId(route);
        const validRoute = requireRoute(validId);
        expect(parsePersonalConfigPanelRoute(validRoute)).not.toBeNull();

        // Dropping one segment from the end
        const segmentsDropped = validRoute.segments.slice(0, -1);
        if (segmentsDropped.length >= 2) {
          const droppedParsedRoute = {
            namespace: validRoute.namespace,
            version: validRoute.version,
            segments: segmentsDropped,
          };
          if ((action === "retry" || action === "refresh") && "lineageId" in route && route.lineageId !== undefined) {
            expect(parsePersonalConfigPanelRoute(droppedParsedRoute)).not.toBeNull();
          } else {
            expect(parsePersonalConfigPanelRoute(droppedParsedRoute)).toBeNull();
          }
        }

        // For 4-segment retry/refresh, dropping one segment drops to 3 segments which must fail closed
        if ((action === "retry" || action === "refresh") && !("lineageId" in route && route.lineageId !== undefined)) {
          const droppedTwice = {
            namespace: validRoute.namespace,
            version: validRoute.version,
            segments: validRoute.segments.slice(0, -1),
          };
          expect(parsePersonalConfigPanelRoute(droppedTwice)).toBeNull();
        }

        // Appending one extra segment to the end
        const appendedParsedRoute = {
          namespace: validRoute.namespace,
          version: validRoute.version,
          segments: [...validRoute.segments, "extra"],
        };
        expect(parsePersonalConfigPanelRoute(appendedParsedRoute)).toBeNull();
      }
    }
  });

  /**
   * Custom IDs a client could construct but the parser must refuse. Each row names the rule it
   * exercises so a loosened parse reports which grammar rule it broke.
   */
  const MALFORMED_ROUTES: ReadonlyArray<readonly [string, string]> = [
    ["foreign namespace", "other:v2:category:en-US:profile:general"],
    ["retired v1 version", "personal-config:v1:category:en-US:profile:general"],
    ["unparseable locale", "personal-config:v2:category:invalid-locale:profile:general"],
    ["unknown category", "personal-config:v2:category:en-US:unknown:general"],
    ["unknown wire token", "personal-config:v2:s-set-sub:en-US:short:nonce123456"],
    [
      "spot-set-cf with an empty mask",
      "personal-config:v2:spot-set-cf:en-US:123456789012345678:0:0:1:a1b2c3d4:nonce123456",
    ],
    ["retry with a trailing segment", "personal-config:v2:retry:en-US:profile:persona:10:extra"],
    ["retry naming a page's provider slot", "personal-config:v2:retry:en-US:models:switch:openrouter"],
    ["retry naming a capability slot", "personal-config:v2:retry:en-US:models:switch:text"],
    ["retry with a zero lineage", "personal-config:v2:retry:en-US:profile:persona:0"],
    ["retry missing its page segment", "personal-config:v2:retry:en-US:profile"],
  ];

  it.each(MALFORMED_ROUTES)("rejects a route with %s", (_label, customId) => {
    expect(parsePersonalConfigPanelRoute(requireRoute(customId))).toBeNull();
  });
});

describe("/personal config command registration", () => {
  it("registers /personal config as a leaf command without config.* subcommands", async () => {
    const { registrationData, executionMap } = await loadCommandData();
    const personalCommand = registrationData.find((cmd) => cmd.name === "personal");
    expect(personalCommand).toBeDefined();

    const options = (personalCommand as { options?: Array<{ name: string; type: number }> }).options ?? [];
    const configOption = options.find((opt) => opt.name === "config");
    expect(configOption).toBeDefined();
    // type 1 is Subcommand (leaf)
    expect(configOption?.type).toBe(1);

    const personalExecutions = executionMap.get("personal");
    expect(personalExecutions?.has("config")).toBe(true);
    expect(personalExecutions?.has("config.export")).toBe(false);
    expect(personalExecutions?.has("config.import")).toBe(false);
    expect(personalExecutions?.has("config.remove")).toBe(false);
  }, 30000);
});

describe("personalConfigOperations invariants", () => {
  it("setNaming applies userNamingRepository.applyUserInfoBatch and invalidates cache", async () => {
    const batchSpy = spyOn(userNamingRepository, "applyUserInfoBatch").mockImplementation(async () => {});
    const result = await personalConfigOperations.setNaming({
      userId: 1,
      userDiscId: "user-123",
      nickname: "NewNick",
      prefix: "Sir",
      suffix: "-sama",
    });

    expect(result).toEqual({ status: "success" });
    expect(batchSpy).toHaveBeenCalledWith(1, {
      global: {
        user_nickname: "NewNick",
        prefix_override: "Sir",
        suffix_override: "-sama",
      },
    });
    batchSpy.mockRestore();
  });

  it("setPersonaNaming applies userNamingRepository.applyUserInfoBatch for persona lineage", async () => {
    const batchSpy = spyOn(userNamingRepository, "applyUserInfoBatch").mockImplementation(async () => {});
    const result = await personalConfigOperations.setPersonaNaming({
      userId: 1,
      userDiscId: "user-123",
      personaLineageId: 10,
      nickname: "PersonaNick",
      prefix: null,
      suffix: null,
    });

    expect(result).toEqual({ status: "success" });
    expect(batchSpy).toHaveBeenCalledWith(1, {
      global: {},
      persona: {
        personaLineageId: 10,
        patch: {
          nickname_override: "PersonaNick",
          prefix_override: null,
          suffix_override: null,
        },
      },
    });
    batchSpy.mockRestore();
  });

  it("setAbout applies userNamingRepository.applyUserInfoBatch for about fields", async () => {
    const batchSpy = spyOn(userNamingRepository, "applyUserInfoBatch").mockImplementation(async () => {});
    const result = await personalConfigOperations.setAbout({
      userId: 1,
      userDiscId: "user-123",
      genderIdentity: "Non-binary",
      pronouns: "they/them",
      addressingStyle: "neutral",
    });

    expect(result).toEqual({ status: "success" });
    expect(batchSpy).toHaveBeenCalledWith(1, {
      global: {
        gender_identity: "Non-binary",
        pronouns: "they/them",
        addressing_style: "neutral",
      },
    });
    batchSpy.mockRestore();
  });

  it("setAppearance validates and updates physical appearance tags", async () => {
    const updateSpy = spyOn(userRepository, "update").mockImplementation(async () => makeUser());

    // Empty tags clears
    const clearResult = await personalConfigOperations.setAppearance({
      userId: 1,
      userDiscId: "user-123",
      rawTags: "   ",
    });
    expect(clearResult).toEqual({ status: "success", tags: [] });
    expect(updateSpy).toHaveBeenCalledWith(1, { physical_appearance_tags: [] });

    // Valid tags updates
    const validResult = await personalConfigOperations.setAppearance({
      userId: 1,
      userDiscId: "user-123",
      rawTags: "white hair, red eyes",
    });
    expect(validResult).toEqual({ status: "success", tags: ["white hair", "red eyes"] });
    expect(updateSpy).toHaveBeenCalledWith(1, { physical_appearance_tags: ["white hair", "red eyes"] });

    updateSpy.mockRestore();
  });

  it("setPrivacyLevel and toggleCrossServerStm call repository methods", async () => {
    const privacySpy = spyOn(userRepository, "setPrivacyLevel").mockImplementation(async () => makeUser());
    const toggleSpy = spyOn(userRepository, "toggleCrossServerShmOptIn").mockImplementation(async () => true);

    const privacyResult = await personalConfigOperations.setPrivacyLevel({
      userId: 1,
      userDiscId: "user-123",
      level: PrivacyLevel.FULL,
    });
    expect(privacyResult).toEqual({ status: "success" });
    expect(privacySpy).toHaveBeenCalledWith("user-123", PrivacyLevel.FULL);

    const toggleResult = await personalConfigOperations.toggleCrossServerStm({
      userDiscId: "user-123",
    });
    expect(toggleResult).toEqual({ status: "success", enabled: true });
    expect(toggleSpy).toHaveBeenCalledWith("user-123");

    privacySpy.mockRestore();
    toggleSpy.mockRestore();
  });
});

describe("personalConfigRoutes interaction handling and telemetry", () => {
  it("acknowledges interaction before writing and emits telemetry on success", async () => {
    const calls: string[] = [];
    let acknowledgedDuringWrite = false;

    const { dependencies, telemetry } = makeDependencies(calls, {
      operations: {
        ...personalConfigOperations,
        setNaming: async (input) => {
          acknowledgedDuringWrite = interaction.deferred || interaction.replied;
          calls.push(`setNaming:${input.nickname}`);
          return { status: "success" };
        },
      },
    });

    const route = createPersonalConfigInteractionRoute(dependencies);
    const customId = buildPersonalConfigRouteId({ action: "naming-submit", locale: "en-US", nonce: "nonce123456" });

    const interaction = makePersonalInteraction({
      kind: "modal",
      customId,
      fields: { nickname_nonce123456: "SuperUser", prefix_nonce123456: "", suffix_nonce123456: "" },
    });

    await route.execute({} as Client, interaction, requireRoute(customId));

    expect(calls).toContain("setNaming:SuperUser");
    expect(acknowledgedDuringWrite).toBe(true);
    expect(telemetry).toContain("personal-config.personal.naming.set");
  });

  it("emits crossserver-stm telemetry on toggle", async () => {
    const calls: string[] = [];
    const { dependencies, telemetry } = makeDependencies(calls);
    const route = createPersonalConfigInteractionRoute(dependencies);
    const customId = buildPersonalConfigRouteId({ action: "crossserver-toggle", locale: "en-US" });

    const interaction = makePersonalInteraction({
      customId,
    });

    await route.execute({} as Client, interaction, requireRoute(customId));

    expect(calls).toContain("toggleCrossServerStm");
    expect(telemetry).toContain("personal-config.personal.crossserver-stm.set");
  });

  it("handles outdated panel version in router", async () => {
    const staleInteraction = makePersonalInteraction({
      customId: "personal-config:v0:category:en-US:profile:general",
    });

    const handled = await dispatchGlobalInteraction({} as Client, staleInteraction);
    expect(handled).toBe(true);
    const replyPayload = staleInteraction.replies.at(-1) as unknown as { content: string };
    expect(replyPayload).toBeDefined();
    expect(replyPayload.content).toContain("/personal config");
  });
});

// The route converts each empty modal field to null before the operation sees it, and null is what
// `applyUserInfoBatch` turns into "inherit". Storing "" instead would be a distinct, non-null value
// that permanently defeats the live-Discord-name fallback, and the operations-level tests cannot
// catch it because they are handed nulls directly.
describe("naming modal empty fields mean inherit", () => {
  it("submits a blank or whitespace-only field to the operation as null, not an empty string", async () => {
    const calls: string[] = [];
    // Declared without a `null` initializer: TypeScript narrows a `let` to that initializer and cannot
    // see the closure assignment, and a missing submission still fails the assertion below.
    let received: { nickname: string | null; prefix: string | null; suffix: string | null } | undefined;

    const { dependencies } = makeDependencies(calls, {
      operations: {
        ...personalConfigOperations,
        setNaming: async (input) => {
          received = { nickname: input.nickname, prefix: input.prefix, suffix: input.suffix };
          return { status: "success" };
        },
      },
    });

    const route = createPersonalConfigInteractionRoute(dependencies);
    const customId = buildPersonalConfigRouteId({ action: "naming-submit", locale: "en-US", nonce: "nonce123456" });

    // Whitespace rather than "" so a dropped .trim() fails here too.
    const interaction = makePersonalInteraction({
      kind: "modal",
      customId,
      fields: { nickname_nonce123456: "   ", prefix_nonce123456: "", suffix_nonce123456: "" },
    });

    await route.execute({} as Client, interaction, requireRoute(customId));

    expect(received).toEqual({ nickname: null, prefix: null, suffix: null });
  });
});

describe("personalConfigPanelCatalog Models routes", () => {
  it("encodes and decodes provider names with colons", () => {
    expect(encodeProviderParam("custom:12")).toBe("custom~12");
    expect(decodeProviderParam("custom~12")).toBe("custom:12");
    expect(encodeProviderParam("openrouter")).toBe("openrouter");
    expect(decodeProviderParam("openrouter")).toBe("openrouter");
  });

  it("carries a colon-bearing provider through the codec without corrupting the segment grammar", () => {
    // A colon is the segment separator, so an unencoded provider would make
    // buildInteractionRouteId throw during panel render. The codec owns this encoding now, and the
    // generated round-trip covers only colon-free providers, so this pins the composition rather
    // than encodeProviderParam and the codec table separately.
    const provider = "custom:123456789";
    const customId = buildPersonalConfigRouteId({
      action: "model-modal-submit",
      locale: "en-US",
      capability: "image_nai",
      provider,
      nonce: "nonce123456",
    });

    expect(customId.split(":")).toHaveLength(7);
    expect(parsePersonalConfigPanelRoute(requireRoute(customId))).toEqual({
      action: "model-modal-submit",
      locale: "en-US",
      capability: "image_nai",
      provider,
      nonce: "nonce123456",
    });
  });

  it("refuses the Fallbacks edit button that the provider select replaced", () => {
    // The button was the only producer of `fallbacks-open`, and a route with no producer is
    // invisible to every gate, so the action was retired rather than left parseable.
    expect(
      parsePersonalConfigPanelRoute(requireRoute("personal-config:v2:fallbacks-open:en-US:openrouter")),
    ).toBeNull();
  });

  it("refuses the Switch Models controls that the six capability selects replaced", () => {
    // Raw wire strings represent what a stale Discord client could still send, so the parser
    // must reject retired controls rather than route them.
    const retired = [
      "personal-config:v2:capability-select:en-US",
      "personal-config:v2:model-enable:en-US:text",
      "personal-config:v2:model-default:en-US:text",
    ];

    for (const customId of retired) {
      expect(parsePersonalConfigPanelRoute(requireRoute(customId))).toBeNull();
    }
  });
});

describe("personalConfigOperations Models invariants", () => {
  it("setCapabilityEnabled rejects enabling when no model is configured", async () => {
    const loadSpy = spyOn(llmProviderRepo, "loadUserSavedProviderConfigs").mockImplementation(async () => [
      {
        user_saved_config_id: 1,
        user_id: 1,
        provider: "openrouter",
        key_version: 1,
        api_key: null,
        llm_id: null,
        diffusion_model_id: null,
        embedding_model_id: null,
        nai_diffusion_model_id: null,
        video_model_id: null,
        vision_llm_id: null,
        nai_preset_name: null,
        llm_temperature: null,
        llm_top_p: null,
        llm_top_k: null,
        llm_frequency_penalty: null,
        llm_presence_penalty: null,
        llm_min_p: null,
        llm_max_output_tokens: null,
        llm_disabled_params: [],
        llm_logit_biases: [],
        thinking_level: "auto",
        model_randomizer_enabled: false,
        enabled_capabilities: [],
        assigned_capabilities: ["text"],
        fallback_model_refs: [],
      } as unknown as UserSavedProviderConfigRow,
    ]);

    const result = await personalConfigOperations.setCapabilityEnabled({
      userId: 1,
      userDiscId: "user-123",
      capability: "text",
      enabled: true,
    });

    expect(result).toEqual({ status: "missing-model" });
    loadSpy.mockRestore();
  });

  it("setCapabilityModel rejects a model outside the fresh provider catalog", async () => {
    const savedRow = {
      provider: "openrouter",
      llm_id: 101,
      enabled_capabilities: ["text"],
      assigned_capabilities: ["text"],
    } as unknown as UserSavedProviderConfigRow;
    const loadConfigsSpy = spyOn(llmProviderRepo, "loadUserSavedProviderConfigs").mockImplementation(async () => [
      savedRow,
    ]);
    const availableSpy = spyOn(llmModelRepo, "loadAvailableModelsForProvider").mockImplementation(
      async () =>
        [{ llm_id: 101, llm_codename: "allowed-model" }] as unknown as ReturnType<
          typeof llmModelRepo.loadAvailableModelsForProvider
        > extends Promise<infer T>
          ? T
          : never,
    );
    const upsertSpy = spyOn(llmProviderRepo, "upsertUserSavedProviderConfig").mockImplementation(async () => true);

    const result = await personalConfigOperations.setCapabilityModel({
      userId: 1,
      userDiscId: "user-123",
      capability: "text",
      provider: "openrouter",
      modelId: 999,
    });

    expect(result).toEqual({ status: "write-failed" });
    expect(upsertSpy).not.toHaveBeenCalled();
    loadConfigsSpy.mockRestore();
    availableSpy.mockRestore();
    upsertSpy.mockRestore();
  });

  it("setQuickToggleRouting attempts all six capabilities after a partial failure", async () => {
    const savedRows = [
      {
        provider: "openrouter",
        llm_id: 101,
        vision_llm_id: 102,
        embedding_model_id: 201,
        diffusion_model_id: 301,
        nai_diffusion_model_id: null,
        video_model_id: 401,
        enabled_capabilities: [],
        assigned_capabilities: ["text", "vision", "embedding", "image", "video"],
      } as unknown as UserSavedProviderConfigRow,
      {
        provider: "novelai",
        llm_id: null,
        vision_llm_id: null,
        embedding_model_id: null,
        diffusion_model_id: null,
        nai_diffusion_model_id: 501,
        video_model_id: null,
        enabled_capabilities: [],
        assigned_capabilities: ["image_nai"],
      } as unknown as UserSavedProviderConfigRow,
    ];
    const loadConfigsSpy = spyOn(llmProviderRepo, "loadUserSavedProviderConfigs").mockImplementation(
      async () => savedRows,
    );
    let writeCount = 0;
    const upsertSpy = spyOn(llmProviderRepo, "upsertUserSavedProviderConfig").mockImplementation(async () => {
      writeCount += 1;
      return writeCount !== 1;
    });

    const result = await personalConfigOperations.setQuickToggleRouting({
      userId: 1,
      userDiscId: "user-123",
      selectedCapabilities: new Set(["text", "vision", "embedding", "image", "image_nai", "video"]),
    });

    expect(result).toEqual({ status: "write-failed" });
    expect(writeCount).toBe(6);
    loadConfigsSpy.mockRestore();
    upsertSpy.mockRestore();
  });

  it("setParameters rejects invalid bounds and thinking level", async () => {
    const loadConfigsSpy = spyOn(llmProviderRepo, "loadUserSavedProviderConfigs").mockImplementation(async () => [
      {
        provider: "openrouter",
        llm_id: 101,
        enabled_capabilities: ["text"],
        assigned_capabilities: ["text"],
      } as unknown as UserSavedProviderConfigRow,
    ]);
    const loadSpy = spyOn(llmProviderRepo, "loadUserSavedProviderConfig").mockImplementation(
      async () =>
        ({
          user_saved_config_id: 1,
          user_id: 1,
          provider: "openrouter",
          key_version: 1,
          api_key: null,
          llm_id: 101,
          diffusion_model_id: null,
          embedding_model_id: null,
          nai_diffusion_model_id: null,
          video_model_id: null,
          vision_llm_id: null,
          nai_preset_name: null,
          llm_temperature: 0.7,
          llm_top_p: 0.95,
          llm_top_k: 0,
          llm_frequency_penalty: 0,
          llm_presence_penalty: 0,
          llm_min_p: 0.05,
          llm_max_output_tokens: 4096,
          llm_disabled_params: [],
          llm_logit_biases: [],
          thinking_level: "auto",
          model_randomizer_enabled: false,
          enabled_capabilities: ["text"],
          assigned_capabilities: ["text"],
          fallback_model_refs: [],
        }) as unknown as UserSavedProviderConfigRow,
    );

    const badTemp = await personalConfigOperations.setParameters({
      userId: 1,
      userDiscId: "user-123",
      provider: "openrouter",
      patch: { temperature: 3.5 },
    });
    expect(badTemp).toEqual({ status: "invalid-value" });

    const badTopK = await personalConfigOperations.setParameters({
      userId: 1,
      userDiscId: "user-123",
      provider: "openrouter",
      patch: { top_k: -5 },
    });
    expect(badTopK).toEqual({ status: "invalid-value" });

    const badThinking = await personalConfigOperations.setParameters({
      userId: 1,
      userDiscId: "user-123",
      provider: "openrouter",
      patch: { thinking_level: "ultra" as unknown as ThinkingLevelValue },
    });
    expect(badThinking).toEqual({ status: "invalid-value" });

    loadSpy.mockRestore();
    loadConfigsSpy.mockRestore();
  });

  it("setRandomizer requires at least one fallback model when enabling", async () => {
    const loadConfigsSpy = spyOn(llmProviderRepo, "loadUserSavedProviderConfigs").mockImplementation(async () => [
      {
        provider: "openrouter",
        llm_id: 101,
        enabled_capabilities: ["text"],
        assigned_capabilities: ["text"],
      } as unknown as UserSavedProviderConfigRow,
    ]);
    const loadSpy = spyOn(llmProviderRepo, "loadUserSavedProviderConfig").mockImplementation(
      async () =>
        ({
          user_saved_config_id: 1,
          user_id: 1,
          provider: "openrouter",
          key_version: 1,
          api_key: null,
          llm_id: 101,
          diffusion_model_id: null,
          embedding_model_id: null,
          nai_diffusion_model_id: null,
          video_model_id: null,
          vision_llm_id: null,
          nai_preset_name: null,
          llm_temperature: 0.7,
          llm_top_p: 0.95,
          llm_top_k: 0,
          llm_frequency_penalty: 0,
          llm_presence_penalty: 0,
          llm_min_p: 0.05,
          llm_max_output_tokens: 4096,
          llm_disabled_params: [],
          llm_logit_biases: [],
          thinking_level: "auto",
          model_randomizer_enabled: false,
          enabled_capabilities: ["text"],
          assigned_capabilities: ["text"],
          fallback_model_refs: [],
        }) as unknown as UserSavedProviderConfigRow,
    );

    const result = await personalConfigOperations.setRandomizer({
      userId: 1,
      userDiscId: "user-123",
      provider: "openrouter",
      enabled: true,
    });

    expect(result).toEqual({ status: "requires-fallbacks" });
    loadSpy.mockRestore();
    loadConfigsSpy.mockRestore();
  });
});

describe("Models interaction routing and telemetry", () => {
  it("quick-toggle-submit acknowledges before the operation and records telemetry on success", async () => {
    const calls: string[] = [];
    let acknowledgedDuringWrite = false;
    let interaction: PersonalInteraction;
    const { dependencies, telemetry } = makeDependencies(calls);
    dependencies.operations = {
      ...dependencies.operations,
      setQuickToggleRouting: async () => {
        acknowledgedDuringWrite = interaction.deferred || interaction.replied;
        calls.push("setQuickToggleRouting");
        return { status: "success" };
      },
    };
    const route = createPersonalConfigInteractionRoute(dependencies);
    const customId = buildPersonalConfigRouteId({
      action: "quick-toggle-submit",
      locale: "en-US",
      nonce: "nonce123456",
    });

    interaction = makePersonalInteraction({
      kind: "modal",
      customId,
    });

    await route.execute({} as Client, interaction, requireRoute(customId));

    expect(calls.some((c) => c.startsWith("setQuickToggleRouting"))).toBe(true);
    expect(acknowledgedDuringWrite).toBe(true);
    expect(telemetry).toContain("personal-config.personal.model-routing.set");
  });

  it("randomizer-toggle records personal-config.personal.randomizer.set telemetry", async () => {
    const calls: string[] = [];
    const { dependencies, telemetry } = makeDependencies(calls);
    const route = createPersonalConfigInteractionRoute(dependencies);
    const customId = buildPersonalConfigRouteId({
      action: "randomizer-toggle",
      locale: "en-US",
      provider: "openrouter",
    });

    const interaction = makePersonalInteraction({
      customId,
    });

    await route.execute({} as Client, interaction, requireRoute(customId));

    expect(calls).toContain("setRandomizer:openrouter:true");
    expect(telemetry).toContain("personal-config.personal.randomizer.set");
  });

  it("parameters-1-submit records personal-config.personal.parameters.set telemetry", async () => {
    const calls: string[] = [];
    const { dependencies, telemetry } = makeDependencies(calls);
    const route = createPersonalConfigInteractionRoute(dependencies);
    const customId = buildPersonalConfigRouteId({
      action: "parameters-1-submit",
      locale: "en-US",
      provider: "openrouter",
      nonce: "nonce123456",
    });

    const interaction = makePersonalInteraction({
      kind: "modal",
      customId,
      fields: {
        temperature_nonce123456: "0.8",
        min_p_nonce123456: "0.1",
        top_p_nonce123456: "0.9",
        top_k_nonce123456: "40",
        frequency_penalty_nonce123456: "0.2",
      },
    });

    await route.execute({} as Client, interaction, requireRoute(customId));

    expect(calls.some((c) => c.startsWith("setParameters:openrouter:"))).toBe(true);
    expect(telemetry).toContain("personal-config.personal.parameters.set");
  });

  it("accepts new and legacy parameter modal field groups through the real routes", async () => {
    const patches: Partial<ModelParameterOptions>[] = [];
    const { dependencies } = makeDependencies([], {
      operations: {
        ...personalConfigOperations,
        setParameters: async (input) => {
          patches.push(input.patch);
          return { status: "success" };
        },
      },
    });
    const route = createPersonalConfigInteractionRoute(dependencies);
    const nonce = "nonce123456";
    const fieldId = (field: string) => buildPersonalConfigModalFieldId(field, nonce);
    const modalModule = await import("@/utils/discord/ui/modals");
    const thinkingSpy = spyOn(modalModule, "takeRawModalSelectValue").mockReturnValue("auto");

    const submit = async (
      action: "parameters-1-submit" | "parameters-2-submit",
      values: Record<string, string>,
      presentFields: string[],
    ) => {
      const customId = buildPersonalConfigRouteId({ action, locale: "en-US", provider: "openrouter", nonce });
      const interaction = makePersonalInteraction({
        kind: "modal",
        customId,
        fields: Object.fromEntries(presentFields.map((present) => [present, values[present] ?? ""])),
      });

      await route.execute({} as Client, interaction, requireRoute(customId));
      expect(interaction.deferred).toBe(true);
    };

    try {
      await submit(
        "parameters-1-submit",
        {
          [fieldId("temperature")]: "0.8",
          [fieldId("min_p")]: "0.1",
          [fieldId("top_p")]: "0.9",
          [fieldId("top_k")]: "40",
        },
        [fieldId("temperature"), fieldId("min_p"), fieldId("top_p"), fieldId("top_k")],
      );
      expect(patches[0]).toEqual({ temperature: 0.8, min_p: 0.1, top_p: 0.9, top_k: 40 });

      await submit(
        "parameters-1-submit",
        {
          [fieldId("temperature")]: "0.8",
          [fieldId("min_p")]: "0.1",
          [fieldId("top_p")]: "0.9",
          [fieldId("top_k")]: "40",
          [fieldId("frequency_penalty")]: "0.2",
        },
        [fieldId("temperature"), fieldId("min_p"), fieldId("top_p"), fieldId("top_k"), fieldId("frequency_penalty")],
      );
      expect(patches[1]).toEqual({
        temperature: 0.8,
        min_p: 0.1,
        top_p: 0.9,
        top_k: 40,
        frequency_penalty: 0.2,
      });

      await submit(
        "parameters-2-submit",
        {
          [fieldId("frequency_penalty")]: "0.4",
          [fieldId("presence_penalty")]: "0.1",
          [fieldId("max_output_tokens")]: "2048",
        },
        [fieldId("frequency_penalty"), fieldId("presence_penalty"), fieldId("max_output_tokens")],
      );
      expect(patches[2]).toEqual({
        frequency_penalty: 0.4,
        presence_penalty: 0.1,
        max_output_tokens: 2048,
        thinking_level: "auto",
      });

      await submit(
        "parameters-2-submit",
        {
          [fieldId("presence_penalty")]: "0.1",
          [fieldId("max_output_tokens")]: "2048",
        },
        [fieldId("presence_penalty"), fieldId("max_output_tokens")],
      );
      expect(patches[3]).toEqual({ presence_penalty: 0.1, max_output_tokens: 2048, thinking_level: "auto" });

      await submit(
        "parameters-2-submit",
        {
          [fieldId("frequency_penalty")]: "",
          [fieldId("presence_penalty")]: "0.1",
          [fieldId("max_output_tokens")]: "2048",
        },
        [fieldId("frequency_penalty"), fieldId("presence_penalty"), fieldId("max_output_tokens")],
      );
      expect(patches[4]).toEqual({
        frequency_penalty: null,
        presence_penalty: 0.1,
        max_output_tokens: 2048,
        thinking_level: "auto",
      });
    } finally {
      thinkingSpy.mockRestore();
    }
  });

  it("fallbacks-submit records personal-config.personal.fallbacks.set telemetry", async () => {
    const calls: string[] = [];
    const { dependencies, telemetry } = makeDependencies(calls);
    const route = createPersonalConfigInteractionRoute(dependencies);
    const customId = buildPersonalConfigRouteId({
      action: "fallbacks-submit",
      locale: "en-US",
      provider: "openrouter",
      nonce: "nonce123456",
    });

    const interaction = makePersonalInteraction({
      kind: "modal",
      customId,
    });

    await route.execute({} as Client, interaction, requireRoute(customId));

    expect(calls.some((c) => c.startsWith("setFallbacks:openrouter:"))).toBe(true);
    expect(telemetry).toContain("personal-config.personal.fallbacks.set");
  });
});

describe("personal config Appearance character reference", () => {
  it("keeps Appearance Tags and adds the character-reference controls without changing their route literals", () => {
    const payload = buildPersonalConfigPanelPayload({
      locale: "en-US",
      category: "profile",
      page: "appearance",
      user: makeUser({ nai_char_ref_url: "https://cdn.example.invalid/me.png" }),
      resolvedNickname: "Tester",
      personas: [],
      guildId: "guild-123",
      memoryCount: 0,
      stmCount: 0,
      readStatus: "fresh",
    });

    const json = JSON.stringify(payload);
    expect(json).toContain(localizedCopy("en-US", "commands.personal.config.edit_appearance_button"));
    expect(json).toContain(localizedCopy("en-US", "commands.personal.config.character_reference_modal_title"));
    expect(json).toContain("personal-config:v2:appearance-open:en-US");
    expect(json).toContain("personal-config:v2:character-reference-open:en-US");
    expect(json).toContain("personal-config:v2:character-reference-clear:en-US");
  });

  it("opens the Me character-reference modal before deferring", async () => {
    let modalShown = false;
    const { dependencies } = makeDependencies([], {
      showCharacterReferenceModal: async () => {
        modalShown = true;
      },
    });
    const route = createPersonalConfigInteractionRoute(dependencies);
    const customId = buildPersonalConfigRouteId({ action: "character-reference-open", locale: "en-US" });
    const interaction = makePersonalInteraction({
      customId,
    });

    await route.execute({} as Client, interaction, requireRoute(customId));

    expect(modalShown).toBe(true);
    expect(interaction.deferred).toBe(false);
  });

  it("clears the Me character reference through the receipt path after acknowledgement", async () => {
    const calls: string[] = [];
    let acknowledgedInsideWrite = false;
    let interaction: PersonalInteraction;
    const { dependencies, user } = makeDependencies(calls, {
      operations: {
        ...personalConfigOperations,
        replaceCharacterReference: async (input) => {
          acknowledgedInsideWrite = interaction.deferred;
          calls.push(`replaceCharacterReference:${input.attachment ? "set" : "clear"}`);
          user.nai_char_ref_url = null;
          return { status: "success", cleared: true };
        },
      },
    });
    user.nai_char_ref_url = "https://cdn.example.invalid/old.png";
    const route = createPersonalConfigInteractionRoute(dependencies);
    const customId = buildPersonalConfigRouteId({ action: "character-reference-clear", locale: "en-US" });
    interaction = makePersonalInteraction({
      customId,
    });

    await route.execute({} as Client, interaction, requireRoute(customId));

    expect(acknowledgedInsideWrite).toBe(true);
    expect(calls).toContain("replaceCharacterReference:clear");
    expect(user.nai_char_ref_url).toBeNull();
  });
});

describe("Models panel rendering", () => {
  it("renders six always-visible routing controls with bounded placeholders and no cursor or duplicate buttons", () => {
    const user = makeUser();
    const payload = buildPersonalConfigPanelPayload({
      locale: "en-US",
      category: "models",
      page: "switch",
      user,
      resolvedNickname: "Tester",
      personas: [makePersona(1, 10, "Tomori")],
      guildId: "guild-123",
      memoryCount: 0,
      stmCount: 0,
      readStatus: "fresh",
      modelDisplayInfo: {
        routingRows: {
          text: {
            capability: "text",
            activeModelName: "Claude 3.5 Sonnet",
            storedProvider: "openrouter",
            storedModelName: "Claude 3.5 Sonnet",
          },
          vision: {
            capability: "vision",
            activeModelName: null,
            storedProvider: null,
            storedModelName: null,
          },
          embedding: {
            capability: "embedding",
            activeModelName: "text-embedding-3",
            storedProvider: "openrouter",
            storedModelName: "text-embedding-3",
          },
          image: {
            capability: "image",
            activeModelName: "Flux.1 Schnell",
            storedProvider: "openrouter",
            storedModelName: "Flux.1 Schnell",
          },
          image_nai: {
            capability: "image_nai",
            activeModelName: "NAI Diffusion V3",
            storedProvider: "novelai",
            storedModelName: "NAI Diffusion V3",
          },
          video: {
            capability: "video",
            activeModelName: null,
            storedProvider: null,
            storedModelName: null,
          },
        },
        availableCapabilities: ["text", "vision", "embedding", "image", "image_nai", "video"],
        eligibleProvidersForCapability: {
          text: ["openrouter"],
          vision: ["openrouter"],
          embedding: ["openrouter"],
          image: ["openrouter"],
          image_nai: ["novelai"],
          video: ["openrouter"],
        },
        parametersProviders: ["openrouter"],
        selectedParametersConfig: null,
        fallbacksProviders: ["openrouter"],
        selectedFallbacksConfig: null,
        primaryModelName: null,
        fallbackSlots: [],
        randomizerEnabled: false,
        canEnableRandomizer: false,
      },
    });

    const components = collectComponents(payload);
    const routingControls = components.filter((component) =>
      component.customId?.includes(":model-provider-select:en-US:"),
    );
    expect(routingControls).toHaveLength(6);
    expect(routingControls.map((component) => component.customId?.split(":").at(-1))).toEqual([
      "text",
      "vision",
      "embedding",
      "image",
      "image_nai",
      "video",
    ]);
    expect(routingControls.map((component) => component.placeholder)).toEqual([
      "Text: Claude 3.5 Sonnet (OpenRouter)",
      "Vision: Using Server Default",
      "Embedding: text-embedding-3 (OpenRouter)",
      "Standard Image: Flux.1 Schnell (OpenRouter)",
      "NovelAI Image: NAI Diffusion V3 (NovelAI)",
      "Video: Using Server Default",
    ]);
    expect(routingControls.every((component) => component.placeholder && component.placeholder.length <= 150)).toBe(
      true,
    );
    expect(routingControls.every((component) => component.disabled === false)).toBe(true);
    expect(routingControls[1].options?.map((option) => option.value)).toEqual(["__server_default__", "openrouter"]);
    expect(components.some((component) => component.customId?.includes(":capability-select:"))).toBe(false);
    expect(components.some((component) => component.customId?.includes(":model-default:"))).toBe(false);
    expect(components.some((component) => component.customId?.includes(":model-enable:"))).toBe(false);

    // Components V2 renders in array order, so the providers hint reads as a footer under the six
    // rows only while it sits between the last select and the Quick-Toggle button.
    const payloadJson = JSON.stringify(payload);
    const lastSelectAt = payloadJson.indexOf(":model-provider-select:en-US:video");
    const hintAt = payloadJson.indexOf("to add more model choices");
    const quickToggleAt = payloadJson.indexOf(":quick-toggle-open:");
    expect(lastSelectAt).toBeGreaterThan(-1);
    expect(hintAt).toBeGreaterThan(lastSelectAt);
    expect(quickToggleAt).toBeGreaterThan(hintAt);
  });

  it("renders Parameters page with grouped summaries and semantic edit buttons", () => {
    const user = makeUser();
    const payload = buildPersonalConfigPanelPayload({
      locale: "en-US",
      category: "models",
      page: "parameters",
      user,
      resolvedNickname: "Tester",
      personas: [makePersona(1, 10, "Tomori")],
      guildId: "guild-123",
      memoryCount: 0,
      stmCount: 0,
      readStatus: "fresh",
      modelDisplayInfo: {
        routingRows: {} as unknown as Record<PersonalConfigManagedCapability, PersonalConfigRoutingRow>,
        availableCapabilities: ["text"],
        eligibleProvidersForCapability: { text: ["openrouter"] } as unknown as Record<
          PersonalConfigManagedCapability,
          string[]
        >,
        parametersProviders: ["openrouter"],
        selectedParametersConfig: {
          user_saved_config_id: 1,
          user_id: 1,
          provider: "openrouter",
          key_version: 1,
          api_key: null,
          llm_id: 101,
          diffusion_model_id: null,
          embedding_model_id: null,
          nai_diffusion_model_id: null,
          video_model_id: null,
          vision_llm_id: null,
          nai_preset_name: null,
          llm_temperature: 0.7,
          llm_top_p: 0.95,
          llm_top_k: 0,
          llm_frequency_penalty: 0,
          llm_presence_penalty: 0,
          llm_min_p: 0.05,
          llm_max_output_tokens: 4096,
          llm_disabled_params: [],
          llm_logit_biases: [],
          thinking_level: "auto",
          model_randomizer_enabled: false,
          enabled_capabilities: ["text"],
          assigned_capabilities: ["text"],
          fallback_model_refs: [],
        } as unknown as UserSavedProviderConfigRow,
        fallbacksProviders: ["openrouter"],
        selectedFallbacksConfig: null,
        primaryModelName: null,
        fallbackSlots: [],
        randomizerEnabled: false,
        canEnableRandomizer: false,
      },
    });

    const payloadJson = JSON.stringify(payload);
    expect(payloadJson).toContain("Temperature");
    expect(payloadJson).toContain("Min P");
    expect(payloadJson).toContain("Top P");
    expect(payloadJson).toContain("Top K");
    expect(payloadJson).toContain("Sampling: Temperature");
    expect(payloadJson).toContain("Top P");
    expect(payloadJson).toContain("Generation: Frequency");
    expect(payloadJson).toContain("Presence");
    expect(payloadJson).toContain("Max output");
    expect(payloadJson).toContain("Thinking");
    expect(payloadJson).toContain(localizedCopy("en-US", "commands.personal.config.edit_params_1_button"));
    expect(payloadJson).toContain(localizedCopy("en-US", "commands.personal.config.edit_params_2_button"));
    expect(payloadJson).not.toContain("Edit Parameters 1-5");
    expect(payloadJson).not.toContain("Edit Parameters 6-8");
    expect(payloadJson).not.toContain(localizedCopy("en-US", "commands.config.panel.stop_strings_title"));
    expect(payloadJson).not.toContain("Logit Bias");

    const components = collectComponents(payload);
    const editorButtons = components.filter(
      (component) =>
        component.customId?.includes(":parameters-1-open:") || component.customId?.includes(":parameters-2-open:"),
    );
    expect(editorButtons.map((component) => component.customId)).toEqual([
      "personal-config:v2:parameters-1-open:en-US:openrouter",
      "personal-config:v2:parameters-2-open:en-US:openrouter",
    ]);
  });

  it("renders distinct zero, one, and several-provider parameter states", () => {
    const build = (parametersProviders: string[], readStatus: "fresh" | "stale" = "fresh") =>
      buildPersonalConfigPanelPayload({
        locale: "en-US",
        category: "models",
        page: "parameters",
        user: makeUser(),
        resolvedNickname: "Tester",
        personas: [],
        guildId: "guild-123",
        memoryCount: 0,
        stmCount: 0,
        readStatus,
        selectedParametersProvider: parametersProviders[0],
        modelDisplayInfo: {
          parametersProviders,
          selectedParametersConfig: parametersProviders[0] ? makeParameterConfig(parametersProviders[0]) : undefined,
          fallbacksProviders: [],
          fallbackSlots: [],
          randomizerEnabled: false,
          canEnableRandomizer: false,
        } as unknown as PersonalConfigModelDisplayInfo,
      });

    const zeroPayload = build([]);
    const zeroJson = JSON.stringify(zeroPayload);
    expect(zeroJson).toMatch(localizedProse("en-US", "commands.personal.config.no_text_providers"));
    expect(zeroJson).not.toContain(":parameters-provider-select:");
    expect(zeroJson).not.toContain(":parameters-1-open:");
    expect(zeroJson).not.toContain(":parameters-2-open:");

    const onePayload = build(["openrouter"]);
    const oneJson = JSON.stringify(onePayload);
    expect(oneJson).toContain("> Provider: `OpenRouter`");
    expect(oneJson).not.toContain(":parameters-provider-select:");
    expect(oneJson).toContain(":parameters-1-open:");
    expect(oneJson).toContain(":parameters-2-open:");

    const severalPayload = build(["openrouter", "novelai"]);
    const severalComponents = collectComponents(severalPayload);
    const severalJson = JSON.stringify(severalPayload);
    const providerSelect = severalComponents.find((component) =>
      component.customId?.includes(":parameters-provider-select:"),
    );
    expect(providerSelect?.options?.map((option) => option.value)).toEqual(["openrouter", "novelai"]);
    expect(providerSelect?.options?.map((option) => option.default)).toEqual([true, false]);
    expect(severalJson).not.toContain("> Provider: `OpenRouter`");

    const staleComponents = collectComponents(build(["openrouter", "novelai"], "stale"));
    const staleProviderSelect = staleComponents.find((component) =>
      component.customId?.includes(":parameters-provider-select:"),
    );
    const staleEditors = staleComponents.filter(
      (component) =>
        component.customId?.includes(":parameters-1-open:") || component.customId?.includes(":parameters-2-open:"),
    );
    expect(staleProviderSelect?.disabled).toBe(true);
    expect(staleEditors.map((component) => component.disabled)).toEqual([true, true]);
    expect(JSON.stringify(build(["openrouter"], "stale"))).toContain("Max output");
  });

  it("renders Fallbacks page with primary model, 5 ordered slots, and Randomizer toggle button", () => {
    const user = makeUser();
    const payload = buildPersonalConfigPanelPayload({
      locale: "en-US",
      category: "models",
      page: "fallbacks",
      user,
      resolvedNickname: "Tester",
      personas: [makePersona(1, 10, "Tomori")],
      guildId: "guild-123",
      memoryCount: 0,
      stmCount: 0,
      readStatus: "fresh",
      modelDisplayInfo: {
        routingRows: {} as unknown as Record<PersonalConfigManagedCapability, PersonalConfigRoutingRow>,
        availableCapabilities: ["text"],
        eligibleProvidersForCapability: { text: ["openrouter"] } as unknown as Record<
          PersonalConfigManagedCapability,
          string[]
        >,
        parametersProviders: ["openrouter"],
        selectedParametersConfig: null,
        fallbacksProviders: ["openrouter"],
        selectedFallbacksConfig: {
          user_saved_config_id: 1,
          user_id: 1,
          provider: "openrouter",
          key_version: 1,
          api_key: null,
          llm_id: 101,
          diffusion_model_id: null,
          embedding_model_id: null,
          nai_diffusion_model_id: null,
          video_model_id: null,
          vision_llm_id: null,
          nai_preset_name: null,
          llm_temperature: 0.7,
          llm_top_p: 0.95,
          llm_top_k: 0,
          llm_frequency_penalty: 0,
          llm_presence_penalty: 0,
          llm_min_p: 0.05,
          llm_max_output_tokens: 4096,
          llm_disabled_params: [],
          llm_logit_biases: [],
          thinking_level: "auto",
          model_randomizer_enabled: false,
          enabled_capabilities: ["text"],
          assigned_capabilities: ["text"],
          fallback_model_refs: [{ type: "llm", id: 102 }],
        } as unknown as UserSavedProviderConfigRow,
        primaryModelName: "Claude 3.5 Sonnet",
        fallbackSlots: [
          { slot: 1, modelName: "Claude 3 Haiku" },
          { slot: 2, modelName: null },
          { slot: 3, modelName: null },
          { slot: 4, modelName: null },
          { slot: 5, modelName: null },
        ],
        randomizerEnabled: false,
        canEnableRandomizer: true,
      },
    });

    const payloadJson = JSON.stringify(payload);
    expect(payloadJson).toContain("Claude 3 Haiku");
    expect(payloadJson).toContain(localizedCopy("en-US", "commands.personal.config.randomizer_section_title"));
    expect(payloadJson).toContain("personal-config:v2:randomizer-set:en-US:openrouter:off");
    expect(payloadJson).toContain("personal-config:v2:randomizer-set:en-US:openrouter:on");

    // The primary model is chosen on Switch Models, so the Fallbacks page deliberately no longer
    // restates it or the provider. A regression that reintroduces either belongs to this assertion.
    expect(payloadJson).not.toContain("Primary");
    expect(payloadJson).not.toContain("Claude 3.5 Sonnet");

    // The provider select replaced the Edit button and is the only way into the fallback modal, so
    // it must render even though this fixture has a single provider.
    expect(payloadJson).not.toContain(localizedCopy("en-US", "commands.personal.config.fallbacks_modal_title"));
    expect(payloadJson).toContain("personal-config:v2:fallbacks-provider-select:en-US");
    expect(payloadJson).toContain(
      localizedCopy("en-US", "commands.personal.config.fallbacks_provider_select_placeholder"),
    );

    // Effective behavior quote sits directly under the buttons row.
    expect(payloadJson).toContain("> I try the primary model first");
  });
});

describe("Model assignment writes on modal submit", () => {
  it("writes on submit even when the assignment newly activates a cross-server override", async () => {
    const calls: string[] = [];

    const { dependencies, telemetry } = makeDependencies(calls, {
      loadUserSavedProviders: async () => [
        {
          user_saved_config_id: 1,
          user_id: 1,
          provider: "openrouter",
          enabled_capabilities: [], // currently disabled (uses server default)
          assigned_capabilities: ["text"],
          llm_id: 101,
        } as unknown as UserSavedProviderConfigRow,
      ],
      loadAvailableModelsForCapability: async () => [
        { id: 101, name: "Claude 3.5 Sonnet" },
        { id: 102, name: "Claude 3 Opus" },
      ],
    });

    const route = createPersonalConfigInteractionRoute(dependencies);
    const customId = buildPersonalConfigRouteId({
      action: "model-modal-submit",
      locale: "en-US",
      capability: "text",
      provider: "openrouter",
      nonce: "nonce123456",
    });

    const interaction = makePersonalInteraction({
      kind: "modal",
      customId,
    });

    // Simulate modal value for model ID 102
    const modalsModule = await import("@/utils/discord/ui/modals");
    const takeSpy = spyOn(modalsModule, "takeRawModalSelectValue").mockReturnValue("102");

    await route.execute({} as Client, interaction, requireRoute(customId));

    takeSpy.mockRestore();

    // Submitting the model is the decision, so there is no second confirmation step.
    expect(calls).toContain("setCapabilityModel:text:openrouter:102");
    expect(telemetry).toContain("personal-config.personal.model.set");
    const json = JSON.stringify(interaction.edits.at(-1));
    expect(json).not.toContain("model-act-confirm");
    expect(json).toContain("Text now routes to OpenRouter using Claude 3 Opus");
  });

  it("answers the standalone language submit with a reply instead of repainting a panel", async () => {
    const calls: string[] = [];

    const { dependencies, telemetry } = makeDependencies(calls);
    const route = createPersonalConfigInteractionRoute(dependencies);
    const customId = buildPersonalConfigRouteId({
      action: "language-only-submit",
      locale: "en-US",
      nonce: "nonce123456",
    });

    const interaction = makePersonalInteraction({
      kind: "modal",
      customId,
      overrides: { id: "modal-lang-1" },
    });

    const modalsModule = await import("@/utils/discord/ui/modals");
    const takeSpy = spyOn(modalsModule, "takeRawModalSelectValue").mockReturnValue("ja");

    await route.execute({} as Client, interaction, requireRoute(customId));

    takeSpy.mockRestore();

    expect(calls).toContain("setLanguage:ja");
    expect(telemetry).toContain("personal-config.personal.language.set");
    // A slash-command modal has no message, so deferring an update would fail outright and the
    // repaint the panel route ends with would have nothing to edit.
    expect(interaction.calls.filter((call) => call.method === "deferUpdate")).toHaveLength(0);
    const replied = interaction.replies.at(-1) as { content?: string } | undefined;
    expect(replied).not.toBeNull();
    expect(replied?.content).toContain("日本語");
  });

  it("writes immediately without confirmation when capability is already an active override", async () => {
    const calls: string[] = [];

    const { dependencies, telemetry } = makeDependencies(calls, {
      loadUserSavedProviders: async () => [
        {
          user_saved_config_id: 1,
          user_id: 1,
          provider: "openrouter",
          enabled_capabilities: ["text"], // already active override!
          assigned_capabilities: ["text"],
          llm_id: 101,
        } as unknown as UserSavedProviderConfigRow,
      ],
      loadAvailableModelsForCapability: async () => [
        { id: 101, name: "Claude 3.5 Sonnet" },
        { id: 102, name: "Claude 3 Opus" },
      ],
    });

    const route = createPersonalConfigInteractionRoute(dependencies);
    const customId = buildPersonalConfigRouteId({
      action: "model-modal-submit",
      locale: "en-US",
      capability: "text",
      provider: "openrouter",
      nonce: "nonce123456",
    });

    const interaction = makePersonalInteraction({
      kind: "modal",
      customId,
    });

    const modalsModule = await import("@/utils/discord/ui/modals");
    const takeSpy = spyOn(modalsModule, "takeRawModalSelectValue").mockReturnValue("102");

    await route.execute({} as Client, interaction, requireRoute(customId));

    takeSpy.mockRestore();

    expect(calls).toContain("setCapabilityModel:text:openrouter:102");
    expect(telemetry).toContain("personal-config.personal.model.set");
    const json = JSON.stringify(interaction.edits.at(-1));
    expect(json).not.toContain("model-act-confirm");
    expect(json).toContain("Text now routes to OpenRouter using Claude 3 Opus");
  });

  it("model-act-cancel repaints without writing or emitting telemetry", async () => {
    const calls: string[] = [];
    const { dependencies, telemetry } = makeDependencies(calls);

    const route = createPersonalConfigInteractionRoute(dependencies);
    const customId = buildPersonalConfigRouteId({ action: "model-act-cancel", locale: "en-US" });

    const interaction = makePersonalInteraction({
      customId,
    });

    await route.execute({} as Client, interaction, requireRoute(customId));

    expect(calls.some((c) => c.startsWith("setCapabilityModel"))).toBe(false);
    expect(telemetry).toHaveLength(0);
    const json = JSON.stringify(interaction.edits.at(-1));
    expect(json).toContain(localizedCopy("en-US", "commands.personal.config.no_changes_heading"));
  });

  it("fails closed on modal submit when the chosen model is no longer available", async () => {
    const calls: string[] = [];
    const { dependencies, telemetry } = makeDependencies(calls, {
      loadAvailableModelsForCapability: async () => [], // model 999 no longer exists
    });

    const route = createPersonalConfigInteractionRoute(dependencies);
    const customId = buildPersonalConfigRouteId({
      action: "model-modal-submit",
      locale: "en-US",
      capability: "text",
      provider: "openrouter",
      nonce: "nonce123456",
    });

    const interaction = makePersonalInteraction({
      kind: "modal",
      customId,
    });

    const modalsModule = await import("@/utils/discord/ui/modals");
    const takeSpy = spyOn(modalsModule, "takeRawModalSelectValue").mockReturnValue("999");

    await route.execute({} as Client, interaction, requireRoute(customId));

    takeSpy.mockRestore();

    expect(calls.some((c) => c.startsWith("setCapabilityModel"))).toBe(false);
    expect(telemetry).toHaveLength(0);
    expect(JSON.stringify(interaction.edits.at(-1))).toContain(
      localizedCopy("en-US", "commands.personal.config.write_failed_heading"),
    );
  });
});

describe("Re-resolution and zero model guard", () => {
  it("model-provider-select shows named no-models receipt when provider has 0 eligible models", async () => {
    let modalShown = false;

    const { dependencies } = makeDependencies([], {
      loadAvailableModelsForCapability: async () => [],
      showModelSelectModal: async () => {
        modalShown = true;
      },
    });

    const route = createPersonalConfigInteractionRoute(dependencies);
    const customId = buildPersonalConfigRouteId({
      action: "model-provider-select",
      locale: "en-US",
      capability: "text",
    });

    const interaction = makePersonalInteraction({
      kind: "string-select",
      customId,
      values: ["openrouter"],
    });

    await route.execute({} as Client, interaction, requireRoute(customId));

    expect(modalShown).toBe(false);
    const json = JSON.stringify(interaction.edits.at(-1));
    expect(json).toContain(localizedCopy("en-US", "commands.personal.config.no_models_available_heading"));
    expect(json).toContain("OpenRouter");
  });

  it("server default explicitly disables personal capability", async () => {
    const calls: string[] = [];
    const { dependencies, telemetry } = makeDependencies(calls);

    const route = createPersonalConfigInteractionRoute(dependencies);
    const customId = buildPersonalConfigRouteId({
      action: "model-provider-select",
      locale: "en-US",
      capability: "text",
    });

    const interaction = makePersonalInteraction({
      kind: "string-select",
      customId,
      values: ["__server_default__"],
    });

    await route.execute({} as Client, interaction, requireRoute(customId));

    expect(calls).toContain("setCapabilityEnabled:text:false");
    expect(telemetry).toContain("personal-config.personal.model.set");
  });

  it("acknowledges before disabling and emits no success telemetry for an unchanged Server Default choice", async () => {
    const calls: string[] = [];
    const { dependencies, telemetry } = makeDependencies(calls);
    let acknowledgedInsideWrite = false;
    let interaction: PersonalInteraction;
    dependencies.operations.setCapabilityEnabled = async () => {
      acknowledgedInsideWrite = interaction.deferred;
      return { status: "no-changes" };
    };
    const route = createPersonalConfigInteractionRoute(dependencies);
    const customId = buildPersonalConfigRouteId({
      action: "model-provider-select",
      locale: "en-US",
      capability: "vision",
    });
    interaction = makePersonalInteraction({
      kind: "string-select",
      customId,
      values: ["__server_default__"],
    });

    await route.execute({} as Client, interaction, requireRoute(customId));

    expect(acknowledgedInsideWrite).toBe(true);
    expect(JSON.stringify(interaction.edits.at(-1))).toContain("No Changes");
    expect(telemetry).toEqual([]);
  });
});

describe("Range pagination workflow", () => {
  it("paginates provider selector in place across page clicks on Switch Models", async () => {
    const providers = Array.from({ length: 30 }, (_, index) => `custom:${index + 1}`);
    const calls: string[] = [];
    const { dependencies, telemetry } = makeDependencies(calls);
    const originalLoader = dependencies.loadPersonalModelDisplayInfo;
    dependencies.loadPersonalModelDisplayInfo = async (...args) => {
      const info = await originalLoader(...args);
      return {
        ...info,
        eligibleProvidersForCapability: {
          ...info.eligibleProvidersForCapability,
          text: providers,
        },
      };
    };

    const route = createPersonalConfigInteractionRoute(dependencies);

    const page1Id = buildPersonalConfigRouteId({
      action: "model-provider-range-open",
      locale: "en-US",
      capability: "text",
      start: 24,
    });
    const page1Interaction = makePersonalInteraction({
      customId: page1Id,
    });

    await route.execute({} as Client, page1Interaction, requireRoute(page1Id));

    const page1Payload = page1Interaction.edits.at(-1);
    const page1Components = collectComponents(page1Payload);
    const providerSelect = page1Components.find((component) =>
      component.customId?.endsWith(":model-provider-select:en-US:text"),
    );
    expect(providerSelect?.options?.map((option) => option.value)).toEqual([
      "__server_default__",
      "custom~24",
      "custom~25",
      "custom~26",
      "custom~27",
      "custom~28",
      "custom~29",
      "custom~30",
      "__provider_range__:0:",
    ]);

    const moreOption = providerSelect?.options?.find((option) => option.value === "__provider_range__:0:");
    expect(moreOption).toBeDefined();
    expect(moreOption?.label).toBe("More Text providers (page 1 of 2)");

    const json = JSON.stringify(page1Payload);
    expect(json).toContain(localizedCopy("en-US", "commands.personal.config.models_title"));
    expect(calls).toEqual([]);
    expect(telemetry).toEqual([]);
  });

  it("fails a stale provider range without writing or emitting telemetry", async () => {
    const providers = Array.from({ length: 30 }, (_, index) => `custom:${index + 1}`);
    const calls: string[] = [];
    const { dependencies, telemetry } = makeDependencies(calls);
    const originalLoader = dependencies.loadPersonalModelDisplayInfo;
    dependencies.loadPersonalModelDisplayInfo = async (...args) => {
      const info = await originalLoader(...args);
      return {
        ...info,
        eligibleProvidersForCapability: { ...info.eligibleProvidersForCapability, text: providers },
      };
    };
    const route = createPersonalConfigInteractionRoute(dependencies);
    const customId = buildPersonalConfigRouteId({
      action: "model-provider-range-open",
      locale: "en-US",
      capability: "text",
      start: 50,
    });
    const interaction = makePersonalInteraction({
      customId,
    });

    await route.execute({} as Client, interaction, requireRoute(customId));

    expect(JSON.stringify(interaction.edits.at(-1))).toContain(
      localizedCopy("en-US", "commands.personal.config.unavailable"),
    );
    expect(calls).toEqual([]);
    expect(telemetry).toEqual([]);
  });

  it("accepts retained literal :25 offset for model-provider-range-open without failing stale", async () => {
    const providers = Array.from({ length: 30 }, (_, index) => `custom:${index + 1}`);
    const calls: string[] = [];
    const { dependencies, telemetry } = makeDependencies(calls);
    const originalLoader = dependencies.loadPersonalModelDisplayInfo;
    dependencies.loadPersonalModelDisplayInfo = async (...args) => {
      const info = await originalLoader(...args);
      return {
        ...info,
        eligibleProvidersForCapability: {
          ...info.eligibleProvidersForCapability,
          text: providers,
        },
      };
    };

    const route = createPersonalConfigInteractionRoute(dependencies);

    // Literal WIRE_CONTRACT_V2 action ending in :25
    const customId = "personal-config:v2:model-provider-range-open:en-US:text:25";
    const interaction = makePersonalInteraction({
      customId,
    });

    await route.execute({} as Client, interaction, requireRoute(customId));

    const repaintedPayload = interaction.edits.at(-1);
    const components = collectComponents(repaintedPayload);
    const providerSelect = components.find((c) => c.customId?.endsWith(":model-provider-select:en-US:text"));
    expect(providerSelect?.options?.map((o) => o.value)).toEqual([
      "__server_default__",
      "custom~24",
      "custom~25",
      "custom~26",
      "custom~27",
      "custom~28",
      "custom~29",
      "custom~30",
      "__provider_range__:0:",
    ]);

    const moreOption = providerSelect?.options?.find((o) => o.value === "__provider_range__:0:");
    expect(moreOption).toBeDefined();
    expect(moreOption?.label).toBe("More Text providers (page 1 of 2)");

    expect(JSON.stringify(repaintedPayload)).not.toContain(
      localizedCopy("en-US", "commands.personal.config.unavailable"),
    );
    expect(calls).toEqual([]);
    expect(telemetry).toEqual([]);
  });

  it("defers and repaints Switch Models with one selector entry per model page when model-provider-select has > 25 models", async () => {
    let modalShown = false;

    const thirtyOpenRouterModels = Array.from({ length: 30 }, (_, i) => ({
      id: 100 + i,
      name: `Model ${i + 1}`,
    }));

    const { dependencies } = makeDependencies([], {
      loadAvailableModelsForCapability: async (_userId, provider, capability) => {
        expect(provider).toBe("openrouter");
        expect(capability).toBe("text");
        return thirtyOpenRouterModels;
      },
      showModelSelectModal: async () => {
        modalShown = true;
      },
    });

    const route = createPersonalConfigInteractionRoute(dependencies);
    const customId = buildPersonalConfigRouteId({
      action: "model-provider-select",
      locale: "en-US",
      capability: "text",
    });

    const interaction = makePersonalInteraction({
      kind: "string-select",
      customId,
      values: ["openrouter"],
    });

    await route.execute({} as Client, interaction, requireRoute(customId));

    expect(modalShown).toBe(false);
    expect(interaction.deferred).toBe(true);

    const repaintedPayload = interaction.edits.at(-1);
    expect(repaintedPayload).not.toBeNull();
    const components = collectComponents(repaintedPayload);
    const customIds = components.flatMap((component) => (component.customId ? [component.customId] : []));
    expect(new Set(customIds).size).toBe(customIds.length);

    const textSelect = components.find((c) => c.customId?.includes(":model-provider-select:en-US:text"));
    expect(textSelect?.options?.map((option) => option.value)).toEqual([
      "__server_default__",
      "page!0!openrouter",
      "page!25!openrouter",
    ]);
    expect(textSelect?.options?.map((option) => option.label)).toEqual([
      "Using Server Default",
      "OpenRouter (page 1)",
      "OpenRouter (page 2)",
    ]);

    // The first page must be selectable directly; a prev/next row would disable the page it sits on.
    expect(components.some((c) => c.customId?.includes(":model-range-open:"))).toBe(false);

    // Expanding rewrites a closed selector, so the repaint has to say what changed.
    expect(textSelect?.placeholder).toBe("Text: choose a page of OpenRouter models");
    const rendered = JSON.stringify(repaintedPayload);
    expect(rendered).toContain(localizedCopy("en-US", "commands.personal.config.provider_paged_heading"));
    expect(rendered).toContain("OpenRouter has 30 models for Text");
  });

  it("carries the expanded provider in the navigation option when the entry list overflows", async () => {
    const twentyFourProviders = Array.from({ length: 24 }, (_, i) => `provider_${i + 1}`);
    const thirtyModels = Array.from({ length: 30 }, (_, i) => ({
      id: 200 + i,
      name: `Model ${i + 1}`,
    }));

    const { dependencies } = makeDependencies([], {
      loadPersonalModelDisplayInfo: async () =>
        makeModelDisplayInfo({
          routingRows: {
            text: {
              capability: "text",
              activeModelName: "Model 1",
              storedProvider: "provider_1",
              storedModelName: "Model 1",
            },
          },
          availableCapabilities: ["text"],
          eligibleProvidersForCapability: {
            text: twentyFourProviders,
          },
          parametersProviders: ["provider_1"],
          selectedParametersConfig: null,
        }),
      loadAvailableModelsForCapability: async () => thirtyModels,
    });

    const route = createPersonalConfigInteractionRoute(dependencies);
    const customId = buildPersonalConfigRouteId({
      action: "model-provider-select",
      locale: "en-US",
      capability: "text",
    });

    const interaction = makePersonalInteraction({
      kind: "string-select",
      customId,
      values: ["provider_1"],
    });

    await route.execute({} as Client, interaction, requireRoute(customId));

    const components = collectComponents(interaction.edits.at(-1));
    const textSelect = components.find((c) => c.customId?.includes(":model-provider-select:en-US:text"));
    expect(textSelect).toBeDefined();

    const moreOption = textSelect?.options?.find(
      (o) => o.value !== undefined && decodeProviderRangeValue(o.value) !== null,
    );
    expect(moreOption).toBeDefined();
    if (!moreOption?.value) throw new Error("Expected moreOption to carry a provider range value");
    const decoded = decodeProviderRangeValue(moreOption.value);
    expect(decoded).toEqual({
      start: 23,
      expandedProvider: "provider_1",
    });
  });

  it("opens the modal on the chosen slice when model-provider-select carries a page value", async () => {
    let passedModels: Array<{ id: number; name: string }> = [];

    const thirtyOpenRouterModels = Array.from({ length: 30 }, (_, i) => ({
      id: 100 + i,
      name: `Model ${i + 1}`,
    }));

    const { dependencies } = makeDependencies([], {
      loadAvailableModelsForCapability: async () => thirtyOpenRouterModels,
      showModelSelectModal: async (_interaction, _locale, _nonce, _cap, _prov, models) => {
        passedModels = models;
      },
    });

    const route = createPersonalConfigInteractionRoute(dependencies);
    const customId = buildPersonalConfigRouteId({
      action: "model-provider-select",
      locale: "en-US",
      capability: "text",
    });

    const interaction = makePersonalInteraction({
      kind: "string-select",
      customId,
      values: ["page!25!openrouter"],
    });

    await route.execute({} as Client, interaction, requireRoute(customId));

    expect(passedModels.map((model) => model.name)).toEqual([
      "Model 26",
      "Model 27",
      "Model 28",
      "Model 29",
      "Model 30",
    ]);
  });

  it("opens modal directly when model-provider-select has <= 25 models", async () => {
    let modalShown = false;
    let passedModels: Array<{ id: number; name: string }> = [];

    const twentyModels = Array.from({ length: 20 }, (_, i) => ({
      id: 100 + i,
      name: `Model ${i + 1}`,
    }));

    const { dependencies } = makeDependencies([], {
      loadAvailableModelsForCapability: async () => twentyModels,
      showModelSelectModal: async (_interaction, _locale, _nonce, _cap, _prov, models) => {
        modalShown = true;
        passedModels = models;
      },
    });

    const route = createPersonalConfigInteractionRoute(dependencies);
    const customId = buildPersonalConfigRouteId({
      action: "model-provider-select",
      locale: "en-US",
      capability: "text",
    });

    const interaction = makePersonalInteraction({
      kind: "string-select",
      customId,
      values: ["openrouter"],
    });

    await route.execute({} as Client, interaction, requireRoute(customId));

    expect(modalShown).toBe(true);
    expect(passedModels).toHaveLength(20);
    expect(passedModels[0].name).toBe("Model 1");
    expect(passedModels[19].name).toBe("Model 20");
  });

  it("opens requested slice in modal on model-range-open button click", async () => {
    let modalShown = false;
    let passedModels: Array<{ id: number; name: string }> = [];

    const thirtyModels = Array.from({ length: 30 }, (_, i) => ({
      id: 100 + i,
      name: `Model ${i + 1}`,
    }));

    const { dependencies } = makeDependencies([], {
      loadAvailableModelsForCapability: async () => thirtyModels,
      showModelSelectModal: async (_interaction, _locale, _nonce, _cap, _prov, models) => {
        modalShown = true;
        passedModels = models;
      },
    });

    const route = createPersonalConfigInteractionRoute(dependencies);
    const customId = buildPersonalConfigRouteId({
      action: "model-range-open",
      locale: "en-US",
      capability: "text",
      provider: "openrouter",
      start: 25,
    });

    const interaction = makePersonalInteraction({
      customId,
    });

    await route.execute({} as Client, interaction, requireRoute(customId));

    expect(modalShown).toBe(true);
    expect(passedModels).toHaveLength(5);
    expect(passedModels[0].name).toBe("Model 26");
    expect(passedModels[4].name).toBe("Model 30");
  });

  it("defers and repaints Fallbacks with one selector entry per option page when fallbacks-provider-select has > 24 options", async () => {
    const fallbackOptions = Array.from({ length: 30 }, (_, i) => ({
      refKey: `llm:${100 + i}`,
      label: `Model ${i + 1}`,
    }));

    const loaders = await import("@/utils/discord/interactions/personalConfigLoaders");
    const loadSpy = spyOn(loaders, "loadFallbackSelectionOptions").mockResolvedValue(fallbackOptions);
    const savedConfig = await import("@/utils/provider/savedProviderConfig");
    const eligibleSpy = spyOn(savedConfig, "loadUserSavedProvidersForCapability").mockResolvedValue([
      { provider: "openrouter" } as unknown as UserSavedProviderConfigRow,
    ]);

    try {
      let modalShown = false;
      const { dependencies } = makeDependencies([], {
        showFallbacksModal: async () => {
          modalShown = true;
        },
      });

      const route = createPersonalConfigInteractionRoute(dependencies);
      const customId = buildPersonalConfigRouteId({
        action: "fallbacks-provider-select",
        locale: "en-US",
      });

      const interaction = makePersonalInteraction({
        kind: "string-select",
        customId,
        values: ["openrouter"],
      });

      await route.execute({} as Client, interaction, requireRoute(customId));

      expect(modalShown).toBe(false);
      expect(interaction.deferred).toBe(true);

      const repaintedPayload = interaction.edits.at(-1);
      const components = collectComponents(repaintedPayload);
      const providerSelect = components.find((c) => c.customId?.includes(":fallbacks-provider-select:en-US"));
      expect(providerSelect?.options?.map((option) => option.value)).toEqual([
        "page!0!openrouter",
        "page!24!openrouter",
      ]);
      expect(providerSelect?.options?.map((option) => option.label)).toEqual([
        "OpenRouter (page 1)",
        "OpenRouter (page 2)",
      ]);
      expect(components.some((c) => c.customId?.includes(":fallbacks-range-open:"))).toBe(false);
      expect(providerSelect?.placeholder).toBe("Choose a page of OpenRouter models");
      const rendered = JSON.stringify(repaintedPayload);
      expect(rendered).toContain(localizedCopy("en-US", "commands.personal.config.fallbacks_paged_heading"));
      expect(rendered).toContain("OpenRouter has 30 fallback options");
    } finally {
      loadSpy.mockRestore();
      eligibleSpy.mockRestore();
    }
  });

  it("opens fallback modal directly when fallbacks-provider-select has <= 24 options", async () => {
    let modalShown = false;
    let passedOptions: Array<{ refKey: string; label: string }> = [];
    const fallbackOptions = Array.from({ length: 20 }, (_, i) => ({
      refKey: `llm:${100 + i}`,
      label: `Model ${i + 1}`,
    }));

    const loaders = await import("@/utils/discord/interactions/personalConfigLoaders");
    const loadSpy = spyOn(loaders, "loadFallbackSelectionOptions").mockResolvedValue(fallbackOptions);
    const savedConfig = await import("@/utils/provider/savedProviderConfig");
    const eligibleSpy = spyOn(savedConfig, "loadUserSavedProvidersForCapability").mockResolvedValue([
      { provider: "openrouter" } as unknown as UserSavedProviderConfigRow,
    ]);

    try {
      const { dependencies } = makeDependencies([], {
        showFallbacksModal: async (_interaction, _locale, _nonce, _provider, options) => {
          modalShown = true;
          passedOptions = options;
        },
      });

      const route = createPersonalConfigInteractionRoute(dependencies);
      const customId = buildPersonalConfigRouteId({
        action: "fallbacks-provider-select",
        locale: "en-US",
      });

      const interaction = makePersonalInteraction({
        kind: "string-select",
        customId,
        values: ["openrouter"],
      });

      await route.execute({} as Client, interaction, requireRoute(customId));

      expect(modalShown).toBe(true);
      expect(passedOptions).toHaveLength(20);
      expect(passedOptions[0].label).toBe("Model 1");
      expect(passedOptions[19].label).toBe("Model 20");
    } finally {
      loadSpy.mockRestore();
      eligibleSpy.mockRestore();
    }
  });

  it("opens requested slice in modal on fallbacks-range-open button click", async () => {
    let modalShown = false;
    let passedProvider = "";
    let passedOptions: Array<{ refKey: string; label: string }> = [];
    let passedFallbackRefs: Array<{ type: string; id: number }> = [];
    const fallbackOptions = Array.from({ length: 30 }, (_, i) => ({
      refKey: `llm:${100 + i}`,
      label: `Model ${i + 1}`,
    }));

    const loaders = await import("@/utils/discord/interactions/personalConfigLoaders");
    const loadSpy = spyOn(loaders, "loadFallbackSelectionOptions").mockResolvedValue(fallbackOptions);
    const savedConfig = await import("@/utils/provider/savedProviderConfig");
    const eligibleSpy = spyOn(savedConfig, "loadUserSavedProvidersForCapability").mockResolvedValue([
      { provider: "openrouter" } as unknown as UserSavedProviderConfigRow,
    ]);

    try {
      const { dependencies } = makeDependencies([], {
        showFallbacksModal: async (_interaction, _locale, _nonce, provider, options, fallbackRefs) => {
          modalShown = true;
          passedProvider = provider;
          passedOptions = options;
          passedFallbackRefs = fallbackRefs;
        },
      });

      const route = createPersonalConfigInteractionRoute(dependencies);
      const customId = buildPersonalConfigRouteId({
        action: "fallbacks-range-open",
        locale: "en-US",
        provider: "openrouter",
        start: 24,
      });

      const interaction = makePersonalInteraction({
        customId,
      });

      await route.execute({} as Client, interaction, requireRoute(customId));

      expect(modalShown).toBe(true);
      expect(passedProvider).toBe("openrouter");
      expect(passedOptions).toHaveLength(6);
      expect(passedOptions[0].label).toBe("Model 25");
      expect(passedOptions[5].label).toBe("Model 30");
      expect(passedFallbackRefs).toEqual([{ type: "llm", id: 103 }]);
    } finally {
      loadSpy.mockRestore();
      eligibleSpy.mockRestore();
    }
  });

  it("rejects handcrafted :25 fallback button with unavailable reply and shows no modal", async () => {
    let modalShown = false;
    const fallbackOptions = Array.from({ length: 30 }, (_, i) => ({
      refKey: `llm:${100 + i}`,
      label: `Model ${i + 1}`,
    }));

    const loaders = await import("@/utils/discord/interactions/personalConfigLoaders");
    const loadSpy = spyOn(loaders, "loadFallbackSelectionOptions").mockResolvedValue(fallbackOptions);
    const savedConfig = await import("@/utils/provider/savedProviderConfig");
    const eligibleSpy = spyOn(savedConfig, "loadUserSavedProvidersForCapability").mockResolvedValue([
      { provider: "openrouter" } as unknown as UserSavedProviderConfigRow,
    ]);

    try {
      const calls: string[] = [];
      const { dependencies, telemetry } = makeDependencies(calls, {
        showFallbacksModal: async () => {
          modalShown = true;
        },
      });

      const route = createPersonalConfigInteractionRoute(dependencies);
      const customId = "personal-config:v2:fallbacks-range-open:en-US:openrouter:25";

      const interaction = makePersonalInteraction({
        customId,
      });

      await route.execute({} as Client, interaction, requireRoute(customId));

      expect(modalShown).toBe(false);
      expect(interaction.replies.at(-1)).toEqual({
        content: localizer("en-US", "commands.personal.config.unavailable"),
        flags: MessageFlags.Ephemeral,
      });
      expect(calls).toEqual([]);
      expect(telemetry).toEqual([]);
    } finally {
      loadSpy.mockRestore();
      eligibleSpy.mockRestore();
    }
  });
});

describe("Operations that own their cache invalidation", () => {
  // These seven call repository methods that do NOT invalidate internally, so the operations layer
  // is the only thing that evicts the stale row. The redundant invalidations elsewhere in this file
  // sit after methods that do self-invalidate and are safe to drop; these are not. Removing one is
  // invisible to every other test, which is why this asserts the call directly.
  it("invalidates the user cache for every operation whose repository method does not", async () => {
    const userCacheModule = await import("@/utils/cache/userCache");
    // Every spy here is restored in the finally block. Bun shares module state across a test lane,
    // so an unrestored repository mock silently breaks unrelated suites: leaving applyUserInfoBatch
    // stubbed made the UpdateUserInfoTool suite fail while this file passed in isolation.
    const invalidateSpy = spyOn(userCacheModule, "invalidateUserCache").mockImplementation(() => {});
    const repoSpies = [
      spyOn(userRepository, "setLanguage").mockImplementation(async () => true),
      spyOn(userRepository, "setTimezoneOffset").mockImplementation(async () => true),
      spyOn(userRepository, "setDeliberateTriggerMode").mockImplementation(async () => true),
      spyOn(userRepository, "setImpersonatePrompt").mockImplementation(async () => true),
      spyOn(userNamingRepository, "applyUserInfoBatch").mockImplementation(async () => {}),
    ];

    const cases: Array<[string, () => Promise<unknown>]> = [
      ["setLanguage", () => personalConfigOperations.setLanguage({ userId: 1, userDiscId: "u1", language: "ja" })],
      ["setTimezone", () => personalConfigOperations.setTimezone({ userId: 1, userDiscId: "u1", offset: 8 })],
      [
        "setNaming",
        () =>
          personalConfigOperations.setNaming({
            userId: 1,
            userDiscId: "u1",
            nickname: "Mirri",
            prefix: null,
            suffix: null,
          }),
      ],
      [
        "setPersonaNaming",
        () =>
          personalConfigOperations.setPersonaNaming({
            userId: 1,
            userDiscId: "u1",
            personaLineageId: 7,
            nickname: "Juno",
            prefix: null,
            suffix: null,
          }),
      ],
      [
        "setAbout",
        () =>
          personalConfigOperations.setAbout({
            userId: 1,
            userDiscId: "u1",
            genderIdentity: "unspecified",
            pronouns: "they/them",
            addressingStyle: "neutral",
          }),
      ],
      ["setTriggerMode", () => personalConfigOperations.setTriggerMode({ userId: 1, userDiscId: "u1", mode: "on" })],
      [
        "setImpersonationPrompt",
        () => personalConfigOperations.setImpersonationPrompt({ userId: 1, userDiscId: "u1", prompt: "hello" }),
      ],
    ];

    try {
      for (const [name, run] of cases) {
        invalidateSpy.mockClear();
        await run();
        expect(`${name}:${invalidateSpy.mock.calls.length}`).toBe(`${name}:1`);
        expect(invalidateSpy.mock.calls[0]?.[0]).toBe("u1");
      }
    } finally {
      invalidateSpy.mockRestore();
      for (const spy of repoSpies) spy.mockRestore();
    }
  });
});

describe("Models-page cache invalidation invariants", () => {
  it("does not call invalidateUserCache on any Models operations writes", async () => {
    const userCacheModule = await import("@/utils/cache/userCache");
    const invalidateSpy = spyOn(userCacheModule, "invalidateUserCache").mockImplementation(() => {});
    const upsertSpy = spyOn(llmProviderRepo, "upsertUserSavedProviderConfig").mockImplementation(async () => true);
    const randomizerSpy = spyOn(llmProviderRepo, "updatePersonalModelRandomizer").mockImplementation(async () => true);

    const dummyConfig: UserSavedProviderConfigRow = {
      user_saved_config_id: 1,
      user_id: 1,
      provider: "openrouter",
      key_version: 1,
      api_key: null,
      llm_id: 101,
      diffusion_model_id: null,
      embedding_model_id: null,
      nai_diffusion_model_id: null,
      video_model_id: null,
      vision_llm_id: null,
      nai_preset_name: null,
      llm_temperature: 0.7,
      llm_top_p: 0.95,
      llm_top_k: 0,
      llm_frequency_penalty: 0,
      llm_presence_penalty: 0,
      llm_min_p: 0.05,
      llm_max_output_tokens: 4096,
      llm_disabled_params: [],
      llm_logit_biases: [],
      thinking_level: "auto",
      model_randomizer_enabled: false,
      enabled_capabilities: ["text"],
      assigned_capabilities: ["text"],
      fallback_model_refs: [{ type: "llm", id: 102 }],
    } as unknown as UserSavedProviderConfigRow;

    const loadConfigSpy = spyOn(llmProviderRepo, "loadUserSavedProviderConfig").mockImplementation(
      async () => dummyConfig,
    );
    const loadConfigsSpy = spyOn(llmProviderRepo, "loadUserSavedProviderConfigs").mockImplementation(async () => [
      dummyConfig,
    ]);
    const loadEndpointsSpy = spyOn(llmProviderRepo, "loadCustomEndpointsForUser").mockImplementation(async () => []);
    const availableModelsSpy = spyOn(llmModelRepo, "loadAvailableModelsForProvider").mockImplementation(
      async () =>
        [{ llm_id: 102, llm_codename: "replacement-model" }] as unknown as ReturnType<
          typeof llmModelRepo.loadAvailableModelsForProvider
        > extends Promise<infer T>
          ? T
          : never,
    );

    await personalConfigOperations.setCapabilityModel({
      userId: 1,
      userDiscId: "user-123",
      capability: "text",
      provider: "openrouter",
      modelId: 102,
    });
    expect(invalidateSpy).not.toHaveBeenCalled();

    await personalConfigOperations.setCapabilityEnabled({
      userId: 1,
      userDiscId: "user-123",
      capability: "text",
      enabled: false,
    });
    expect(invalidateSpy).not.toHaveBeenCalled();

    await personalConfigOperations.setParameters({
      userId: 1,
      userDiscId: "user-123",
      provider: "openrouter",
      patch: { temperature: 0.9 },
    });
    expect(invalidateSpy).not.toHaveBeenCalled();

    await personalConfigOperations.setRandomizer({
      userId: 1,
      userDiscId: "user-123",
      provider: "openrouter",
      enabled: true,
    });
    expect(invalidateSpy).not.toHaveBeenCalled();

    invalidateSpy.mockRestore();
    upsertSpy.mockRestore();
    randomizerSpy.mockRestore();
    loadConfigSpy.mockRestore();
    loadConfigsSpy.mockRestore();
    loadEndpointsSpy.mockRestore();
    availableModelsSpy.mockRestore();
  });

  it("writes the server model fallback preference through the self-invalidating user update", async () => {
    const updateSpy = spyOn(userRepository, "update").mockImplementation(
      async () => ({ user_disc_id: "user-123" }) as unknown as UserRow,
    );

    try {
      const result = await personalConfigOperations.setServerModelFallback({
        userId: 1,
        userDiscId: "user-123",
        current: true,
        enabled: false,
      });

      expect(result).toEqual({ status: "success", enabled: false });
      // `userRepository.update` owns the cache invalidation, so the operation must not evict twice.
      expect(updateSpy).toHaveBeenCalledWith(1, { personal_server_fallback_enabled: false });
    } finally {
      updateSpy.mockRestore();
    }
  });

  it("performs no write when the server model fallback preference already matches", async () => {
    const updateSpy = spyOn(userRepository, "update").mockImplementation(async () => null);

    try {
      const result = await personalConfigOperations.setServerModelFallback({
        userId: 1,
        userDiscId: "user-123",
        current: false,
        enabled: false,
      });

      expect(result).toEqual({ status: "no-changes" });
      expect(updateSpy).not.toHaveBeenCalled();
    } finally {
      updateSpy.mockRestore();
    }
  });
});

describe("Fallbacks submission re-resolution and invariants", () => {
  it("keeps blank slots, clears none slots, deduplicates, and rejects primary conflict", async () => {
    let savedConfigUpsert: unknown = null;
    const loadConfigsSpy = spyOn(llmProviderRepo, "loadUserSavedProviderConfigs").mockImplementation(async () => [
      {
        provider: "openrouter",
        llm_id: 101,
        enabled_capabilities: ["text"],
        assigned_capabilities: ["text"],
      } as unknown as UserSavedProviderConfigRow,
    ]);
    const loadSpy = spyOn(llmProviderRepo, "loadUserSavedProviderConfig").mockImplementation(
      async () =>
        ({
          user_saved_config_id: 1,
          user_id: 1,
          provider: "openrouter",
          llm_id: 101,
          fallback_model_refs: [
            { type: "llm", id: 102 },
            { type: "llm", id: 103 },
          ],
        }) as unknown as UserSavedProviderConfigRow,
    );
    const availableSpy = spyOn(llmModelRepo, "loadAvailableModelsForProvider").mockImplementation(
      async () =>
        [
          { llm_id: 101, llm_codename: "claude-3-5-sonnet" },
          { llm_id: 102, llm_codename: "claude-3-opus" },
          { llm_id: 103, llm_codename: "gpt-4o" },
          { llm_id: 104, llm_codename: "gemini-pro" },
        ] as unknown as ReturnType<typeof llmModelRepo.loadAvailableModelsForProvider> extends Promise<infer T>
          ? T
          : never,
    );
    const endpointsSpy = spyOn(llmProviderRepo, "loadCustomEndpointsForUser").mockImplementation(async () => []);
    const upsertSpy = spyOn(llmProviderRepo, "upsertUserSavedProviderConfig").mockImplementation(
      async (_userId, cfg) => {
        savedConfigUpsert = cfg;
        return true;
      },
    );

    const conflictResult = await personalConfigOperations.setFallbacks({
      userId: 1,
      userDiscId: "user-123",
      provider: "openrouter",
      slotValues: ["llm:101", "", "", "", ""],
    });
    expect(conflictResult.status).toBe("primary-conflict");

    const validResult = await personalConfigOperations.setFallbacks({
      userId: 1,
      userDiscId: "user-123",
      provider: "openrouter",
      slotValues: ["", "__none__", "llm:104", "llm:104", ""],
    });
    expect(validResult.status).toBe("success");
    expect((savedConfigUpsert as { fallback_model_refs: unknown[] }).fallback_model_refs).toEqual([
      { type: "llm", id: 102 },
      { type: "llm", id: 104 },
    ]);

    loadSpy.mockRestore();
    loadConfigsSpy.mockRestore();
    availableSpy.mockRestore();
    endpointsSpy.mockRestore();
    upsertSpy.mockRestore();
  });

  it("rejects a custom endpoint submitted for a standard provider", async () => {
    const savedRow = {
      provider: "openrouter",
      llm_id: 101,
      fallback_model_refs: [],
      enabled_capabilities: ["text"],
      assigned_capabilities: ["text"],
    } as unknown as UserSavedProviderConfigRow;
    const loadConfigsSpy = spyOn(llmProviderRepo, "loadUserSavedProviderConfigs").mockImplementation(async () => [
      savedRow,
    ]);
    const loadConfigSpy = spyOn(llmProviderRepo, "loadUserSavedProviderConfig").mockImplementation(
      async () => savedRow,
    );
    const availableSpy = spyOn(llmModelRepo, "loadAvailableModelsForProvider").mockImplementation(async () => []);
    const endpointsSpy = spyOn(llmProviderRepo, "loadCustomEndpointsForUser").mockImplementation(
      async () =>
        [
          {
            custom_endpoint_id: 55,
            connection_id: 9,
            capability: "text",
            label: "owned-endpoint",
          },
        ] as unknown as ReturnType<typeof llmProviderRepo.loadCustomEndpointsForUser> extends Promise<infer T>
          ? T
          : never,
    );
    const upsertSpy = spyOn(llmProviderRepo, "upsertUserSavedProviderConfig").mockImplementation(async () => true);

    const result = await personalConfigOperations.setFallbacks({
      userId: 1,
      userDiscId: "user-123",
      provider: "openrouter",
      slotValues: ["custom_endpoint:55", "", "", "", ""],
    });

    expect(result).toEqual({ status: "write-failed" });
    expect(upsertSpy).not.toHaveBeenCalled();
    loadConfigsSpy.mockRestore();
    loadConfigSpy.mockRestore();
    availableSpy.mockRestore();
    endpointsSpy.mockRestore();
    upsertSpy.mockRestore();
  });
});

describe("Quick-Toggle modal structure and routing copy", () => {
  it("renders 6 checkbox options with type 22 and max_values 6 in canonical order", () => {
    const { buildQuickToggleModal } = require("@/utils/discord/ui/personalConfigModals");
    const modal = buildQuickToggleModal("en-US", "nonce123456", [
      {
        user_saved_config_id: 1,
        user_id: 1,
        provider: "openrouter",
        enabled_capabilities: ["text", "image"],
        assigned_capabilities: ["text", "image"],
        diffusion_model_id: 10,
        nai_diffusion_model_id: null,
      } as unknown as UserSavedProviderConfigRow,
      {
        user_saved_config_id: 2,
        user_id: 1,
        provider: "novelai",
        enabled_capabilities: ["image_nai"],
        assigned_capabilities: ["image_nai"],
        diffusion_model_id: null,
        nai_diffusion_model_id: 20,
      } as unknown as UserSavedProviderConfigRow,
    ]);

    const modalJson = JSON.stringify(modal);
    expect(modalJson).toContain(localizedCopy("en-US", "commands.personal.config.quick_toggle_modal_title"));
    expect(modalJson).toContain(localizedCopy("en-US", "commands.personal.config.quick_toggle_group_description"));

    const component = modal.components[0]?.component;
    expect(component?.type).toBe(22);
    expect(component?.min_values).toBe(0);
    expect(component?.max_values).toBe(6);
    expect(component?.options).toHaveLength(6);

    const values = component?.options.map((opt: { value: string }) => opt.value);
    expect(values).toEqual(["text", "vision", "embedding", "image", "image_nai", "video"]);

    const labels = component?.options.map((opt: { label: string }) => opt.label);
    expect(labels).toEqual(["Text", "Vision", "Embedding", "Standard Image", "NovelAI Image", "Video"]);

    const imageOpt = component?.options.find((opt: { value: string }) => opt.value === "image");
    expect(imageOpt?.default).toBe(true);
    expect(imageOpt?.description).toContain("OpenRouter");

    const naiOpt = component?.options.find((opt: { value: string }) => opt.value === "image_nai");
    expect(naiOpt?.default).toBe(true);
    expect(naiOpt?.description).toContain("NovelAI");

    // The group description is capped at 100 characters, so anything past that never reaches a client.
    const groupDescription = modal.components[0]?.description as string;
    expect(groupDescription.length).toBeLessThanOrEqual(100);
    expect(groupDescription).toBe(localizedCopy("en-US", "commands.personal.config.quick_toggle_group_description"));
  });

  it("keeps naming the saved provider for a capability that is assigned but switched off", () => {
    const { buildQuickToggleModal } = require("@/utils/discord/ui/personalConfigModals");
    // Every model column must be present and null: an absent column reads as configured, which
    // would make the untouched capabilities report a provider they do not own.
    const modal = buildQuickToggleModal("en-US", "nonce123456", [
      {
        user_saved_config_id: 1,
        user_id: 1,
        provider: "openrouter",
        enabled_capabilities: [],
        assigned_capabilities: ["text"],
        llm_id: 10,
        vision_llm_id: null,
        embedding_model_id: null,
        diffusion_model_id: null,
        nai_diffusion_model_id: null,
        video_model_id: null,
      } as unknown as UserSavedProviderConfigRow,
    ]);

    const component = modal.components[0]?.component;
    const textOpt = component?.options.find((opt: { value: string }) => opt.value === "text");
    expect(textOpt?.default).toBe(false);
    expect(textOpt?.description).toContain("OpenRouter");

    const visionOpt = component?.options.find((opt: { value: string }) => opt.value === "vision");
    expect(visionOpt?.default).toBe(false);
    expect(visionOpt?.description).toBe(localizedCopy("en-US", "commands.personal.config.quick_toggle_none_desc"));
  });

  it("carries the submitted capability set straight to the write with no confirmation step", async () => {
    const calls: string[] = [];
    const { dependencies, telemetry } = makeDependencies(calls, {
      loadUserSavedProviders: async () => [
        {
          user_saved_config_id: 1,
          user_id: 1,
          provider: "openrouter",
          // Nothing is switched on yet, so every checked capability is a new cross-server override.
          enabled_capabilities: [],
          assigned_capabilities: ["text", "vision"],
          llm_id: 101,
          vision_llm_id: 201,
          embedding_model_id: null,
          diffusion_model_id: null,
          nai_diffusion_model_id: null,
          video_model_id: null,
        } as unknown as UserSavedProviderConfigRow,
      ],
      operations: {
        ...personalConfigOperations,
        setQuickToggleRouting: async (input) => {
          calls.push(`setQuickToggleRouting:${Array.from(input.selectedCapabilities).join(",")}`);
          return { status: "success" };
        },
      },
    });

    const route = createPersonalConfigInteractionRoute(dependencies);
    const customId = buildPersonalConfigRouteId({
      action: "quick-toggle-submit",
      locale: "en-US",
      nonce: "nonce123456",
    });
    const interaction = makePersonalInteraction({
      kind: "modal",
      customId,
    });

    const modalsModule = await import("@/utils/discord/ui/modals");
    const takeSpy = spyOn(modalsModule, "takeRawModalCheckboxGroupValues").mockReturnValue(["text", "vision"]);

    await route.execute({} as Client, interaction, requireRoute(customId));

    takeSpy.mockRestore();

    expect(calls).toContain("setQuickToggleRouting:text,vision");
    expect(telemetry).toContain("personal-config.personal.model-routing.set");
    const json = JSON.stringify(interaction.edits.at(-1));
    expect(json).not.toContain("quick-toggle-confirm");
    expect(json).toContain(localizedCopy("en-US", "commands.personal.config.routing_updated_heading"));
  });

  it("fails closed when a checked capability has no configured model", async () => {
    const calls: string[] = [];
    const { dependencies, telemetry } = makeDependencies(calls, {
      loadUserSavedProviders: async () => [
        {
          user_saved_config_id: 1,
          user_id: 1,
          provider: "openrouter",
          enabled_capabilities: [],
          assigned_capabilities: ["text"],
          llm_id: 101,
          vision_llm_id: null,
          embedding_model_id: null,
          diffusion_model_id: null,
          nai_diffusion_model_id: null,
          video_model_id: null,
        } as unknown as UserSavedProviderConfigRow,
      ],
    });

    const route = createPersonalConfigInteractionRoute(dependencies);
    const customId = buildPersonalConfigRouteId({
      action: "quick-toggle-submit",
      locale: "en-US",
      nonce: "nonce123456",
    });
    const interaction = makePersonalInteraction({
      kind: "modal",
      customId,
    });

    const modalsModule = await import("@/utils/discord/ui/modals");
    const takeSpy = spyOn(modalsModule, "takeRawModalCheckboxGroupValues").mockReturnValue(["text", "video"]);

    await route.execute({} as Client, interaction, requireRoute(customId));

    takeSpy.mockRestore();

    // The guard that used to sit behind the confirmation still runs before any write.
    expect(calls.some((c) => c.startsWith("setQuickToggleRouting"))).toBe(false);
    expect(telemetry).toHaveLength(0);
    expect(JSON.stringify(interaction.edits.at(-1))).toContain(
      localizedCopy("en-US", "commands.personal.config.missing_model_heading"),
    );
  });
});

describe("personalConfigOperations Advanced operations", () => {
  it("setTriggerMode calls userRepository.setDeliberateTriggerMode", async () => {
    const triggerSpy = spyOn(userRepository, "setDeliberateTriggerMode").mockImplementation(async () => true);
    const result = await personalConfigOperations.setTriggerMode({
      userId: 1,
      userDiscId: "user-123",
      mode: "on",
    });
    expect(result).toEqual({ status: "success" });
    expect(triggerSpy).toHaveBeenCalledWith(1, "on");
    triggerSpy.mockRestore();
  });

  it("setToolMode calls userRepository.update", async () => {
    const updateSpy = spyOn(userRepository, "update").mockImplementation(async () => makeUser());
    const result = await personalConfigOperations.setToolMode({
      userId: 1,
      userDiscId: "user-123",
      mode: "off",
    });
    expect(result).toEqual({ status: "success" });
    expect(updateSpy).toHaveBeenCalledWith(1, { personal_deliberate_tool_mode: "off" });
    updateSpy.mockRestore();
  });

  it("setImpersonationPrompt calls userRepository.setImpersonatePrompt", async () => {
    const impSpy = spyOn(userRepository, "setImpersonatePrompt").mockImplementation(async () => true);
    const result = await personalConfigOperations.setImpersonationPrompt({
      userId: 1,
      userDiscId: "user-123",
      prompt: "Act like a helpful cat",
    });
    expect(result).toEqual({ status: "success" });
    expect(impSpy).toHaveBeenCalledWith(1, "Act like a helpful cat");
    impSpy.mockRestore();
  });

  it("setSpotlight calls userRepository.replacePersonalSpotlight", async () => {
    const personalSpotlightCache = await import("@/utils/cache/personalSpotlightCache");
    const getCachedSpy = spyOn(personalSpotlightCache, "getCachedPersonalSpotlightStatus").mockResolvedValue(null);
    const spotSpy = spyOn(userRepository, "replacePersonalSpotlight").mockImplementation(async () => {});
    const result = await personalConfigOperations.setSpotlight({
      serverId: 42,
      userId: 1,
      userDiscId: "user-123",
      channelId: "ch-100",
      personaIds: [1, 2],
      autoTriggerPersonaId: 1,
      expiresAt: null,
    });
    expect(result).toEqual({ status: "success" });
    expect(spotSpy).toHaveBeenCalledWith(42, 1, "ch-100", [1, 2], 1, null);
    getCachedSpy.mockRestore();
    spotSpy.mockRestore();
  });

  it("removeSpotlights calls userRepository.removePersonalSpotlight for each channel", async () => {
    const remSpy = spyOn(userRepository, "removePersonalSpotlight").mockImplementation(async () => true);
    const result = await personalConfigOperations.removeSpotlights({
      serverId: 42,
      userId: 1,
      userDiscId: "user-123",
      channelIds: ["ch-100", "ch-200"],
    });
    expect(result).toEqual({ status: "success", removedCount: 2 });
    expect(remSpy).toHaveBeenCalledTimes(2);
    remSpy.mockRestore();
  });
});

describe("personalConfigRoutes Advanced interactions and telemetry", () => {
  it("sets trigger mode and records telemetry", async () => {
    const calls: string[] = [];
    const { dependencies, telemetry } = makeDependencies(calls);
    const route = createPersonalConfigInteractionRoute(dependencies);
    const customId = buildPersonalConfigRouteId({ action: "trigger-mode-set", locale: "en-US", mode: "on" });

    const interaction = makePersonalInteraction({
      customId,
    });

    await route.execute({} as Client, interaction, requireRoute(customId));

    expect(calls).toContain("setTriggerMode:on");
    expect(telemetry).toContain("personal-config.personal.trigger-mode.set");
  });

  it("sets tool mode and records telemetry", async () => {
    const calls: string[] = [];
    const { dependencies, telemetry } = makeDependencies(calls);
    const route = createPersonalConfigInteractionRoute(dependencies);
    const customId = buildPersonalConfigRouteId({ action: "tool-mode-set", locale: "en-US", mode: "off" });

    const interaction = makePersonalInteraction({
      customId,
    });

    await route.execute({} as Client, interaction, requireRoute(customId));

    expect(calls).toContain("setToolMode:off");
    expect(telemetry).toContain("personal-config.personal.tool-mode.set");
  });

  it("opens impersonation modal with prefilled prompt", async () => {
    const calls: string[] = [];
    let openedModalPrompt: string | null = "unopened";
    const { dependencies } = makeDependencies(calls, {
      showImpersonationModal: async (_interaction, _locale, _nonce, currentPrompt) => {
        openedModalPrompt = currentPrompt;
      },
    });

    const route = createPersonalConfigInteractionRoute(dependencies);
    const customId = buildPersonalConfigRouteId({ action: "impersonation-open", locale: "en-US" });

    const interaction = makePersonalInteraction({
      customId,
    });

    await route.execute({} as Client, interaction, requireRoute(customId));

    expect(openedModalPrompt).toBeNull();
  });

  it("refuses blank impersonation submission with info receipt and no write", async () => {
    const calls: string[] = [];
    const { dependencies, telemetry } = makeDependencies(calls);
    const route = createPersonalConfigInteractionRoute(dependencies);
    const customId = buildPersonalConfigRouteId({
      action: "impersonation-submit",
      locale: "en-US",
      nonce: "nonce123456",
    });

    const interaction = makePersonalInteraction({
      kind: "modal",
      customId,
      fields: { prompt_nonce123456: "   " },
    });

    await route.execute({} as Client, interaction, requireRoute(customId));

    expect(calls.filter((c) => c.startsWith("setImpersonationPrompt"))).toHaveLength(0);
    expect(telemetry).not.toContain("personal-config.personal.impersonation.set");
    expect(JSON.stringify(interaction.edits.at(-1))).toContain(
      localizedCopy("en-US", "commands.personal.config.impersonation_blank_refusal_heading"),
    );
  });

  it("updates impersonation prompt and records telemetry", async () => {
    const calls: string[] = [];
    const { dependencies, telemetry } = makeDependencies(calls);
    const route = createPersonalConfigInteractionRoute(dependencies);
    const customId = buildPersonalConfigRouteId({
      action: "impersonation-submit",
      locale: "en-US",
      nonce: "nonce123456",
    });

    const interaction = makePersonalInteraction({
      kind: "modal",
      customId,
      fields: { prompt_nonce123456: "Speak concisely" },
    });

    await route.execute({} as Client, interaction, requireRoute(customId));

    expect(calls).toContain("setImpersonationPrompt:Speak concisely");
    expect(telemetry).toContain("personal-config.personal.impersonation.set");
  });

  it("clears impersonation prompt via confirmation and records telemetry", async () => {
    const calls: string[] = [];
    const { dependencies, user, telemetry } = makeDependencies(calls);
    user.impersonation_prompt = "Existing prompt";
    const route = createPersonalConfigInteractionRoute(dependencies);
    const customId = buildPersonalConfigRouteId({
      action: "impersonation-clear-confirm",
      locale: "en-US",
      nonce: "nonce123456",
    });

    const interaction = makePersonalInteraction({
      customId,
    });

    await route.execute({} as Client, interaction, requireRoute(customId));

    expect(calls).toContain("setImpersonationPrompt:null");
    expect(telemetry).toContain("personal-config.personal.impersonation.set");
  });

  it("rejects spotlight actions in DM context cleanly", async () => {
    const calls: string[] = [];
    const { dependencies } = makeDependencies(calls, {
      resolveScope: async () => ({
        userId: 1,
        userDiscId: "user-123",
        guildId: null,
        workspaceId: "dm",
        internalServerId: null,
        user: makeUser(),
        resolvedNickname: "LiveUser",
        personas: [],
        readStatus: "fresh",
      }),
    });

    const route = createPersonalConfigInteractionRoute(dependencies);
    const customId = buildPersonalConfigRouteId({ action: "spotlight-set-open", locale: "en-US" });

    const interaction = makePersonalInteraction({
      customId,
      guildId: null,
    });

    await route.execute({} as Client, interaction, requireRoute(customId));

    expect(JSON.stringify(interaction.replies.at(-1))).toContain(
      localizedCopy("en-US", "commands.personal.config.spotlight_guild_only_detail"),
    );
  });

  it("handles spotlight set review, auto-trigger, and confirm", async () => {
    const calls: string[] = [];
    const { dependencies, telemetry } = makeDependencies(calls);
    const route = createPersonalConfigInteractionRoute(dependencies);
    const personas = [{ id: 1 }, { id: 2 }];
    const fp = computeSpotlightSetFingerprint("guild-123", "user-123", personas);
    const customId = buildPersonalConfigRouteId({
      action: "spot-set-cf",
      locale: "en-US",
      channelId: "123456789012345678",
      hours: 12,
      autoIdx: 1,
      blockIdx: 0,
      mask: "1",
      fp,
      nonce: "nonce123456",
    });

    const interaction = makePersonalInteraction({
      customId,
      channelCache: makeChannelCache(["123456789012345678"]),
    });

    await route.execute({} as Client, interaction, requireRoute(customId));

    expect(calls).toContain("setSpotlight:123456789012345678:1:1");
    expect(telemetry).toContain("personal-config.personal.spotlight.set");
  });

  it("performs no spotlight write when the confirmed channel is not a text channel in this guild", async () => {
    const calls: string[] = [];
    const { dependencies, telemetry } = makeDependencies(calls);
    const route = createPersonalConfigInteractionRoute(dependencies);
    const personas = [{ id: 1 }, { id: 2 }];
    const fp = computeSpotlightSetFingerprint("guild-123", "user-123", personas);
    const customId = buildPersonalConfigRouteId({
      action: "spot-set-cf",
      locale: "en-US",
      channelId: "999999999999999999",
      hours: 12,
      autoIdx: 1,
      blockIdx: 0,
      mask: "1",
      fp,
      nonce: "nonce123456",
    });

    const interaction = makePersonalInteraction({
      customId,
      channelCache: makeChannelCache(["123456789012345678"]),
    });

    await route.execute({} as Client, interaction, requireRoute(customId));

    expect(calls.some((entry) => entry.startsWith("setSpotlight:"))).toBe(false);
    expect(telemetry).not.toContain("personal-config.personal.spotlight.set");
  });

  it("removes only the presented range when the removal modal was opened past the first page", async () => {
    const calls: string[] = [];
    const activeSpotlights = Array.from({ length: 60 }, (_, index) =>
      makeSpotlight(String(100000000000000000n + BigInt(index)), { personaIds: [1] }),
    );
    const { dependencies } = makeDependencies(calls, {
      loadActiveSpotlights: async () => activeSpotlights,
    });
    const route = createPersonalConfigInteractionRoute(dependencies);
    const fp = computeSpotlightRemoveFingerprint("guild-123", "user-123", activeSpotlights);
    const customId = buildPersonalConfigRouteId({
      action: "spotlight-remove-submit",
      locale: "en-US",
      start: 50,
      fp,
      nonce: "nonce123456",
    });

    const interaction = makePersonalInteraction({
      kind: "modal",
      customId,
      overrides: { id: "modal-range-2" },
    });

    await route.execute({} as Client, interaction, requireRoute(customId));

    const removal = calls.find((entry) => entry.startsWith("removeSpotlights:"));
    expect(removal).toBeDefined();
    const removedIds = (removal ?? "").slice("removeSpotlights:".length).split(",");
    expect(removedIds).toEqual(activeSpotlights.slice(50).map((entry) => entry.channelDiscId));
    expect(removedIds).not.toContain(activeSpotlights[0].channelDiscId);
  });

  it("emits one persona option per lineage and never exceeds Discord's option cap", () => {
    // Naming preferences are lineage-keyed, so two personas can legitimately share a lineage.
    // Discord rejects a repeated option value outright with COMPONENT_OPTION_VALUE_DUPLICATED.
    const shared = [makePersona(1, 10, "Tomori"), makePersona(2, 10, "Tomori (alter)")];
    const many = Array.from({ length: 40 }, (_, index) => makePersona(100 + index, 200 + index, `P${index}`));

    const payload = buildPersonalConfigPanelPayload({
      locale: "en-US",
      category: "profile",
      page: "persona",
      user: makeUser(),
      resolvedNickname: "Tester",
      personas: [...shared, ...many],
      guildId: "guild-123",
      memoryCount: 0,
      stmCount: 0,
      readStatus: "fresh",
    });

    const json = JSON.stringify(payload);
    const optionValues = [...json.matchAll(/"customId":"personal-config:v2:persona-select[^"]*"/g)];
    expect(optionValues.length).toBe(1);

    const select = JSON.parse(json).components[0].components.find(
      (row: { components?: Array<{ customId?: string; options?: Array<{ value: string }> }> }) =>
        row.components?.[0]?.customId?.includes("persona-select"),
    ).components[0];

    const values: string[] = select.options.map((option: { value: string }) => option.value);
    expect(values.length).toBeLessThanOrEqual(25);
    expect(new Set(values).size).toBe(values.length);
    expect(values).toContain("10");
  });

  it("renders both spotlight multi-selects as checkbox groups, never file uploads", () => {
    // RawDiscordComponent.type is a bare number, so TypeScript accepts any of them. Component type 19
    // is FileUpload and 22 is CheckboxGroup: picking 19 renders an upload box that submits no values,
    // which for the unchecked-means-remove modal means every presented row is treated as unchecked.
    const setModal = buildSpotlightSetModal("en-US", "nonce123456", "123456789012345678", 0, 0, "a1b2c3d4", [
      { id: 1, name: "Tomori", isAlter: false },
      { id: 2, name: "Mirri", isAlter: true },
    ]);
    const removeModal = buildSpotlightRemoveModal(
      "en-US",
      "nonce123456",
      0,
      "a1b2c3d4",
      [makeSpotlight("123456789012345678", { personaIds: [1] })],
      [{ id: 1, name: "Tomori", isAlter: false }],
      new Map([["123456789012345678", { name: "general" }]]),
    );

    for (const modal of [setModal, removeModal]) {
      const optionBearing = modal.components.filter((label) => label.component?.options !== undefined);
      expect(optionBearing.length).toBeGreaterThan(0);
      for (const label of optionBearing) {
        expect(label.component?.type).not.toBe(19);
      }
    }

    const personaGroups = setModal.components.filter((label) => label.component?.custom_id?.startsWith("personas_"));
    expect(personaGroups.length).toBeGreaterThan(0);
    for (const group of personaGroups) expect(group.component?.type).toBe(22);

    const removalGroups = removeModal.components.filter((label) =>
      label.component?.custom_id?.startsWith("spotlights_"),
    );
    expect(removalGroups.length).toBeGreaterThan(0);
    for (const group of removalGroups) expect(group.component?.type).toBe(22);
  });

  it("resolves every composed Response Modes locale key to real text", () => {
    // check-locales matches literal dot-notation strings only, so a key built from a template is
    // invisible to it and a missing half would render its own key to the user with every gate green.
    // Only `mode_` is still composed; the receipt handlers build it from the route's mode.
    for (const mode of ["off", "follow", "on"] as const) {
      const key = `commands.personal.config.mode_${mode}`;
      expect(localizer("en-US", key)).not.toBe(key);
    }
  });

  it("renders Deliberate Trigger Mode and Tool Mode as state-control rows with effective behavior below buttons", () => {
    type ResponseModeChoice = "off" | "follow" | "on";
    const modes: ResponseModeChoice[] = ["off", "follow", "on"];

    for (const dtmMode of modes) {
      for (const toolMode of modes) {
        for (const isGuild of [true, false]) {
          for (const serverFlag of isGuild ? [false, true] : [false]) {
            const payload = buildPersonalConfigPanelPayload({
              locale: "en-US",
              category: "advanced",
              page: "response-modes",
              user: makeUser({ personal_dtm: dtmMode, personal_deliberate_tool_mode: toolMode }),
              resolvedNickname: "Tester",
              personas: [],
              guildId: isGuild ? "guild-123" : null,
              memoryCount: 0,
              stmCount: 0,
              readStatus: "fresh",
              serverTriggerBehavior: isGuild
                ? { deliberate_trigger_mode: serverFlag, deliberate_tool_mode: serverFlag }
                : null,
            });

            const container = payload.components.find(
              (component): component is ContainerComponentData<ComponentInContainerData> =>
                component.type === ComponentType.Container,
            );
            if (!container) throw new Error("Expected the panel container");

            // Find DTM action row and its surrounding text displays
            const dtmRowIndex = container.components.findIndex(
              (c) =>
                c.type === ComponentType.ActionRow &&
                "components" in c &&
                c.components.some(
                  (b) => "customId" in b && typeof b.customId === "string" && b.customId.includes("trigger-mode-set"),
                ),
            );
            expect(dtmRowIndex).toBeGreaterThan(0);

            const dtmHeadingDisplay = container.components[dtmRowIndex - 1] as TextDisplayComponentData;
            expect(dtmHeadingDisplay.type).toBe(ComponentType.TextDisplay);
            expect(dtmHeadingDisplay.content).toContain(
              "**[Deliberate Trigger Mode](https://docs.tomoribot.app/en/features/chatting-personality/chatting-and-triggers/#deliberate-trigger-mode)**",
            );
            expect(dtmHeadingDisplay.content.replaceAll("\n", " ")).toContain(
              localizedCopy("en-US", "commands.personal.config.dtm_description"),
            );
            expect(dtmHeadingDisplay.content).not.toContain(">");

            const dtmEffectDisplay = container.components[dtmRowIndex + 1] as TextDisplayComponentData;
            expect(dtmEffectDisplay.type).toBe(ComponentType.TextDisplay);

            // Verify DTM effect sentence
            if (!isGuild) {
              expect(dtmEffectDisplay.content).toBe("> Deliberate Trigger Mode does not apply in direct messages");
            } else {
              const isDtmActive = dtmMode === "on" || (dtmMode === "follow" && serverFlag);
              expect(dtmEffectDisplay.content).toBe(
                isDtmActive
                  ? "> Only an @mention, a reply, or /respond reaches me"
                  : "> You can trigger me by saying my name",
              );
            }

            // Verify DTM button styling and disabled states
            const dtmRow = container.components[dtmRowIndex] as ActionRowData<InteractionButtonComponentData>;
            expect(dtmRow.components).toHaveLength(3);
            const [dtmOff, dtmFollow, dtmOn] = dtmRow.components;

            expect(dtmOff.customId).toBe("personal-config:v2:trigger-mode-set:en-US:off");
            expect(dtmOff.label).toBe("Off");
            expect(dtmOff.style).toBe(dtmMode === "off" ? ButtonStyle.Primary : ButtonStyle.Secondary);
            expect(dtmOff.disabled).toBe(dtmMode === "off");

            expect(dtmFollow.customId).toBe("personal-config:v2:trigger-mode-set:en-US:follow");
            expect(dtmFollow.label).toBe(localizedCopy("en-US", "commands.personal.config.mode_follow"));
            expect(dtmFollow.style).toBe(dtmMode === "follow" ? ButtonStyle.Primary : ButtonStyle.Secondary);
            expect(dtmFollow.disabled).toBe(dtmMode === "follow");

            expect(dtmOn.customId).toBe("personal-config:v2:trigger-mode-set:en-US:on");
            expect(dtmOn.label).toBe("On");
            expect(dtmOn.style).toBe(dtmMode === "on" ? ButtonStyle.Primary : ButtonStyle.Secondary);
            expect(dtmOn.disabled).toBe(dtmMode === "on");

            // Find Tool Mode action row and its surrounding text displays
            const toolRowIndex = container.components.findIndex(
              (c) =>
                c.type === ComponentType.ActionRow &&
                "components" in c &&
                c.components.some(
                  (b) => "customId" in b && typeof b.customId === "string" && b.customId.includes("tool-mode-set"),
                ),
            );
            expect(toolRowIndex).toBeGreaterThan(dtmRowIndex);

            const toolHeadingDisplay = container.components[toolRowIndex - 1] as TextDisplayComponentData;
            expect(toolHeadingDisplay.type).toBe(ComponentType.TextDisplay);
            expect(toolHeadingDisplay.content).toContain(
              "**[Deliberate Tool Mode](https://docs.tomoribot.app/en/features/capabilities/tools-and-extensions/#deliberate-tool-mode)** (EXPERIMENTAL)",
            );
            expect(toolHeadingDisplay.content.replaceAll("\n", " ")).toContain(
              localizedCopy("en-US", "commands.personal.config.tool_mode_description"),
            );
            expect(toolHeadingDisplay.content).not.toContain(">");

            const toolEffectDisplay = container.components[toolRowIndex + 1] as TextDisplayComponentData;
            expect(toolEffectDisplay.type).toBe(ComponentType.TextDisplay);

            // Verify Tool Mode effect sentence
            const isToolActive = toolMode === "on" || (toolMode === "follow" && isGuild && serverFlag);
            expect(toolEffectDisplay.content).toBe(
              isToolActive
                ? "> My tools are only offered when the conversation calls for them"
                : "> All my tools are always available",
            );

            // Verify Tool Mode button styling and disabled states
            const toolRow = container.components[toolRowIndex] as ActionRowData<InteractionButtonComponentData>;
            expect(toolRow.components).toHaveLength(3);
            const [toolOff, toolFollow, toolOn] = toolRow.components;

            expect(toolOff.customId).toBe("personal-config:v2:tool-mode-set:en-US:off");
            expect(toolOff.label).toBe("Off");
            expect(toolOff.style).toBe(toolMode === "off" ? ButtonStyle.Primary : ButtonStyle.Secondary);
            expect(toolOff.disabled).toBe(toolMode === "off");

            expect(toolFollow.customId).toBe("personal-config:v2:tool-mode-set:en-US:follow");
            expect(toolFollow.label).toBe(localizedCopy("en-US", "commands.personal.config.mode_follow"));
            expect(toolFollow.style).toBe(toolMode === "follow" ? ButtonStyle.Primary : ButtonStyle.Secondary);
            expect(toolFollow.disabled).toBe(toolMode === "follow");

            expect(toolOn.customId).toBe("personal-config:v2:tool-mode-set:en-US:on");
            expect(toolOn.label).toBe("On");
            expect(toolOn.style).toBe(toolMode === "on" ? ButtonStyle.Primary : ButtonStyle.Secondary);
            expect(toolOn.disabled).toBe(toolMode === "on");

            // Ensure no retired status prose exists in the payload
            const serialized = JSON.stringify(payload);
            expect(serialized).not.toContain("(Off)");
            expect(serialized).not.toContain("(On)");
            expect(serialized).not.toContain("(Follow Server");
          }
        }
      }
    }
  });

  it("disables all Response Mode buttons when writes are disabled while preserving Primary selection", () => {
    const payload = buildPersonalConfigPanelPayload({
      locale: "en-US",
      category: "advanced",
      page: "response-modes",
      user: makeUser({ personal_dtm: "follow", personal_deliberate_tool_mode: "on" }),
      resolvedNickname: "Tester",
      personas: [],
      guildId: "guild-123",
      memoryCount: 0,
      stmCount: 0,
      readStatus: "stale",
      serverTriggerBehavior: { deliberate_trigger_mode: false, deliberate_tool_mode: false },
    });

    const container = payload.components.find(
      (component): component is ContainerComponentData<ComponentInContainerData> =>
        component.type === ComponentType.Container,
    );
    if (!container) throw new Error("Expected the panel container");
    const rows = container.components.filter(
      (c): c is ActionRowData<ButtonComponentData> =>
        c.type === ComponentType.ActionRow &&
        "components" in c &&
        c.components.some(
          (b) =>
            "customId" in b &&
            typeof b.customId === "string" &&
            (b.customId.includes("trigger-mode-set") || b.customId.includes("tool-mode-set")),
        ),
    );

    expect(rows).toHaveLength(2);
    const [dtmRow, toolRow] = rows;

    for (const btn of dtmRow.components) {
      expect(btn.disabled).toBe(true);
    }
    expect(dtmRow.components[0].style).toBe(ButtonStyle.Secondary);
    expect(dtmRow.components[1].style).toBe(ButtonStyle.Primary);
    expect(dtmRow.components[2].style).toBe(ButtonStyle.Secondary);

    for (const btn of toolRow.components) {
      expect(btn.disabled).toBe(true);
    }
    expect(toolRow.components[0].style).toBe(ButtonStyle.Secondary);
    expect(toolRow.components[1].style).toBe(ButtonStyle.Secondary);
    expect(toolRow.components[2].style).toBe(ButtonStyle.Primary);
  });

  it("renders Profile General and Persona with section descriptions and precise fallback wording (never bare Inherited)", () => {
    const generalPayload = buildPersonalConfigPanelPayload({
      locale: "en-US",
      category: "profile",
      page: "general",
      user: makeUser({ prefix_override: null, suffix_override: null }),
      resolvedNickname: "Tester",
      personas: [],
      guildId: "guild-123",
      memoryCount: 0,
      stmCount: 0,
      readStatus: "fresh",
    });
    const generalJson = JSON.stringify(generalPayload);
    expect(generalJson).toContain("**Interface**\\nHow I talk to you and what time I think you are in");
    expect(generalJson).toContain("**Naming**\\nWhat I call you, across every server");
    expect(generalJson).toContain("**About You**\\nHow I refer to you when I talk about you");
    expect(generalJson).toContain("> Prefix: Persona default (unset)");
    expect(generalJson).toContain("> Suffix: Persona default (unset)");
    expect(generalJson).not.toContain("Inherited");

    const personaPayload = buildPersonalConfigPanelPayload({
      locale: "en-US",
      category: "profile",
      page: "persona",
      user: makeUser(),
      resolvedNickname: "Tester",
      personas: [makePersona(1, 10, "Tomori")],
      guildId: "guild-123",
      memoryCount: 0,
      stmCount: 0,
      readStatus: "fresh",
      selectedPersonaAvatarUrl: "https://cdn.example.invalid/persona.png",
      personaNamingPreference: null,
    });
    const personaJson = JSON.stringify(personaPayload);
    expect(personaJson).toContain("https://cdn.example.invalid/persona.png");
    expect(personaJson).toContain("> Nickname override: Global profile or persona default");
    expect(personaJson).toContain("> Prefix override: Global profile or persona default");
    expect(personaJson).toContain("> Suffix override: Global profile or persona default");
    expect(personaJson).not.toContain("Inherited");

    const personaComponents = (JSON.parse(personaJson).components[0].components ?? []) as unknown[];
    const pageSelectorIndex = personaComponents.findIndex((component) =>
      JSON.stringify(component).includes("personal-config:v2:page:"),
    );
    const personaSelectorIndex = personaComponents.findIndex((component) =>
      JSON.stringify(component).includes("personal-config:v2:persona-select:"),
    );
    const personaHeadingIndex = personaComponents.findIndex((component) =>
      JSON.stringify(component).includes("Persona Naming"),
    );
    expect(pageSelectorIndex).toBeLessThan(personaSelectorIndex);
    expect(personaSelectorIndex).toBeLessThan(personaHeadingIndex);
  });

  it("renders Privacy with clean Your Data spacing and separated Cross-Server STM section", () => {
    const privacyPayload = buildPersonalConfigPanelPayload({
      locale: "en-US",
      category: "privacy",
      page: "controls",
      user: makeUser({ shortterm_cache_crossserver_opt_in: false }),
      resolvedNickname: "Tester",
      personas: [],
      guildId: "guild-123",
      memoryCount: 5,
      stmCount: 0,
      readStatus: "fresh",
    });
    const privacyJson = JSON.stringify(privacyPayload);
    // Section headers
    expect(privacyJson).toContain("**Your Data**");
    expect(privacyJson).toContain("**Cross-Server [STM](");
    // Cross-server STM section footer
    expect(privacyJson).toContain("-# `/personal memories` always persist across servers, but not STM");
    // State control buttons and effect quote
    expect(privacyJson).toContain("personal-config:v2:crossserver-set:en-US:off");
    expect(privacyJson).toContain("personal-config:v2:crossserver-set:en-US:on");
    expect(privacyJson).toContain("> I cannot remember recent conversations with you");
  });

  it("keeps Server Default actionable when a capability has no eligible providers", () => {
    const modelsPayload = buildPersonalConfigPanelPayload({
      locale: "en-US",
      category: "models",
      page: "switch",
      user: makeUser(),
      resolvedNickname: "Tester",
      personas: [],
      guildId: "guild-123",
      memoryCount: 0,
      stmCount: 0,
      readStatus: "fresh",
      modelDisplayInfo: {
        routingRows: {
          text: {
            capability: "text",
            activeModelName: "Claude 3.5 Sonnet",
            storedProvider: "openrouter",
            storedModelName: "Claude 3.5 Sonnet",
          },
          vision: { capability: "vision", activeModelName: null, storedProvider: null, storedModelName: null },
          embedding: { capability: "embedding", activeModelName: null, storedProvider: null, storedModelName: null },
          image: { capability: "image", activeModelName: null, storedProvider: null, storedModelName: null },
          image_nai: { capability: "image_nai", activeModelName: null, storedProvider: null, storedModelName: null },
          video: { capability: "video", activeModelName: null, storedProvider: null, storedModelName: null },
        },
        availableCapabilities: ["text", "vision", "embedding", "image", "image_nai", "video"],
        eligibleProvidersForCapability: {
          text: ["openrouter"],
          vision: [],
          embedding: [],
          image: [],
          image_nai: [],
          video: [],
        },
        parametersProviders: [],
        fallbacksProviders: [],
        primaryModelName: "Claude 3.5 Sonnet",
        fallbackSlots: [],
        randomizerEnabled: false,
        canEnableRandomizer: false,
      },
    });
    const components = collectComponents(modelsPayload);
    const visionControl = components.find((component) => component.customId?.endsWith(":vision"));
    expect(visionControl?.disabled).toBe(false);
    expect(visionControl?.options?.map((option) => option.value)).toEqual(["__server_default__"]);
    expect(visionControl?.placeholder).toBe("Vision: Using Server Default");
  });

  it("handles spotlight removal and records telemetry on success", async () => {
    const calls: string[] = [];
    const activeSpotlights = [makeSpotlight("123456789012345678", { personaIds: [1] })];
    const { dependencies, telemetry } = makeDependencies(calls, {
      loadActiveSpotlights: async () => activeSpotlights,
    });
    const route = createPersonalConfigInteractionRoute(dependencies);
    const fp = computeSpotlightRemoveFingerprint("guild-123", "user-123", activeSpotlights);
    const customId = buildPersonalConfigRouteId({
      action: "spotlight-remove-submit",
      locale: "en-US",
      start: 0,
      fp,
      nonce: "nonce123456",
    });

    const interaction = makePersonalInteraction({
      kind: "modal",
      customId,
    });

    await route.execute({} as Client, interaction, requireRoute(customId));

    expect(calls).toContain("removeSpotlights:123456789012345678");
    expect(telemetry).toContain("personal-config.personal.spotlight.remove");
  });
});

describe("Stable spotlight identity and destructive safety", () => {
  it("detects persona inserted before selected position and fails stale with zero writes or telemetry", async () => {
    const calls: string[] = [];
    const initialPersonas = [
      { id: 1, name: "Tomori", isAlter: false },
      { id: 2, name: "Anon", isAlter: false },
    ];
    const fp = computeSpotlightSetFingerprint("guild-123", "user-123", initialPersonas);
    const customId = buildPersonalConfigRouteId({
      action: "spot-set-cf",
      locale: "en-US",
      channelId: "123456789012345678",
      hours: 0,
      autoIdx: 0,
      blockIdx: 0,
      mask: "2",
      fp,
      nonce: "nonce123456",
    });

    const driftedPersonas = [
      { id: 99, name: "NewPersona", isAlter: false },
      { id: 1, name: "Tomori", isAlter: false },
      { id: 2, name: "Anon", isAlter: false },
    ];

    const { dependencies, telemetry } = makeDependencies(calls, {
      loadGuildPersonas: async () => driftedPersonas,
    });
    const route = createPersonalConfigInteractionRoute(dependencies);

    const interaction = makePersonalInteraction({
      customId,
      channelCache: makeChannelCache(["123456789012345678"]),
    });

    await route.execute({} as Client, interaction, requireRoute(customId));

    expect(calls.filter((c) => c.startsWith("setSpotlight"))).toHaveLength(0);
    expect(telemetry).not.toContain("personal-config.personal.spotlight.set");
    expect(JSON.stringify(interaction.edits.at(-1))).toContain(
      localizedCopy("en-US", "commands.personal.config.unavailable"),
    );
  });

  it("detects persona deleted before selected position and fails stale with zero writes or telemetry", async () => {
    const calls: string[] = [];
    const initialPersonas = [
      { id: 1, name: "Tomori", isAlter: false },
      { id: 2, name: "Anon", isAlter: false },
      { id: 3, name: "Soy", isAlter: false },
    ];
    const fp = computeSpotlightSetFingerprint("guild-123", "user-123", initialPersonas);
    const customId = buildPersonalConfigRouteId({
      action: "spot-set-cf",
      locale: "en-US",
      channelId: "123456789012345678",
      hours: 0,
      autoIdx: 0,
      blockIdx: 0,
      mask: "4",
      fp,
      nonce: "nonce123456",
    });

    const driftedPersonas = [
      { id: 2, name: "Anon", isAlter: false },
      { id: 3, name: "Soy", isAlter: false },
    ];

    const { dependencies, telemetry } = makeDependencies(calls, {
      loadGuildPersonas: async () => driftedPersonas,
    });
    const route = createPersonalConfigInteractionRoute(dependencies);

    const interaction = makePersonalInteraction({
      customId,
      channelCache: makeChannelCache(["123456789012345678"]),
    });

    await route.execute({} as Client, interaction, requireRoute(customId));

    expect(calls.filter((c) => c.startsWith("setSpotlight"))).toHaveLength(0);
    expect(telemetry).not.toContain("personal-config.personal.spotlight.set");
    expect(JSON.stringify(interaction.edits.at(-1))).toContain(
      localizedCopy("en-US", "commands.personal.config.unavailable"),
    );
  });

  it("fails stale on spotlight-set-submit when personas drift before modal submit", async () => {
    const calls: string[] = [];
    const initialPersonas = [
      { id: 1, name: "Tomori", isAlter: false },
      { id: 2, name: "Anon", isAlter: false },
    ];
    const fp = computeSpotlightSetFingerprint("guild-123", "user-123", initialPersonas);
    const customId = buildPersonalConfigRouteId({
      action: "spotlight-set-submit",
      locale: "en-US",
      channelId: "123456789012345678",
      hours: 0,
      blockIdx: 0,
      fp,
      nonce: "nonce123456",
    });

    const driftedPersonas = [
      { id: 99, name: "New", isAlter: false },
      { id: 1, name: "Tomori", isAlter: false },
      { id: 2, name: "Anon", isAlter: false },
    ];

    const { dependencies, telemetry } = makeDependencies(calls, {
      loadGuildPersonas: async () => driftedPersonas,
    });
    const route = createPersonalConfigInteractionRoute(dependencies);

    const interaction = makePersonalInteraction({
      kind: "modal",
      customId,
    });

    const modalsModule = await import("@/utils/discord/ui/modals");
    const takeSpy = spyOn(modalsModule, "takeRawModalSelectValue").mockReturnValue("123456789012345678");

    await route.execute({} as Client, interaction, requireRoute(customId));

    takeSpy.mockRestore();

    expect(calls.filter((c) => c.startsWith("setSpotlight"))).toHaveLength(0);
    expect(telemetry).not.toContain("personal-config.personal.spotlight.set");
    expect(JSON.stringify(interaction.edits.at(-1))).toContain(
      localizedCopy("en-US", "commands.personal.config.unavailable"),
    );
  });

  it("fails stale on spot-set-auto button click when personas drift", async () => {
    const initialPersonas = [
      { id: 1, name: "Tomori", isAlter: false },
      { id: 2, name: "Anon", isAlter: false },
    ];
    const fp = computeSpotlightSetFingerprint("guild-123", "user-123", initialPersonas);
    const customId = buildPersonalConfigRouteId({
      action: "spot-set-auto",
      locale: "en-US",
      channelId: "123456789012345678",
      hours: 0,
      blockIdx: 0,
      mask: "3",
      fp,
      nonce: "nonce123456",
    });

    let modalCalled = false;
    const { dependencies } = makeDependencies([], {
      loadGuildPersonas: async () => [{ id: 99, name: "Drifted", isAlter: false }, ...initialPersonas],
      showSpotlightAutoTriggerModal: async () => {
        modalCalled = true;
      },
    });
    const route = createPersonalConfigInteractionRoute(dependencies);

    const interaction = makePersonalInteraction({
      customId,
    });

    await route.execute({} as Client, interaction, requireRoute(customId));

    expect(modalCalled).toBe(false);
    expect(JSON.stringify(interaction.replies.at(-1))).toContain(
      localizedCopy("en-US", "commands.personal.config.stale_warning"),
    );
  });

  it("fails stale on spot-set-auto-sub modal submission when personas drift", async () => {
    const initialPersonas = [
      { id: 1, name: "Tomori", isAlter: false },
      { id: 2, name: "Anon", isAlter: false },
    ];
    const fp = computeSpotlightSetFingerprint("guild-123", "user-123", initialPersonas);
    const customId = buildPersonalConfigRouteId({
      action: "spot-set-auto-sub",
      locale: "en-US",
      channelId: "123456789012345678",
      hours: 0,
      blockIdx: 0,
      mask: "3",
      fp,
      nonce: "nonce123456",
    });

    const { dependencies } = makeDependencies([], {
      loadGuildPersonas: async () => [{ id: 99, name: "Drifted", isAlter: false }, ...initialPersonas],
    });
    const route = createPersonalConfigInteractionRoute(dependencies);

    const interaction = makePersonalInteraction({
      kind: "modal",
      customId,
    });

    await route.execute({} as Client, interaction, requireRoute(customId));

    expect(JSON.stringify(interaction.edits.at(-1))).toContain(
      localizedCopy("en-US", "commands.personal.config.unavailable"),
    );
  });

  it("detects presented spotlight inserted, deleted, or expired between modal render and submit", async () => {
    const calls: string[] = [];
    const initialSpotlights = [
      makeSpotlight("123456789012345678", { personaIds: [1] }),
      makeSpotlight("987654321098765432", { personaIds: [2] }),
    ];
    const fp = computeSpotlightRemoveFingerprint("guild-123", "user-123", initialSpotlights);
    const customId = buildPersonalConfigRouteId({
      action: "spotlight-remove-submit",
      locale: "en-US",
      start: 0,
      fp,
      nonce: "nonce123456",
    });

    const insertedSpotlights = [...initialSpotlights, makeSpotlight("111222333444555666", { personaIds: [1] })];
    const { dependencies: depInserted, telemetry: telInserted } = makeDependencies(calls, {
      loadActiveSpotlights: async () => insertedSpotlights,
    });
    const routeInserted = createPersonalConfigInteractionRoute(depInserted);

    const interactionA = makePersonalInteraction({
      kind: "modal",
      customId,
      overrides: { id: "modal-drift-a" },
    });

    await routeInserted.execute({} as Client, interactionA, requireRoute(customId));

    expect(calls.filter((c) => c.startsWith("removeSpotlights"))).toHaveLength(0);
    expect(telInserted).not.toContain("personal-config.personal.spotlight.remove");
    expect(JSON.stringify(interactionA.edits.at(-1))).toContain(
      localizedCopy("en-US", "commands.personal.config.unavailable"),
    );

    const expiredSpotlights = [initialSpotlights[1]];
    const { dependencies: depExpired, telemetry: telExpired } = makeDependencies(calls, {
      loadActiveSpotlights: async () => expiredSpotlights,
    });
    const routeExpired = createPersonalConfigInteractionRoute(depExpired);

    const interactionB = makePersonalInteraction({
      kind: "modal",
      customId,
      overrides: { id: "modal-drift-b" },
    });

    await routeExpired.execute({} as Client, interactionB, requireRoute(customId));

    expect(calls.filter((c) => c.startsWith("removeSpotlights"))).toHaveLength(0);
    expect(telExpired).not.toContain("personal-config.personal.spotlight.remove");
    expect(JSON.stringify(interactionB.edits.at(-1))).toContain(
      localizedCopy("en-US", "commands.personal.config.unavailable"),
    );
  });

  it("fails stale on spot-rem-range button click when active spotlights drift", async () => {
    const initialSpotlights = [makeSpotlight("123456789012345678", { personaIds: [1] })];
    const fp = computeSpotlightRemoveFingerprint("guild-123", "user-123", initialSpotlights);
    const customId = buildPersonalConfigRouteId({ action: "spot-rem-range", locale: "en-US", start: 0, fp });

    let modalCalled = false;
    const { dependencies } = makeDependencies([], {
      loadActiveSpotlights: async () => [],
      showSpotlightRemoveModal: async () => {
        modalCalled = true;
      },
    });
    const route = createPersonalConfigInteractionRoute(dependencies);

    const interaction = makePersonalInteraction({
      customId,
    });

    await route.execute({} as Client, interaction, requireRoute(customId));

    expect(modalCalled).toBe(false);
    expect(JSON.stringify(interaction.replies.at(-1))).toContain(
      localizedCopy("en-US", "commands.personal.config.stale_warning"),
    );
  });

  it("executes a newly constructed route from transported fingerprint without setup or snapshot state", async () => {
    const calls: string[] = [];
    const activeSpotlights = [makeSpotlight("123456789012345678", { personaIds: [1] })];
    const fp = computeSpotlightRemoveFingerprint("guild-123", "user-123", activeSpotlights);
    const customId = buildPersonalConfigRouteId({
      action: "spotlight-remove-submit",
      locale: "en-US",
      start: 0,
      fp,
      nonce: "nonce123456",
    });

    const { dependencies, telemetry } = makeDependencies(calls, {
      loadActiveSpotlights: async () => activeSpotlights,
    });
    const freshRoute = createPersonalConfigInteractionRoute(dependencies);

    const interaction = makePersonalInteraction({
      kind: "modal",
      customId,
      overrides: { id: "modal-restart" },
    });

    await freshRoute.execute({} as Client, interaction, requireRoute(customId));

    expect(calls).toContain("removeSpotlights:123456789012345678");
    expect(telemetry).toContain("personal-config.personal.spotlight.remove");
  });

  it("rejects token replay by another actor or workspace", async () => {
    const calls: string[] = [];
    const personas = [{ id: 1 }, { id: 2 }];
    const validFp = computeSpotlightSetFingerprint("guild-123", "user-123", personas);
    const customId = buildPersonalConfigRouteId({
      action: "spot-set-cf",
      locale: "en-US",
      channelId: "123456789012345678",
      hours: 0,
      autoIdx: 0,
      blockIdx: 0,
      mask: "1",
      fp: validFp,
      nonce: "nonce123456",
    });

    const actorInteraction = makePersonalInteraction({
      customId,
      channelCache: makeChannelCache(["123456789012345678"]),
      overrides: { user: { id: "user-999", username: "attacker", displayName: "Attacker", globalName: "Attacker" } },
    });

    const { dependencies: depActor, telemetry: telActor } = makeDependencies(calls, {
      resolveScope: async () => ({
        userId: 999,
        userDiscId: "user-999",
        guildId: "guild-123",
        workspaceId: "guild-123",
        internalServerId: 42,
        user: makeUser({ user_id: 999, user_disc_id: "user-999" }),
        resolvedNickname: "Attacker",
        personas: [makePersona(1, 10, "Tomori"), makePersona(2, 20, "Anon")],
        readStatus: "fresh",
      }),
    });
    const routeActor = createPersonalConfigInteractionRoute(depActor);

    await routeActor.execute({} as Client, actorInteraction, requireRoute(customId));

    expect(calls.filter((c) => c.startsWith("setSpotlight"))).toHaveLength(0);
    expect(telActor).not.toContain("personal-config.personal.spotlight.set");
    expect(JSON.stringify(actorInteraction.edits.at(-1))).toContain(
      localizedCopy("en-US", "commands.personal.config.unavailable"),
    );

    const guildInteraction = makePersonalInteraction({
      customId,
      guildId: "guild-999",
      channelCache: makeChannelCache(["123456789012345678"]),
    });

    const { dependencies: depGuild, telemetry: telGuild } = makeDependencies(calls, {
      resolveScope: async () => ({
        userId: 1,
        userDiscId: "user-123",
        guildId: "guild-999",
        workspaceId: "guild-999",
        internalServerId: 99,
        user: makeUser(),
        resolvedNickname: "Tester",
        personas: [makePersona(1, 10, "Tomori"), makePersona(2, 20, "Anon")],
        readStatus: "fresh",
      }),
    });
    const routeGuild = createPersonalConfigInteractionRoute(depGuild);

    await routeGuild.execute({} as Client, guildInteraction, requireRoute(customId));

    expect(calls.filter((c) => c.startsWith("setSpotlight"))).toHaveLength(0);
    expect(telGuild).not.toContain("personal-config.personal.spotlight.set");
    expect(JSON.stringify(guildInteraction.edits.at(-1))).toContain(
      localizedCopy("en-US", "commands.personal.config.unavailable"),
    );
  });

  it("fails stale on old v1 controls through real global router with no mutation", async () => {
    const v1Interaction = makePersonalInteraction({
      customId: "personal-config:v1:spot-set-cf:en-US:123456789012345678:12:1:1:nonce123456",
    });

    const replaceSpy = spyOn(userRepository, "replacePersonalSpotlight").mockImplementation(async () => {});
    const removeSpy = spyOn(userRepository, "removePersonalSpotlight").mockImplementation(async () => true);

    const handled = await dispatchGlobalInteraction({} as Client, v1Interaction);

    expect(handled).toBe(true);
    expect(replaceSpy).not.toHaveBeenCalled();
    expect(removeSpy).not.toHaveBeenCalled();
    expect(JSON.stringify(v1Interaction.replies.at(-1))).toContain("/personal config");

    replaceSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it("attempts all selected channels on partial failure and surfaces partial status without success telemetry", async () => {
    const remSpy = spyOn(userRepository, "removePersonalSpotlight").mockImplementation(async (_srvId, _usrId, chId) => {
      return chId !== "ch-200";
    });

    const result = await personalConfigOperations.removeSpotlights({
      serverId: 42,
      userId: 1,
      userDiscId: "user-123",
      channelIds: ["ch-100", "ch-200", "ch-300"],
    });

    expect(result).toEqual({
      status: "partial-failure",
      removedCount: 2,
      failedCount: 1,
    });
    expect(remSpy).toHaveBeenCalledTimes(3);
    remSpy.mockRestore();

    const calls: string[] = [];
    const activeSpotlights = [
      makeSpotlight("ch-100", { personaIds: [1] }),
      makeSpotlight("ch-200", { personaIds: [1] }),
    ];
    const fp = computeSpotlightRemoveFingerprint("guild-123", "user-123", activeSpotlights);
    const customId = buildPersonalConfigRouteId({
      action: "spotlight-remove-submit",
      locale: "en-US",
      start: 0,
      fp,
      nonce: "nonce123456",
    });

    const { dependencies, telemetry } = makeDependencies(calls, {
      loadActiveSpotlights: async () => activeSpotlights,
      operations: {
        ...personalConfigOperations,
        removeSpotlights: async () => ({
          status: "partial-failure",
          removedCount: 1,
          failedCount: 1,
        }),
      },
    });
    const route = createPersonalConfigInteractionRoute(dependencies);

    const interaction = makePersonalInteraction({
      kind: "modal",
      customId,
      overrides: { id: "modal-partial" },
    });

    await route.execute({} as Client, interaction, requireRoute(customId));

    expect(telemetry).not.toContain("personal-config.personal.spotlight.remove");
    expect(JSON.stringify(interaction.edits.at(-1))).toContain(
      localizedCopy("en-US", "commands.personal.config.spotlight_partial_removal_heading"),
    );
  });

  it("asserts raw numeric component types across all touched spotlight modals", () => {
    const setModal = buildSpotlightSetModal("en-US", "nonce123456", "123456789012345678", 0, 0, "a1b2c3d4", [
      { id: 1, name: "Tomori", isAlter: false },
      { id: 2, name: "Anon", isAlter: false },
    ]);
    const step1Modal = buildSpotlightStep1Modal("en-US", "nonce123456");
    const autoModal = buildSpotlightAutoTriggerModal(
      "en-US",
      "nonce123456",
      "123456789012345678",
      12,
      0,
      "3",
      "a1b2c3d4",
      [{ id: 1, name: "Tomori", isAlter: false }],
    );
    const removeModal = buildSpotlightRemoveModal(
      "en-US",
      "nonce123456",
      0,
      "a1b2c3d4",
      [makeSpotlight("123456789012345678", { personaIds: [1] })],
      [{ id: 1, name: "Tomori", isAlter: false }],
      new Map([["123456789012345678", { name: "general" }]]),
    );

    const channelComp = step1Modal.components.find((c) => c.component?.custom_id?.startsWith("channel_"));
    expect(channelComp?.component?.type).toBe(8);

    const hoursComp = step1Modal.components.find((c) => c.component?.custom_id?.startsWith("hours_"));
    expect(hoursComp?.component?.type).toBe(4);

    // Splitting channel and duration out is what frees all five modal components for personas.
    expect(setModal.components.every((c) => c.component?.type === 22)).toBe(true);

    const personaGroup = setModal.components.find((c) => c.component?.custom_id?.startsWith("personas_"));
    expect(personaGroup?.component?.type).toBe(22);

    // A persona catalog is a dropdown. This assertion previously pinned 21 (RadioGroup), which
    // type-checks, renders nothing locally, and 400s in Discord past ten options.
    const autoComp = autoModal.components.find((c) => c.component?.custom_id?.startsWith("auto_trigger_"));
    expect(autoComp?.component?.type).toBe(3);

    const removeGroup = removeModal.components.find((c) => c.component?.custom_id?.startsWith("spotlights_"));
    expect(removeGroup?.component?.type).toBe(22);

    for (const modal of [step1Modal, setModal, autoModal, removeModal]) {
      for (const row of modal.components) {
        expect(row.type).toBe(18);
      }
    }
  });

  it("guarantees worst-case custom ID length stays <= 100 characters for Spotlight v2 routes and round-trips to semantic actions", () => {
    const locale = "en-US";
    const snowflake = "12345678901234567890";
    const hours = 999999;
    const personaId = 2147483647;
    const nonce = "nonce1234567";
    const fp = "a1b2c3d4";
    const mask = ((1n << BigInt(50)) - 1n).toString(36);
    const removeStart = 999950;

    const setModal = buildSpotlightSetModal(locale, nonce, snowflake, hours, 999, fp, [
      { id: personaId, name: "Tomori", isAlter: false },
    ]);
    const autoModal = buildSpotlightAutoTriggerModal(locale, nonce, snowflake, hours, 999, mask, fp, [
      { id: personaId, name: "Tomori", isAlter: false },
    ]);
    const removeModal = buildSpotlightRemoveModal(
      locale,
      nonce,
      removeStart,
      fp,
      [makeSpotlight(snowflake, { personaIds: [personaId] })],
      [{ id: personaId, name: "Tomori", isAlter: false }],
      new Map([[snowflake, { name: "general" }]]),
    );

    const reviewPayload = buildPersonalConfigPanelPayload({
      locale,
      category: "advanced",
      page: "spotlight",
      user: makeUser(),
      resolvedNickname: "Tester",
      personas: [],
      guildId: snowflake,
      memoryCount: 0,
      stmCount: 0,
      readStatus: "fresh",
      spotlightDisplayInfo: {
        activeSpotlights: [],
        personas: [{ id: personaId, name: "Tomori", isAlter: false }],
      },
      view: {
        kind: "spotlight-set-review",
        channelId: snowflake,
        hours,
        blockIdx: 999,
        selectedPersonaIds: [personaId],
        autoTriggerPersonaId: personaId,
        autoIdx: 50,
        mask,
        fp,
        nonce,
      },
    });
    const rangePayload = buildPersonalConfigPanelPayload({
      locale,
      category: "advanced",
      page: "spotlight",
      user: makeUser(),
      resolvedNickname: "Tester",
      personas: [],
      guildId: snowflake,
      memoryCount: 0,
      stmCount: 0,
      readStatus: "fresh",
      spotlightDisplayInfo: {
        activeSpotlights: [],
        personas: [{ id: personaId, name: "Tomori", isAlter: false }],
      },
      view: {
        kind: "spotlight-remove-range",
        rangePage: 5,
        totalOptions: 2_000_000,
        fp,
      },
    });
    const autoRangePayload = buildPersonalConfigPanelPayload({
      locale,
      category: "advanced",
      page: "spotlight",
      user: makeUser(),
      resolvedNickname: "Tester",
      personas: [],
      guildId: snowflake,
      memoryCount: 0,
      stmCount: 0,
      readStatus: "fresh",
      spotlightDisplayInfo: {
        activeSpotlights: [],
        personas: [{ id: personaId, name: "Tomori", isAlter: false }],
      },
      view: {
        kind: "spotlight-auto-range",
        channelId: snowflake,
        hours,
        blockIdx: 999,
        mask,
        fp,
        rangePage: 1,
        totalOptions: 700,
      },
    });

    const producedCustomIds = [
      ...JSON.stringify([reviewPayload, rangePayload, autoRangePayload]).matchAll(/"customId":"([^"]+)"/g),
    ].map((match) => match[1]);

    const producedRoute = (action: string) => {
      const customId = producedCustomIds.find((candidate) => {
        const parsed = parseInteractionRoute(candidate);
        return parsed ? parsePersonalConfigPanelRoute(parsed)?.action === action : false;
      });
      if (!customId) throw new Error(`Missing produced Spotlight route for ${action}`);
      return customId;
    };

    const testCases: Array<{
      customId: string;
      expected: ReturnType<typeof parsePersonalConfigPanelRoute>;
    }> = [
      {
        customId: setModal.custom_id,
        expected: { action: "spotlight-set-submit", locale, channelId: snowflake, hours, blockIdx: 999, fp, nonce },
      },
      {
        customId: producedRoute("spot-set-cf"),
        expected: {
          action: "spot-set-cf",
          locale,
          channelId: snowflake,
          hours,
          autoIdx: 50,
          blockIdx: 999,
          mask,
          fp,
          nonce,
        },
      },
      {
        customId: producedRoute("spot-set-auto"),
        expected: { action: "spot-set-auto", locale, channelId: snowflake, hours, blockIdx: 999, mask, fp, nonce },
      },
      {
        customId: autoModal.custom_id,
        expected: { action: "spot-set-auto-sub", locale, channelId: snowflake, hours, blockIdx: 999, mask, fp, nonce },
      },
      {
        customId: producedRoute("spotlight-remove-select"),
        expected: { action: "spotlight-remove-select", locale, fp },
      },
      {
        customId: removeModal.custom_id,
        expected: { action: "spotlight-remove-submit", locale, start: removeStart, fp, nonce },
      },
      {
        customId: producedRoute("spotlight-remove-page"),
        expected: { action: "spotlight-remove-page", locale, chooserPage: 4, fp },
      },
      {
        customId: producedRoute("spot-set-auto-select"),
        expected: {
          action: "spot-set-auto-select",
          locale,
          channelId: snowflake,
          hours,
          blockIdx: 999,
          mask,
          fp,
        },
      },
      {
        customId: producedRoute("spot-set-auto-page"),
        expected: {
          action: "spot-set-auto-page",
          locale,
          channelId: snowflake,
          hours,
          blockIdx: 999,
          mask,
          fp,
          chooserPage: 0,
        },
      },
      {
        customId: producedRoute("spot-set-auto-cancel"),
        expected: {
          action: "spot-set-auto-cancel",
          locale,
          channelId: snowflake,
          hours,
          blockIdx: 999,
          mask,
          fp,
        },
      },
      {
        customId: buildPersonalConfigRouteId({
          action: "model-range-page",
          locale,
          capability: "embedding",
          provider: "fireworks",
          chooserPage: 398,
        }),
        expected: {
          action: "model-range-page",
          locale,
          capability: "embedding",
          provider: "fireworks",
          chooserPage: 398,
        },
      },
      {
        customId: buildPersonalConfigRouteId({
          action: "fallbacks-range-page",
          locale,
          provider: "openrouter",
          chooserPage: 398,
        }),
        expected: {
          action: "fallbacks-range-page",
          locale,
          provider: "openrouter",
          chooserPage: 398,
        },
      },
    ];

    for (const { customId, expected } of testCases) {
      expect(customId.length).toBeLessThanOrEqual(100);
      const parsed = parseInteractionRoute(customId);
      expect(parsed).not.toBeNull();
      if (!parsed) {
        throw new Error(`Failed to parse interaction route for customId: ${customId}`);
      }
      const route = parsePersonalConfigPanelRoute(parsed);
      expect(route).toEqual(expected);
    }
  });

  it("acknowledges interaction before writes on spotlight set and removal paths", async () => {
    const calls: string[] = [];
    const personas = [{ id: 1 }, { id: 2 }];
    const setFp = computeSpotlightSetFingerprint("guild-123", "user-123", personas);
    const setCustomId = buildPersonalConfigRouteId({
      action: "spot-set-cf",
      locale: "en-US",
      channelId: "123456789012345678",
      hours: 0,
      autoIdx: 0,
      blockIdx: 0,
      mask: "1",
      fp: setFp,
      nonce: "nonce123456",
    });

    let acknowledgedDuringSetWrite = false;
    let acknowledgedDuringRemoveWrite = false;

    let setInteraction: PersonalInteraction;
    const { dependencies: depSet } = makeDependencies(calls, {
      operations: {
        ...personalConfigOperations,
        setSpotlight: async () => {
          acknowledgedDuringSetWrite = setInteraction.deferred || setInteraction.replied;
          return { status: "success" };
        },
      },
    });
    const setRoute = createPersonalConfigInteractionRoute(depSet);

    setInteraction = makePersonalInteraction({
      customId: setCustomId,
      channelCache: makeChannelCache(["123456789012345678"]),
    });

    await setRoute.execute({} as Client, setInteraction, requireRoute(setCustomId));
    expect(acknowledgedDuringSetWrite).toBe(true);

    const activeSpotlights = [makeSpotlight("123456789012345678", { personaIds: [1] })];
    const remFp = computeSpotlightRemoveFingerprint("guild-123", "user-123", activeSpotlights);
    const remCustomId = buildPersonalConfigRouteId({
      action: "spotlight-remove-submit",
      locale: "en-US",
      start: 0,
      fp: remFp,
      nonce: "nonce123456",
    });

    let remInteraction: PersonalInteraction;
    const { dependencies: depRem } = makeDependencies(calls, {
      loadActiveSpotlights: async () => activeSpotlights,
      operations: {
        ...personalConfigOperations,
        removeSpotlights: async () => {
          acknowledgedDuringRemoveWrite = remInteraction.deferred || remInteraction.replied;
          return { status: "success", removedCount: 1 };
        },
      },
    });
    const remRoute = createPersonalConfigInteractionRoute(depRem);

    remInteraction = makePersonalInteraction({
      kind: "modal",
      customId: remCustomId,
      overrides: { id: "modal-ack" },
    });

    await remRoute.execute({} as Client, remInteraction, requireRoute(remCustomId));
    expect(acknowledgedDuringRemoveWrite).toBe(true);
  });
});

describe("Personal Spotlight auto-trigger and range chooser", () => {
  it("assigns single selected persona directly as auto-trigger without modal", async () => {
    let modalOpened = false;
    const persona = { id: 10, name: "Tomori", isAlter: false };
    const fp = computeSpotlightSetFingerprint("guild-123", "user-123", [persona]);
    const mask = "1";

    const { dependencies } = makeDependencies([], {
      loadGuildPersonas: async () => [persona],
      showSpotlightAutoTriggerModal: async () => {
        modalOpened = true;
      },
    });

    const route = createPersonalConfigInteractionRoute(dependencies);
    const customId = buildPersonalConfigRouteId({
      action: "spot-set-auto",
      locale: "en-US",
      channelId: "123456789012345678",
      hours: 0,
      blockIdx: 0,
      mask,
      fp,
      nonce: "nonce123456",
    });

    const interaction = makePersonalInteraction({
      customId,
    });

    await route.execute({} as Client, interaction, requireRoute(customId));

    expect(interaction.deferred).toBe(true);
    expect(modalOpened).toBe(false);
    const json = JSON.stringify(interaction.edits.at(-1));
    expect(json).toContain("Auto-trigger: Tomori");
  });

  it("renders range chooser when >24 personas are selected and opens sliced modal on range click", async () => {
    const personas = Array.from({ length: 30 }, (_, i) => ({
      id: 100 + i,
      name: `Persona ${i + 1}`,
      isAlter: false,
    }));
    const fp = computeSpotlightSetFingerprint("guild-123", "user-123", personas);
    // Every one of the thirty personas selected, in the single block they occupy.
    const mask = ((1n << BigInt(personas.length)) - 1n).toString(36);

    let modalOpenedWith: Array<{ id: number; name: string }> = [];

    const { dependencies } = makeDependencies([], {
      loadGuildPersonas: async () => personas,
      showSpotlightAutoTriggerModal: async (_interaction, _locale, _nonce, _ch, _h, _blk, _m, _fp, selected) => {
        modalOpenedWith = selected;
      },
    });

    const route = createPersonalConfigInteractionRoute(dependencies);

    const autoCustomId = buildPersonalConfigRouteId({
      action: "spot-set-auto",
      locale: "en-US",
      channelId: "123456789012345678",
      hours: 0,
      blockIdx: 0,
      mask,
      fp,
      nonce: "nonce123456",
    });

    const autoInteraction = makePersonalInteraction({
      customId: autoCustomId,
    });

    await route.execute({} as Client, autoInteraction, requireRoute(autoCustomId));

    expect(autoInteraction.deferred).toBe(true);
    expect(modalOpenedWith).toHaveLength(0);
    const json = JSON.stringify(autoInteraction.edits.at(-1));
    expect(json).toContain("1-24");
    expect(json).toContain("25-30");

    const rangeCustomId = buildPersonalConfigRouteId({
      action: "spot-set-auto-range",
      locale: "en-US",
      channelId: "123456789012345678",
      hours: 0,
      blockIdx: 0,
      mask,
      fp,
      start: 24,
    });

    const rangeInteraction = makePersonalInteraction({
      customId: rangeCustomId,
    });

    await route.execute({} as Client, rangeInteraction, requireRoute(rangeCustomId));

    expect(modalOpenedWith).toHaveLength(6);
    expect(modalOpenedWith[0].id).toBe(124);
    expect(modalOpenedWith[5].id).toBe(129);
  });

  it("lands the retained model and fallback chooser routes on the expanded page selector", async () => {
    const models = Array.from({ length: 150 }, (_, i) => ({
      id: 200 + i,
      name: `Model ${i + 1}`,
    }));
    const fallbackOptions = Array.from({ length: 150 }, (_, i) => ({
      refKey: `llm:${200 + i}`,
      label: `Model ${i + 1}`,
    }));

    const { dependencies } = makeDependencies([], {
      loadAvailableModelsForCapability: async () => models,
    });
    const loaders = await import("@/utils/discord/interactions/personalConfigLoaders");
    const fallbackLoaderSpy = spyOn(loaders, "loadFallbackSelectionOptions").mockResolvedValue(fallbackOptions);

    const route = createPersonalConfigInteractionRoute(dependencies);

    const modelPageCustomId = buildPersonalConfigRouteId({
      action: "model-range-page",
      locale: "en-US",
      capability: "text",
      provider: "openrouter",
      chooserPage: 5,
    });

    const modelInteraction = makePersonalInteraction({
      customId: modelPageCustomId,
    });

    try {
      await route.execute({} as Client, modelInteraction, requireRoute(modelPageCustomId));
      const modelJson = JSON.stringify(modelInteraction.edits.at(-1));
      expect(modelJson).toContain(localizedCopy("en-US", "commands.personal.config.models_title"));
      const modelComponents = collectComponents(modelInteraction.edits.at(-1));
      const modelSelect = modelComponents.find((c) => c.customId?.includes(":model-provider-select:en-US:text"));
      expect(modelSelect?.options?.map((option) => option.label)).toEqual([
        "Using Server Default",
        "OpenRouter (page 1)",
        "OpenRouter (page 2)",
        "OpenRouter (page 3)",
        "OpenRouter (page 4)",
        "OpenRouter (page 5)",
        "OpenRouter (page 6)",
      ]);

      const fallbackPageCustomId = buildPersonalConfigRouteId({
        action: "fallbacks-range-page",
        locale: "en-US",
        provider: "openrouter",
        chooserPage: 5,
      });

      const fallbackInteraction = makePersonalInteraction({
        customId: fallbackPageCustomId,
      });

      await route.execute({} as Client, fallbackInteraction, requireRoute(fallbackPageCustomId));
      const fallbackJson = JSON.stringify(fallbackInteraction.edits.at(-1));
      expect(fallbackJson).toContain(localizedCopy("en-US", "commands.personal.config.fallbacks_title"));
      const fallbackComponents = collectComponents(fallbackInteraction.edits.at(-1));
      const fallbackSelect = fallbackComponents.find((c) => c.customId?.includes(":fallbacks-provider-select:en-US"));
      expect(fallbackSelect?.options).toHaveLength(7);
      expect(fallbackSelect?.options?.at(-1)?.label).toBe("OpenRouter (page 7)");
    } finally {
      fallbackLoaderSpy.mockRestore();
    }
  });

  it("navigates spotlight remove range page past 25 blocks (1250 spotlights)", async () => {
    const activeSpotlights = Array.from({ length: 1500 }, (_, i) =>
      makeSpotlight(`1234567890123456${(i % 100).toString().padStart(2, "0")}`, { personaIds: [1] }),
    );
    const fp = computeSpotlightRemoveFingerprint("guild-123", "user-123", activeSpotlights);

    const { dependencies } = makeDependencies([], {
      loadActiveSpotlights: async () => activeSpotlights,
    });

    const route = createPersonalConfigInteractionRoute(dependencies);
    const removePageCustomId = buildPersonalConfigRouteId({
      action: "spotlight-remove-page",
      locale: "en-US",
      chooserPage: 1,
      fp,
    });

    const interaction = makePersonalInteraction({
      customId: removePageCustomId,
    });

    await route.execute({} as Client, interaction, requireRoute(removePageCustomId));
    const json = JSON.stringify(interaction.edits.at(-1));
    expect(json).toContain(localizedCopy("en-US", "commands.personal.config.spotlight_remove_range_title"));
    expect(json).toContain("1251-1300");
    expect(json).toContain("1451-1500");
  });

  it("routes a no-changes result to an info receipt without telemetry", async () => {
    const persona = { id: 10, name: "Tomori", isAlter: false };
    const fp = computeSpotlightSetFingerprint("guild-123", "user-123", [persona]);
    const channelId = "123456789012345678";

    let writeCalled = false;
    let telemetryRecorded = false;

    const { dependencies } = makeDependencies([], {
      loadGuildPersonas: async () => [persona],
      operations: {
        ...personalConfigOperations,
        setSpotlight: async (input) => {
          if (
            input.expiresAt === null &&
            input.autoTriggerPersonaId === 10 &&
            input.personaIds.length === 1 &&
            input.personaIds[0] === 10
          ) {
            return { status: "no-changes" };
          }
          writeCalled = true;
          return { status: "success" };
        },
      },
      recordAction: () => {
        telemetryRecorded = true;
      },
    });

    const route = createPersonalConfigInteractionRoute(dependencies);
    const customId = buildPersonalConfigRouteId({
      action: "spot-set-cf",
      locale: "en-US",
      channelId,
      hours: 0,
      autoIdx: 1,
      blockIdx: 0,
      mask: "1",
      fp,
      nonce: "nonce123456",
    });

    const interaction = makePersonalInteraction({
      customId,
      channelCache: makeChannelCache([channelId]),
    });

    await route.execute({} as Client, interaction, requireRoute(customId));

    expect(writeCalled).toBe(false);
    expect(telemetryRecorded).toBe(false);
    const json = JSON.stringify(interaction.edits.at(-1));
    expect(json).toContain("No Changes");
  });

  it("unchanged permanent spotlight set is a no-op that skips the write", async () => {
    const personalSpotlightCache = await import("@/utils/cache/personalSpotlightCache");
    const getCachedSpy = spyOn(personalSpotlightCache, "getCachedPersonalSpotlightStatus").mockImplementation(
      async () => makeSpotlight("123456789012345678", { personaIds: [1, 2], autoTriggerPersonaId: 1 }),
    );
    const replaceSpy = spyOn(userRepository, "replacePersonalSpotlight").mockImplementation(async () => {});

    const result = await personalConfigOperations.setSpotlight({
      serverId: 1,
      userId: 1,
      userDiscId: "user-123",
      channelId: "123456789012345678",
      personaIds: [1, 2],
      autoTriggerPersonaId: 1,
      expiresAt: null,
    });

    expect(result.status).toBe("no-changes");
    expect(replaceSpy).not.toHaveBeenCalled();
    getCachedSpy.mockRestore();
    replaceSpy.mockRestore();
  });

  it("partial removal attempts all selected rows and repaints with warning receipt", async () => {
    const activeSpotlights = [
      makeSpotlight("111111111111111111", { personaIds: [1] }),
      makeSpotlight("222222222222222222", { personaIds: [2] }),
    ];
    const fp = computeSpotlightRemoveFingerprint("guild-123", "user-123", activeSpotlights);

    const { dependencies } = makeDependencies([], {
      loadActiveSpotlights: async () => activeSpotlights,
      operations: {
        ...personalConfigOperations,
        removeSpotlights: async () => ({
          status: "partial-failure",
          removedCount: 1,
          failedCount: 1,
        }),
      },
    });

    const route = createPersonalConfigInteractionRoute(dependencies);
    const customId = buildPersonalConfigRouteId({
      action: "spotlight-remove-submit",
      locale: "en-US",
      start: 0,
      fp,
      nonce: "nonce123456",
    });

    const interaction = makePersonalInteraction({
      kind: "modal",
      customId,
      overrides: { id: "modal-submit-123" },
    });

    await route.execute({} as Client, interaction, requireRoute(customId));

    const json = JSON.stringify(interaction.edits.at(-1));
    expect(json).toContain(localizedCopy("en-US", "commands.personal.config.spotlight_partial_removal_heading"));
  });
});

describe("Persona reachability beyond one modal", () => {
  const makeBlockPersonas = (count: number) =>
    Array.from({ length: count }, (_, i) => ({ id: 100 + i, name: `Persona ${i + 1}`, isAlter: false }));

  it("carries channel and duration from the step one modal into the persona step", async () => {
    const personas = makeBlockPersonas(SPOTLIGHT_PERSONA_PAGE_SIZE + 10);
    const { dependencies } = makeDependencies([], { loadGuildPersonas: async () => personas });
    const nonce = "nonce123456";
    const customId = buildPersonalConfigRouteId({
      action: "spotlight-set-step1",
      locale: "en-US",
      nonce,
    });
    const modalsModule = await import("@/utils/discord/ui/modals");
    const takeSpy = spyOn(modalsModule, "takeRawModalSelectValue").mockReturnValue("123456789012345678");

    const interaction = makePersonalInteraction({
      kind: "modal",
      customId,
      overrides: { id: "modal-step1" },
      fields: { hours_nonce123456: "12" },
    });

    await createPersonalConfigInteractionRoute(dependencies).execute({} as Client, interaction, requireRoute(customId));

    takeSpy.mockRestore();
    const json = JSON.stringify(interaction.edits.at(-1));
    // The block select must carry both, because the persona modal that follows cannot ask again.
    expect(json).toContain("s-blk-s:en-US:123456789012345678:12:");
  });

  it("round-trips a full-block base36 mask and refuses one bit past the bound", () => {
    const full = (1n << BigInt(SPOTLIGHT_PERSONA_PAGE_SIZE)) - 1n;
    const encoded = encodeSpotlightMask(full);
    expect(decodeSpotlightMask(encoded)).toBe(full);
    expect(encoded).toMatch(/^[0-9a-z]+$/);
    expect(decodeSpotlightMask(encodeSpotlightMask(1n << BigInt(SPOTLIGHT_PERSONA_PAGE_SIZE)))).toBeNull();
  });

  it("keeps a worst-case full-block spot-set-cf inside 100 characters", () => {
    const customId = buildPersonalConfigRouteId({
      action: "spot-set-cf",
      locale: "en-US",
      channelId: "12345678901234567890",
      hours: 999999,
      autoIdx: SPOTLIGHT_PERSONA_PAGE_SIZE,
      blockIdx: 999,
      mask: encodeSpotlightMask((1n << BigInt(SPOTLIGHT_PERSONA_PAGE_SIZE)) - 1n),
      fp: "a1b2c3d4",
      nonce: "nonce1234567",
    });
    expect(customId.length).toBeLessThanOrEqual(100);
    const parsed = parsePersonalConfigPanelRoute(requireRoute(customId));
    expect(parsed?.action).toBe("spot-set-cf");
  });

  it("renders no block chooser at or below one block and a chooser above it", () => {
    const render = (totalPersonas: number) =>
      JSON.stringify(
        buildPersonalConfigPanelPayload({
          locale: "en-US",
          category: "advanced",
          page: "spotlight",
          user: makeUser(),
          resolvedNickname: "Tester",
          personas: [],
          guildId: "123456789012345678",
          memoryCount: 0,
          stmCount: 0,
          readStatus: "fresh",
          view: {
            kind: "spotlight-persona-select",
            channelId: "123456789012345678",
            hours: 0,
            fp: "a1b2c3d4",
            totalPersonas,
            chooserPage: 0,
          },
        }),
      );

    const atBound = render(SPOTLIGHT_PERSONA_PAGE_SIZE);
    expect(atBound).toContain("s-blk:");
    expect(atBound).not.toContain("s-blk-s:");
    expect(atBound).not.toContain("s-blk-p:");

    const aboveBound = render(SPOTLIGHT_PERSONA_PAGE_SIZE * 3);
    expect(aboveBound).toContain("s-blk-s:");
    expect(aboveBound).toContain("1-50");
    expect(aboveBound).toContain("101-150");
  });

  it("opens the persona modal for the block the range button named", async () => {
    const personas = makeBlockPersonas(SPOTLIGHT_PERSONA_PAGE_SIZE * 2);
    const fp = computeSpotlightSetFingerprint("guild-123", "user-123", personas);
    let openedWith: Array<{ id: number }> = [];
    let openedBlock = -1;

    const { dependencies } = makeDependencies([], {
      loadGuildPersonas: async () => personas,
      showSpotlightSetModal: async (_i, _l, _n, _ch, _h, blockIdx, _fp, block) => {
        openedBlock = blockIdx;
        openedWith = block;
      },
    });

    const customId = buildPersonalConfigRouteId({
      action: "spotlight-set-block",
      locale: "en-US",
      channelId: "123456789012345678",
      hours: 0,
      fp,
      blockIdx: 1,
    });
    const interaction = makePersonalInteraction({
      customId,
    });

    await createPersonalConfigInteractionRoute(dependencies).execute({} as Client, interaction, requireRoute(customId));

    expect(openedBlock).toBe(1);
    expect(openedWith.map((p) => p.id)).toEqual(personas.slice(50, 100).map((p) => p.id));
  });

  it("resolves the block-relative auto index to the persona the review displayed", async () => {
    const personas = makeBlockPersonas(SPOTLIGHT_PERSONA_PAGE_SIZE * 2);
    const fp = computeSpotlightSetFingerprint("guild-123", "user-123", personas);
    // Second block, its first three personas selected, the third chosen as auto-trigger.
    const mask = encodeSpotlightMask(0b111n);
    // A holder rather than a bare `let`: TypeScript narrows `let` to its `null` initializer and does
    // not see the closure assignment, and the holder keeps `null` as the unwritten state the
    // assertion below rejects.
    const captured: { written: { personaIds: number[]; autoTriggerPersonaId: number | null } | null } = {
      written: null,
    };

    const { dependencies } = makeDependencies([], {
      loadGuildPersonas: async () => personas,
      operations: {
        ...personalConfigOperations,
        setSpotlight: async (input) => {
          captured.written = { personaIds: input.personaIds, autoTriggerPersonaId: input.autoTriggerPersonaId };
          return { status: "success" };
        },
      },
    });

    const customId = buildPersonalConfigRouteId({
      action: "spot-set-cf",
      locale: "en-US",
      channelId: "123456789012345678",
      hours: 0,
      autoIdx: 3,
      blockIdx: 1,
      mask,
      fp,
      nonce: "nonce123456",
    });
    const interaction = makePersonalInteraction({
      customId,
      channelCache: makeChannelCache(["123456789012345678"]),
    });

    await createPersonalConfigInteractionRoute(dependencies).execute({} as Client, interaction, requireRoute(customId));

    expect(captured.written).not.toBeNull();
    expect(captured.written?.personaIds).toEqual([personas[50].id, personas[51].id, personas[52].id]);
    expect(captured.written?.autoTriggerPersonaId).toBe(personas[52].id);
  });

  it("fails stale without writing when the mask names more personas than the block still holds", async () => {
    const personas = makeBlockPersonas(SPOTLIGHT_PERSONA_PAGE_SIZE + 5);
    const fp = computeSpotlightSetFingerprint("guild-123", "user-123", personas);
    // Second block holds five personas; a mask claiming a tenth bit cannot have come from it.
    const mask = encodeSpotlightMask(1n << 9n);
    let wrote = false;

    const { dependencies } = makeDependencies([], {
      loadGuildPersonas: async () => personas,
      operations: {
        ...personalConfigOperations,
        setSpotlight: async () => {
          wrote = true;
          return { status: "success" };
        },
      },
    });

    const customId = buildPersonalConfigRouteId({
      action: "spot-set-cf",
      locale: "en-US",
      channelId: "123456789012345678",
      hours: 0,
      autoIdx: 0,
      blockIdx: 1,
      mask,
      fp,
      nonce: "nonce123456",
    });
    const interaction = makePersonalInteraction({
      customId,
      channelCache: makeChannelCache(["123456789012345678"]),
    });

    await createPersonalConfigInteractionRoute(dependencies).execute({} as Client, interaction, requireRoute(customId));

    expect(wrote).toBe(false);
    expect(JSON.stringify(interaction.edits.at(-1))).toContain("out of date");
  });
});

describe("Raw modal component types and their option bounds", () => {
  // Discord rejects a RadioGroup or CheckboxGroup outside 2-10 options with BASE_TYPE_BAD_LENGTH,
  // while a StringSelect holds 25. `RawDiscordComponent.type` is a bare number, so nothing but a
  // test distinguishes them: a catalog behind a RadioGroup type-checks and 400s at runtime.
  const RADIO = 21;
  const CHECKBOX = 22;
  const STRING_SELECT = 3;

  it("offers authored languages as endonyms in a 25-option-capable select", () => {
    const modal = buildLanguageModal("en-US", "nonce123456", "ja");
    const control = modal.components[0]?.component;
    const options = (control?.options ?? []) as Array<{ value: string; label: string; default?: boolean }>;

    expect(control?.type).toBe(STRING_SELECT);
    // Asserted in order, not sorted: the picker follows LOCALE_DISPLAY_ORDER so it reads the same
    // as the docs language switcher and the README row. Sorting here would hide a reshuffle.
    expect(options).toEqual([
      { value: "en-US", label: "English", default: false },
      { value: "ja", label: "日本語", default: true },
      { value: "zh-TW", label: "繁體中文", default: false },
      { value: "zh-CN", label: "简体中文", default: false },
      { value: "es-419", label: "Español (Latinoamérica)", default: false },
      { value: "pt-BR", label: "Português (Brasil)", default: false },
      { value: "vi", label: "Tiếng Việt", default: false },
    ]);
    assertBounds(modal, "language");
    expect(getRegisterableLocales().sort()).toEqual([
      "en-US",
      "es-419",
      "es-ES",
      "ja",
      "pt-BR",
      "vi",
      "zh-CN",
      "zh-TW",
    ]);

    const unsupported = buildLanguageModal("en-US", "nonce123456", "de");
    const unsupportedOptions = (unsupported.components[0]?.component?.options ?? []) as Array<{ default?: boolean }>;
    expect(unsupportedOptions.every((option) => option.default === false)).toBe(true);
  });

  const assertBounds = (modal: { components: RawDiscordComponent[] }, label: string) => {
    for (const row of modal.components) {
      const component = row.component;
      if (!component) continue;
      const type = component.type as number;
      const options = (component.options ?? []) as unknown[];
      if (type === RADIO || type === CHECKBOX) {
        expect(`${label}:${type}:${options.length}`).toBe(
          `${label}:${type}:${Math.min(Math.max(options.length, 2), 10)}`,
        );
      }
      if (type === STRING_SELECT) {
        expect(options.length).toBeGreaterThanOrEqual(1);
        expect(options.length).toBeLessThanOrEqual(25);
      }
    }
  };

  const manyModels = Array.from({ length: 25 }, (_, i) => ({
    id: 1000 + i,
    name: `provider/model-${i}`,
    description: "d",
  }));
  const manyPersonas = Array.from({ length: 24 }, (_, i) => ({
    id: 200 + i,
    name: `Persona ${i}`,
    isAlter: false,
  }));

  it("puts catalogs behind a StringSelect, never a RadioGroup", () => {
    const model = buildModelSelectModal("en-US", "nonce123456", "text", "openrouter", manyModels, 1000);
    const auto = buildSpotlightAutoTriggerModal(
      "en-US",
      "nonce123456",
      "123456789012345678",
      0,
      0,
      "1",
      "a1b2c3d4",
      manyPersonas,
    );

    expect(model.components[0]?.component?.type).toBe(STRING_SELECT);
    expect(auto.components[0]?.component?.type).toBe(STRING_SELECT);
    assertBounds(model, "model");
    assertBounds(auto, "auto");
  });

  it("keeps every checkbox group between 2 and 10 options at awkward counts", () => {
    // Eleven splits 6 and 5, not 10 and 1: a greedy split leaves a group Discord rejects.
    for (const count of [2, 10, 11, 21, 41, 50]) {
      const personas = Array.from({ length: count }, (_, i) => ({
        id: 300 + i,
        name: `P${i}`,
        isAlter: false,
      }));
      const modal = buildSpotlightSetModal("en-US", "nonce123456", "123456789012345678", 0, 0, "a1b2c3d4", personas);
      const sizes = modal.components.map((row) => ((row.component?.options ?? []) as unknown[]).length);
      expect(`${count}:${sizes.join(",")}`).toBe(`${count}:${sizes.join(",")}`);
      expect(sizes.reduce((a, b) => a + b, 0)).toBe(count);
      for (const size of sizes) {
        expect(size).toBeGreaterThanOrEqual(2);
        expect(size).toBeLessThanOrEqual(10);
      }
    }
  });
});

describe("Pre-defer dispatch, fall-throughs, and acknowledgement timing", () => {
  it("model-provider-select with __server_default__ falls through to post-defer, while ordinary provider shows modal pre-defer without deferring", async () => {
    let setCapabilityCalled = false;
    const { dependencies: serverDefaultDeps } = makeDependencies([], {
      operations: {
        ...personalConfigOperations,
        setCapabilityEnabled: async (_input) => {
          expect(serverDefaultInteraction.deferred).toBe(true);
          setCapabilityCalled = true;
          return { status: "success" };
        },
      },
    });

    const route1 = createPersonalConfigInteractionRoute(serverDefaultDeps);
    const serverDefaultCustomId = buildPersonalConfigRouteId({
      action: "model-provider-select",
      locale: "en-US",
      capability: "text",
    });

    const serverDefaultInteraction = makePersonalInteraction({
      kind: "string-select",
      customId: serverDefaultCustomId,
      values: ["__server_default__"],
    });
    await route1.execute({} as Client, serverDefaultInteraction, requireRoute(serverDefaultCustomId));
    expect(serverDefaultInteraction.deferred).toBe(true);
    expect(setCapabilityCalled).toBe(true);

    let modalShown = false;
    let acknowledgedInsideModal = true;
    let modalInteraction: PersonalInteraction;

    const { dependencies: modalDeps } = makeDependencies([], {
      loadAvailableModelsForCapability: async () => [
        { id: 101, name: "Claude 3.5 Sonnet" },
        { id: 102, name: "Claude 3 Opus" },
      ],
      showModelSelectModal: async () => {
        modalShown = true;
        acknowledgedInsideModal = modalInteraction.deferred || modalInteraction.replied;
      },
    });

    const route2 = createPersonalConfigInteractionRoute(modalDeps);
    const modalCustomId = buildPersonalConfigRouteId({
      action: "model-provider-select",
      locale: "en-US",
      capability: "text",
    });

    modalInteraction = makePersonalInteraction({
      kind: "string-select",
      customId: modalCustomId,
      values: ["openrouter"],
    });

    await route2.execute({} as Client, modalInteraction, requireRoute(modalCustomId));
    expect(modalShown).toBe(true);
    expect(acknowledgedInsideModal).toBe(false);
    expect(modalInteraction.deferred).toBe(false);
    expect(modalInteraction.replied).toBe(false);
  });

  it("spotlight-remove-open with > SPOTLIGHT_REMOVE_PAGE_SIZE active spotlights falls through to post-defer range chooser, while <= limit shows removal modal pre-defer", async () => {
    const active51 = Array.from({ length: 51 }, (_, i) => makeSpotlight(`channel-${i}`, { personaIds: [1] }));

    let modalCalledForOverflow = false;

    const { dependencies: overflowDeps } = makeDependencies([], {
      loadActiveSpotlights: async () => active51,
      showSpotlightRemoveModal: async () => {
        modalCalledForOverflow = true;
      },
    });

    const route1 = createPersonalConfigInteractionRoute(overflowDeps);
    const overflowCustomId = buildPersonalConfigRouteId({
      action: "spotlight-remove-open",
      locale: "en-US",
    });

    const overflowInteraction = makePersonalInteraction({
      customId: overflowCustomId,
    });

    await route1.execute({} as Client, overflowInteraction, requireRoute(overflowCustomId));
    expect(modalCalledForOverflow).toBe(false);
    expect(overflowInteraction.deferred).toBe(true);
    const repaintedPayload = overflowInteraction.edits.at(-1);
    expect(repaintedPayload).not.toBeNull();
    const payloadJson = JSON.stringify(repaintedPayload);
    expect(payloadJson).toContain(localizedCopy("en-US", "commands.personal.config.spotlight_remove_range_title"));
    expect(payloadJson).toContain("s-rem-s");

    const active5 = Array.from({ length: 5 }, (_, i) => makeSpotlight(`channel-${i}`, { personaIds: [1] }));

    const normalDeferred = false;
    const normalReplied = false;
    let modalCalledForNormal = false;
    let acknowledgedInsideNormalModal = true;

    const { dependencies: normalDeps } = makeDependencies([], {
      loadActiveSpotlights: async () => active5,
      showSpotlightRemoveModal: async () => {
        modalCalledForNormal = true;
        acknowledgedInsideNormalModal = normalDeferred || normalReplied;
      },
    });

    const route2 = createPersonalConfigInteractionRoute(normalDeps);
    const normalCustomId = buildPersonalConfigRouteId({
      action: "spotlight-remove-open",
      locale: "en-US",
    });

    const normalInteraction = makePersonalInteraction({
      customId: normalCustomId,
    });

    await route2.execute({} as Client, normalInteraction, requireRoute(normalCustomId));
    expect(modalCalledForNormal).toBe(true);
    expect(acknowledgedInsideNormalModal).toBe(false);
    expect(normalInteraction.deferred).toBe(false);
    expect(normalInteraction.replied).toBe(false);
  });

  it("proves pre-defer modal actions do not acknowledge before opening their modal or direct reply", async () => {
    const actionsToTest = [
      { action: "language-open" as const, modalProp: "showLanguageModal" },
      { action: "timezone-open" as const, modalProp: "showTimezoneModal" },
      { action: "naming-open" as const, modalProp: "showNamingModal" },
      { action: "about-open" as const, modalProp: "showAboutModal" },
      { action: "appearance-open" as const, modalProp: "showAppearanceModal" },
      { action: "privacy-level-open" as const, modalProp: "showPrivacyLevelModal" },
      { action: "quick-toggle-open" as const, modalProp: "showQuickToggleModal" },
      { action: "impersonation-open" as const, modalProp: "showImpersonationModal" },
      { action: "spotlight-set-open" as const, modalProp: "showSpotlightStep1Modal" },
    ];

    for (const { action, modalProp } of actionsToTest) {
      let modalCalled = false;
      let acknowledgedInsideModal = true;
      let interaction: PersonalInteraction;

      const { dependencies } = makeDependencies([], {
        [modalProp]: async () => {
          modalCalled = true;
          acknowledgedInsideModal = interaction.deferred || interaction.replied;
        },
      });

      const route = createPersonalConfigInteractionRoute(dependencies);
      const customId = buildPersonalConfigRouteId({ action, locale: "en-US" } as PersonalConfigPanelRoute);

      interaction = makePersonalInteraction({
        customId,
      });

      await route.execute({} as Client, interaction, requireRoute(customId));
      expect(modalCalled).toBe(true);
      expect(acknowledgedInsideModal).toBe(false);
      expect(interaction.deferred).toBe(false);
      expect(interaction.replied).toBe(false);
    }
  });

  it("proves post-defer write handlers repaint with refreshed scope after database writes", async () => {
    const calls: string[] = [];
    let resolveCount = 0;

    const initialUser = makeUser({ user_nickname: "InitialNick" });
    const refreshedUser = makeUser({ user_nickname: "RefreshedNick" });

    const { dependencies } = makeDependencies(calls, {
      resolveScope: async (_interaction, forceRefresh = false) => {
        resolveCount++;
        const currentUser = forceRefresh ? refreshedUser : initialUser;
        return {
          userId: currentUser.user_id,
          userDiscId: currentUser.user_disc_id,
          guildId: "guild-123",
          workspaceId: "guild-123",
          internalServerId: 42,
          user: currentUser,
          resolvedNickname: currentUser.user_nickname ?? "LiveUser",
          personas: [],
          readStatus: "fresh",
        };
      },
      operations: {
        ...personalConfigOperations,
        setNaming: async (input) => {
          calls.push(`setNaming:${input.nickname}`);
          return { status: "success" };
        },
      },
    });

    const route = createPersonalConfigInteractionRoute(dependencies);
    const customId = buildPersonalConfigRouteId({ action: "naming-submit", locale: "en-US", nonce: "nonce123456" });

    const interaction = makePersonalInteraction({
      kind: "modal",
      customId,
      fields: {
        nickname_nonce123456: "RefreshedNick",
        prefix_nonce123456: "",
        suffix_nonce123456: "",
      },
    });

    await route.execute({} as Client, interaction, requireRoute(customId));

    expect(calls).toContain("setNaming:RefreshedNick");
    expect(resolveCount).toBeGreaterThanOrEqual(2);
    const capturedPayload = interaction.edits.at(-1);
    expect(capturedPayload).not.toBeNull();
    const renderedText = JSON.stringify(capturedPayload);
    expect(renderedText).toContain("RefreshedNick");
    expect(renderedText).not.toContain("InitialNick");
  });

  it("proves post-defer model parameter writes repaint with refreshed scope and record telemetry", async () => {
    const calls: string[] = [];
    let resolveCount = 0;
    let recordedAction: string | undefined;
    let writeUserId: number | undefined;
    let writeUserDiscId: string | undefined;
    let repaintSavedProvidersUserId: number | undefined;
    let repaintModelDisplayInfoUserId: number | undefined;

    const initialUser = makeUser({ user_id: 101, user_disc_id: "user-101", user_nickname: "InitialUser" });
    const refreshedUser = makeUser({ user_id: 202, user_disc_id: "user-202", user_nickname: "RefreshedUser" });

    const baseDependencies = makeDependencies(calls).dependencies;
    const { dependencies } = makeDependencies(calls, {
      resolveScope: async (_interaction, forceRefresh = false) => {
        resolveCount++;
        const currentUser = forceRefresh ? refreshedUser : initialUser;
        return {
          userId: currentUser.user_id,
          userDiscId: currentUser.user_disc_id,
          guildId: "guild-123",
          workspaceId: "guild-123",
          internalServerId: 42,
          user: currentUser,
          resolvedNickname: currentUser.user_nickname ?? "LiveUser",
          personas: [],
          readStatus: "fresh",
        };
      },
      operations: {
        ...personalConfigOperations,
        setParameters: async (input) => {
          writeUserId = input.userId;
          writeUserDiscId = input.userDiscId;
          calls.push(`setParameters:${input.userId}:${input.provider}:${input.patch.temperature}`);
          return { status: "success" };
        },
      },
      loadUserSavedProviders: async (userId) => {
        repaintSavedProvidersUserId = userId;
        calls.push(`loadUserSavedProviders:${userId}`);
        return baseDependencies.loadUserSavedProviders(userId);
      },
      loadPersonalModelDisplayInfo: async (
        userId,
        savedProviders,
        capability,
        selectedParametersProvider,
        selectedFallbacksProvider,
      ) => {
        repaintModelDisplayInfoUserId = userId;
        calls.push(`loadPersonalModelDisplayInfo:${userId}`);
        return baseDependencies.loadPersonalModelDisplayInfo(
          userId,
          savedProviders,
          capability,
          selectedParametersProvider,
          selectedFallbacksProvider,
        );
      },
      recordAction: (input) => {
        recordedAction = input.action;
      },
    });

    const route = createPersonalConfigInteractionRoute(dependencies);
    const customId = buildPersonalConfigRouteId({
      action: "parameters-1-submit",
      locale: "en-US",
      nonce: "nonce123456",
      provider: "gemini",
    });

    const interaction = makePersonalInteraction({
      kind: "modal",
      customId,
      fields: {
        temperature_nonce123456: "0.7",
        min_p_nonce123456: "",
        top_p_nonce123456: "",
        top_k_nonce123456: "",
      },
    });

    await route.execute({} as Client, interaction, requireRoute(customId));

    expect(writeUserId).toBe(101);
    expect(writeUserDiscId).toBe("user-101");
    expect(calls).toContain("setParameters:101:gemini:0.7");
    expect(repaintSavedProvidersUserId).toBe(202);
    expect(repaintModelDisplayInfoUserId).toBe(202);
    expect(calls).toContain("loadUserSavedProviders:202");
    expect(calls).toContain("loadPersonalModelDisplayInfo:202");
    expect(resolveCount).toBeGreaterThanOrEqual(2);
    expect(recordedAction).toBe("personal-config.personal.parameters.set");
    expect(interaction.deferred).toBe(true);
    const capturedPayload = interaction.edits.at(-1);
    expect(capturedPayload).not.toBeNull();
    const renderedText = JSON.stringify(capturedPayload);
    expect(renderedText).toContain(localizedCopy("en-US", "commands.personal.config.parameters_updated_heading"));
    expect(renderedText).toContain("Updated sampler parameters for Google Gemini");
  });

  it("proves post-defer trigger mode write repaints with refreshed scope and records telemetry", async () => {
    const calls: string[] = [];
    let resolveCount = 0;
    let recordedAction: string | undefined;
    let writeUserId: number | undefined;
    let writeUserDiscId: string | undefined;

    const initialUser = makeUser({
      user_id: 101,
      user_disc_id: "user-101",
      user_nickname: "InitialUser",
      personal_dtm: "follow",
    });
    const refreshedUser = makeUser({
      user_id: 202,
      user_disc_id: "user-202",
      user_nickname: "RefreshedUser",
      personal_dtm: "on",
    });

    const { dependencies } = makeDependencies(calls, {
      resolveScope: async (_interaction, forceRefresh = false) => {
        resolveCount++;
        const currentUser = forceRefresh ? refreshedUser : initialUser;
        return {
          userId: currentUser.user_id,
          userDiscId: currentUser.user_disc_id,
          guildId: "guild-123",
          workspaceId: "guild-123",
          internalServerId: 42,
          user: currentUser,
          resolvedNickname: currentUser.user_nickname ?? "LiveUser",
          personas: [],
          readStatus: "fresh",
        };
      },
      operations: {
        ...personalConfigOperations,
        setTriggerMode: async (input) => {
          writeUserId = input.userId;
          writeUserDiscId = input.userDiscId;
          calls.push(`setTriggerMode:${input.userId}:${input.mode}`);
          return { status: "success" };
        },
      },
      recordAction: (input) => {
        recordedAction = input.action;
      },
    });

    const route = createPersonalConfigInteractionRoute(dependencies);
    const customId = buildPersonalConfigRouteId({
      action: "trigger-mode-set",
      locale: "en-US",
      mode: "on",
    });

    const interaction = makePersonalInteraction({
      customId,
    });

    await route.execute({} as Client, interaction, requireRoute(customId));

    expect(writeUserId).toBe(101);
    expect(writeUserDiscId).toBe("user-101");
    expect(calls).toContain("setTriggerMode:101:on");
    expect(resolveCount).toBeGreaterThanOrEqual(2);
    expect(recordedAction).toBe("personal-config.personal.trigger-mode.set");
    expect(interaction.deferred).toBe(true);
    const capturedPayload = interaction.edits.at(-1);
    expect(capturedPayload).not.toBeNull();
    const renderedText = JSON.stringify(capturedPayload);
    expect(renderedText).toContain(localizedCopy("en-US", "commands.personal.config.trigger_mode_updated_heading"));
    expect(renderedText).toContain("Your deliberate trigger mode preference has been set to On.");
    expect(renderedText).toContain("> Only an @mention, a reply, or /respond reaches me");
    expect(renderedText).not.toContain("> You can trigger me by saying my name");
  });

  it("proves post-defer spotlight write repaints with refreshed scope and records telemetry", async () => {
    const calls: string[] = [];
    let resolveCount = 0;
    let recordedAction: string | undefined;
    let writeUserId: number | undefined;
    let writeUserDiscId: string | undefined;
    let writeChannelId: string | undefined;
    let activeSpotlightUserId: number | undefined;

    const initialUser = makeUser({
      user_id: 101,
      user_disc_id: "user-101",
      user_nickname: "InitialSpotlightUser",
    });
    const refreshedUser = makeUser({
      user_id: 202,
      user_disc_id: "user-202",
      user_nickname: "RefreshedSpotlightUser",
    });

    const personas = [
      { id: 1, name: "Tomori", isAlter: false },
      { id: 2, name: "Anon", isAlter: false },
    ];
    const fp = computeSpotlightSetFingerprint("guild-123", "user-101", personas);

    const { dependencies } = makeDependencies(calls, {
      resolveScope: async (_interaction, forceRefresh = false) => {
        resolveCount++;
        const currentUser = forceRefresh ? refreshedUser : initialUser;
        return {
          userId: currentUser.user_id,
          userDiscId: currentUser.user_disc_id,
          guildId: "guild-123",
          workspaceId: "guild-123",
          internalServerId: 42,
          user: currentUser,
          resolvedNickname: currentUser.user_nickname ?? "LiveUser",
          personas: [],
          readStatus: "fresh",
        };
      },
      loadGuildPersonas: async () => personas,
      loadActiveSpotlights: async (_serverId, userId) => {
        activeSpotlightUserId = userId;
        return [];
      },
      operations: {
        ...personalConfigOperations,
        setSpotlight: async (input) => {
          writeUserId = input.userId;
          writeUserDiscId = input.userDiscId;
          writeChannelId = input.channelId;
          calls.push(`setSpotlight:${input.channelId}:${input.personaIds.join(",")}`);
          return { status: "success" };
        },
      },
      recordAction: (input) => {
        recordedAction = input.action;
      },
    });

    const route = createPersonalConfigInteractionRoute(dependencies);
    const customId = buildPersonalConfigRouteId({
      action: "spot-set-cf",
      locale: "en-US",
      channelId: "123456789012345678",
      hours: 12,
      autoIdx: 1,
      blockIdx: 0,
      mask: "1",
      fp,
      nonce: "nonce123456",
    });

    const interaction = makePersonalInteraction({
      customId,
      channelCache: makeChannelCache(["123456789012345678"]),
      overrides: { user: { id: "user-101", username: "tester", displayName: "Tester", globalName: "Tester" } },
    });

    await route.execute({} as Client, interaction, requireRoute(customId));

    expect(writeUserId).toBe(101);
    expect(writeUserDiscId).toBe("user-101");
    expect(writeChannelId).toBe("123456789012345678");
    expect(calls).toContain("setSpotlight:123456789012345678:1");
    expect(resolveCount).toBeGreaterThanOrEqual(2);
    expect(activeSpotlightUserId).toBe(202);
    expect(recordedAction).toBe("personal-config.personal.spotlight.set");
    expect(interaction.deferred).toBe(true);
    const capturedPayload = interaction.edits.at(-1);
    expect(capturedPayload).not.toBeNull();
    const renderedText = JSON.stringify(capturedPayload);
    expect(renderedText).toContain(localizedCopy("en-US", "commands.personal.config.spotlight_saved_heading"));
    expect(renderedText).toContain("Your personal spotlight has been saved for <#123456789012345678>.");
  });

  describe("Model Randomizer and Cross-Server STM state controls", () => {
    describe("Cross-Server STM state control rendering and custom IDs", () => {
      it("renders Off as disabled Primary and On as enabled Secondary when cross-server STM is off", () => {
        const payload = buildPersonalConfigPanelPayload({
          locale: "en-US",
          category: "privacy",
          page: "controls",
          user: makeUser({ shortterm_cache_crossserver_opt_in: false }),
          resolvedNickname: "Tester",
          personas: [],
          guildId: "guild-123",
          memoryCount: 0,
          stmCount: 0,
          readStatus: "fresh",
        });

        const container = payload.components.find(
          (component): component is ContainerComponentData<ComponentInContainerData> =>
            component.type === ComponentType.Container,
        );
        if (!container) throw new Error("Expected the panel container");
        const buttonRow = container.components.find(
          (r): r is ActionRowData<InteractionButtonComponentData> =>
            r.type === ComponentType.ActionRow &&
            "components" in r &&
            r.components.some(
              (b) => "customId" in b && typeof b.customId === "string" && b.customId.includes("crossserver-set"),
            ),
        );

        expect(buttonRow).toBeDefined();
        const offButton = buttonRow?.components.find((b) => b.label === "Off");
        const onButton = buttonRow?.components.find((b) => b.label === "On");

        expect(offButton).toBeDefined();
        expect(offButton?.style).toBe(ButtonStyle.Primary);
        expect(offButton?.disabled).toBe(true);

        expect(onButton).toBeDefined();
        expect(onButton?.style).toBe(ButtonStyle.Secondary);
        expect(onButton?.disabled).toBe(false);

        // Custom IDs decode to their OWN target booleans (not the negation of current state)
        const offRoute = parsePersonalConfigPanelRoute(requireRoute(offButton?.customId ?? ""));
        expect(offRoute).toEqual({ action: "crossserver-set", locale: "en-US", enabled: false });

        const onRoute = parsePersonalConfigPanelRoute(requireRoute(onButton?.customId ?? ""));
        expect(onRoute).toEqual({ action: "crossserver-set", locale: "en-US", enabled: true });

        // Effective behavior quote row below
        const payloadJson = JSON.stringify(payload);
        expect(payloadJson).toContain("> I cannot remember recent conversations with you");
      });

      it("renders Off as enabled Secondary and On as disabled Primary when cross-server STM is on", () => {
        const payload = buildPersonalConfigPanelPayload({
          locale: "en-US",
          category: "privacy",
          page: "controls",
          user: makeUser({ shortterm_cache_crossserver_opt_in: true }),
          resolvedNickname: "Tester",
          personas: [],
          guildId: "guild-123",
          memoryCount: 0,
          stmCount: 0,
          readStatus: "fresh",
        });

        const container = payload.components.find(
          (component): component is ContainerComponentData<ComponentInContainerData> =>
            component.type === ComponentType.Container,
        );
        if (!container) throw new Error("Expected the panel container");
        const buttonRow = container.components.find(
          (r): r is ActionRowData<InteractionButtonComponentData> =>
            r.type === ComponentType.ActionRow &&
            "components" in r &&
            r.components.some(
              (b) => "customId" in b && typeof b.customId === "string" && b.customId.includes("crossserver-set"),
            ),
        );

        expect(buttonRow).toBeDefined();
        const offButton = buttonRow?.components.find((b) => b.label === "Off");
        const onButton = buttonRow?.components.find((b) => b.label === "On");

        expect(offButton).toBeDefined();
        expect(offButton?.style).toBe(ButtonStyle.Secondary);
        expect(offButton?.disabled).toBe(false);

        expect(onButton).toBeDefined();
        expect(onButton?.style).toBe(ButtonStyle.Primary);
        expect(onButton?.disabled).toBe(true);

        const offRoute = parsePersonalConfigPanelRoute(requireRoute(offButton?.customId ?? ""));
        expect(offRoute).toEqual({ action: "crossserver-set", locale: "en-US", enabled: false });

        const onRoute = parsePersonalConfigPanelRoute(requireRoute(onButton?.customId ?? ""));
        expect(onRoute).toEqual({ action: "crossserver-set", locale: "en-US", enabled: true });

        const payloadJson = JSON.stringify(payload);
        expect(payloadJson).toContain("> I can carry recent conversation memory with you");
      });
    });

    describe("Model Randomizer state control rendering and custom IDs", () => {
      it("renders Off as disabled Primary and On as enabled Secondary when randomizer is off and canEnableRandomizer is true", () => {
        const payload = buildPersonalConfigPanelPayload({
          locale: "en-US",
          category: "models",
          page: "fallbacks",
          user: makeUser(),
          resolvedNickname: "Tester",
          personas: [],
          guildId: "guild-123",
          memoryCount: 0,
          stmCount: 0,
          readStatus: "fresh",
          modelDisplayInfo: makeModelDisplayInfo({
            fallbacksProviders: ["openrouter"],
            selectedFallbacksConfig: {
              provider: "openrouter",
              model_randomizer_enabled: false,
            } as unknown as UserSavedProviderConfigRow,
            fallbackSlots: [{ slot: 1, modelName: "Claude 3 Haiku" }],
            randomizerEnabled: false,
            canEnableRandomizer: true,
          }),
        });

        const container = payload.components.find(
          (component): component is ContainerComponentData<ComponentInContainerData> =>
            component.type === ComponentType.Container,
        );
        if (!container) throw new Error("Expected the panel container");
        const buttonRow = container.components.find(
          (r): r is ActionRowData<InteractionButtonComponentData> =>
            r.type === ComponentType.ActionRow &&
            "components" in r &&
            r.components.some(
              (b) => "customId" in b && typeof b.customId === "string" && b.customId.includes("randomizer-set"),
            ),
        );

        expect(buttonRow).toBeDefined();
        const offButton = buttonRow?.components.find((b) => b.label === "Off");
        const onButton = buttonRow?.components.find((b) => b.label === "On");

        expect(offButton).toBeDefined();
        expect(offButton?.style).toBe(ButtonStyle.Primary);
        expect(offButton?.disabled).toBe(true);

        expect(onButton).toBeDefined();
        expect(onButton?.style).toBe(ButtonStyle.Secondary);
        expect(onButton?.disabled).toBe(false);

        const offRoute = parsePersonalConfigPanelRoute(requireRoute(offButton?.customId ?? ""));
        expect(offRoute).toEqual({
          action: "randomizer-set",
          locale: "en-US",
          provider: "openrouter",
          enabled: false,
        });

        const onRoute = parsePersonalConfigPanelRoute(requireRoute(onButton?.customId ?? ""));
        expect(onRoute).toEqual({
          action: "randomizer-set",
          locale: "en-US",
          provider: "openrouter",
          enabled: true,
        });

        const payloadJson = JSON.stringify(payload);
        expect(payloadJson).toContain("> I try the primary model first");
        expect(payloadJson).not.toContain(
          localizedCopy("en-US", "commands.personal.config.randomizer_requires_fallback_detail"),
        );
      });

      it("renders Off as enabled Secondary and On as disabled Primary when randomizer is on and canEnableRandomizer is true", () => {
        const payload = buildPersonalConfigPanelPayload({
          locale: "en-US",
          category: "models",
          page: "fallbacks",
          user: makeUser(),
          resolvedNickname: "Tester",
          personas: [],
          guildId: "guild-123",
          memoryCount: 0,
          stmCount: 0,
          readStatus: "fresh",
          modelDisplayInfo: makeModelDisplayInfo({
            fallbacksProviders: ["openrouter"],
            selectedFallbacksConfig: {
              provider: "openrouter",
              model_randomizer_enabled: true,
            } as unknown as UserSavedProviderConfigRow,
            fallbackSlots: [{ slot: 1, modelName: "Claude 3 Haiku" }],
            randomizerEnabled: true,
            canEnableRandomizer: true,
          }),
        });

        const container = payload.components.find(
          (component): component is ContainerComponentData<ComponentInContainerData> =>
            component.type === ComponentType.Container,
        );
        if (!container) throw new Error("Expected the panel container");
        const buttonRow = container.components.find(
          (r): r is ActionRowData<InteractionButtonComponentData> =>
            r.type === ComponentType.ActionRow &&
            "components" in r &&
            r.components.some(
              (b) => "customId" in b && typeof b.customId === "string" && b.customId.includes("randomizer-set"),
            ),
        );

        expect(buttonRow).toBeDefined();
        const offButton = buttonRow?.components.find((b) => b.label === "Off");
        const onButton = buttonRow?.components.find((b) => b.label === "On");

        expect(offButton).toBeDefined();
        expect(offButton?.style).toBe(ButtonStyle.Secondary);
        expect(offButton?.disabled).toBe(false);

        expect(onButton).toBeDefined();
        expect(onButton?.style).toBe(ButtonStyle.Primary);
        expect(onButton?.disabled).toBe(true);

        const payloadJson = JSON.stringify(payload);
        expect(payloadJson).toContain("> I pick a random model from my primary and fallbacks first");
      });

      it("renders On as unavailable (disabled Secondary), Off as disabled Primary, and explains precondition in prose when canEnableRandomizer is false", () => {
        const payload = buildPersonalConfigPanelPayload({
          locale: "en-US",
          category: "models",
          page: "fallbacks",
          user: makeUser(),
          resolvedNickname: "Tester",
          personas: [],
          guildId: "guild-123",
          memoryCount: 0,
          stmCount: 0,
          readStatus: "fresh",
          modelDisplayInfo: makeModelDisplayInfo({
            fallbacksProviders: ["openrouter"],
            selectedFallbacksConfig: {
              provider: "openrouter",
              model_randomizer_enabled: false,
            } as unknown as UserSavedProviderConfigRow,
            fallbackSlots: [],
            randomizerEnabled: false,
            canEnableRandomizer: false,
          }),
        });

        const container = payload.components.find(
          (component): component is ContainerComponentData<ComponentInContainerData> =>
            component.type === ComponentType.Container,
        );
        if (!container) throw new Error("Expected the panel container");
        const buttonRow = container.components.find(
          (r): r is ActionRowData<InteractionButtonComponentData> =>
            r.type === ComponentType.ActionRow &&
            "components" in r &&
            r.components.some(
              (b) => "customId" in b && typeof b.customId === "string" && b.customId.includes("randomizer-set"),
            ),
        );

        expect(buttonRow).toBeDefined();
        const offButton = buttonRow?.components.find((b) => b.label === "Off");
        const onButton = buttonRow?.components.find((b) => b.label === "On");

        // Off is the selection: disabled Primary
        expect(offButton).toBeDefined();
        expect(offButton?.style).toBe(ButtonStyle.Primary);
        expect(offButton?.disabled).toBe(true);

        // On is an unavailable alternative: disabled Secondary
        expect(onButton).toBeDefined();
        expect(onButton?.style).toBe(ButtonStyle.Secondary);
        expect(onButton?.disabled).toBe(true);

        const payloadJson = JSON.stringify(payload);
        // Precondition explained in prose
        expect(payloadJson).toContain(
          JSON.stringify(
            formatPanelProse("-# Model Randomizer requires at least one configured fallback model."),
          ).slice(1, -1),
        );
        // Effective behavior quote is Off
        expect(payloadJson).toContain("> I try the primary model first");
      });

      it("keeps On selected from the stored flag when every fallback was cleared, while the behavior sentence reports the effective Off", () => {
        // Clearing all five fallback slots leaves model_randomizer_enabled true, so this state is
        // reachable. Showing Off here would deny a stored value that resumes the moment a fallback
        // returns, so the selection tracks storage and the quote row tracks effect.
        const payload = buildPersonalConfigPanelPayload({
          locale: "en-US",
          category: "models",
          page: "fallbacks",
          user: makeUser(),
          resolvedNickname: "Tester",
          personas: [],
          guildId: "guild-123",
          memoryCount: 0,
          stmCount: 0,
          readStatus: "fresh",
          modelDisplayInfo: makeModelDisplayInfo({
            fallbacksProviders: ["openrouter"],
            selectedFallbacksConfig: {
              provider: "openrouter",
              model_randomizer_enabled: true,
            } as unknown as UserSavedProviderConfigRow,
            fallbackSlots: [],
            randomizerEnabled: true,
            canEnableRandomizer: false,
          }),
        });

        const container = payload.components.find(
          (component): component is ContainerComponentData<ComponentInContainerData> =>
            component.type === ComponentType.Container,
        );
        if (!container) throw new Error("Expected the panel container");
        const buttonRow = container.components.find(
          (r): r is ActionRowData<InteractionButtonComponentData> =>
            r.type === ComponentType.ActionRow &&
            "components" in r &&
            r.components.some(
              (b) => "customId" in b && typeof b.customId === "string" && b.customId.includes("randomizer-set"),
            ),
        );

        expect(buttonRow).toBeDefined();
        const offButton = buttonRow?.components.find((b) => b.label === "Off");
        const onButton = buttonRow?.components.find((b) => b.label === "On");

        // On is the stored selection, so it stays disabled Primary rather than being rewritten to Off.
        expect(onButton?.style).toBe(ButtonStyle.Primary);
        expect(onButton?.disabled).toBe(true);

        // Off stays reachable so the user can clear the stored flag without adding a fallback first.
        expect(offButton?.style).toBe(ButtonStyle.Secondary);
        expect(offButton?.disabled).toBe(false);

        const payloadJson = JSON.stringify(payload);
        expect(payloadJson).toContain("> I try the primary model first");
        expect(payloadJson).not.toContain("> I pick a random model from my primary and fallbacks first");
        expect(payloadJson).toContain(
          JSON.stringify(
            formatPanelProse("-# Model Randomizer requires at least one configured fallback model."),
          ).slice(1, -1),
        );
      });
    });

    describe("Server Model Fallback state control rendering and custom IDs", () => {
      /** The section's own control row, told apart from the randomizer row that shares the page. */
      function findServerFallbackRow(
        payload: PersonalConfigPanelPayload,
      ): ActionRowData<InteractionButtonComponentData> {
        const container = payload.components.find(
          (component): component is ContainerComponentData<ComponentInContainerData> =>
            component.type === ComponentType.Container,
        );
        if (!container) throw new Error("Expected the panel container");
        const buttonRow = container.components.find(
          (r): r is ActionRowData<InteractionButtonComponentData> =>
            r.type === ComponentType.ActionRow &&
            "components" in r &&
            r.components.some(
              (b) => "customId" in b && typeof b.customId === "string" && b.customId.includes("server-fallback-set"),
            ),
        );
        if (!buttonRow) throw new Error("Server Model Fallback control row is missing from the page");
        return buttonRow;
      }

      it("renders the section with On selected and the enabled behavior line for a default account", () => {
        const payload = buildPersonalConfigPanelPayload({
          locale: "en-US",
          category: "models",
          page: "fallbacks",
          user: makeUser(),
          resolvedNickname: "Tester",
          personas: [],
          guildId: "guild-123",
          memoryCount: 0,
          stmCount: 0,
          readStatus: "fresh",
        });

        const buttonRow = findServerFallbackRow(payload);
        const offButton = buttonRow.components.find((b) => b.label === "Off");
        const onButton = buttonRow.components.find((b) => b.label === "On");

        expect(onButton?.style).toBe(ButtonStyle.Primary);
        expect(onButton?.disabled).toBe(true);
        expect(offButton?.style).toBe(ButtonStyle.Secondary);
        expect(offButton?.disabled).toBe(false);

        expect(parsePersonalConfigPanelRoute(requireRoute(offButton?.customId ?? ""))).toEqual({
          action: "server-fallback-set",
          locale: "en-US",
          enabled: false,
        });

        const payloadJson = JSON.stringify(payload);
        expect(payloadJson).toContain(localizedCopy("en-US", "commands.personal.config.server_fallback_section_title"));
        expect(payloadJson).toContain(localizedCopy("en-US", "commands.personal.config.server_fallback_effect_on"));
        expect(payloadJson).not.toContain(
          localizedCopy("en-US", "commands.personal.config.server_fallback_effect_off"),
        );
      });

      it("renders Off selected and the disabled behavior line for an opted-out account", () => {
        const payload = buildPersonalConfigPanelPayload({
          locale: "en-US",
          category: "models",
          page: "fallbacks",
          user: makeUser({ personal_server_fallback_enabled: false }),
          resolvedNickname: "Tester",
          personas: [],
          guildId: "guild-123",
          memoryCount: 0,
          stmCount: 0,
          readStatus: "fresh",
        });

        const buttonRow = findServerFallbackRow(payload);
        const offButton = buttonRow.components.find((b) => b.label === "Off");
        const onButton = buttonRow.components.find((b) => b.label === "On");

        expect(offButton?.style).toBe(ButtonStyle.Primary);
        expect(offButton?.disabled).toBe(true);
        expect(onButton?.style).toBe(ButtonStyle.Secondary);
        expect(onButton?.disabled).toBe(false);

        const payloadJson = JSON.stringify(payload);
        expect(payloadJson).toContain(localizedCopy("en-US", "commands.personal.config.server_fallback_effect_off"));
      });

      it("renders the section on a page with no personal text provider to point at", () => {
        // The fallback notice names this page as the opt-out, so the control must not depend on a
        // saved personal provider being there to fall back from.
        const payload = buildPersonalConfigPanelPayload({
          locale: "en-US",
          category: "models",
          page: "fallbacks",
          user: makeUser(),
          resolvedNickname: "Tester",
          personas: [],
          guildId: "guild-123",
          memoryCount: 0,
          stmCount: 0,
          readStatus: "fresh",
          modelDisplayInfo: makeModelDisplayInfo(),
        });

        expect(findServerFallbackRow(payload)).toBeDefined();
        expect(JSON.stringify(payload)).toContain(
          JSON.stringify(
            formatPanelProse(localizedCopy("en-US", "commands.personal.config.no_text_providers_fallbacks")),
          ).slice(1, -1),
        );
      });

      it("says so when the current server never lends its model, whatever the setting reads", () => {
        const buildPayload = (userByokMode: boolean) =>
          buildPersonalConfigPanelPayload({
            locale: "en-US",
            category: "models",
            page: "fallbacks",
            user: makeUser(),
            resolvedNickname: "Tester",
            personas: [],
            guildId: "guild-123",
            memoryCount: 0,
            stmCount: 0,
            readStatus: "fresh",
            serverModelAccess: { userByokMode },
          });

        // The runtime wrapper re-marks prose continuation lines, so the notice is matched as rendered.
        const notice = JSON.stringify(
          formatPanelProse(`-# ${localizedCopy("en-US", "commands.personal.config.server_fallback_byok_notice")}`),
        ).slice(1, -1);

        expect(JSON.stringify(buildPayload(true))).toContain(notice);
        expect(JSON.stringify(buildPayload(false))).not.toContain(notice);
      });
    });

    describe("Execution of crossserver-set and crossserver-toggle", () => {
      it("acknowledges interaction before database write and sets cross-server STM to on", async () => {
        const calls: string[] = [];
        let acknowledgedDuringWrite = false;
        const { dependencies, telemetry, user } = makeDependencies(calls);
        user.shortterm_cache_crossserver_opt_in = false;

        dependencies.operations.setCrossServerStm = async (input) => {
          acknowledgedDuringWrite = interaction.deferred || interaction.replied;
          calls.push(`setCrossServerStm:${input.enabled}`);
          user.shortterm_cache_crossserver_opt_in = input.enabled;
          return { status: "success", enabled: input.enabled };
        };

        const route = createPersonalConfigInteractionRoute(dependencies);
        const customId = buildPersonalConfigRouteId({
          action: "crossserver-set",
          locale: "en-US",
          enabled: true,
        });

        const interaction = makePersonalInteraction({
          customId,
        });

        await route.execute({} as Client, interaction, requireRoute(customId));

        expect(acknowledgedDuringWrite).toBe(true);
        expect(calls).toContain("setCrossServerStm:true");
        expect(telemetry).toContain("personal-config.personal.crossserver-stm.set");
        const capturedPayload = interaction.edits.at(-1);
        expect(capturedPayload).not.toBeNull();
        const renderedText = JSON.stringify(capturedPayload);
        expect(renderedText).toContain(localizedCopy("en-US", "commands.personal.config.crossserver_enabled_heading"));
      });

      it("performs no write when setting cross-server STM to already stored value", async () => {
        const calls: string[] = [];
        const { dependencies, user } = makeDependencies(calls);
        user.shortterm_cache_crossserver_opt_in = true;

        const route = createPersonalConfigInteractionRoute(dependencies);
        const customId = buildPersonalConfigRouteId({
          action: "crossserver-set",
          locale: "en-US",
          enabled: true,
        });

        const interaction = makePersonalInteraction({
          customId,
        });

        await route.execute({} as Client, interaction, requireRoute(customId));

        // No DB write performed
        expect(calls.filter((c) => c.startsWith("setCrossServerStm"))).toHaveLength(0);
        // Still repaints from authoritative state with noChangesReceipt
        const capturedPayload = interaction.edits.at(-1);
        expect(capturedPayload).not.toBeNull();
        const renderedText = JSON.stringify(capturedPayload);
        expect(renderedText).toContain("No Changes");
      });

      it("legacy crossserver-toggle action remains routable and flips the stored state", async () => {
        const calls: string[] = [];
        const { dependencies, telemetry, user } = makeDependencies(calls);
        user.shortterm_cache_crossserver_opt_in = false;

        const route = createPersonalConfigInteractionRoute(dependencies);
        const customId = "personal-config:v2:crossserver-toggle:en-US";

        const interaction = makePersonalInteraction({
          customId,
        });

        await route.execute({} as Client, interaction, requireRoute(customId));

        expect(calls).toContain("toggleCrossServerStm");
        expect(user.shortterm_cache_crossserver_opt_in).toBe(true);
        expect(telemetry).toContain("personal-config.personal.crossserver-stm.set");
        const capturedPayload = interaction.edits.at(-1);
        expect(capturedPayload).not.toBeNull();
        const renderedText = JSON.stringify(capturedPayload);
        expect(renderedText).toContain(localizedCopy("en-US", "commands.personal.config.crossserver_enabled_heading"));
      });
    });

    describe("Execution of randomizer-set and randomizer-toggle", () => {
      it("acknowledges interaction before database write and sets randomizer to on", async () => {
        const calls: string[] = [];
        let acknowledgedDuringWrite = false;
        const savedConfig = {
          user_saved_config_id: 1,
          user_id: 1,
          provider: "openrouter",
          model_randomizer_enabled: false,
          fallback_model_refs: [{ type: "llm", id: 103 }],
        } as unknown as UserSavedProviderConfigRow;

        const { dependencies, telemetry } = makeDependencies(calls, {
          loadUserSavedProviders: async () => [savedConfig],
        });

        dependencies.operations.setRandomizer = async (input) => {
          acknowledgedDuringWrite = interaction.deferred || interaction.replied;
          calls.push(`setRandomizer:${input.provider}:${input.enabled}`);
          savedConfig.model_randomizer_enabled = input.enabled;
          return { status: "success", enabled: input.enabled };
        };

        const route = createPersonalConfigInteractionRoute(dependencies);
        const customId = buildPersonalConfigRouteId({
          action: "randomizer-set",
          locale: "en-US",
          provider: "openrouter",
          enabled: true,
        });

        const interaction = makePersonalInteraction({
          customId,
        });

        await route.execute({} as Client, interaction, requireRoute(customId));

        expect(acknowledgedDuringWrite).toBe(true);
        expect(calls).toContain("setRandomizer:openrouter:true");
        expect(telemetry).toContain("personal-config.personal.randomizer.set");
        const capturedPayload = interaction.edits.at(-1);
        expect(capturedPayload).not.toBeNull();
        const renderedText = JSON.stringify(capturedPayload);
        expect(renderedText).toContain(localizedCopy("en-US", "commands.personal.config.randomizer_enabled_heading"));
      });

      it("performs no write when setting randomizer to already stored value", async () => {
        const calls: string[] = [];
        const savedConfig = {
          user_saved_config_id: 1,
          user_id: 1,
          provider: "openrouter",
          model_randomizer_enabled: true,
          fallback_model_refs: [{ type: "llm", id: 103 }],
        } as unknown as UserSavedProviderConfigRow;

        const { dependencies } = makeDependencies(calls, {
          loadUserSavedProviders: async () => [savedConfig],
        });

        dependencies.operations.setRandomizer = async (_input) => {
          return { status: "no-changes" };
        };

        const route = createPersonalConfigInteractionRoute(dependencies);
        const customId = buildPersonalConfigRouteId({
          action: "randomizer-set",
          locale: "en-US",
          provider: "openrouter",
          enabled: true,
        });

        const interaction = makePersonalInteraction({
          customId,
        });

        await route.execute({} as Client, interaction, requireRoute(customId));

        const capturedPayload = interaction.edits.at(-1);
        expect(capturedPayload).not.toBeNull();
        const renderedText = JSON.stringify(capturedPayload);
        expect(renderedText).toContain("No Changes");
      });

      it("legacy randomizer-toggle action remains routable and flips the stored state", async () => {
        const calls: string[] = [];
        const savedConfig = {
          user_saved_config_id: 1,
          user_id: 1,
          provider: "openrouter",
          model_randomizer_enabled: false,
          fallback_model_refs: [{ type: "llm", id: 103 }],
        } as unknown as UserSavedProviderConfigRow;

        const { dependencies, telemetry } = makeDependencies(calls, {
          loadUserSavedProviders: async () => [savedConfig],
        });

        const route = createPersonalConfigInteractionRoute(dependencies);
        const customId = "personal-config:v2:randomizer-toggle:en-US:openrouter";

        const interaction = makePersonalInteraction({
          customId,
        });

        await route.execute({} as Client, interaction, requireRoute(customId));

        expect(calls).toContain("setRandomizer:openrouter:true");
        expect(telemetry).toContain("personal-config.personal.randomizer.set");
        const capturedPayload = interaction.edits.at(-1);
        expect(capturedPayload).not.toBeNull();
        const renderedText = JSON.stringify(capturedPayload);
        expect(renderedText).toContain(localizedCopy("en-US", "commands.personal.config.randomizer_enabled_heading"));
      });
    });

    describe("Execution of server-fallback-set", () => {
      it("acknowledges the interaction before the write and reports the account opt-out", async () => {
        const calls: string[] = [];
        let acknowledgedDuringWrite = false;
        const { dependencies, telemetry, user } = makeDependencies(calls);
        user.personal_server_fallback_enabled = true;

        dependencies.operations.setServerModelFallback = async (input) => {
          acknowledgedDuringWrite = interaction.deferred || interaction.replied;
          calls.push(`setServerModelFallback:${input.current}:${input.enabled}`);
          user.personal_server_fallback_enabled = input.enabled;
          return { status: "success", enabled: input.enabled };
        };

        const route = createPersonalConfigInteractionRoute(dependencies);
        const customId = buildPersonalConfigRouteId({
          action: "server-fallback-set",
          locale: "en-US",
          enabled: false,
        });
        const interaction = makePersonalInteraction({
          customId,
        });

        await route.execute({} as Client, interaction, requireRoute(customId));

        expect(acknowledgedDuringWrite).toBe(true);
        expect(calls).toContain("setServerModelFallback:true:false");
        expect(telemetry).toContain("personal-config.personal.server-fallback.set");
        expect(JSON.stringify(interaction.edits.at(-1))).toContain(
          localizedCopy("en-US", "commands.personal.config.server_fallback_disabled_heading"),
        );
      });

      it("reports no changes when the stored value already matches", async () => {
        const calls: string[] = [];
        const { dependencies, telemetry, user } = makeDependencies(calls);
        user.personal_server_fallback_enabled = false;

        dependencies.operations.setServerModelFallback = async () => ({ status: "no-changes" });

        const route = createPersonalConfigInteractionRoute(dependencies);
        const customId = buildPersonalConfigRouteId({
          action: "server-fallback-set",
          locale: "en-US",
          enabled: false,
        });
        const interaction = makePersonalInteraction({
          customId,
        });

        await route.execute({} as Client, interaction, requireRoute(customId));

        expect(telemetry).not.toContain("personal-config.personal.server-fallback.set");
        expect(JSON.stringify(interaction.edits.at(-1))).toContain(
          localizedCopy("en-US", "commands.personal.config.no_changes_heading"),
        );
      });
    });
  });

  describe("Spotlight overflow on the block selector", () => {
    const makeBlockPersonas = (count: number) =>
      Array.from({ length: count }, (_, i) => ({ id: 100 + i, name: `Persona ${i + 1}`, isAlter: false }));

    describe("Spotlight Persona Block Selector payload", () => {
      it("renders StringSelect with one option per block bounded by real total when totalPersonas > 50", () => {
        const payload = buildPersonalConfigPanelPayload({
          locale: "en-US",
          category: "advanced",
          page: "spotlight",
          user: makeUser(),
          resolvedNickname: "Tester",
          personas: [],
          guildId: "123456789012345678",
          memoryCount: 0,
          stmCount: 0,
          readStatus: "fresh",
          view: {
            kind: "spotlight-persona-select",
            channelId: "123456789012345678",
            hours: 24,
            fp: "a1b2c3d4",
            totalPersonas: 137,
            chooserPage: 0,
          },
        });

        const components = collectComponents(payload);
        const blockSelect = components.find((c) =>
          c.customId?.includes(":s-blk-s:en-US:123456789012345678:24:a1b2c3d4"),
        );
        expect(blockSelect).toBeDefined();
        expect(blockSelect?.placeholder).toBe(
          localizedCopy("en-US", "commands.personal.config.spotlight_personas_range_placeholder"),
        );
        expect(blockSelect?.options).toEqual([
          { value: "0", label: "Personas 1-50" },
          { value: "1", label: "Personas 51-100" },
          { value: "2", label: "Personas 101-137" },
        ]);
        expect(blockSelect?.disabled).toBe(false);

        // Block count 3 <= 25, so no pagination row
        const paginationButtons = components.filter((c) => c.customId?.includes(":s-blk-p:"));
        expect(paginationButtons).toHaveLength(0);

        const cancelButton = components.find((c) => c.customId === "personal-config:v2:spotlight-set-cancel:en-US");
        expect(cancelButton).toBeDefined();
      });

      it("renders pagination row when block count > 25 (e.g. 1350 personas = 27 blocks)", () => {
        const payload = buildPersonalConfigPanelPayload({
          locale: "en-US",
          category: "advanced",
          page: "spotlight",
          user: makeUser(),
          resolvedNickname: "Tester",
          personas: [],
          guildId: "123456789012345678",
          memoryCount: 0,
          stmCount: 0,
          readStatus: "fresh",
          view: {
            kind: "spotlight-persona-select",
            channelId: "123456789012345678",
            hours: 24,
            fp: "a1b2c3d4",
            totalPersonas: 1350,
            chooserPage: 0,
          },
        });

        const components = collectComponents(payload);
        const blockSelect = components.find((c) => c.customId?.includes(":s-blk-s:"));
        expect(blockSelect).toBeDefined();
        expect(blockSelect?.options).toHaveLength(25);
        expect(blockSelect?.options?.[0]).toEqual({ value: "0", label: "Personas 1-50" });
        expect(blockSelect?.options?.[24]).toEqual({ value: "24", label: "Personas 1201-1250" });

        // Block count 27 > 25, pagination row must be present
        const paginationButtons = components.filter((c) => c.customId?.includes(":s-blk-p:"));
        expect(paginationButtons.length).toBeGreaterThan(0);
      });

      it("disables select when read status is stale", () => {
        const payload = buildPersonalConfigPanelPayload({
          locale: "en-US",
          category: "advanced",
          page: "spotlight",
          user: makeUser(),
          resolvedNickname: "Tester",
          personas: [],
          guildId: "123456789012345678",
          memoryCount: 0,
          stmCount: 0,
          readStatus: "stale",
          view: {
            kind: "spotlight-persona-select",
            channelId: "123456789012345678",
            hours: 24,
            fp: "a1b2c3d4",
            totalPersonas: 137,
            chooserPage: 0,
          },
        });

        const components = collectComponents(payload);
        const blockSelect = components.find((c) => c.customId?.includes(":s-blk-s:"));
        expect(blockSelect?.disabled).toBe(true);
      });
    });

    describe("Spotlight Auto-Trigger Block Selector payload", () => {
      it("renders StringSelect with blocks of 24 bounded by real total", () => {
        const payload = buildPersonalConfigPanelPayload({
          locale: "en-US",
          category: "advanced",
          page: "spotlight",
          user: makeUser(),
          resolvedNickname: "Tester",
          personas: [],
          guildId: "123456789012345678",
          memoryCount: 0,
          stmCount: 0,
          readStatus: "fresh",
          view: {
            kind: "spotlight-auto-range",
            channelId: "123456789012345678",
            hours: 12,
            blockIdx: 0,
            mask: "fff",
            fp: "a1b2c3d4",
            rangePage: 0,
            totalOptions: 55,
          },
        });

        const components = collectComponents(payload);
        const autoSelect = components.find((c) => c.customId?.includes(":s-auto-s:"));
        expect(autoSelect).toBeDefined();
        expect(autoSelect?.placeholder).toBe(
          localizedCopy("en-US", "commands.personal.config.spotlight_auto_range_placeholder"),
        );
        expect(autoSelect?.options).toEqual([
          { value: "0", label: "Personas 1-24" },
          { value: "24", label: "Personas 25-48" },
          { value: "48", label: "Personas 49-55" },
        ]);

        const cancelBtn = components.find((c) => c.customId?.includes(":s-auto-c:"));
        expect(cancelBtn).toBeDefined();

        // blockCount 3 <= 25, no pagination row
        const paginationButtons = components.filter((c) => c.customId?.includes(":s-auto-p:"));
        expect(paginationButtons).toHaveLength(0);
      });

      it("renders pagination row for auto-trigger when blocks > 25", () => {
        const payload = buildPersonalConfigPanelPayload({
          locale: "en-US",
          category: "advanced",
          page: "spotlight",
          user: makeUser(),
          resolvedNickname: "Tester",
          personas: [],
          guildId: "123456789012345678",
          memoryCount: 0,
          stmCount: 0,
          readStatus: "fresh",
          view: {
            kind: "spotlight-auto-range",
            channelId: "123456789012345678",
            hours: 12,
            blockIdx: 0,
            mask: "fff",
            fp: "a1b2c3d4",
            rangePage: 0,
            totalOptions: 700,
          },
        });

        const components = collectComponents(payload);
        const paginationButtons = components.filter((c) => c.customId?.includes(":s-auto-p:"));
        expect(paginationButtons.length).toBeGreaterThan(0);
      });
    });

    describe("Spotlight Remove Block Selector payload", () => {
      it("renders StringSelect with blocks of 50 bounded by real total", () => {
        const payload = buildPersonalConfigPanelPayload({
          locale: "en-US",
          category: "advanced",
          page: "spotlight",
          user: makeUser(),
          resolvedNickname: "Tester",
          personas: [],
          guildId: "123456789012345678",
          memoryCount: 0,
          stmCount: 0,
          readStatus: "fresh",
          view: {
            kind: "spotlight-remove-range",
            rangePage: 0,
            totalOptions: 125,
            fp: "a1b2c3d4",
          },
        });

        const components = collectComponents(payload);
        const remSelect = components.find((c) => c.customId?.includes(":s-rem-s:"));
        expect(remSelect).toBeDefined();
        expect(remSelect?.placeholder).toBe(
          localizedCopy("en-US", "commands.personal.config.spotlight_remove_range_placeholder"),
        );
        expect(remSelect?.options).toEqual([
          { value: "0", label: "Spotlights 1-50" },
          { value: "50", label: "Spotlights 51-100" },
          { value: "100", label: "Spotlights 101-125" },
        ]);

        const cancelBtn = components.find((c) => c.customId?.includes(":spotlight-remove-cancel:"));
        expect(cancelBtn).toBeDefined();

        // blockCount 3 <= 25, no pagination row
        const paginationButtons = components.filter((c) => c.customId?.includes(":s-rem-p:"));
        expect(paginationButtons).toHaveLength(0);
      });

      it("renders pagination row for remove when blocks > 25", () => {
        const payload = buildPersonalConfigPanelPayload({
          locale: "en-US",
          category: "advanced",
          page: "spotlight",
          user: makeUser(),
          resolvedNickname: "Tester",
          personas: [],
          guildId: "123456789012345678",
          memoryCount: 0,
          stmCount: 0,
          readStatus: "fresh",
          view: {
            kind: "spotlight-remove-range",
            rangePage: 0,
            totalOptions: 1500,
            fp: "a1b2c3d4",
          },
        });

        const components = collectComponents(payload);
        const paginationButtons = components.filter((c) => c.customId?.includes(":s-rem-p:"));
        expect(paginationButtons.length).toBeGreaterThan(0);
      });
    });

    describe("Interaction dispatch for spotlight-set-block-select", () => {
      it("opens spotlight set modal on selecting valid block", async () => {
        const personas = makeBlockPersonas(120);
        const fp = computeSpotlightSetFingerprint("guild-123", "user-123", personas);
        let openedWithBlockIdx = -1;
        let openedPersonas: Array<{ id: number }> = [];

        const { dependencies } = makeDependencies([], {
          loadGuildPersonas: async () => personas,
          showSpotlightSetModal: async (_i, _l, _n, _ch, _h, blockIdx, _fp, slice) => {
            openedWithBlockIdx = blockIdx;
            openedPersonas = slice;
          },
        });

        const route = createPersonalConfigInteractionRoute(dependencies);
        const customId = buildPersonalConfigRouteId({
          action: "spotlight-set-block-select",
          locale: "en-US",
          channelId: "123456789012345678",
          hours: 12,
          fp,
        });

        const interaction = makePersonalInteraction({
          kind: "string-select",
          customId,
          values: ["1"],
        });

        await route.execute({} as Client, interaction, requireRoute(customId));

        expect(openedWithBlockIdx).toBe(1);
        expect(openedPersonas).toHaveLength(50);
        expect(openedPersonas[0].id).toBe(personas[50].id);
      });

      it("repaints with stale warning on non-numeric or out-of-range block selection", async () => {
        const personas = makeBlockPersonas(120);
        const fp = computeSpotlightSetFingerprint("guild-123", "user-123", personas);
        let modalOpened = false;

        const { dependencies } = makeDependencies([], {
          loadGuildPersonas: async () => personas,
          showSpotlightSetModal: async () => {
            modalOpened = true;
          },
        });

        const route = createPersonalConfigInteractionRoute(dependencies);
        const customId = buildPersonalConfigRouteId({
          action: "spotlight-set-block-select",
          locale: "en-US",
          channelId: "123456789012345678",
          hours: 12,
          fp,
        });

        const interaction = makePersonalInteraction({
          kind: "string-select",
          customId,
          values: ["99"],
        });

        await route.execute({} as Client, interaction, requireRoute(customId));

        expect(modalOpened).toBe(false);
        const json = JSON.stringify(interaction.edits.at(-1));
        expect(json).toContain(localizedCopy("en-US", "commands.personal.config.stale_warning"));
      });
    });

    describe("Interaction dispatch for spot-set-auto-select", () => {
      it("opens auto-trigger modal on selecting valid block", async () => {
        const personas = makeBlockPersonas(60);
        const fp = computeSpotlightSetFingerprint("guild-123", "user-123", personas);
        const mask = ((1n << 50n) - 1n).toString(36);
        let openedSlice: Array<{ id: number }> = [];

        const { dependencies } = makeDependencies([], {
          loadGuildPersonas: async () => personas,
          showSpotlightAutoTriggerModal: async (_i, _l, _n, _ch, _h, _blk, _m, _fp, slice) => {
            openedSlice = slice;
          },
        });

        const route = createPersonalConfigInteractionRoute(dependencies);
        const customId = buildPersonalConfigRouteId({
          action: "spot-set-auto-select",
          locale: "en-US",
          channelId: "123456789012345678",
          hours: 12,
          blockIdx: 0,
          mask,
          fp,
        });

        const interaction = makePersonalInteraction({
          kind: "string-select",
          customId,
          values: ["24"],
        });

        await route.execute({} as Client, interaction, requireRoute(customId));

        expect(openedSlice).toHaveLength(24);
        expect(openedSlice[0].id).toBe(personas[24].id);
      });

      it("repaints with stale warning on out-of-bounds start value", async () => {
        const personas = makeBlockPersonas(60);
        const fp = computeSpotlightSetFingerprint("guild-123", "user-123", personas);
        const mask = ((1n << 50n) - 1n).toString(36);
        let modalOpened = false;

        const { dependencies } = makeDependencies([], {
          loadGuildPersonas: async () => personas,
          showSpotlightAutoTriggerModal: async () => {
            modalOpened = true;
          },
        });

        const route = createPersonalConfigInteractionRoute(dependencies);
        const customId = buildPersonalConfigRouteId({
          action: "spot-set-auto-select",
          locale: "en-US",
          channelId: "123456789012345678",
          hours: 12,
          blockIdx: 0,
          mask,
          fp,
        });

        const interaction = makePersonalInteraction({
          kind: "string-select",
          customId,
          values: ["100"],
        });

        await route.execute({} as Client, interaction, requireRoute(customId));

        expect(modalOpened).toBe(false);
        const json = JSON.stringify(interaction.edits.at(-1));
        expect(json).toContain(localizedCopy("en-US", "commands.personal.config.stale_warning"));
      });
    });

    describe("Interaction dispatch for spotlight-remove-select", () => {
      it("opens remove modal on selecting valid block", async () => {
        const activeSpotlights = Array.from({ length: 120 }, (_, i) =>
          makeSpotlight(`1234567890123456${(i % 100).toString().padStart(2, "0")}`, { personaIds: [1] }),
        );
        const fp = computeSpotlightRemoveFingerprint("guild-123", "user-123", activeSpotlights);
        let openedStart = -1;
        let openedSlice: PersonalSpotlightStatus[] = [];

        const { dependencies } = makeDependencies([], {
          loadActiveSpotlights: async () => activeSpotlights,
          showSpotlightRemoveModal: async (_i, _l, _n, start, _fp, slice) => {
            openedStart = start;
            openedSlice = slice;
          },
        });

        const route = createPersonalConfigInteractionRoute(dependencies);
        const customId = buildPersonalConfigRouteId({
          action: "spotlight-remove-select",
          locale: "en-US",
          fp,
        });

        const interaction = makePersonalInteraction({
          kind: "string-select",
          customId,
          values: ["50"],
        });

        await route.execute({} as Client, interaction, requireRoute(customId));

        expect(openedStart).toBe(50);
        expect(openedSlice).toHaveLength(50);
        expect(openedSlice[0].channelDiscId).toBe(activeSpotlights[50].channelDiscId);
      });

      it("repaints with stale warning on out-of-bounds start value", async () => {
        const activeSpotlights = Array.from({ length: 120 }, (_, i) =>
          makeSpotlight(`1234567890123456${(i % 100).toString().padStart(2, "0")}`, { personaIds: [1] }),
        );
        const fp = computeSpotlightRemoveFingerprint("guild-123", "user-123", activeSpotlights);
        let modalOpened = false;

        const { dependencies } = makeDependencies([], {
          loadActiveSpotlights: async () => activeSpotlights,
          showSpotlightRemoveModal: async () => {
            modalOpened = true;
          },
        });

        const route = createPersonalConfigInteractionRoute(dependencies);
        const customId = buildPersonalConfigRouteId({
          action: "spotlight-remove-select",
          locale: "en-US",
          fp,
        });

        const interaction = makePersonalInteraction({
          kind: "string-select",
          customId,
          values: ["500"],
        });

        await route.execute({} as Client, interaction, requireRoute(customId));

        expect(modalOpened).toBe(false);
        const json = JSON.stringify(interaction.edits.at(-1));
        expect(json).toContain(localizedCopy("en-US", "commands.personal.config.stale_warning"));
      });
    });
  });
});
