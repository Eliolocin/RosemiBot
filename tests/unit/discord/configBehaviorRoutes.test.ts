/**
 * Route coverage for Behavior > General and Trigger.
 *
 * These cases dispatch through the real registry, policy, and route handler. Repository spies
 * only observe the canonical methods the handler should call, which keeps the authorization and
 * acknowledgement assertions on the actual wiring.
 */
import { beforeAll, describe, expect, it, spyOn } from "bun:test";
import { ChannelType, ComponentType, type Client } from "discord.js";
import type { RandomTriggerRow, TomoriState } from "@/types/db/schema";
import * as shortTermMemoryCache from "@/utils/cache/shortTermMemoryCache";
import * as tomoriStateCache from "@/utils/cache/tomoriStateCache";
import { configRepository, serverScheduleRepository } from "@/utils/db/repositories";
import { shortTermMemoryRepository } from "@/utils/db/repositories/ShortTermMemoryRepository";
import {
  CONFIG_PERSONA_SELECT_PAGE_SIZE,
  CONFIG_RANDOM_TRIGGER_CHECKBOX_CAPACITY,
  CONFIG_ROUTE_CODECS,
  buildConfigRouteId,
  computeRandomTriggerRemoveFingerprint,
  parseConfigPanelRoute,
} from "@/utils/discord/configPanelCatalog";
import { createConfigInteractionRoute } from "@/utils/discord/interactions/configRoutes";
import type { ConfigRouteDependencies, ConfigScope } from "@/utils/discord/interactions/configRouteContext";
import {
  InteractionRouteRegistry,
  parseInteractionRoute,
  type GlobalRoutableInteraction,
} from "@/utils/discord/interactions/routeRegistry";
import { dispatchGlobalInteraction } from "@/utils/discord/interactions/router";
import { buildConfigModalFieldId, CONFIG_PERSONA_PROMPT_PART_FIELDS } from "@/utils/discord/ui/configModals";
import {
  BEHAVIOR_COOLDOWN_LENGTH_FIELD,
  BEHAVIOR_COOLDOWN_TYPE_FIELD,
  BEHAVIOR_FETCH_LIMIT_FIELD,
  BEHAVIOR_HUMANIZER_FIELD,
  BEHAVIOR_PRESET_BUILT_IN,
  BEHAVIOR_PRESET_FIELD,
  BEHAVIOR_RANDOM_CHANNEL_FIELD,
  BEHAVIOR_RANDOM_PERSONA_FIELD,
  BEHAVIOR_RANDOM_PROMPT_FIELD,
  BEHAVIOR_RANDOM_SETTINGS_FIELD,
  buildBehaviorCooldownModal,
  buildBehaviorMemoryTaggingModal,
  buildBehaviorNoticeVisibilityModal,
  buildBehaviorStmParametersModal,
  BEHAVIOR_STM_CATEGORY_PREFIX,
  buildBehaviorToolContextModal,
  buildBehaviorToolTriggerAddModal,
  buildBehaviorToolTriggerRemoveModal,
  buildBehaviorHumanizerModal,
  buildBehaviorRandomAddModal,
  buildBehaviorRandomRemoveModal,
} from "@/utils/discord/ui/configBehaviorModals";
import { initializeLocalizer, localizer } from "@/utils/text/localizer";
import { TOOL_NOTICE_DEFINITIONS } from "@/constants/toolNotices";
import { localizedCopy, localizedProse } from "../../helpers/localeCases";
import {
  createInteractionRecorder,
  createRouteInteraction,
  type RouteInteraction,
} from "../../helpers/routeInteraction";

beforeAll(async () => initializeLocalizer());

const CLIENT = {} as Client;

type ConfigInteraction = Parameters<ReturnType<typeof createConfigInteractionRoute>["execute"]>[1];

function makeState(): TomoriState {
  return {
    server_id: 9,
    persona_id: 55,
    persona_nickname: "Mirri",
    is_alter: false,
    trigger_words: [],
    naming_config: { prefixes: {}, suffixes: {}, addressTerms: {} },
    attribute_list: [],
    sample_dialogues_in: [],
    sample_dialogues_out: [],
    config: {
      system_prompt: "Old prompt",
      context_note: null,
      context_note_depth: 0,
      humanizer_degree: 1,
      message_fetch_limit: 80,
      timezone_offset: 0,
      cascade_limit: 3,
      match_limit: 3,
      deliberate_trigger_mode: false,
      always_reply_enabled: false,
      cooldown_type: 0,
      cooldown_length: 5,
    },
  } as unknown as TomoriState;
}

function makeRandomTrigger(): RandomTriggerRow & { trigger_id: number } {
  return {
    trigger_id: 9,
    server_id: 9,
    channel_disc_id: "channel-1",
    persona_id: 55,
    timer_hours: 2,
    random_offset_range: 1,
    chance_percent: 40,
    silence_threshold_hours: null,
    respond_to_self: false,
    custom_prompt: null,
    failure_threshold: null,
    consecutive_failures: 0,
    next_trigger_at: new Date("2026-01-01T00:00:00Z"),
  };
}

interface Harness {
  dependencies: Partial<ConfigRouteDependencies>;
  scope: ConfigScope;
  /** Payloads every interaction in this harness has edited, oldest first. */
  readonly edits: unknown[];
  /** Payloads every interaction in this harness has replied or followed up with, oldest first. */
  readonly replies: unknown[];
  modals: unknown[];
  deferredAtWrite: boolean[];
  telemetry: string[];
  /** Values the intercepted modal store holds, keyed by interaction id then field id. */
  selectValues: Map<string, Map<string, string>>;
  /** Files the newest interaction's arrays behind the running `edits`/`replies` views. */
  record: (interaction: RouteInteraction) => void;
}

function makeHarness(inGuild = true): Harness {
  const state = makeState();
  const scope: ConfigScope = {
    serverDiscId: inGuild ? "guild-1" : "user-1",
    guildId: inGuild ? "guild-1" : null,
    internalServerId: 9,
    userId: 1,
    actor: { workspaceKind: inGuild ? "guild" : "dm", isManager: true },
    personas: [state],
    readStatus: "fresh",
  };
  const recorder = createInteractionRecorder();
  const harness: Harness = {
    scope,
    get edits() {
      return recorder.edits;
    },
    get replies() {
      return recorder.replies;
    },
    modals: [],
    deferredAtWrite: [],
    telemetry: [],
    selectValues: new Map(),
    dependencies: {
      resolveScope: async () => scope,
      getPersonaAvatarData: async () => ({ url: null, files: [] }),
      createNonce: () => "nonce1234567",
      showModal: async (_interaction, payload) => {
        harness.modals.push(payload);
      },
      takeFileUpload: () => undefined,
      takeAvatarUpload: () => undefined,
      takeCheckboxValues: () => [],
      takeSelectValue: (interactionId: string, fieldId: string) =>
        harness.selectValues.get(interactionId)?.get(fieldId),
      recordAction: ({ action }) => {
        harness.telemetry.push(action);
      },
      loadBehaviorView: async (current) => ({
        general: {
          responsePrefill: null,
          prefillBlocker: null,
          prefillModelName: "gemini-2.5-flash",
          systemPrompt: current.config.system_prompt ?? null,
          contextNote: current.config.context_note ?? null,
          contextNoteDepth: current.config.context_note_depth ?? 0,
          humanizerDegree: current.config.humanizer_degree ?? 1,
          messageFetchLimit: current.config.message_fetch_limit ?? 80,
          timezoneOffset: current.config.timezone_offset ?? 0,
        },
        trigger: {
          randomTriggers: [],
          cascadeLimit: current.config.cascade_limit ?? 3,
          matchLimit: current.config.match_limit ?? 3,
          deliberateTriggerMode: current.config.deliberate_trigger_mode ?? false,
          alwaysReplyEnabled: current.config.always_reply_enabled ?? false,
          cooldownType: current.config.cooldown_type ?? 0,
          cooldownLength: current.config.cooldown_length ?? 5,
        },
      }),
      loadPermissionsView: async () => ({
        capabilities: { toolUseEnabled: true, includeElevenLabs: true, definitionStates: {} },
        privacy: { stmPrivacyBypass: false },
      }),
    },
    record: recorder.record,
  };
  return harness;
}

function makeInteraction(
  harness: Harness,
  customId: string,
  options: {
    kind?: "button" | "modal" | "select";
    fields?: Record<string, string>;
    /** Component type per field id, for modal fields that are not text inputs. */
    componentTypes?: Record<string, number>;
    /** Values the reader should find in the intercepted store, keyed by field id. */
    selectValues?: Record<string, string>;
    values?: string[];
    isManager?: boolean;
    inGuild?: boolean;
    onFollowUp?: () => void;
  } = {},
): RouteInteraction {
  const kind = options.kind ?? "button";
  const interactionId = "interaction-1";
  harness.selectValues.set(interactionId, new Map(Object.entries(options.selectValues ?? {})));

  const interaction = createRouteInteraction({
    customId,
    kind: kind === "select" ? "string-select" : kind,
    guildId: options.inGuild === false ? null : "guild-1",
    isManager: options.isManager ?? true,
    values: options.values ?? [],
    overrides: { id: interactionId },
  });
  // Routes that resolve a chosen channel look it up in the guild cache, so the lounge the routes
  // repaint from has to be present there.
  interaction.guild?.channels.cache.set("channel-1", { type: ChannelType.GuildText, name: "lounge" });

  // The route's text reader checks the submitted component's type before reading it, because
  // discord.js keys every submitted component by custom id whatever its kind. The shared factory's
  // presence map cannot carry a type, so the richer one is attached here.
  const submittedFields = options.fields ?? {};
  const fieldRows = new Map(
    Object.entries(submittedFields).map(([fieldId, value]) => [
      fieldId,
      { customId: fieldId, type: options.componentTypes?.[fieldId] ?? ComponentType.TextInput, value },
    ]),
  );
  interaction.fields = {
    fields: fieldRows as unknown as RouteInteraction["fields"]["fields"],
    getTextInputValue: (fieldId: string) => submittedFields[fieldId] ?? "",
  };
  if (options.onFollowUp) {
    const recordFollowUp = interaction.followUp;
    interaction.followUp = async (payload?: unknown) => {
      options.onFollowUp?.();
      return recordFollowUp(payload);
    };
  }

  harness.record(interaction);
  return interaction;
}

async function dispatch(harness: Harness, interaction: RouteInteraction): Promise<void> {
  const registry = new InteractionRouteRegistry([createConfigInteractionRoute(harness.dependencies)]);
  await registry.dispatch(CLIENT, interaction as unknown as ConfigInteraction);
}

function collectRawComponentTypes(value: unknown): number[] {
  if (Array.isArray(value)) return value.flatMap(collectRawComponentTypes);
  if (typeof value !== "object" || value === null) return [];
  const record = value as Record<string, unknown>;
  return [
    ...(typeof record.type === "number" ? [record.type] : []),
    ...Object.values(record).flatMap(collectRawComponentTypes),
  ];
}

/**
 * Maps each modal field's custom id to the type of the component the reader will actually receive.
 *
 * The component carrying a custom id sits one level below the label that wraps it, so the type of
 * interest is the innermost one.
 */
function collectModalFieldTypes(payload: unknown): Map<string, number> {
  const types = new Map<string, number>();

  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const entry of value) walk(entry);
      return;
    }
    if (typeof value !== "object" || value === null) return;

    const record = value as Record<string, unknown>;
    if (typeof record.custom_id === "string" && typeof record.type === "number") {
      types.set(record.custom_id, record.type);
    }
    for (const entry of Object.values(record)) walk(entry);
  };

  walk(payload);
  return types;
}

const D9_WIRE_CONTRACT: ReadonlyArray<readonly [string, Parameters<typeof buildConfigRouteId>[0]]> = [
  ["config:v2:beh-prompt-open:en-US", { action: "behavior-prompt-open", locale: "en-US" }],
  [
    "config:v2:beh-prompt-sub:en-US:nonce1234567",
    { action: "behavior-prompt-submit", locale: "en-US", nonce: "nonce1234567" },
  ],
  ["config:v2:beh-preset-open:en-US", { action: "behavior-preset-open", locale: "en-US" }],
  [
    "config:v2:beh-preset-sub:en-US:nonce1234567",
    { action: "behavior-preset-submit", locale: "en-US", nonce: "nonce1234567" },
  ],
  ["config:v2:beh-prompt-remove:en-US", { action: "behavior-prompt-remove", locale: "en-US" }],
  ["config:v2:beh-prefill-open:en-US", { action: "behavior-prefill-open", locale: "en-US" }],
  [
    "config:v2:beh-prefill-sub:en-US:nonce1234567",
    { action: "behavior-prefill-submit", locale: "en-US", nonce: "nonce1234567" },
  ],
  ["config:v2:beh-context-open:en-US", { action: "behavior-context-open", locale: "en-US" }],
  [
    "config:v2:beh-context-sub:en-US:nonce1234567",
    { action: "behavior-context-submit", locale: "en-US", nonce: "nonce1234567" },
  ],
  ["config:v2:beh-humanizer-open:en-US", { action: "behavior-humanizer-open", locale: "en-US" }],
  [
    "config:v2:beh-humanizer-sub:en-US:nonce1234567",
    { action: "behavior-humanizer-submit", locale: "en-US", nonce: "nonce1234567" },
  ],
  ["config:v2:beh-fetch-open:en-US", { action: "behavior-fetch-open", locale: "en-US" }],
  [
    "config:v2:beh-fetch-sub:en-US:nonce1234567",
    { action: "behavior-fetch-submit", locale: "en-US", nonce: "nonce1234567" },
  ],
  ["config:v2:beh-timezone-open:en-US", { action: "behavior-timezone-open", locale: "en-US" }],
  [
    "config:v2:beh-timezone-sub:en-US:nonce1234567",
    { action: "behavior-timezone-submit", locale: "en-US", nonce: "nonce1234567" },
  ],
  ["config:v2:beh-random-add-open:en-US", { action: "behavior-random-add-open", locale: "en-US" }],
  ["config:v2:beh-random-add-range:en-US", { action: "behavior-random-add-range-select", locale: "en-US" }],
  [
    "config:v2:beh-random-add-sub:en-US:nonce1234567",
    { action: "behavior-random-add-submit", locale: "en-US", nonce: "nonce1234567" },
  ],
  ["config:v2:beh-random-rem-open:en-US", { action: "behavior-random-remove-open", locale: "en-US" }],
  ["config:v2:beh-random-rem-open:en-US:1250", { action: "behavior-random-remove-open", locale: "en-US", start: 1250 }],
  ["config:v2:beh-random-rem-select:en-US", { action: "behavior-random-remove-select", locale: "en-US" }],
  ["config:v2:beh-random-rem-page:en-US:1250", { action: "behavior-random-remove-page", locale: "en-US", start: 1250 }],
  ["config:v2:beh-random-rem-cancel:en-US", { action: "behavior-random-remove-cancel", locale: "en-US" }],
  [
    "config:v2:beh-random-rem-cancel:en-US:1250",
    { action: "behavior-random-remove-cancel", locale: "en-US", start: 1250 },
  ],
  [
    "config:v2:beh-random-rem-sub:en-US:1250:abcd1234:nonce1234567",
    { action: "behavior-random-remove-submit", locale: "en-US", start: 1250, fp: "abcd1234", nonce: "nonce1234567" },
  ],
  ["config:v2:beh-limits-open:en-US", { action: "behavior-limits-open", locale: "en-US" }],
  [
    "config:v2:beh-limits-sub:en-US:nonce1234567",
    { action: "behavior-limits-submit", locale: "en-US", nonce: "nonce1234567" },
  ],
  ["config:v2:beh-dtm-set:en-US:1", { action: "behavior-dtm-set", locale: "en-US", enabled: true }],
  ["config:v2:beh-always-set:en-US:0", { action: "behavior-always-set", locale: "en-US", enabled: false }],
  ["config:v2:beh-cooldown-open:en-US", { action: "behavior-cooldown-open", locale: "en-US" }],
  [
    "config:v2:beh-cooldown-sub:en-US:nonce1234567",
    { action: "behavior-cooldown-submit", locale: "en-US", nonce: "nonce1234567" },
  ],
];

describe("config Behavior routes", () => {
  it("routes a v1 Config control to the stale-version outdated-panel path", async () => {
    const harness = makeHarness();
    const staleInteraction = makeInteraction(harness, "config:v1:beh-prompt-open:en-US");

    await dispatchGlobalInteraction(CLIENT, staleInteraction as unknown as GlobalRoutableInteraction);

    expect(harness.replies).toHaveLength(1);
    expect((harness.replies[0] as { content?: string }).content).toContain("out of date");
  });

  it("writes Self-Debug through the real route and repaints Context Additions", async () => {
    const events: string[] = [];
    const update = spyOn(configRepository, "updateChatConfig").mockImplementation(async (_serverId, patch) => {
      events.push("write");
      expect(patch).toEqual({ self_debug_enabled: true });
      return true;
    });
    const invalidate = spyOn(tomoriStateCache, "invalidateTomoriStateCache").mockImplementation(() => {
      events.push("invalidate");
    });
    try {
      const harness = makeHarness();
      const interaction = makeInteraction(
        harness,
        buildConfigRouteId({ action: "behavior-self-debug-set", locale: "en-US", enabled: true }),
      );
      let acknowledged = false;
      update.mockImplementation(async (_serverId, patch) => {
        acknowledged = interaction.deferred || interaction.replied;
        events.push("write");
        expect(patch).toEqual({ self_debug_enabled: true });
        return true;
      });

      await dispatch(harness, interaction);

      expect(acknowledged).toBe(true);
      expect(events).toEqual(["write", "invalidate"]);
      expect(harness.telemetry).toEqual(["server-config.workspace.self-debug.set"]);
      expect(JSON.stringify(harness.edits.at(-1))).toContain("context-additions");
    } finally {
      update.mockRestore();
      invalidate.mockRestore();
    }
  });

  it("writes Automatic STM Summarization to the capabilities table and repaints Memory", async () => {
    const events: string[] = [];
    const update = spyOn(configRepository, "updateCapabilitiesConfig").mockImplementation(async (_serverId, patch) => {
      events.push("write");
      expect(patch).toEqual({ short_term_memory_enabled: false });
      return true;
    });
    const invalidate = spyOn(tomoriStateCache, "invalidateTomoriStateCache").mockImplementation(() => {
      events.push("invalidate");
    });
    try {
      const harness = makeHarness();
      const interaction = makeInteraction(
        harness,
        buildConfigRouteId({ action: "behavior-stm-enabled-set", locale: "en-US", enabled: false }),
      );

      await dispatch(harness, interaction);

      expect(events).toEqual(["write", "invalidate"]);
      expect(harness.telemetry).toEqual(["server-config.workspace.capabilities.set"]);
      expect(JSON.stringify(harness.edits.at(-1))).toContain("behavior:memory");
    } finally {
      update.mockRestore();
      invalidate.mockRestore();
    }
  });

  it("round-trips the literal D9 custom-ID wire contract", () => {
    for (const [customId, expected] of D9_WIRE_CONTRACT) {
      const parsed = parseInteractionRoute(customId);
      expect(parsed).not.toBeNull();
      if (!parsed) throw new Error(`D9 route did not parse: ${customId}`);
      expect(parseConfigPanelRoute(parsed)).toEqual(expected);
      expect(buildConfigRouteId(expected)).toBe(customId);
    }
  });

  it("pins every D9 action to its literal wire token and field order", () => {
    const expected: Record<string, { wireToken: string; fields: string[] }> = {
      "behavior-prompt-open": { wireToken: "beh-prompt-open", fields: [] },
      "behavior-prompt-submit": { wireToken: "beh-prompt-sub", fields: ["nonce"] },
      "behavior-preset-open": { wireToken: "beh-preset-open", fields: [] },
      "behavior-preset-submit": { wireToken: "beh-preset-sub", fields: ["nonce"] },
      "behavior-prompt-remove": { wireToken: "beh-prompt-remove", fields: [] },
      "behavior-prefill-open": { wireToken: "beh-prefill-open", fields: [] },
      "behavior-prefill-submit": { wireToken: "beh-prefill-sub", fields: ["nonce"] },
      "behavior-context-open": { wireToken: "beh-context-open", fields: [] },
      "behavior-context-submit": { wireToken: "beh-context-sub", fields: ["nonce"] },
      "behavior-humanizer-open": { wireToken: "beh-humanizer-open", fields: [] },
      "behavior-humanizer-submit": { wireToken: "beh-humanizer-sub", fields: ["nonce"] },
      "behavior-fetch-open": { wireToken: "beh-fetch-open", fields: [] },
      "behavior-fetch-submit": { wireToken: "beh-fetch-sub", fields: ["nonce"] },
      "behavior-timezone-open": { wireToken: "beh-timezone-open", fields: [] },
      "behavior-timezone-submit": { wireToken: "beh-timezone-sub", fields: ["nonce"] },
      "behavior-random-add-open": { wireToken: "beh-random-add-open", fields: [] },
      "behavior-random-add-range-select": { wireToken: "beh-random-add-range", fields: [] },
      "behavior-random-add-submit": { wireToken: "beh-random-add-sub", fields: ["nonce"] },
      "behavior-random-remove-open": { wireToken: "beh-random-rem-open", fields: ["start"] },
      "behavior-random-remove-select": { wireToken: "beh-random-rem-select", fields: [] },
      "behavior-random-remove-page": { wireToken: "beh-random-rem-page", fields: ["start"] },
      "behavior-random-remove-cancel": { wireToken: "beh-random-rem-cancel", fields: ["start"] },
      "behavior-random-remove-submit": { wireToken: "beh-random-rem-sub", fields: ["start", "fp", "nonce"] },
      "behavior-limits-open": { wireToken: "beh-limits-open", fields: [] },
      "behavior-limits-submit": { wireToken: "beh-limits-sub", fields: ["nonce"] },
      "behavior-dtm-set": { wireToken: "beh-dtm-set", fields: ["enabled"] },
      "behavior-always-set": { wireToken: "beh-always-set", fields: ["enabled"] },
      "behavior-cooldown-open": { wireToken: "beh-cooldown-open", fields: [] },
      "behavior-cooldown-submit": { wireToken: "beh-cooldown-sub", fields: ["nonce"] },
      "behavior-tool-mode-set": { wireToken: "beh-tool-mode-set", fields: ["enabled"] },
      "behavior-tool-context-open": { wireToken: "beh-tool-context-open", fields: [] },
      "behavior-tool-context-submit": { wireToken: "beh-tool-context-sub", fields: ["nonce"] },
      "behavior-tool-trigger-add-open": { wireToken: "beh-tool-trigger-add-open", fields: [] },
      "behavior-tool-trigger-add-submit": { wireToken: "beh-tool-trigger-add-sub", fields: ["nonce"] },
      "behavior-tool-trigger-remove-open": { wireToken: "beh-tool-trigger-remove-open", fields: [] },
      "behavior-tool-trigger-remove-submit": { wireToken: "beh-tool-trigger-remove-sub", fields: ["nonce"] },
      "behavior-send-limit-open": { wireToken: "beh-send-limit-open", fields: [] },
      "behavior-send-limit-submit": { wireToken: "beh-send-limit-sub", fields: ["nonce"] },
      "behavior-self-debug-set": { wireToken: "beh-self-debug-set", fields: ["enabled"] },
      "behavior-notice-visibility-open": { wireToken: "beh-notices-open", fields: [] },
      "behavior-notice-visibility-submit": { wireToken: "beh-notices-sub", fields: ["nonce"] },
      "behavior-notice-verbosity-set": { wireToken: "beh-notice-verbosity-set", fields: ["verbosity"] },
      "behavior-speech-transcripts-set": { wireToken: "beh-transcripts-set", fields: ["enabled"] },
      "behavior-memory-tagging-open": { wireToken: "beh-memory-tag-open", fields: [] },
      "behavior-memory-tagging-submit": { wireToken: "beh-memory-tag-sub", fields: ["nonce"] },
      "behavior-stm-enabled-set": { wireToken: "beh-stm-enabled-set", fields: ["enabled"] },
      "behavior-stm-parameters-open": { wireToken: "beh-stm-params-open", fields: [] },
      "behavior-stm-parameters-submit": { wireToken: "beh-stm-params-sub", fields: ["nonce"] },
      "behavior-stm-categories-open": { wireToken: "beh-stm-categories-open", fields: [] },
      "behavior-stm-categories-submit": { wireToken: "beh-stm-categories-sub", fields: ["nonce"] },
      "behavior-stm-prompt-open": { wireToken: "beh-stm-prompt-open", fields: [] },
      "behavior-stm-prompt-submit": { wireToken: "beh-stm-prompt-sub", fields: ["nonce"] },
    };

    expect(Object.keys(expected).sort()).toEqual(
      Object.keys(CONFIG_ROUTE_CODECS)
        .filter((action) => action.startsWith("behavior-"))
        .sort(),
    );
    for (const [action, contract] of Object.entries(expected)) {
      const codec = CONFIG_ROUTE_CODECS[action as keyof typeof CONFIG_ROUTE_CODECS];
      expect(codec.wireToken).toBe(contract.wireToken);
      expect<string[]>(codec.fields.map((field) => field.key)).toEqual(contract.fields);
    }
  });

  it("never renders a field the write path reads as text as a radio group", () => {
    // A radio group is keyed by custom id like any other component, so reading it with
    // `getTextInputValue` finds the id, fails the type check, and throws out of the route. Pinning
    // the types makes a builder change that breaks that pairing fail in CI rather than in a guild.
    const nonce = "nonce1234567";
    const humanizerFields = collectModalFieldTypes(buildBehaviorHumanizerModal("en-US", nonce, 1));
    const cooldownFields = collectModalFieldTypes(buildBehaviorCooldownModal("en-US", nonce, 0, 5));

    expect(humanizerFields.get(buildConfigModalFieldId(BEHAVIOR_HUMANIZER_FIELD, nonce))).toBe(21);
    expect(cooldownFields.get(buildConfigModalFieldId(BEHAVIOR_COOLDOWN_TYPE_FIELD, nonce))).toBe(21);
    expect(cooldownFields.get(buildConfigModalFieldId(BEHAVIOR_COOLDOWN_LENGTH_FIELD, nonce))).toBe(4);
  });

  it("emits literal raw modal component types for Behavior inputs", () => {
    const addModal = buildBehaviorRandomAddModal("en-US", "nonce1234567", [makeState()]);
    const humanizerModal = buildBehaviorHumanizerModal("en-US", "nonce1234567", 1);
    const removeModal = buildBehaviorRandomRemoveModal("en-US", "nonce1234567", "abcd1234", 0, [makeRandomTrigger()]);
    const addTypes = collectRawComponentTypes(addModal);
    const humanizerTypes = collectRawComponentTypes(humanizerModal);
    const removeTypes = collectRawComponentTypes(removeModal);
    const experimentalTypes = collectRawComponentTypes(buildBehaviorToolContextModal("en-US", "nonce1234567", 4));
    const triggerTypes = collectRawComponentTypes(buildBehaviorToolTriggerAddModal("en-US", "nonce1234567"));
    const triggerRemoveTypes = collectRawComponentTypes(
      buildBehaviorToolTriggerRemoveModal("en-US", "nonce1234567", { image: ["draw it"] }),
    );
    const noticeTypes = collectRawComponentTypes(buildBehaviorNoticeVisibilityModal("en-US", "nonce1234567", []));
    const memoryTypes = collectRawComponentTypes(buildBehaviorMemoryTaggingModal("en-US", "nonce1234567", false, true));
    const stmTypes = collectRawComponentTypes(buildBehaviorStmParametersModal("en-US", "nonce1234567", null));

    expect(addTypes).toContain(18); // Label
    expect(addTypes).toContain(8); // Channel Select
    expect(addTypes).toContain(22); // Checkbox Group
    expect(addTypes).toContain(4); // Text Input
    expect(humanizerTypes).toContain(18); // Label
    expect(humanizerTypes).toContain(21); // Radio Group
    expect(removeTypes).toContain(18); // Label
    expect(removeTypes).toContain(22); // Checkbox Group
    expect(experimentalTypes).toContain(4); // Text Input
    expect(triggerTypes).toContain(3); // String Select
    expect(triggerRemoveTypes).toContain(22); // Checkbox Group
    expect(noticeTypes).toContain(22); // Checkbox Group
    expect(memoryTypes).toContain(21); // Radio Group
    expect(stmTypes).toContain(21); // Radio Group

    const fiftyTriggerEntries = Object.fromEntries(
      Array.from({ length: 50 }, (_unused, index) => [`target-${index}`, [`trigger-${index}`]]),
    );
    expect(buildBehaviorToolTriggerRemoveModal("en-US", "nonce1234567", fiftyTriggerEntries).components).toHaveLength(
      5,
    );
  });

  it("opens the Random Trigger Add modal on the persona page its range entry names", async () => {
    // A roster past one page is reachable only through the range select, so the start the option
    // carries has to reach the builder: otherwise every range would reopen page one.
    const personas = Array.from({ length: 60 }, (_unused, index) => ({
      ...makeState(),
      persona_id: index + 1,
      persona_nickname: `Persona ${index + 1}`,
      is_alter: index !== 0,
    }));
    const harness = makeHarness(true);
    harness.scope.personas = personas;
    await dispatch(
      harness,
      makeInteraction(harness, buildConfigRouteId({ action: "behavior-random-add-range-select", locale: "en-US" }), {
        kind: "select",
        values: ["24"],
      }),
    );
    expect(harness.modals).toHaveLength(1);
    const personaWrapper = (harness.modals[0] as { components: unknown[] }).components[1] as
      | { component?: { options?: Array<{ value: string }> } }
      | undefined;
    const options = personaWrapper?.component?.options ?? [];
    expect(options[0]?.value).toBe("random");
    expect(options).toHaveLength(25);
    const values = options.map((option) => option.value);
    expect(values).toContain("25");
    expect(values).toContain("48");
    expect(values).not.toContain("1");
    expect(values).not.toContain("49");
  });

  it("acknowledges before a permitted DM General write", async () => {
    const harness = makeHarness(false);
    const nonce = "nonce1234567";
    const fields = Object.fromEntries(
      CONFIG_PERSONA_PROMPT_PART_FIELDS.map((field, index) => [
        buildConfigModalFieldId(field, nonce),
        index === 0 ? "New prompt" : "",
      ]),
    );
    const interaction = makeInteraction(
      harness,
      buildConfigRouteId({ action: "behavior-prompt-submit", locale: "en-US", nonce }),
      { kind: "modal", fields, inGuild: false },
    );
    const update = spyOn(configRepository, "updateChatConfig").mockImplementation(async () => {
      harness.deferredAtWrite.push(interaction.deferred || interaction.replied);
      return true;
    });
    await dispatch(harness, interaction);
    expect(harness.deferredAtWrite).toEqual([true]);
    expect(update).toHaveBeenCalledTimes(1);
    update.mockRestore();
  });

  it("denies a forged guild-member General write without touching the repository", async () => {
    const harness = makeHarness(true);
    const update = spyOn(configRepository, "updateChatConfig").mockResolvedValue(true);
    const updateTrigger = spyOn(configRepository, "updateTriggerBehaviorConfig").mockResolvedValue(true);
    await dispatch(
      harness,
      makeInteraction(
        harness,
        buildConfigRouteId({ action: "behavior-fetch-submit", locale: "en-US", nonce: "nonce1234567" }),
        {
          kind: "modal",
          isManager: false,
          fields: { [buildConfigModalFieldId(BEHAVIOR_FETCH_LIMIT_FIELD, "nonce1234567")]: "60" },
        },
      ),
    );
    await dispatch(
      harness,
      makeInteraction(harness, buildConfigRouteId({ action: "behavior-dtm-set", locale: "en-US", enabled: false }), {
        isManager: false,
      }),
    );
    expect(update).not.toHaveBeenCalled();
    expect(updateTrigger).not.toHaveBeenCalled();
    update.mockRestore();
    updateTrigger.mockRestore();
  });

  it("denies Timezone and all Trigger routes in a DM", async () => {
    const harness = makeHarness(false);
    const updateChat = spyOn(configRepository, "updateChatConfig").mockResolvedValue(true);
    const updateTrigger = spyOn(configRepository, "updateTriggerBehaviorConfig").mockResolvedValue(true);
    await dispatch(
      harness,
      makeInteraction(
        harness,
        buildConfigRouteId({ action: "behavior-timezone-submit", locale: "en-US", nonce: "nonce1234567" }),
        {
          kind: "modal",
          inGuild: false,
          fields: { [buildConfigModalFieldId("behavior_timezone", "nonce1234567")]: "8" },
        },
      ),
    );
    await dispatch(
      harness,
      makeInteraction(harness, buildConfigRouteId({ action: "behavior-dtm-set", locale: "en-US", enabled: true }), {
        inGuild: false,
      }),
    );
    expect(updateChat).not.toHaveBeenCalled();
    expect(updateTrigger).not.toHaveBeenCalled();
    updateChat.mockRestore();
    updateTrigger.mockRestore();
  });

  it("reads the humanizer degree from the store, not from the modal text fields", async () => {
    // The degree is rendered as a radio group, so it never arrives as text. Carrying the value as
    // a text field must therefore leave the setting untouched: the reader is looking somewhere
    // else, and reading it as text is what threw the route out of the interaction entirely.
    const harness = makeHarness(false);
    const update = spyOn(configRepository, "updateChatConfig").mockResolvedValue(true);
    const field = buildConfigModalFieldId(BEHAVIOR_HUMANIZER_FIELD, "nonce1234567");
    await dispatch(
      harness,
      makeInteraction(
        harness,
        buildConfigRouteId({ action: "behavior-humanizer-submit", locale: "en-US", nonce: "nonce1234567" }),
        { kind: "modal", inGuild: false, fields: { [field]: "3" } },
      ),
    );
    expect(update).not.toHaveBeenCalled();
    expect(harness.edits.length).toBeGreaterThan(0);
    update.mockRestore();
  });

  it("writes the chosen humanizer degree and reports it", async () => {
    const harness = makeHarness(false);
    const update = spyOn(configRepository, "updateChatConfig").mockResolvedValue(true);
    const field = buildConfigModalFieldId(BEHAVIOR_HUMANIZER_FIELD, "nonce1234567");
    await dispatch(
      harness,
      makeInteraction(
        harness,
        buildConfigRouteId({ action: "behavior-humanizer-submit", locale: "en-US", nonce: "nonce1234567" }),
        { kind: "modal", inGuild: false, selectValues: { [field]: "3" } },
      ),
    );
    expect(update).toHaveBeenCalledWith(9, { humanizer_degree: 3 });
    expect(harness.telemetry).toContain("server-config.workspace.humanizer.set");
    update.mockRestore();
  });

  it("opens the preset modal with the built-in default first even when the catalog is empty", async () => {
    const harness = makeHarness();
    const presets = spyOn(configRepository, "loadSystemPromptPresets").mockResolvedValue([]);
    try {
      await dispatch(
        harness,
        makeInteraction(harness, buildConfigRouteId({ action: "behavior-preset-open", locale: "en-US" })),
      );

      expect(harness.modals).toHaveLength(1);
      const select = (harness.modals[0] as { components: Array<{ component: { options: Array<{ value: string }> } }> })
        .components[0]?.component;
      expect(select?.options.map((option) => option.value)).toEqual([BEHAVIOR_PRESET_BUILT_IN]);
    } finally {
      presets.mockRestore();
    }
  });

  it("clears the custom prompt to NULL when the built-in default is chosen", async () => {
    const harness = makeHarness();
    const events: string[] = [];
    const update = spyOn(configRepository, "updateChatConfig").mockImplementation(async (_serverId, patch) => {
      events.push("write");
      expect(patch).toEqual({ system_prompt: null });
      return true;
    });
    const invalidate = spyOn(tomoriStateCache, "invalidateTomoriStateCache").mockImplementation(() => {
      events.push("invalidate");
    });
    const presets = spyOn(configRepository, "loadSystemPromptPresets").mockResolvedValue([]);
    const field = buildConfigModalFieldId(BEHAVIOR_PRESET_FIELD, "nonce1234567");
    try {
      await dispatch(
        harness,
        makeInteraction(
          harness,
          buildConfigRouteId({ action: "behavior-preset-submit", locale: "en-US", nonce: "nonce1234567" }),
          { kind: "modal", selectValues: { [field]: BEHAVIOR_PRESET_BUILT_IN } },
        ),
      );

      expect(events).toEqual(["write", "invalidate"]);
      expect(harness.telemetry).toEqual(["server-config.workspace.system-prompt.remove"]);
    } finally {
      update.mockRestore();
      invalidate.mockRestore();
      presets.mockRestore();
    }
  });

  it("does not write when the built-in default is chosen and no custom prompt is set", async () => {
    const harness = makeHarness();
    (harness.scope.personas[0] as TomoriState).config.system_prompt = null;
    const update = spyOn(configRepository, "updateChatConfig").mockResolvedValue(true);
    const presets = spyOn(configRepository, "loadSystemPromptPresets").mockResolvedValue([]);
    const field = buildConfigModalFieldId(BEHAVIOR_PRESET_FIELD, "nonce1234567");
    try {
      await dispatch(
        harness,
        makeInteraction(
          harness,
          buildConfigRouteId({ action: "behavior-preset-submit", locale: "en-US", nonce: "nonce1234567" }),
          { kind: "modal", selectValues: { [field]: BEHAVIOR_PRESET_BUILT_IN } },
        ),
      );

      expect(update).not.toHaveBeenCalled();
      expect(harness.telemetry).toEqual([]);
    } finally {
      update.mockRestore();
      presets.mockRestore();
    }
  });

  it("rejects a humanizer submission whose value is missing from the store", async () => {
    const harness = makeHarness(false);
    const update = spyOn(configRepository, "updateChatConfig").mockResolvedValue(true);
    await dispatch(
      harness,
      makeInteraction(
        harness,
        buildConfigRouteId({ action: "behavior-humanizer-submit", locale: "en-US", nonce: "nonce1234567" }),
        { kind: "modal", inGuild: false },
      ),
    );
    expect(update).not.toHaveBeenCalled();
    expect(harness.edits.length).toBeGreaterThan(0);
    update.mockRestore();
  });

  it("treats an already selected direct trigger state as a no-op", async () => {
    const harness = makeHarness(true);
    const update = spyOn(configRepository, "updateTriggerBehaviorConfig").mockResolvedValue(true);
    await dispatch(
      harness,
      makeInteraction(harness, buildConfigRouteId({ action: "behavior-dtm-set", locale: "en-US", enabled: false })),
    );
    expect(update).not.toHaveBeenCalled();
    update.mockRestore();
  });

  it("acknowledges before writing Deliberate Tool Mode", async () => {
    const harness = makeHarness(true);
    const interaction = makeInteraction(
      harness,
      buildConfigRouteId({ action: "behavior-tool-mode-set", locale: "en-US", enabled: true }),
    );
    const update = spyOn(configRepository, "updateTriggerBehaviorConfig").mockImplementation(
      async (_serverId, patch) => {
        harness.deferredAtWrite.push(interaction.deferred || interaction.replied);
        expect(patch).toEqual({ deliberate_tool_mode: true });
        return true;
      },
    );
    await dispatch(harness, interaction);
    expect(harness.deferredAtWrite).toEqual([true]);
    update.mockRestore();
  });

  it("adds a normalized custom tool trigger through the dedicated add flow", async () => {
    const harness = makeHarness(true);
    const nonce = "nonce1234567";
    harness.dependencies.takeSelectValue = (_interactionId, fieldId) =>
      fieldId === buildConfigModalFieldId("behavior_tool_trigger_target", nonce) ? "image" : undefined;
    const update = spyOn(configRepository, "updateTriggerBehaviorConfig").mockImplementation(
      async (_serverId, patch) => {
        harness.deferredAtWrite.push(true);
        expect(patch).toEqual({ deliberate_tool_triggers: { image: ["draw it"] } });
        return true;
      },
    );
    await dispatch(
      harness,
      makeInteraction(
        harness,
        buildConfigRouteId({ action: "behavior-tool-trigger-add-submit", locale: "en-US", nonce }),
        {
          kind: "modal",
          fields: {
            [buildConfigModalFieldId("behavior_tool_trigger_literal", nonce)]: "  Draw   It  ",
            [buildConfigModalFieldId("behavior_tool_trigger_regex", nonce)]: "",
          },
        },
      ),
    );
    expect(harness.deferredAtWrite).toEqual([true]);
    expect(update).toHaveBeenCalledTimes(1);
    update.mockRestore();
  });

  it("keeps the explicit no-write result when removal exceeds fifty triggers", async () => {
    const harness = makeHarness(true);
    const state = harness.scope.personas[0];
    if (!state) throw new Error("Test harness has no persona");
    state.config.deliberate_tool_triggers = Object.fromEntries(
      Array.from({ length: 51 }, (_unused, index) => [`target-${index}`, [`trigger-${index}`]]),
    );
    const update = spyOn(configRepository, "updateTriggerBehaviorConfig").mockResolvedValue(true);
    await dispatch(
      harness,
      makeInteraction(harness, buildConfigRouteId({ action: "behavior-tool-trigger-remove-open", locale: "en-US" })),
    );
    expect(harness.modals).toHaveLength(0);
    expect(harness.replies).toHaveLength(1);
    expect(update).not.toHaveBeenCalled();
    update.mockRestore();
  });

  it("does not record telemetry when a D10 write fails", async () => {
    const harness = makeHarness(true);
    const state = harness.scope.personas[0];
    if (!state) throw new Error("Test harness has no persona");
    state.config.send_message_limit = 4;
    const update = spyOn(configRepository, "updateChatConfig").mockResolvedValue(false);
    await dispatch(
      harness,
      makeInteraction(
        harness,
        buildConfigRouteId({ action: "behavior-send-limit-submit", locale: "en-US", nonce: "nonce1234567" }),
        {
          kind: "modal",
          fields: { [buildConfigModalFieldId("behavior_send_limit", "nonce1234567")]: "8" },
        },
      ),
    );
    expect(update).toHaveBeenCalledTimes(1);
    expect(harness.telemetry).toEqual([]);
    update.mockRestore();
  });

  it("denies both Notices writes to an ordinary guild member", async () => {
    const harness = makeHarness(true);
    const updateNotice = spyOn(configRepository, "updateNoticeEmbedsConfig").mockResolvedValue(true);
    const updateSpeech = spyOn(configRepository, "updateSpeechConfig").mockResolvedValue(true);
    await dispatch(
      harness,
      makeInteraction(harness, buildConfigRouteId({ action: "behavior-notice-visibility-open", locale: "en-US" }), {
        isManager: false,
      }),
    );
    await dispatch(
      harness,
      makeInteraction(
        harness,
        buildConfigRouteId({ action: "behavior-speech-transcripts-set", locale: "en-US", enabled: false }),
        { isManager: false },
      ),
    );
    expect(updateNotice).not.toHaveBeenCalled();
    expect(updateSpeech).not.toHaveBeenCalled();
    updateNotice.mockRestore();
    updateSpeech.mockRestore();
  });

  it("treats unchecked custom tool triggers as removals", async () => {
    const harness = makeHarness(true);
    const state = harness.scope.personas[0];
    if (!state) throw new Error("Test harness has no persona");
    state.config.deliberate_tool_triggers = { image: ["draw it"] };
    harness.dependencies.takeCheckboxValues = () => [];
    const update = spyOn(configRepository, "updateTriggerBehaviorConfig").mockImplementation(
      async (_serverId, patch) => {
        harness.deferredAtWrite.push(true);
        expect(patch).toEqual({ deliberate_tool_triggers: {} });
        return true;
      },
    );
    await dispatch(
      harness,
      makeInteraction(
        harness,
        buildConfigRouteId({ action: "behavior-tool-trigger-remove-submit", locale: "en-US", nonce: "nonce1234567" }),
        { kind: "modal" },
      ),
    );
    expect(update).toHaveBeenCalledTimes(1);
    update.mockRestore();
  });

  it("persists the complement of unchecked notice choices", async () => {
    const harness = makeHarness(true);
    harness.dependencies.takeCheckboxValues = () => [];
    const update = spyOn(configRepository, "updateNoticeEmbedsConfig").mockImplementation(async (_serverId, patch) => {
      harness.deferredAtWrite.push(true);
      expect(patch.tool_notice_hidden_keys).toHaveLength(TOOL_NOTICE_DEFINITIONS.length);
      return true;
    });
    await dispatch(
      harness,
      makeInteraction(
        harness,
        buildConfigRouteId({ action: "behavior-notice-visibility-submit", locale: "en-US", nonce: "nonce1234567" }),
        { kind: "modal" },
      ),
    );
    expect(update).toHaveBeenCalledTimes(1);
    update.mockRestore();
  });

  it("writes a Notice Verbosity change and skips the write when it is already selected", async () => {
    const harness = makeHarness(true);
    const state = harness.scope.personas[0];
    if (!state) throw new Error("Test harness has no persona");
    state.config.tool_notice_verbosity = "minimal";
    const update = spyOn(configRepository, "updateNoticeEmbedsConfig").mockResolvedValue(true);
    await dispatch(
      harness,
      makeInteraction(
        harness,
        buildConfigRouteId({ action: "behavior-notice-verbosity-set", locale: "en-US", verbosity: "verbose" }),
      ),
    );
    await dispatch(
      harness,
      makeInteraction(
        harness,
        buildConfigRouteId({ action: "behavior-notice-verbosity-set", locale: "en-US", verbosity: "minimal" }),
      ),
    );
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0]?.[1]).toEqual({ tool_notice_verbosity: "verbose" });
    expect(harness.telemetry).toEqual(["server-config.workspace.notice-verbosity.set"]);
    update.mockRestore();
  });

  it("discloses active STM scopes before the category write and clears only those cache records", async () => {
    const harness = makeHarness(true);
    const nonce = "nonce1234567";
    const events: string[] = [];
    const categories = spyOn(shortTermMemoryRepository, "getStmCategories").mockResolvedValue([
      {
        server_id: 9,
        position: 0,
        label: "summary",
        description: "A running summary of recent events, topics, and context from this conversation.",
      },
    ]);
    const activeScopes = spyOn(shortTermMemoryCache, "getShortTermMemoriesForServer").mockReturnValue([
      { serverId: "guild-1", channelId: "channel-a", personaId: 55, messages: [], lastUpdated: 1 },
      { serverId: "guild-1", channelId: "channel-b", personaId: null, messages: [], lastUpdated: 2 },
      { serverId: "guild-1", channelId: "channel-a", personaId: 55, messages: [], lastUpdated: 3 },
    ]);
    await dispatch(
      harness,
      makeInteraction(harness, buildConfigRouteId({ action: "behavior-stm-categories-open", locale: "en-US" })),
    );
    expect(JSON.stringify(harness.modals[0])).toContain("<#channel-a>, <#channel-b>");
    const interaction = makeInteraction(
      harness,
      buildConfigRouteId({ action: "behavior-stm-categories-submit", locale: "en-US", nonce }),
      {
        kind: "modal",
        fields: {
          [buildConfigModalFieldId(`${BEHAVIOR_STM_CATEGORY_PREFIX}0`, nonce)]: "Topics: Recent conversation topics",
        },
      },
    );
    const upsert = spyOn(shortTermMemoryRepository, "upsertStmCategories").mockImplementation(
      async (_serverId, value) => {
        events.push("write");
        expect(interaction.deferred || interaction.replied).toBe(true);
        expect(value).toEqual([{ position: 0, label: "Topics", description: "Recent conversation topics" }]);
        return true;
      },
    );
    const clear = spyOn(shortTermMemoryRepository, "clearForServerChannel").mockImplementation(
      (serverId, channelId, personaId) => {
        events.push(`clear:${serverId}:${channelId}:${personaId ?? "none"}`);
      },
    );

    await dispatch(harness, interaction);

    expect(events).toEqual(["write", "clear:guild-1:channel-a:55", "clear:guild-1:channel-b:none"]);
    expect(clear).toHaveBeenCalledTimes(2);
    expect(clear).toHaveBeenNthCalledWith(1, "guild-1", "channel-a", 55);
    expect(clear).toHaveBeenNthCalledWith(2, "guild-1", "channel-b", null);
    categories.mockRestore();
    activeScopes.mockRestore();
    upsert.mockRestore();
    clear.mockRestore();
  });

  it("preserves random-trigger fields while updating the existing persona/channel identity", async () => {
    const harness = makeHarness(true);
    const nonce = "nonce1234567";
    const fields = {
      [buildConfigModalFieldId(BEHAVIOR_RANDOM_SETTINGS_FIELD, nonce)]: "6,35,2,4,3",
      [buildConfigModalFieldId(BEHAVIOR_RANDOM_PROMPT_FIELD, nonce)]: "Start a topic.",
    };
    harness.dependencies.takeSelectValue = (_interactionId, fieldId) =>
      fieldId === buildConfigModalFieldId(BEHAVIOR_RANDOM_CHANNEL_FIELD, nonce)
        ? "channel-1"
        : fieldId === buildConfigModalFieldId(BEHAVIOR_RANDOM_PERSONA_FIELD, nonce)
          ? "55"
          : undefined;
    harness.dependencies.takeCheckboxValues = () => ["yes"];
    const existing = makeRandomTrigger();
    const count = spyOn(serverScheduleRepository, "getServerTriggerCount").mockResolvedValue(1);
    const lookup = spyOn(serverScheduleRepository, "getTriggerByPersonaAndChannel").mockResolvedValue(existing);
    const upsert = spyOn(serverScheduleRepository, "upsertTrigger").mockResolvedValue(existing);
    await dispatch(
      harness,
      makeInteraction(harness, buildConfigRouteId({ action: "behavior-random-add-submit", locale: "en-US", nonce }), {
        kind: "modal",
        fields,
      }),
    );
    expect(lookup).toHaveBeenCalledWith(9, "channel-1", 55);
    expect(upsert).toHaveBeenCalledWith(9, {
      serverId: 9,
      channelDiscId: "channel-1",
      personaId: 55,
      timerHours: 6,
      chancePercent: 35,
      randomOffsetRange: 2,
      silenceThresholdHours: 4,
      failureThreshold: 3,
      respondToSelf: true,
      customPrompt: "Start a topic.",
    });
    count.mockRestore();
    lookup.mockRestore();
    upsert.mockRestore();
  });

  it("refuses a blank Timing and Chance field instead of writing the retired 1,100,,, default", async () => {
    const harness = makeHarness(true);
    const nonce = "nonce1234567";
    harness.dependencies.takeSelectValue = (_interactionId, fieldId) =>
      fieldId === buildConfigModalFieldId(BEHAVIOR_RANDOM_CHANNEL_FIELD, nonce) ? "channel-1" : undefined;
    harness.dependencies.takeCheckboxValues = () => [];
    const insert = spyOn(serverScheduleRepository, "insertTrigger").mockResolvedValue(makeRandomTrigger());
    const upsert = spyOn(serverScheduleRepository, "upsertTrigger").mockResolvedValue(makeRandomTrigger());
    await dispatch(
      harness,
      makeInteraction(harness, buildConfigRouteId({ action: "behavior-random-add-submit", locale: "en-US", nonce }), {
        kind: "modal",
        // No settings value is submitted; the prefill was removed in favour of a placeholder.
        fields: {},
      }),
    );
    expect(insert).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
    expect(JSON.stringify(harness.edits)).toContain(
      localizedCopy("en-US", "commands.config.panel.random_trigger_settings_invalid_detail"),
    );
    insert.mockRestore();
    upsert.mockRestore();
  });

  it("re-reads random triggers and removes checked-list omissions, including an explicit empty selection", async () => {
    const harness = makeHarness(true);
    const trigger = makeRandomTrigger();
    const getTriggers = spyOn(serverScheduleRepository, "getServerTriggers").mockResolvedValue([trigger]);
    const deleteTrigger = spyOn(serverScheduleRepository, "deleteTrigger").mockResolvedValue(true);
    harness.dependencies.loadBehaviorView = async (current) => ({
      general: {
        responsePrefill: null,
        prefillBlocker: null,
        prefillModelName: "gemini-2.5-flash",
        systemPrompt: current.config.system_prompt ?? null,
        contextNote: current.config.context_note ?? null,
        contextNoteDepth: current.config.context_note_depth ?? 0,
        humanizerDegree: current.config.humanizer_degree ?? 1,
        messageFetchLimit: current.config.message_fetch_limit ?? 80,
        timezoneOffset: current.config.timezone_offset ?? 0,
      },
      trigger: {
        randomTriggers: [trigger],
        cascadeLimit: current.config.cascade_limit ?? 3,
        matchLimit: current.config.match_limit ?? 3,
        deliberateTriggerMode: current.config.deliberate_trigger_mode ?? false,
        alwaysReplyEnabled: current.config.always_reply_enabled ?? false,
        cooldownType: current.config.cooldown_type ?? 0,
        cooldownLength: current.config.cooldown_length ?? 5,
      },
    });
    harness.dependencies.takeCheckboxValues = () => [];
    const fp = computeRandomTriggerRemoveFingerprint(9, [trigger]);
    await dispatch(
      harness,
      makeInteraction(
        harness,
        buildConfigRouteId({
          action: "behavior-random-remove-submit",
          locale: "en-US",
          start: 0,
          fp,
          nonce: "nonce1234567",
        }),
        { kind: "modal" },
      ),
    );
    expect(getTriggers).toHaveBeenCalledWith(9);
    expect(deleteTrigger).toHaveBeenCalledWith(9);
    getTriggers.mockRestore();
    deleteTrigger.mockRestore();
  });

  it("rejects random-trigger removal when checkbox evidence is missing", async () => {
    const harness = makeHarness(true);
    const trigger = makeRandomTrigger();
    const getTriggers = spyOn(serverScheduleRepository, "getServerTriggers").mockResolvedValue([trigger]);
    const deleteTrigger = spyOn(serverScheduleRepository, "deleteTrigger").mockResolvedValue(true);
    harness.dependencies.takeCheckboxValues = () => undefined;
    const fp = computeRandomTriggerRemoveFingerprint(9, [trigger]);
    await dispatch(
      harness,
      makeInteraction(
        harness,
        buildConfigRouteId({
          action: "behavior-random-remove-submit",
          locale: "en-US",
          start: 0,
          fp,
          nonce: "nonce1234567",
        }),
        { kind: "modal" },
      ),
    );
    expect(deleteTrigger).not.toHaveBeenCalled();
    getTriggers.mockRestore();
    deleteTrigger.mockRestore();
  });

  it("stops random-trigger removal when the live schedule fingerprint changed", async () => {
    const harness = makeHarness(true);
    const original = makeRandomTrigger();
    const changed = { ...original, chance_percent: original.chance_percent + 1 };
    const getTriggers = spyOn(serverScheduleRepository, "getServerTriggers").mockResolvedValue([changed]);
    const deleteTrigger = spyOn(serverScheduleRepository, "deleteTrigger").mockResolvedValue(true);
    harness.dependencies.takeCheckboxValues = () => [];
    const fp = computeRandomTriggerRemoveFingerprint(9, [original]);
    await dispatch(
      harness,
      makeInteraction(
        harness,
        buildConfigRouteId({
          action: "behavior-random-remove-submit",
          locale: "en-US",
          start: 0,
          fp,
          nonce: "nonce1234567",
        }),
        { kind: "modal" },
      ),
    );
    expect(getTriggers).toHaveBeenCalledWith(9);
    expect(deleteTrigger).not.toHaveBeenCalled();
    getTriggers.mockRestore();
    deleteTrigger.mockRestore();
  });

  it("opens the selected overflow page through the real select route", async () => {
    const harness = makeHarness(true);
    const first = makeRandomTrigger();
    const triggers = Array.from({ length: 51 }, (_entry, index) => ({ ...first, trigger_id: index + 1 }));
    harness.dependencies.loadBehaviorView = async (current) => ({
      general: {
        responsePrefill: null,
        prefillBlocker: null,
        prefillModelName: "gemini-2.5-flash",
        systemPrompt: current.config.system_prompt ?? null,
        contextNote: current.config.context_note ?? null,
        contextNoteDepth: current.config.context_note_depth ?? 0,
        humanizerDegree: current.config.humanizer_degree ?? 1,
        messageFetchLimit: current.config.message_fetch_limit ?? 80,
        timezoneOffset: current.config.timezone_offset ?? 0,
      },
      trigger: {
        randomTriggers: triggers,
        cascadeLimit: current.config.cascade_limit ?? 3,
        matchLimit: current.config.match_limit ?? 3,
        deliberateTriggerMode: current.config.deliberate_trigger_mode ?? false,
        alwaysReplyEnabled: current.config.always_reply_enabled ?? false,
        cooldownType: current.config.cooldown_type ?? 0,
        cooldownLength: current.config.cooldown_length ?? 5,
      },
    });
    await dispatch(
      harness,
      makeInteraction(harness, buildConfigRouteId({ action: "behavior-random-remove-select", locale: "en-US" }), {
        kind: "select",
        values: ["50"],
      }),
    );
    expect(harness.modals).toHaveLength(1);
    expect((harness.modals[0] as { custom_id: string }).custom_id).toContain("beh-random-rem-sub");
    expect((harness.modals[0] as { components: unknown[] }).components).toHaveLength(1);
  });

  it("opens the removal modal directly when all schedules fit one modal", async () => {
    for (const scheduleCount of [1, 50]) {
      const harness = makeHarness(true);
      const first = makeRandomTrigger();
      const triggers = Array.from({ length: scheduleCount }, (_entry, index) => ({ ...first, trigger_id: index + 1 }));
      harness.dependencies.loadBehaviorView = async (current) => ({
        general: {
          responsePrefill: null,
          prefillBlocker: null,
          prefillModelName: "gemini-2.5-flash",
          systemPrompt: current.config.system_prompt ?? null,
          contextNote: current.config.context_note ?? null,
          contextNoteDepth: current.config.context_note_depth ?? 0,
          humanizerDegree: current.config.humanizer_degree ?? 1,
          messageFetchLimit: current.config.message_fetch_limit ?? 80,
          timezoneOffset: current.config.timezone_offset ?? 0,
        },
        trigger: {
          randomTriggers: triggers,
          cascadeLimit: current.config.cascade_limit ?? 3,
          matchLimit: current.config.match_limit ?? 3,
          deliberateTriggerMode: current.config.deliberate_trigger_mode ?? false,
          alwaysReplyEnabled: current.config.always_reply_enabled ?? false,
          cooldownType: current.config.cooldown_type ?? 0,
          cooldownLength: current.config.cooldown_length ?? 5,
        },
      });
      await dispatch(
        harness,
        makeInteraction(harness, buildConfigRouteId({ action: "behavior-random-remove-open", locale: "en-US" })),
      );
      expect(harness.modals, `${scheduleCount} schedules`).toHaveLength(1);
      expect(harness.edits).toHaveLength(0);
      expect((harness.modals[0] as { custom_id: string }).custom_id).toContain("beh-random-rem-sub");
    }
  });

  it("reports no schedules when Remove opens with zero random triggers", async () => {
    const harness = makeHarness(true);
    await dispatch(
      harness,
      makeInteraction(harness, buildConfigRouteId({ action: "behavior-random-remove-open", locale: "en-US" })),
    );
    expect(harness.modals).toHaveLength(0);
    expect(harness.replies).toHaveLength(1);
    expect(JSON.stringify(harness.replies[0])).toContain(
      localizer("en-US", "commands.config.random-trigger.remove.none_description"),
    );
  });

  it("repaints into the removal-range state instead of refusing when Remove exceeds one modal", async () => {
    const harness = makeHarness(true);
    const first = makeRandomTrigger();
    const triggers = Array.from({ length: 51 }, (_entry, index) => ({ ...first, trigger_id: index + 1 }));
    harness.dependencies.loadBehaviorView = async (current) => ({
      general: {
        responsePrefill: null,
        prefillBlocker: null,
        prefillModelName: "gemini-2.5-flash",
        systemPrompt: current.config.system_prompt ?? null,
        contextNote: current.config.context_note ?? null,
        contextNoteDepth: current.config.context_note_depth ?? 0,
        humanizerDegree: current.config.humanizer_degree ?? 1,
        messageFetchLimit: current.config.message_fetch_limit ?? 80,
        timezoneOffset: current.config.timezone_offset ?? 0,
      },
      trigger: {
        randomTriggers: triggers,
        cascadeLimit: current.config.cascade_limit ?? 3,
        matchLimit: current.config.match_limit ?? 3,
        deliberateTriggerMode: current.config.deliberate_trigger_mode ?? false,
        alwaysReplyEnabled: current.config.always_reply_enabled ?? false,
        cooldownType: current.config.cooldown_type ?? 0,
        cooldownLength: current.config.cooldown_length ?? 5,
      },
    });
    await dispatch(
      harness,
      makeInteraction(harness, buildConfigRouteId({ action: "behavior-random-remove-open", locale: "en-US" })),
    );
    expect(harness.modals).toHaveLength(0);
    expect(harness.replies).toHaveLength(0);
    expect(harness.edits).toHaveLength(1);
    const edit = JSON.stringify(harness.edits[0]);
    expect(edit).toContain(buildConfigRouteId({ action: "behavior-random-remove-select", locale: "en-US" }));
    expect(edit).toContain(buildConfigRouteId({ action: "behavior-random-remove-cancel", locale: "en-US" }));
    expect(edit).not.toContain(buildConfigRouteId({ action: "behavior-random-add-open", locale: "en-US" }));
  });

  it("returns from the removal-range state to the ordinary Trigger page through Cancel", async () => {
    const harness = makeHarness(true);
    const first = makeRandomTrigger();
    const triggers = Array.from({ length: 51 }, (_entry, index) => ({ ...first, trigger_id: index + 1 }));
    harness.dependencies.loadBehaviorView = async (current) => ({
      general: {
        responsePrefill: null,
        prefillBlocker: null,
        prefillModelName: "gemini-2.5-flash",
        systemPrompt: current.config.system_prompt ?? null,
        contextNote: current.config.context_note ?? null,
        contextNoteDepth: current.config.context_note_depth ?? 0,
        humanizerDegree: current.config.humanizer_degree ?? 1,
        messageFetchLimit: current.config.message_fetch_limit ?? 80,
        timezoneOffset: current.config.timezone_offset ?? 0,
      },
      trigger: {
        randomTriggers: triggers,
        cascadeLimit: current.config.cascade_limit ?? 3,
        matchLimit: current.config.match_limit ?? 3,
        deliberateTriggerMode: current.config.deliberate_trigger_mode ?? false,
        alwaysReplyEnabled: current.config.always_reply_enabled ?? false,
        cooldownType: current.config.cooldown_type ?? 0,
        cooldownLength: current.config.cooldown_length ?? 5,
      },
    });
    await dispatch(
      harness,
      makeInteraction(harness, buildConfigRouteId({ action: "behavior-random-remove-cancel", locale: "en-US" })),
    );
    expect(harness.edits).toHaveLength(1);
    const edit = JSON.stringify(harness.edits[0]);
    expect(edit).toContain(buildConfigRouteId({ action: "behavior-random-add-open", locale: "en-US" }));
    expect(edit).not.toContain(buildConfigRouteId({ action: "behavior-random-remove-select", locale: "en-US" }));
    expect(edit).toContain(buildConfigRouteId({ action: "behavior-random-remove-open", locale: "en-US" }));
  });

  it("pages the removal selector beyond 25 page ranges through the real route registry", async () => {
    const harness = makeHarness(true);
    const first = makeRandomTrigger();
    const triggers = Array.from({ length: 1300 }, (_entry, index) => ({ ...first, trigger_id: index + 1 }));
    harness.dependencies.loadBehaviorView = async (current) => ({
      general: {
        responsePrefill: null,
        prefillBlocker: null,
        prefillModelName: "gemini-2.5-flash",
        systemPrompt: current.config.system_prompt ?? null,
        contextNote: current.config.context_note ?? null,
        contextNoteDepth: current.config.context_note_depth ?? 0,
        humanizerDegree: current.config.humanizer_degree ?? 1,
        messageFetchLimit: current.config.message_fetch_limit ?? 80,
        timezoneOffset: current.config.timezone_offset ?? 0,
      },
      trigger: {
        randomTriggers: triggers,
        cascadeLimit: current.config.cascade_limit ?? 3,
        matchLimit: current.config.match_limit ?? 3,
        deliberateTriggerMode: current.config.deliberate_trigger_mode ?? false,
        alwaysReplyEnabled: current.config.always_reply_enabled ?? false,
        cooldownType: current.config.cooldown_type ?? 0,
        cooldownLength: current.config.cooldown_length ?? 5,
      },
    });

    await dispatch(
      harness,
      makeInteraction(
        harness,
        buildConfigRouteId({
          action: "behavior-random-remove-page",
          locale: "en-US",
          start: CONFIG_PERSONA_SELECT_PAGE_SIZE * CONFIG_RANDOM_TRIGGER_CHECKBOX_CAPACITY,
        }),
      ),
    );

    expect(harness.edits).toHaveLength(1);
    const edit = JSON.stringify(harness.edits[0]);
    expect(edit).toContain(buildConfigRouteId({ action: "behavior-random-remove-select", locale: "en-US" }));
    expect(edit).toContain(String(CONFIG_PERSONA_SELECT_PAGE_SIZE * CONFIG_RANDOM_TRIGGER_CHECKBOX_CAPACITY));
    // Window paging keeps the page inside the removal-range state rather than the ordinary page.
    expect(edit).toContain(buildConfigRouteId({ action: "behavior-random-remove-cancel", locale: "en-US" }));
    expect(edit).not.toContain(buildConfigRouteId({ action: "behavior-random-add-open", locale: "en-US" }));
  });

  it("returns from a later removal window to the first schedule page instead of stranding the summary", async () => {
    const harness = makeHarness(true);
    const first = makeRandomTrigger();
    const triggers = Array.from({ length: 1300 }, (_entry, index) => ({ ...first, trigger_id: index + 1 }));
    harness.dependencies.loadBehaviorView = async (current) => ({
      general: {
        responsePrefill: null,
        prefillBlocker: null,
        prefillModelName: "gemini-2.5-flash",
        systemPrompt: current.config.system_prompt ?? null,
        contextNote: current.config.context_note ?? null,
        contextNoteDepth: current.config.context_note_depth ?? 0,
        humanizerDegree: current.config.humanizer_degree ?? 1,
        messageFetchLimit: current.config.message_fetch_limit ?? 80,
        timezoneOffset: current.config.timezone_offset ?? 0,
      },
      trigger: {
        randomTriggers: triggers,
        cascadeLimit: current.config.cascade_limit ?? 3,
        matchLimit: current.config.match_limit ?? 3,
        deliberateTriggerMode: current.config.deliberate_trigger_mode ?? false,
        alwaysReplyEnabled: current.config.always_reply_enabled ?? false,
        cooldownType: current.config.cooldown_type ?? 0,
        cooldownLength: current.config.cooldown_length ?? 5,
      },
    });

    await dispatch(
      harness,
      makeInteraction(
        harness,
        buildConfigRouteId({
          action: "behavior-random-remove-page",
          locale: "en-US",
          start: CONFIG_PERSONA_SELECT_PAGE_SIZE * CONFIG_RANDOM_TRIGGER_CHECKBOX_CAPACITY,
        }),
      ),
    );
    await dispatch(
      harness,
      makeInteraction(harness, buildConfigRouteId({ action: "behavior-random-remove-cancel", locale: "en-US" })),
    );

    expect(harness.edits).toHaveLength(2);
    const ordinary = JSON.stringify(harness.edits[1]);
    expect(ordinary).toContain(buildConfigRouteId({ action: "behavior-random-add-open", locale: "en-US" }));
    expect(ordinary).not.toContain(buildConfigRouteId({ action: "behavior-random-remove-select", locale: "en-US" }));
    // Cancel lands back on the first schedule page, where the summary still reports the overflow.
    expect(ordinary).toMatch(localizedProse("en-US", "commands.config.panel.random_trigger_more"));
  });
});
