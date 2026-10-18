import { createHash } from "node:crypto";
import type {
  CustomEndpointApiStyle,
  CustomEndpointRow,
  FallbackEntry,
  FallbackModelRef,
  NaiPresetRow,
  TomoriState,
} from "@/types/db/schema";
import { configRepository, llmModelRepo, llmProviderRepo } from "@/utils/db/repositories";
import {
  CONFIG_FALLBACK_PAGE_SIZE,
  CONFIG_FALLBACK_SLOT_COUNT,
  CONFIG_MODEL_CAPABILITY_ORDER,
  computeNaiPresetFingerprint,
  isConfigCatalogModelCapability,
  type ConfigCatalogModelCapability,
} from "@/utils/discord/configPanelCatalog";
import { formatModelOverrideModelSummary } from "@/utils/discord/modelOverrideCatalog";
import { loadModelOverrideEntries } from "@/utils/discord/interactions/modelOverrideRoutes";
import {
  CONFIG_FALLBACK_ENDPOINT_PREFIX,
  loadConfigModelChoices,
  loadConfigModelProviders,
  resolveNaiPresetTarget,
} from "@/utils/discord/interactions/configModelOperations";
import type { ConfigFallbackOption } from "@/utils/discord/ui/configModelModals";
import type {
  ConfigFallbacksView,
  ConfigEndpointPage,
  ConfigImageGenerationView,
  ConfigParametersView,
  ConfigSwitchModelsProviderPage,
  ConfigSwitchModelsView,
} from "@/utils/discord/ui/configModelsPanel";
import { buildProviderPageEntries } from "@/utils/discord/ui/modelRoutingControls";
import { resolveProviderEntryStart } from "@/utils/discord/ui/providerSelectWindow";
import { resolveNaiImageParams } from "@/utils/image/naiImageParams";
import { buildCustomProviderName, isCustomProvider, parseCustomProvider } from "@/utils/provider/customProviderUtils";
import { getProviderDisplayName } from "@/utils/provider/providerInfoRegistry";
import { loadSavedProvidersForCapability } from "@/utils/provider/savedProviderConfig";
import { localizer, resolveDescription } from "@/utils/text/localizer";

export type ConfigEndpointModelCapability = "stt";

export interface ConfigCapabilityEndpoint {
  id: number;
  capability: "transcription";
  label: string;
  modelLabel: string;
  apiStyle: CustomEndpointApiStyle | null;
  isActive: boolean;
}

export type ConfigCapabilityEndpointInput = ConfigCapabilityEndpoint | CustomEndpointRow;

export type LoadConfigCapabilityEndpoints = (state: TomoriState) => Promise<ConfigCapabilityEndpointInput[]>;

export function normalizeConfigCapabilityEndpoints(
  rows: readonly ConfigCapabilityEndpointInput[],
): ConfigCapabilityEndpoint[] {
  return rows.flatMap((endpoint) => {
    if ("id" in endpoint) {
      return endpoint.capability === "transcription" && Number.isSafeInteger(endpoint.id) && endpoint.id > 0
        ? [endpoint]
        : [];
    }
    const id = endpoint.custom_endpoint_id;
    if (endpoint.capability !== "transcription" || id === undefined || !Number.isSafeInteger(id) || id <= 0) {
      return [];
    }
    return [
      {
        id,
        capability: "transcription",
        label: endpoint.label,
        modelLabel: endpoint.model_name ?? endpoint.label,
        apiStyle: endpoint.api_style,
        isActive: endpoint.is_default,
      },
    ];
  });
}

export const loadConfigCapabilityEndpoints: LoadConfigCapabilityEndpoints = (state) =>
  llmProviderRepo.loadCustomEndpointsForServer(state.server_id);

/** Binds an endpoint choice to its ordered list and the identifying fields of every presented row. */
export function computeConfigEndpointFingerprint(endpoints: readonly ConfigCapabilityEndpoint[]): string {
  return createHash("sha256")
    .update(
      `config-endpoints:stt:${JSON.stringify(
        endpoints.map((endpoint) => ({
          id: endpoint.id,
          capability: endpoint.capability,
          label: endpoint.label,
          modelLabel: endpoint.modelLabel,
          apiStyle: endpoint.apiStyle,
          isActive: endpoint.isActive,
        })),
      )}`,
    )
    .digest("base64url")
    .slice(0, 8);
}

export function encodeConfigEndpointSelection(position: number, fingerprint: string): string {
  return `ep|${position}|${fingerprint}`;
}

export function decodeConfigEndpointSelection(value: string): { position: number; fingerprint: string } | null {
  const match = /^ep\|(\d+)\|([A-Za-z0-9_-]{8})$/.exec(value);
  if (!match) return null;
  const position = Number.parseInt(match[1] ?? "", 10);
  if (!Number.isSafeInteger(position) || position < 0) return null;
  return { position, fingerprint: match[2] ?? "" };
}

export function encodeConfigEndpointPageValue(start: number): string {
  return `ep-page|${start}`;
}

export function decodeConfigEndpointPageValue(value: string): number | null {
  const match = /^ep-page\|(\d+)$/.exec(value);
  if (!match) return null;
  const start = Number.parseInt(match[1] ?? "", 10);
  return Number.isSafeInteger(start) && start >= 0 ? start : null;
}

/**
 * Resolves the display name of whatever currently occupies one slot.
 *
 * Each slot reads a different catalog, and only Text and Vision are joined into `TomoriState`
 * already, so the rest need a lookup by id rather than a field read.
 */
async function resolveSlotAssignment(
  state: TomoriState,
  capability: ConfigCatalogModelCapability,
): Promise<{ modelName: string | null; provider: string | null }> {
  switch (capability) {
    case "text":
      return { modelName: state.llm?.llm_codename ?? null, provider: state.llm?.llm_provider ?? null };
    case "vision":
      return {
        modelName: state.vision_llm?.llm_codename ?? null,
        provider: state.vision_llm?.llm_provider ?? null,
      };
    case "embedding": {
      const id = state.config.embedding_model_id;
      if (!id) return { modelName: null, provider: null };
      const model = await llmModelRepo.loadEmbeddingModelById(id);
      return { modelName: model?.codename ?? null, provider: model?.provider ?? null };
    }
    case "decision": {
      const id = state.config.decision_model_id;
      if (!id) return { modelName: null, provider: null };
      const model = await llmModelRepo.loadDecisionModelById(id);
      return { modelName: model?.codename ?? null, provider: model?.provider ?? null };
    }
    case "image":
    case "nai-image": {
      const id = capability === "image" ? state.config.diffusion_model_id : state.config.nai_diffusion_model_id;
      if (!id) return { modelName: null, provider: null };
      const model = await llmModelRepo.loadDiffusionModelById(id);
      return { modelName: model?.codename ?? null, provider: model?.provider ?? null };
    }
    case "video": {
      const id = state.config.video_model_id;
      if (!id) return { modelName: null, provider: null };
      const model = await llmModelRepo.loadVideoGenerationModelById(id);
      return { modelName: model?.codename ?? null, provider: model?.provider ?? null };
    }
    case "tts-design":
    case "tts-clone": {
      const design = capability === "tts-design";
      const endpointId = design ? state.config.speech_design_endpoint_id : state.config.speech_clone_endpoint_id;
      if (endpointId) {
        const [endpoint] = await llmProviderRepo.loadCustomEndpointsByIds([endpointId]);
        return endpoint
          ? {
              modelName: endpoint.model_name ?? endpoint.label,
              provider: buildCustomProviderName(endpoint.connection_id),
            }
          : { modelName: null, provider: null };
      }
      const id = design ? state.config.speech_design_model_id : state.config.speech_clone_model_id;
      if (!id) return { modelName: null, provider: null };
      const model = await llmModelRepo.loadSpeechModelById(id);
      return { modelName: model?.codename ?? null, provider: model?.provider ?? null };
    }
  }
}

/**
 * Builds the Switch page view for one workspace.
 *
 * The workspace snowflake is required rather than derived from `state`, because `TomoriState`
 * carries the internal server id only and the persona half of the override list is read through the
 * workspace persona cache.
 */
export async function loadConfigSwitchModelsView(
  state: TomoriState,
  workspaceDiscId: string,
  providerPage: ConfigSwitchModelsProviderPage | undefined,
  endpointPage: ConfigEndpointPage | undefined = undefined,
  loadCapabilityEndpoints: LoadConfigCapabilityEndpoints = loadConfigCapabilityEndpoints,
): Promise<ConfigSwitchModelsView> {
  const slots = await Promise.all(
    CONFIG_MODEL_CAPABILITY_ORDER.filter(isConfigCatalogModelCapability).map(async (capability) => {
      const expanded = providerPage?.capability === capability ? (providerPage.provider ?? null) : null;
      const [assignment, providers, expandedOptionCount] = await Promise.all([
        resolveSlotAssignment(state, capability),
        loadConfigModelProviders(state.server_id, capability),
        // Only the expanded provider's catalog is measured: the renderer needs the count to decide
        // how many page entries it contributes, and loading every catalog to fill a field the
        // collapsed slots never read would put the whole model table behind every repaint.
        expanded ? loadConfigModelChoices(state.server_id, capability, expanded).then((rows) => rows.length) : 0,
      ]);
      return {
        capability,
        currentModelName: assignment.modelName,
        currentProvider: assignment.provider,
        eligibleProviders: providers,
        providerPageStart: providerPage?.capability === capability ? providerPage.start : 0,
        expandedProvider: expanded,
        expandedOptionCount,
      };
    }),
  );

  const endpointSlots = [
    {
      capability: "stt" as const,
      endpoints: normalizeConfigCapabilityEndpoints(await loadCapabilityEndpoints(state)),
      pageStart: endpointPage?.start ?? 0,
    },
  ];

  // The removal list and this summary read one loader, so a target named here is a target that
  // command can clear, and both surfaces print the same effective model for it.
  const { channelOverrides, personasWithOverride } = await loadModelOverrideEntries(state.server_id, workspaceDiscId);

  return {
    slots,
    channelOverrides: channelOverrides.map((entry) => ({
      target: `<#${entry.channelDiscId}>`,
      model: formatModelOverrideModelSummary(entry.llm),
    })),
    personaOverrides: personasWithOverride.map((entry) => ({
      target: `**${entry.persona_nickname}**`,
      model: formatModelOverrideModelSummary(entry.persona_llm),
    })),
    imageGenerationEnabled: state.config.imagegen_enabled,
    videoGenerationEnabled: state.config.videogen_enabled,
    speechCapabilityEnabled: state.config.voice_message_enabled ?? true,
    endpointSlots,
  };
}

export async function loadConfigParametersView(
  state: TomoriState,
  requestedProvider: string | undefined,
  logitBiasPageStart: number,
  naiPresetPageStart = 0,
  workspaceKind: "guild" | "dm" = "guild",
): Promise<ConfigParametersView> {
  const providers = await loadSavedProvidersForCapability(state.server_id, "text");
  const selected =
    providers.find((row) => row.provider.toLowerCase() === requestedProvider?.toLowerCase()) ??
    providers.find((row) => row.provider.toLowerCase() === state.llm?.llm_provider?.toLowerCase()) ??
    providers[0] ??
    null;

  let naiPresetView: ConfigParametersView["naiPresetView"];
  if (workspaceKind === "guild" && selected?.provider.toLowerCase() === "novelai") {
    const target = resolveNaiPresetTarget(state);
    const presets: NaiPresetRow[] = target ? await configRepository.loadNaiPresets(target) : [];
    naiPresetView = {
      target,
      compatibility:
        target === null
          ? state.llm.llm_provider.toLowerCase() === "novelai"
            ? "unsupported"
            : "not-novelai"
          : "eligible",
      presets,
      activePresetName: state.nai_preset?.preset_name ?? null,
      fingerprint: target
        ? computeNaiPresetFingerprint(
            target,
            presets.map((preset) => preset.preset_name),
          )
        : null,
      pageStart: naiPresetPageStart,
    };
  }

  return {
    textProviders: providers.map((row) => row.provider),
    selectedProvider: selected?.provider ?? null,
    selectedConfig: selected,
    stopStrings: state.config.llm_stop_strings ?? [],
    speakerPatternEnabled: state.config.llm_stop_speaker_pattern_enabled ?? false,
    logitBiasEntries: state.config.llm_logit_biases ?? [],
    logitBiasPageStart,
    naiPresetView,
  };
}

function describeFallbackEntry(
  locale: string,
  entry: FallbackEntry | null,
  rawRef: FallbackModelRef | null,
): string | null {
  if (!entry) {
    if (!rawRef) return null;
    return `${localizer(locale, "general.unknown")} (#${rawRef.id})`;
  }
  if (entry.kind === "llm") {
    return `${entry.model.llm_codename} (${getProviderDisplayName(entry.model.llm_provider)})`;
  }
  return `${entry.endpoint.label}:${entry.endpoint.model_name ?? entry.endpoint.label} (${localizer(
    locale,
    "commands.model.fallback.custom_provider_label",
  )})`;
}

/**
 * Value a provider option carries on Switch Models and Fallbacks: the provider plus the option-page
 * offset the modal should open on.
 *
 * A modal select holds 25 options and cannot page inside itself, so the range is chosen here, as one
 * select option per page, rather than by a prev/next row that would strand the page it is parked on.
 */
export function encodeConfigProviderPageValue(provider: string, start: number): string {
  return `${start}|${provider}`;
}

export function decodeConfigProviderPageValue(value: string): { provider: string; start: number } | null {
  const separator = value.indexOf("|");
  if (separator < 0) return null;
  const start = Number.parseInt(value.slice(0, separator), 10);
  const provider = value.slice(separator + 1);
  if (!Number.isInteger(start) || start < 0 || !provider) return null;
  return { provider, start };
}

/**
 * Value the Switch Models provider select carries to scroll its own entry list.
 *
 * The provider selectors share one page, so a prev/next row per capability costs more components
 * than the forty-component budget has. Riding the select instead costs none, and the expanded
 * provider has to ride along or the next window rebuilds a shorter entry list and the offset it
 * was given now points outside it.
 */
export function encodeConfigProviderRangeValue(start: number, expandedProvider: string | null): string {
  return `more|${start}|${expandedProvider ?? ""}`;
}

export function decodeConfigProviderRangeValue(
  value: string,
): { start: number; expandedProvider: string | null } | null {
  if (!value.startsWith("more|")) return null;
  const separator = value.indexOf("|", 5);
  if (separator < 0) return null;
  const start = Number.parseInt(value.slice(5, separator), 10);
  if (!Number.isInteger(start) || start < 0) return null;
  return { start, expandedProvider: value.slice(separator + 1) || null };
}

export async function loadConfigFallbacksView(
  state: TomoriState,
  locale: string,
  expandedProvider: string | null,
  entryStart = 0,
): Promise<ConfigFallbacksView> {
  const providers = await loadSavedProvidersForCapability(state.server_id, "text");
  const refs = state.config.fallback_model_refs ?? [];
  const chain = state.fallback_chain ?? [];

  const expandedOptionCount = expandedProvider ? (await loadConfigFallbackOptions(state, expandedProvider)).length : 0;
  const { entries, expandedStartIndex } = buildProviderPageEntries({
    providers: providers.map((row) => row.provider),
    expandedProvider,
    expandedOptionCount,
    pageSize: CONFIG_FALLBACK_PAGE_SIZE,
    locale,
    pageLabelKey: "commands.config.panel.provider_page_label",
    encodeProviderValue: (provider) => encodeConfigProviderPageValue(provider, 0),
    encodePageValue: (provider, start) => encodeConfigProviderPageValue(provider, start),
  });

  return {
    slots: Array.from({ length: CONFIG_FALLBACK_SLOT_COUNT }, (_slot, index) => ({
      label: describeFallbackEntry(locale, chain[index] ?? null, refs[index] ?? null),
    })),
    providerEntries: entries,
    expandedProvider,
    entryStart: resolveProviderEntryStart(entryStart, expandedStartIndex),
    randomizerEnabled: state.config.model_randomizer_enabled ?? false,
    hasFallbacks: refs.length > 0,
  };
}

/**
 * The models one provider contributes to a fallback slot.
 *
 * A custom label resolves through connection-scoped endpoint rows rather than the model catalog, so
 * each saved fallback keeps pointing at the exact endpoint it was chosen from.
 */
export async function loadConfigFallbackOptions(
  state: TomoriState,
  provider: string,
  locale = "en-US",
): Promise<ConfigFallbackOption[]> {
  if (isCustomProvider(provider)) {
    const parsed = parseCustomProvider(provider);
    if (!parsed) return [];
    const endpoints = await llmProviderRepo.loadCustomEndpointsForServer(state.server_id);
    return endpoints
      .filter((endpoint) => endpoint.connection_id === parsed.connectionId && endpoint.capability === "text")
      .map((endpoint) => ({
        value: `${CONFIG_FALLBACK_ENDPOINT_PREFIX}${endpoint.custom_endpoint_id}`,
        label: `${endpoint.label}:${endpoint.model_name ?? endpoint.label}`,
        description: endpoint.model_name ?? endpoint.label,
      }));
  }

  const models =
    (await llmModelRepo.loadAvailableModelsForProvider(provider, false, {
      kind: "server",
      ownerId: state.server_id,
    })) ?? [];
  // `other-model` is a migration placeholder rather than a routable model, so it never becomes a
  // fallback the chain would try to call.
  return models
    .filter((model) => model.llm_codename !== "other-model")
    .map((model) => ({
      value: model.llm_codename,
      label: model.llm_codename,
      description: resolveDescription(model.descriptions, locale) ?? undefined,
    }));
}

export function loadConfigImageGenerationView(state: TomoriState, locale: string): ConfigImageGenerationView {
  const effective = resolveNaiImageParams({
    nai_sampler: state.config.nai_sampler,
    nai_steps: state.config.nai_steps,
    nai_scale: state.config.nai_scale,
    nai_noise_schedule: state.config.nai_noise_schedule,
    nai_cfg_rescale: state.config.nai_cfg_rescale,
  });
  const noneLabel = localizer(locale, "commands.config.panel.none_label");

  return {
    positiveTags: state.config.image_default_positive_tags ?? [],
    negativeTags: state.config.image_default_negative_tags ?? [],
    sampler: effective.sampler || noneLabel,
    steps: String(effective.steps),
    scale: String(effective.scale),
    noiseSchedule: effective.noiseSchedule || noneLabel,
    cfgRescale: String(effective.cfgRescale),
  };
}
