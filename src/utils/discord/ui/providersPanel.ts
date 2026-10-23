import {
  ButtonStyle,
  ComponentType,
  MessageFlags,
  TextInputStyle,
  type ActionRowData,
  type ButtonComponentData,
  type ComponentInContainerData,
  type SelectMenuComponentOptionData,
  type StringSelectMenuComponentData,
  type TopLevelComponentData,
} from "discord.js";
import type {
  ProviderPanelCapability,
  ProviderPanelCapabilitySection,
  ProviderPanelEntry,
  ProviderPanelModel,
  ProviderPanelOptionAction,
} from "@/types/discord/providerPanel";
import { findProviderOption, type ProviderOptionScope } from "@/utils/provider/providerOptionRegistry";
import type { CustomEndpointApiStyle, CustomEndpointCapability } from "@/types/db/schema";
import type { PanelReadStatus, PanelReceipt } from "@/types/discord/panel";
import type { RawDiscordComponent } from "@/types/discord/rawApiTypes";
import { resolveRangeSelection } from "@/utils/discord/interactions/panelController";
import { escapeDiscordMarkdown } from "@/utils/text/discordMarkdown";
import {
  buildProvidersRouteId,
  buildProvidersRouteSegments,
  PROVIDERS_ROUTE_NAMESPACE,
  PROVIDERS_ROUTE_VERSION,
  type ProvidersRouteNamespace,
} from "@/utils/discord/providersPanelCatalog";
import {
  buildPanelContainer,
  buildPanelReceiptContainer,
  buildPaginationRow,
  withLinePrefix,
} from "@/utils/discord/ui/panel";
import {
  DISCORD_MESSAGE_TEXT_DISPLAY_TOTAL_MAX,
  DISCORD_SELECT_OPTION_DESCRIPTION_MAX,
  DISCORD_SELECT_OPTION_LABEL_MAX,
  DISCORD_SELECT_OPTIONS_MAX,
} from "@/utils/discord/ui/componentsV2Limits";
import { safeSelectOptionText } from "@/utils/discord/ui/modals";
import { measureFormattedPanelTextLength } from "@/utils/discord/ui/panelProse";
import type { ImageEndpointSupports } from "@/utils/provider/customImageEndpointSupport";
import {
  SPEECH_SCRIPT_MARKUPS,
  SPEECH_VOICE_MODES,
  type SpeechEndpointSettings,
} from "@/utils/provider/customSpeechEndpointSettings";
import {
  getAllProviderChoices,
  getProviderAddChoiceDescriptionKey,
  providerUsesApiFamily,
} from "@/utils/provider/providerInfoRegistry";
import { providerRequiresAlternation, providerRequiresPrefixCompletion } from "@/providers/utils/strictChatCompat";
import { buildTextPreview, textPreviewFooterKey, textPreviewFooterVars } from "@/utils/text/textPreview";
import { localizer } from "@/utils/text/localizer";

const ENDPOINT_FIELD_KEYS: Record<
  Exclude<AddEndpointModalField, "api-style">,
  { label: string; description: string; placeholder: string }
> = {
  label: {
    label: "commands.providers.endpoint_label_label",
    description: "commands.providers.endpoint_label_description",
    placeholder: "commands.providers.endpoint_label_placeholder",
  },
  url: {
    label: "commands.providers.endpoint_url_label",
    description: "commands.providers.endpoint_url_description",
    placeholder: "commands.providers.endpoint_url_placeholder",
  },
  "auth-token": {
    label: "commands.providers.endpoint_auth-token_label",
    description: "commands.providers.endpoint_auth-token_description",
    placeholder: "commands.providers.endpoint_auth-token_placeholder",
  },
};

const CREDENTIAL_FIELD_KEYS: Record<
  Exclude<EditProviderModalField, "delete-rotation">,
  { label: string; description: string; placeholder: string }
> = {
  "api-key": {
    label: "commands.providers.edit_api-key_label",
    description: "commands.providers.edit_api-key_description",
    placeholder: "commands.providers.edit_api-key_placeholder",
  },
  "rotation-key": {
    label: "commands.providers.edit_rotation-key_label",
    description: "commands.providers.edit_rotation-key_description",
    placeholder: "commands.providers.edit_rotation-key_placeholder",
  },
};

type EndpointApiStyle = Exclude<CustomEndpointApiStyle, "elevenlabs" | "elevenlabs-transcription">;

const API_STYLE_KEYS: Record<EndpointApiStyle, { label: string; description: string }> = {
  "openai-compatible": {
    label: "commands.providers.api_styles.openai-compatible",
    description: "commands.providers.api_style_descriptions.openai-compatible",
  },
  "ollama-native": {
    label: "commands.providers.api_styles.ollama-native",
    description: "commands.providers.api_style_descriptions.ollama-native",
  },
  comfyui: {
    label: "commands.providers.api_styles.comfyui",
    description: "commands.providers.api_style_descriptions.comfyui",
  },
  "tts-clone": {
    label: "commands.providers.api_styles.tts-clone",
    description: "commands.providers.api_style_descriptions.tts-clone",
  },
  "openai-compatible-transcription": {
    label: "commands.providers.api_styles.openai-compatible-transcription",
    description: "commands.providers.api_style_descriptions.openai-compatible-transcription",
  },
  "system-one": {
    label: "commands.providers.api_styles.system-one",
    description: "commands.providers.api_style_descriptions.system-one",
  },
  "openai-decisions": {
    label: "commands.providers.api_styles.openai-decisions",
    description: "commands.providers.api_style_descriptions.openai-decisions",
  },
};

const CAPABILITY_KEYS: Record<ProviderPanelCapability, { label: string; placeholder: string }> = {
  text: {
    label: "commands.providers.capabilities.text",
    placeholder: "commands.providers.model_code_placeholders.text",
  },
  image: {
    label: "commands.providers.capabilities.image",
    placeholder: "commands.providers.model_code_placeholders.image",
  },
  embedding: {
    label: "commands.providers.capabilities.embedding",
    placeholder: "commands.providers.model_code_placeholders.embedding",
  },
  video: {
    label: "commands.providers.capabilities.video",
    placeholder: "commands.providers.model_code_placeholders.video",
  },
  speech: {
    label: "commands.providers.capabilities.speech",
    placeholder: "commands.providers.model_code_placeholders.speech",
  },
  transcription: {
    label: "commands.providers.capabilities.transcription",
    placeholder: "commands.providers.model_code_placeholders.transcription",
  },
  decision: {
    label: "commands.providers.capabilities.decision",
    placeholder: "commands.providers.model_code_placeholders.decision",
  },
};

const MODEL_FLAG_KEYS: Record<
  (typeof TEXT_CAPABILITY_FLAGS)[number] | (typeof CHAT_COMPAT_FLAGS)[number],
  { label: string; description: string }
> = {
  tools: {
    label: "commands.providers.model_flags.tools",
    description: "commands.providers.model_flag_descriptions.tools",
  },
  images: {
    label: "commands.providers.model_flags.images",
    description: "commands.providers.model_flag_descriptions.images",
  },
  structured: {
    label: "commands.providers.model_flags.structured",
    description: "commands.providers.model_flag_descriptions.structured",
  },
  "strict-roles": {
    label: "commands.providers.model_flags.strict-roles",
    description: "commands.providers.model_flag_descriptions.strict-roles",
  },
  prefix: {
    label: "commands.providers.model_flags.prefix",
    description: "commands.providers.model_flag_descriptions.prefix",
  },
  prefill: {
    label: "commands.providers.model_flags.prefill",
    description: "commands.providers.model_flag_descriptions.prefill",
  },
  "verbatim-tools": {
    label: "commands.providers.model_flags.verbatim-tools",
    description: "commands.providers.model_flag_descriptions.verbatim-tools",
  },
};

const VOICE_MODE_KEYS: Record<(typeof SPEECH_VOICE_MODES)[number], { label: string; description: string }> = {
  clone: {
    label: "commands.providers.voice_modes.clone",
    description: "commands.providers.voice_mode_descriptions.clone",
  },
  "voice-design": {
    label: "commands.providers.voice_modes.voice-design",
    description: "commands.providers.voice_mode_descriptions.voice-design",
  },
  auto: {
    label: "commands.providers.voice_modes.auto",
    description: "commands.providers.voice_mode_descriptions.auto",
  },
};

const SCRIPT_MARKUP_KEYS: Record<(typeof SPEECH_SCRIPT_MARKUPS)[number], { label: string; description: string }> = {
  plain: {
    label: "commands.providers.script_markups.plain",
    description: "commands.providers.script_markup_descriptions.plain",
  },
  "bracket-tags": {
    label: "commands.providers.script_markups.bracket-tags",
    description: "commands.providers.script_markup_descriptions.bracket-tags",
  },
  emoji: {
    label: "commands.providers.script_markups.emoji",
    description: "commands.providers.script_markup_descriptions.emoji",
  },
};

const IMAGE_SUPPORT_KEYS: Record<keyof ImageEndpointSupports, string> = {
  txt2img: "commands.providers.model_image_supports.txt2img",
  img2img: "commands.providers.model_image_supports.img2img",
  inpaint: "commands.providers.model_image_supports.inpaint",
  negative_prompt: "commands.providers.model_image_supports.negative_prompt",
};

const SPEECH_CAPABILITY_KEYS: Record<"design" | "clone", string> = {
  design: "commands.config.panel.capability_tts_design",
  clone: "commands.config.panel.capability_tts_clone",
};

const ENTRY_KIND_KEYS: Record<ProviderPanelEntry["kind"], { label: string; impact: string }> = {
  provider: {
    label: "commands.providers.entry_kind_provider",
    impact: "commands.providers.remove_impact_provider",
  },
  endpoint: {
    label: "commands.providers.entry_kind_endpoint",
    impact: "commands.providers.remove_impact_endpoint",
  },
  brave: {
    label: "commands.providers.entry_kind_brave",
    impact: "commands.providers.remove_impact_brave",
  },
};

export const PROVIDERS_ENTRIES_PER_SELECTOR_PAGE = DISCORD_SELECT_OPTIONS_MAX - 2;
export const PROVIDERS_ADD_PROVIDER_VALUE = "action:add-provider";
export const PROVIDERS_ADD_ENDPOINT_VALUE = "action:add-endpoint";

export function providersEntriesPerPage(optionActionCount: number): number {
  return Math.max(1, PROVIDERS_ENTRIES_PER_SELECTOR_PAGE - optionActionCount);
}

export type AddProviderModalField = "provider" | "api-key";

export function buildAddProviderModalFieldId(field: AddProviderModalField, nonce: string): string {
  return `${field}_${nonce}`;
}

export function buildAddProviderModal(
  locale: string,
  nonce: string,
  routeNamespace: ProvidersRouteNamespace = PROVIDERS_ROUTE_NAMESPACE,
  includeBrave = true,
): { custom_id: string; title: string; components: RawDiscordComponent[] } {
  const curatedOptions = getAllProviderChoices()
    .filter((provider) => provider.value !== "custom")
    .map((provider) => {
      const descriptionKey = getProviderAddChoiceDescriptionKey(provider.value);
      return {
        label: safeSelectOptionText(provider.name, 100),
        value: provider.value,
        description: descriptionKey ? safeSelectOptionText(localizer(locale, descriptionKey), 100) : undefined,
      };
    });
  return {
    custom_id: buildProvidersRouteId(routeNamespace, { action: "add-submit", locale, nonce }),
    title: safeSelectOptionText(localizer(locale, "commands.providers.add_provider_modal_title"), 45),
    components: [
      {
        type: 18,
        label: safeSelectOptionText(localizer(locale, "commands.providers.provider_label"), 45),
        description: safeSelectOptionText(
          localizer(
            locale,
            includeBrave
              ? "commands.providers.provider_description"
              : "commands.providers.provider_description_personal",
          ),
          100,
        ),
        component: {
          type: 3,
          custom_id: buildAddProviderModalFieldId("provider", nonce),
          required: true,
          options: [
            ...curatedOptions,
            {
              label: localizer(locale, "commands.providers.provider_elevenlabs"),
              value: "elevenlabs",
              description: localizer(locale, "commands.providers.provider_elevenlabs_description"),
            },
            ...(includeBrave
              ? [
                  {
                    label: localizer(locale, "commands.providers.provider_brave"),
                    value: "brave",
                    description: localizer(locale, "commands.providers.provider_brave_description"),
                  },
                ]
              : []),
          ],
        },
      },
      {
        type: 18,
        label: safeSelectOptionText(localizer(locale, "commands.providers.api_key_label"), 45),
        description: safeSelectOptionText(localizer(locale, "commands.providers.api_key_description"), 100),
        component: {
          type: 4,
          custom_id: buildAddProviderModalFieldId("api-key", nonce),
          style: TextInputStyle.Short,
          placeholder: safeSelectOptionText(localizer(locale, "commands.providers.api_key_placeholder"), 100),
          min_length: 10,
          max_length: 500,
          required: true,
        },
      },
    ],
  };
}

export const ENDPOINT_API_STYLES: Readonly<Record<CustomEndpointCapability, readonly EndpointApiStyle[]>> = {
  text: ["openai-compatible", "ollama-native"],
  embedding: ["openai-compatible", "ollama-native"],
  image: ["openai-compatible", "comfyui"],
  video: ["openai-compatible", "comfyui"],
  speech: ["tts-clone"],
  transcription: ["openai-compatible-transcription"],
  decision: ["system-one", "openai-decisions"],
};

export const PROVIDERS_MODELS_PER_SELECTOR_PAGE = DISCORD_SELECT_OPTIONS_MAX - Object.keys(ENDPOINT_API_STYLES).length;

export type AddEndpointModalField = "label" | "url" | "api-style" | "auth-token";

export function buildAddEndpointModalFieldId(field: AddEndpointModalField, nonce: string): string {
  return `${field}_${nonce}`;
}

function endpointTextInput(
  locale: string,
  nonce: string,
  field: Exclude<AddEndpointModalField, "api-style">,
  required: boolean,
): RawDiscordComponent {
  return {
    type: 18,
    label: safeSelectOptionText(localizer(locale, ENDPOINT_FIELD_KEYS[field].label), 45),
    description: safeSelectOptionText(localizer(locale, ENDPOINT_FIELD_KEYS[field].description), 100),
    component: {
      type: 4,
      custom_id: buildAddEndpointModalFieldId(field, nonce),
      style: field === "auth-token" ? TextInputStyle.Paragraph : TextInputStyle.Short,
      placeholder: safeSelectOptionText(localizer(locale, ENDPOINT_FIELD_KEYS[field].placeholder), 100),
      max_length: field === "label" ? 40 : 500,
      required,
    },
  };
}

export function buildAddEndpointModal(
  locale: string,
  nonce: string,
  routeNamespace: ProvidersRouteNamespace = PROVIDERS_ROUTE_NAMESPACE,
): { custom_id: string; title: string; components: RawDiscordComponent[] } {
  return {
    custom_id: buildProvidersRouteId(routeNamespace, { action: "endpoint-submit", locale, nonce }),
    title: safeSelectOptionText(localizer(locale, "commands.providers.add_endpoint_modal_title"), 45),
    components: [
      endpointTextInput(locale, nonce, "label", true),
      endpointTextInput(locale, nonce, "url", true),
      {
        type: 18,
        label: safeSelectOptionText(localizer(locale, "commands.providers.endpoint_api_style_label"), 45),
        description: safeSelectOptionText(localizer(locale, "commands.providers.endpoint_api_style_description"), 100),
        component: {
          type: 21,
          custom_id: buildAddEndpointModalFieldId("api-style", nonce),
          required: true,
          options: [...new Set(Object.values(ENDPOINT_API_STYLES).flat())].map((style, index) => ({
            value: style,
            label: safeSelectOptionText(
              localizer(locale, API_STYLE_KEYS[style].label),
              DISCORD_SELECT_OPTION_LABEL_MAX,
            ),
            description: safeSelectOptionText(
              localizer(locale, API_STYLE_KEYS[style].description),
              DISCORD_SELECT_OPTION_DESCRIPTION_MAX,
            ),
            default: index === 0,
          })),
        },
      },
      endpointTextInput(locale, nonce, "auth-token", false),
    ],
  };
}

export type EditProviderModalField = "api-key" | "rotation-key" | "delete-rotation";

export function buildEditProviderModalFieldId(field: EditProviderModalField, nonce: string): string {
  return `${field}_${nonce}`;
}

export function buildEditProviderModal(
  locale: string,
  provider: string,
  rotationKeyCount: number,
  nonce: string,
  routeNamespace: ProvidersRouteNamespace = PROVIDERS_ROUTE_NAMESPACE,
  allowRotation = true,
): { custom_id: string; title: string; components: RawDiscordComponent[] } {
  const credentialField = (field: "api-key" | "rotation-key"): RawDiscordComponent => ({
    type: 18,
    label: safeSelectOptionText(localizer(locale, CREDENTIAL_FIELD_KEYS[field].label), 45),
    description: safeSelectOptionText(localizer(locale, CREDENTIAL_FIELD_KEYS[field].description), 100),
    component: {
      type: 4,
      custom_id: buildEditProviderModalFieldId(field, nonce),
      style: TextInputStyle.Paragraph,
      placeholder: safeSelectOptionText(localizer(locale, CREDENTIAL_FIELD_KEYS[field].placeholder), 100),
      min_length: 10,
      max_length: 500,
      required: false,
    },
  });
  return {
    custom_id: buildProvidersRouteId(routeNamespace, {
      action: "edit-provider-submit",
      locale,
      provider,
      nonce,
    }),
    title: safeSelectOptionText(localizer(locale, "commands.providers.edit_provider_modal_title"), 45),
    components:
      provider === "brave" || !allowRotation
        ? [credentialField("api-key")]
        : [
            credentialField("api-key"),
            credentialField("rotation-key"),
            {
              type: 18,
              label: safeSelectOptionText(localizer(locale, "commands.providers.delete_rotation_label"), 45),
              description: safeSelectOptionText(
                localizer(locale, "commands.providers.delete_rotation_description", { count: rotationKeyCount }),
                100,
              ),
              component: {
                type: 21,
                custom_id: buildEditProviderModalFieldId("delete-rotation", nonce),
                required: true,
                options: [
                  { value: "keep", label: localizer(locale, "commands.providers.delete_rotation_keep"), default: true },
                  { value: "delete", label: localizer(locale, "commands.providers.delete_rotation_confirm") },
                ],
              },
            },
          ],
  };
}

export interface EditEndpointModalContext {
  connectionId: number;
  label: string;
  endpointUrl: string;
  apiStyles: string[];
  isPreset: boolean;
  /** Undefined when the group has no text connection, which is the only kind the option affects. */
  vramHandoffEnabled?: boolean;
}

export type EditEndpointModalField = "label" | "url" | "auth-token" | "behavior";

/** The single Endpoint Behavior option value; the group is a checkbox list so later options can join it. */
export const UNLOAD_DURING_COMFYUI_BEHAVIOR = "unload-during-comfyui";

export function buildEditEndpointModalFieldId(field: EditEndpointModalField, nonce: string): string {
  return `edit-${field}_${nonce}`;
}

export function buildEditEndpointModal(
  locale: string,
  context: EditEndpointModalContext,
  nonce: string,
  routeNamespace: ProvidersRouteNamespace = PROVIDERS_ROUTE_NAMESPACE,
): { custom_id: string; title: string; components: RawDiscordComponent[] } {
  const components: RawDiscordComponent[] = context.isPreset
    ? [
        {
          type: 10,
          content: localizer(locale, "commands.providers.preset_endpoint_read_only", {
            label: context.label,
            url: context.endpointUrl,
            formats: context.apiStyles.join(", "),
          }),
        },
      ]
    : [
        {
          type: 18,
          label: safeSelectOptionText(localizer(locale, "commands.providers.endpoint_label_label"), 45),
          description: safeSelectOptionText(localizer(locale, "commands.providers.endpoint_label_description"), 100),
          component: {
            type: 4,
            custom_id: buildEditEndpointModalFieldId("label", nonce),
            style: TextInputStyle.Short,
            value: context.label,
            min_length: 1,
            max_length: 40,
            required: true,
          },
        },
        {
          type: 18,
          label: safeSelectOptionText(localizer(locale, "commands.providers.endpoint_url_label"), 45),
          description: safeSelectOptionText(localizer(locale, "commands.providers.edit_endpoint_url_description"), 100),
          component: {
            type: 4,
            custom_id: buildEditEndpointModalFieldId("url", nonce),
            style: TextInputStyle.Short,
            value: context.endpointUrl,
            placeholder: safeSelectOptionText(localizer(locale, "commands.providers.endpoint_url_placeholder"), 100),
            max_length: 500,
            required: true,
          },
        },
      ];
  components.push({
    type: 18,
    label: safeSelectOptionText(localizer(locale, "commands.providers.edit_auth_token_label"), 45),
    description: safeSelectOptionText(localizer(locale, "commands.providers.edit_auth_token_description"), 100),
    component: {
      type: 4,
      custom_id: buildEditEndpointModalFieldId("auth-token", nonce),
      style: TextInputStyle.Paragraph,
      placeholder: safeSelectOptionText(localizer(locale, "commands.providers.edit_auth_token_placeholder"), 100),
      max_length: 500,
      required: false,
    },
  });
  if (!context.isPreset && context.vramHandoffEnabled !== undefined) {
    components.push({
      type: 18,
      label: safeSelectOptionText(localizer(locale, "commands.providers.endpoint_behavior_label"), 45),
      description: safeSelectOptionText(localizer(locale, "commands.providers.endpoint_behavior_description"), 100),
      component: {
        type: 22,
        custom_id: buildEditEndpointModalFieldId("behavior", nonce),
        min_values: 0,
        max_values: 1,
        required: false,
        options: [
          {
            value: UNLOAD_DURING_COMFYUI_BEHAVIOR,
            label: safeSelectOptionText(localizer(locale, "commands.providers.endpoint_behavior_unload_comfyui"), 100),
            description: safeSelectOptionText(
              localizer(locale, "commands.providers.endpoint_behavior_unload_comfyui_description"),
              100,
            ),
            default: context.vramHandoffEnabled,
          },
        ],
      },
    });
  }
  return {
    custom_id: buildProvidersRouteId(routeNamespace, {
      action: "edit-endpoint-submit",
      locale,
      connectionId: context.connectionId,
      nonce,
    }),
    title: safeSelectOptionText(localizer(locale, "commands.providers.edit_endpoint_modal_title"), 45),
    components,
  };
}

export type ProvidersPanelPage =
  | { kind: "entry"; entryId?: string; modelRangeIndex?: number }
  | { kind: "add-provider" }
  | { kind: "remove"; entryId: string };

export type ProviderModelModalField =
  | "decision-action"
  | "code-name"
  | "num-ctx"
  | "flags"
  | "compat"
  | "image-supports"
  | "voice-mode"
  | "script-markup"
  | "supports-instruct"
  | "workflow";

const MODEL_SELECTION_CAPABILITIES: readonly ProviderPanelCapability[] = [
  "text",
  "image",
  "embedding",
  "video",
  "speech",
  "transcription",
  "decision",
];

const TEXT_CAPABILITY_FLAGS = ["tools", "images", "structured"] as const;
const CHAT_COMPAT_FLAGS = ["strict-roles", "prefix", "prefill", "verbatim-tools"] as const;

/**
 * Strict role alternation and prefix completion describe the backend's parser, not the model. A flag
 * the request path either ignores or force-overrides is a control that cannot change anything, so it
 * is not offered.
 * Re-derive this at submit time too: a panel may outlive the answer.
 *
 * Verbatim tool calling is different in kind: the request path always honors it, but only
 * `CustomStreamAdapter` runs the parser that executes what the model writes, so offering it to a
 * curated provider would produce tool calls nothing consumes.
 *
 * Assistant prefill describes whether the model continues a trailing assistant turn, which the
 * prefill resolver reads for every provider. It is offered wherever the user can register a model
 * the seed does not cover (including OpenRouter codenames), and hidden where prefix completion
 * already makes the prefill native or where the seed is authoritative (Anthropic, Google, NovelAI).
 */
export function offeredChatCompatFlags(
  entryKind: "provider" | "endpoint",
  entryKey: string,
): ReadonlyArray<(typeof CHAT_COMPAT_FLAGS)[number]> {
  // A custom endpoint is served by the `custom` provider, whose OpenAI-compatible adapter reads both
  // compat columns. These toggles were introduced for exactly that case and must keep working there.
  const provider = entryKind === "endpoint" ? "custom" : entryKey;
  if (providerUsesApiFamily(provider, "openrouter")) return ["prefill"];
  if (!providerUsesApiFamily(provider, "openai-compatible")) return [];
  return CHAT_COMPAT_FLAGS.filter((flag) => {
    if (flag === "strict-roles") return !providerRequiresAlternation(provider);
    if (flag === "prefix" || flag === "prefill") return !providerRequiresPrefixCompletion(provider);
    return entryKind === "endpoint";
  });
}

const IMAGE_SUPPORT_FIELDS: ReadonlyArray<keyof ImageEndpointSupports> = [
  "txt2img",
  "img2img",
  "inpaint",
  "negative_prompt",
];

export interface ProviderModelModalDefaults {
  apiStyle?: CustomEndpointApiStyle;
  codeName?: string;
  text?: ProviderPanelModel["textSettings"];
  decision?: ProviderPanelModel["decisionSettings"];
  image?: { supports: ImageEndpointSupports; allowInpaint: boolean };
  speech?: { settings: SpeechEndpointSettings; allowVoiceMode: boolean };
}

export interface ModelSelectionValue {
  mode: "add" | "edit";
  capability: ProviderPanelCapability;
  editingModelId: number | null;
}

export function buildModelSelectionValue(
  mode: "add" | "edit",
  capability: ProviderPanelCapability,
  model?: ProviderPanelModel,
): string {
  return mode === "add" ? `add:${capability}` : `edit:${capability}:${model?.id ?? 0}`;
}

function isModelSelectionCapability(value: string | undefined): value is ProviderPanelCapability {
  return MODEL_SELECTION_CAPABILITIES.includes(value as ProviderPanelCapability);
}

export function parseModelSelectionValue(raw: string | undefined): ModelSelectionValue | null {
  const [mode, capability, rawModelId] = raw?.split(":") ?? [];
  if (mode !== "add" && mode !== "edit") return null;
  if (!isModelSelectionCapability(capability)) return null;
  if (mode === "add") return { mode, capability, editingModelId: null };

  const editingModelId = Number(rawModelId);
  if (!Number.isSafeInteger(editingModelId) || editingModelId <= 0) return null;
  return { mode, capability, editingModelId };
}

export function buildProviderModelModalFieldId(field: ProviderModelModalField, nonce: string): string {
  return `${field}_${nonce}`;
}

function entryRouteFields(entry: ProviderPanelEntry): { entryKind: "provider" | "endpoint"; entryKey: string } | null {
  if (entry.kind === "provider") return { entryKind: "provider", entryKey: entry.provider };
  if (entry.kind === "endpoint") return { entryKind: "endpoint", entryKey: String(entry.connectionIds[0] ?? 0) };
  return null;
}

function removalRouteFields(entry: ProviderPanelEntry): {
  entryKind: "provider" | "endpoint" | "brave";
  entryKey: string;
} {
  if (entry.kind === "provider") return { entryKind: "provider", entryKey: entry.provider };
  if (entry.kind === "endpoint") return { entryKind: "endpoint", entryKey: String(entry.connectionIds[0] ?? 0) };
  return { entryKind: "brave", entryKey: "brave" };
}

export function buildProviderModelModal(
  locale: string,
  entryKind: "provider" | "endpoint",
  entryKey: string,
  capability: ProviderPanelCapabilitySection["capability"],
  editingModelId: number | null,
  nonce: string,
  defaults?: ProviderModelModalDefaults,
  routeNamespace: ProvidersRouteNamespace = PROVIDERS_ROUTE_NAMESPACE,
): { custom_id: string; title: string; components: RawDiscordComponent[] } {
  const components: RawDiscordComponent[] = [
    {
      type: 18,
      label: safeSelectOptionText(localizer(locale, "commands.providers.model_code_label"), 45),
      description: safeSelectOptionText(localizer(locale, "commands.providers.model_code_description"), 100),
      component: {
        type: 4,
        custom_id: buildProviderModelModalFieldId("code-name", nonce),
        style: TextInputStyle.Short,
        placeholder: safeSelectOptionText(localizer(locale, CAPABILITY_KEYS[capability].placeholder), 100),
        min_length: 1,
        max_length: 200,
        required: true,
        value: defaults?.codeName,
      },
    },
  ];
  if ((capability === "text" || capability === "decision") && entryKind === "endpoint") {
    components.push({
      type: 18,
      label: safeSelectOptionText(localizer(locale, "commands.providers.model_num_ctx_label"), 45),
      description: safeSelectOptionText(
        localizer(
          locale,
          capability === "decision"
            ? "commands.providers.decision_input_limit_description"
            : "commands.providers.model_num_ctx_description",
        ),
        100,
      ),
      component: {
        type: 4,
        custom_id: buildProviderModelModalFieldId("num-ctx", nonce),
        style: TextInputStyle.Short,
        placeholder: "16384",
        value:
          capability === "decision"
            ? defaults?.decision
              ? String(defaults.decision.inputTokenLimit)
              : undefined
            : defaults?.text?.numCtx
              ? String(defaults.text.numCtx)
              : undefined,
        max_length: 8,
        required: capability === "decision",
      },
    });
  }
  if (capability === "text") {
    const storedFlags: Record<string, boolean | undefined> = {
      tools: defaults?.text?.hasTools,
      images: defaults?.text?.seesImages,
      structured: defaults?.text?.supportsStructOutput,
      "strict-roles": defaults?.text?.strictRoleAlternation,
      prefix: defaults?.text?.supportsPrefixCompletion,
      prefill: defaults?.text?.supportsAssistantPrefill,
      "verbatim-tools": defaults?.text?.verbatimToolCalling,
    };
    const flagOption = (value: keyof typeof MODEL_FLAG_KEYS) => ({
      value,
      label: safeSelectOptionText(localizer(locale, MODEL_FLAG_KEYS[value].label), 100),
      description: safeSelectOptionText(localizer(locale, MODEL_FLAG_KEYS[value].description), 100),
      default: Boolean(storedFlags[value]),
    });
    components.push({
      type: 18,
      label: safeSelectOptionText(localizer(locale, "commands.providers.model_flags_label"), 45),
      description: safeSelectOptionText(localizer(locale, "commands.providers.model_flags_description"), 100),
      component: {
        type: 22,
        custom_id: buildProviderModelModalFieldId("flags", nonce),
        min_values: 0,
        max_values: TEXT_CAPABILITY_FLAGS.length,
        required: false,
        options: TEXT_CAPABILITY_FLAGS.map(flagOption),
      },
    });
    const compatFlags = offeredChatCompatFlags(entryKind, entryKey);
    if (compatFlags.length > 0) {
      components.push({
        type: 18,
        label: safeSelectOptionText(localizer(locale, "commands.providers.model_compat_label"), 45),
        description: safeSelectOptionText(localizer(locale, "commands.providers.model_compat_description"), 100),
        component: {
          type: 22,
          custom_id: buildProviderModelModalFieldId("compat", nonce),
          min_values: 0,
          max_values: compatFlags.length,
          required: false,
          options: compatFlags.map(flagOption),
        },
      });
    }
  }
  if (capability === "decision" && editingModelId) {
    components.push({
      type: 18,
      label: localizer(locale, "commands.providers.decision_action_label"),
      component: {
        type: 21,
        custom_id: buildProviderModelModalFieldId("decision-action", nonce),
        required: true,
        options: [
          { value: "save", label: localizer(locale, "commands.providers.decision_action_save"), default: true },
          { value: "delete", label: localizer(locale, "commands.providers.decision_action_delete") },
        ],
      },
    });
  }
  // ElevenLabs has no clone/design body shapes, so its preset exposes script markup without a voice-mode selector.
  if (capability === "speech" && defaults?.speech) {
    const speech = defaults.speech;
    if (speech.allowVoiceMode) {
      components.push({
        type: 18,
        label: safeSelectOptionText(localizer(locale, "commands.providers.model_voice_mode_label"), 45),
        description: safeSelectOptionText(localizer(locale, "commands.providers.model_voice_mode_description"), 100),
        component: {
          type: 21,
          custom_id: buildProviderModelModalFieldId("voice-mode", nonce),
          required: true,
          options: SPEECH_VOICE_MODES.map((mode) => ({
            value: mode,
            label: safeSelectOptionText(localizer(locale, VOICE_MODE_KEYS[mode].label), 100),
            description: safeSelectOptionText(localizer(locale, VOICE_MODE_KEYS[mode].description), 100),
            default: mode === speech.settings.voiceMode,
          })),
        },
      });
    }
    components.push({
      type: 18,
      label: safeSelectOptionText(localizer(locale, "commands.providers.model_script_markup_label"), 45),
      description: safeSelectOptionText(localizer(locale, "commands.providers.model_script_markup_description"), 100),
      component: {
        type: 21,
        custom_id: buildProviderModelModalFieldId("script-markup", nonce),
        required: true,
        options: SPEECH_SCRIPT_MARKUPS.map((markup) => ({
          value: markup,
          label: safeSelectOptionText(localizer(locale, SCRIPT_MARKUP_KEYS[markup].label), 100),
          description: safeSelectOptionText(localizer(locale, SCRIPT_MARKUP_KEYS[markup].description), 100),
          default: markup === speech.settings.scriptMarkup,
        })),
      },
    });
    if (speech.allowVoiceMode) {
      components.push({
        type: 18,
        label: safeSelectOptionText(localizer(locale, "commands.providers.model_supports_instruct_label"), 45),
        description: safeSelectOptionText(
          localizer(locale, "commands.providers.model_supports_instruct_description"),
          100,
        ),
        component: {
          type: 22,
          custom_id: buildProviderModelModalFieldId("supports-instruct", nonce),
          min_values: 0,
          max_values: 1,
          required: false,
          options: [
            {
              value: "supports-instruct",
              label: safeSelectOptionText(localizer(locale, "commands.providers.model_supports_instruct_option"), 100),
              description: safeSelectOptionText(
                localizer(locale, "commands.providers.model_supports_instruct_option_description"),
                100,
              ),
              default: speech.settings.supportsInstruct,
            },
          ],
        },
      });
    }
  }
  if (
    entryKind === "endpoint" &&
    defaults?.apiStyle === "comfyui" &&
    (capability === "image" || capability === "video")
  ) {
    components.push({
      type: 18,
      label: safeSelectOptionText(localizer(locale, "commands.providers.model_workflow_label"), 45),
      description: safeSelectOptionText(localizer(locale, "commands.providers.model_workflow_description"), 100),
      component: {
        type: 19,
        custom_id: buildProviderModelModalFieldId("workflow", nonce),
        min_values: 0,
        max_values: 1,
        required: false,
      },
    });
  }
  // The caller omits `image` when nothing would store the declaration: a curated provider whose image
  // path never consults these flags, such as NovelAI's own tool.
  if (capability === "image" && defaults?.image) {
    const offered = IMAGE_SUPPORT_FIELDS.filter((field) => field !== "inpaint" || defaults.image?.allowInpaint);
    components.push({
      type: 18,
      label: safeSelectOptionText(localizer(locale, "commands.providers.model_image_supports_label"), 45),
      description: safeSelectOptionText(localizer(locale, "commands.providers.model_image_supports_description"), 100),
      component: {
        type: 22,
        custom_id: buildProviderModelModalFieldId("image-supports", nonce),
        min_values: 1,
        max_values: offered.length,
        required: true,
        options: offered.map((field) => ({
          value: field,
          label: safeSelectOptionText(localizer(locale, IMAGE_SUPPORT_KEYS[field]), DISCORD_SELECT_OPTION_LABEL_MAX),
          default: defaults.image?.supports[field] ?? false,
        })),
      },
    });
  }
  return {
    custom_id: buildProvidersRouteId(routeNamespace, {
      action: "model-submit",
      locale,
      entryKind,
      entryKey,
      capability,
      editingModelId: editingModelId ?? null,
      nonce,
    }),
    title: safeSelectOptionText(
      localizer(
        locale,
        editingModelId ? "commands.providers.edit_model_modal_title" : "commands.providers.add_model_modal_title",
      ),
      45,
    ),
    components,
  };
}

export interface ProvidersPanelPayload {
  components: TopLevelComponentData[];
  flags: MessageFlags.IsComponentsV2;
}

export interface ProvidersPanelRenderInput {
  locale: string;
  entries: ProviderPanelEntry[];
  initialEntryId: string | null;
  readStatus: PanelReadStatus;
  page: ProvidersPanelPage;
  rangeIndex?: number;
  receipt?: PanelReceipt;
  enabledActions?: ReadonlySet<"add-provider" | "add-endpoint" | "model" | "edit" | "remove">;
  routeNamespace?: ProvidersRouteNamespace;
  footerCommand?: { root: string; subcommandGroup?: string; subcommand?: string };
  optionActions?: ProviderPanelOptionAction[];
  optionOwnerId?: number;
  viewerId?: string;
  canManageServer?: boolean;
}

function buildRetryRow(locale: string, routeNamespace: ProvidersRouteNamespace): ActionRowData<ButtonComponentData> {
  return {
    type: ComponentType.ActionRow,
    components: [
      {
        type: ComponentType.Button,
        style: ButtonStyle.Secondary,
        customId: buildProvidersRouteId(routeNamespace, { action: "retry", locale }),
        label: localizer(locale, "commands.providers.retry"),
      },
    ],
  };
}

function buildPayload(components: ComponentInContainerData[], receipt?: PanelReceipt): ProvidersPanelPayload {
  return {
    components: [buildPanelContainer(components), ...(receipt ? [buildPanelReceiptContainer(receipt)] : [])],
    flags: MessageFlags.IsComponentsV2,
  };
}

function buildModelLine(locale: string, model: ProviderPanelModel, routeNamespace: ProvidersRouteNamespace): string {
  const markers: string[] = [];
  const personal = routeNamespace !== PROVIDERS_ROUTE_NAMESPACE;
  if (model.isWorkspaceActive) {
    markers.push(
      localizer(
        locale,
        personal ? "commands.providers.marker_personal_active" : "commands.providers.marker_workspace_active",
      ),
    );
  }
  if (model.isWorkspaceFallback) {
    markers.push(
      localizer(
        locale,
        personal ? "commands.providers.marker_personal_fallback" : "commands.providers.marker_workspace_fallback",
      ),
    );
  }
  if (model.isProviderFallback) markers.push(localizer(locale, "commands.providers.marker_provider_fallback"));
  if (model.isCustomRegistration) {
    markers.push(localizer(locale, "commands.providers.marker_custom_registration"));
  }
  const suffix = markers.length > 0 ? ` (${markers.join(", ")})` : "";
  const codeName = model.codeName.replaceAll("`", "ˋ").replaceAll(/\s+/g, " ").trim();
  return `> \`${codeName}\`${suffix}`;
}

const PROVIDER_NAME_PREVIEW_BUDGET = 600;

/**
 * Each refit shrinks the body by the measured post-wrap overflow, so the fit converges; the bound
 * only stops a future formatter that wraps differently at each length from looping forever.
 */
const ENTRY_FIT_ATTEMPTS = 3;

function entryDisplayName(locale: string, entry: ProviderPanelEntry): string {
  return entry.copyKey ? localizer(locale, entry.copyKey) : entry.displayName;
}

function renderProviderName(locale: string, value: string): string {
  const preview = buildTextPreview(value, PROVIDER_NAME_PREVIEW_BUDGET);
  const rendered = escapeDiscordMarkdown(preview.text);
  const footerKey = textPreviewFooterKey(preview);
  if (!footerKey) return rendered;
  return `${rendered}\n-# ${localizer(locale, footerKey, textPreviewFooterVars(preview, locale))}`;
}

function buildCapabilitySection(
  locale: string,
  section: ProviderPanelCapabilitySection,
  routeNamespace: ProvidersRouteNamespace,
): string {
  const label = localizer(locale, CAPABILITY_KEYS[section.capability].label);
  if (section.capability === "speech") {
    return (["design", "clone"] as const)
      .flatMap((mode) => {
        const eligible = section.models.filter(
          (model) =>
            model.speechSettings &&
            (model.speechSettings.voiceMode === "auto" ||
              model.speechSettings.voiceMode === (mode === "design" ? "voice-design" : "clone")),
        );
        if (eligible.length === 0) return [];
        return [
          [
            `**${localizer(locale, SPEECH_CAPABILITY_KEYS[mode])}**`,
            ...eligible.map((model) =>
              buildModelLine(
                locale,
                {
                  ...model,
                  isWorkspaceActive: model.speechActiveModes?.includes(mode) ?? false,
                },
                routeNamespace,
              ),
            ),
          ].join("\n"),
        ];
      })
      .join("\n\n");
  }
  return [
    `**${label}**`,
    localizer(locale, "commands.providers.capability_models_explanation"),
    ...section.models.map((model) => buildModelLine(locale, model, routeNamespace)),
  ].join("\n");
}

function buildEntryBody(
  locale: string,
  entry: ProviderPanelEntry,
  routeNamespace: ProvidersRouteNamespace,
  bodyLimit: number,
): string {
  if (entry.kind === "brave") {
    return [
      localizer(locale, "commands.providers.brave_description"),
      `> ${localizer(locale, "commands.providers.brave_configured")}`,
    ].join("\n");
  }

  // A sparse entry would otherwise print one empty block per unpopulated capability, so absence is
  // stated once for the whole page instead.
  const populated = entry.capabilities.filter((section) => section.models.length > 0);
  if (populated.length === 0) return localizer(locale, "commands.providers.entry_no_models");
  const body = populated.map((section) => buildCapabilitySection(locale, section, routeNamespace)).join("\n\n");
  return capEntryBody(locale, body, bodyLimit);
}

/**
 * Discord rejects a TextDisplay over 4000 characters, and the model list under each capability is
 * unbounded, so a catalog-sized provider made the whole panel fail with BASE_TYPE_BAD_LENGTH rather
 * than render. Trimming at a line boundary and stating the omitted count keeps the panel usable
 * without hiding models silently.
 */
function capEntryBody(locale: string, body: string, bodyLimit: number): string {
  const preview = buildTextPreview(body, bodyLimit);
  const footerKey = textPreviewFooterKey(preview);
  if (!footerKey) return preview.text;
  return `${preview.text}\n-# ${localizer(locale, footerKey, textPreviewFooterVars(preview, locale))}`;
}

/**
 * Fits the entry body and its trailing guidance into what the rest of the panel leaves of Discord's
 * message-wide text-display total. A fixed body cap overflowed that total once a long locale's
 * guidance and a receipt shared the message. The fit is measured after the panel boundary wraps the
 * text, because each wrapped line gains a prefix the raw length does not count.
 */
function buildEntryContent(
  locale: string,
  entry: ProviderPanelEntry,
  routeNamespace: ProvidersRouteNamespace,
  guidance: string,
  availableTextLength: number,
): string {
  let bodyLimit = Math.max(0, availableTextLength - guidance.length);
  let content = "";
  for (let attempt = 0; attempt < ENTRY_FIT_ATTEMPTS; attempt++) {
    content = `${buildEntryBody(locale, entry, routeNamespace, bodyLimit)}${guidance}`;
    const overflow =
      measureFormattedPanelTextLength({ type: ComponentType.TextDisplay, content }) - availableTextLength;
    if (overflow <= 0) return content;
    bodyLimit = Math.max(0, bodyLimit - overflow);
  }
  return content;
}

function buildEntryActions(
  locale: string,
  entry: ProviderPanelEntry,
  readStatus: PanelReadStatus,
  enabledActions: ProvidersPanelRenderInput["enabledActions"],
  routeNamespace: ProvidersRouteNamespace,
  input: ProvidersPanelRenderInput,
): ActionRowData<ButtonComponentData> | null {
  const option = entry.kind === "provider" ? findProviderOption(entry.provider) : undefined;
  if (option) {
    return (
      option.panel?.entryActions?.({
        locale,
        scope: providerOptionScopeForPanel(routeNamespace, input),
        entry,
        data: entry.optionData,
        canManageServer: input.canManageServer ?? false,
      }) ?? null
    );
  }
  const unavailable = readStatus !== "fresh";
  const buttons: ButtonComponentData[] = [];
  buttons.push(
    {
      type: ComponentType.Button,
      style: ButtonStyle.Secondary,
      customId:
        entry.kind === "endpoint"
          ? buildProvidersRouteId(routeNamespace, {
              action: "edit-endpoint-open",
              locale,
              connectionId: entry.connectionIds[0] ?? 0,
            })
          : entry.kind === "provider"
            ? buildProvidersRouteId(routeNamespace, {
                action: "edit-provider-open",
                locale,
                provider: entry.provider,
                rotationKeyCount: entry.rotationKeyCount,
              })
            : buildProvidersRouteId(routeNamespace, {
                action: "edit-provider-open",
                locale,
                provider: "brave",
                rotationKeyCount: 0,
              }),
      label:
        entry.kind === "endpoint"
          ? localizer(locale, "commands.providers.edit_endpoint")
          : localizer(locale, "commands.providers.edit_provider"),
      disabled: unavailable || !enabledActions?.has("edit"),
    },
    {
      type: ComponentType.Button,
      style: ButtonStyle.Danger,
      customId: buildProvidersRouteId(routeNamespace, {
        action: "remove-prompt",
        locale,
        ...removalRouteFields(entry),
      }),
      label: localizer(
        locale,
        entry.kind === "endpoint"
          ? "commands.providers.remove_endpoint"
          : entry.kind === "brave"
            ? "commands.providers.remove_key"
            : "commands.providers.remove_provider",
      ),
      disabled: unavailable || !enabledActions?.has("remove"),
    },
  );
  return { type: ComponentType.ActionRow, components: buttons };
}

function buildEntryModelSelector(
  locale: string,
  entry: ProviderPanelEntry,
  readStatus: PanelReadStatus,
  rangeIndex = 0,
  enabledActions: ProvidersPanelRenderInput["enabledActions"],
  routeNamespace: ProvidersRouteNamespace,
): ComponentInContainerData[] {
  const entryFields = entryRouteFields(entry);
  if (!entryFields || entry.kind === "brave") return [];
  const customModels = entry.capabilities.flatMap((section) =>
    section.models
      .filter((model) => model.isCustomRegistration)
      .map((model) => ({ capability: section.capability, model })),
  );
  const selection = resolveRangeSelection(customModels, rangeIndex, PROVIDERS_MODELS_PER_SELECTOR_PAGE);
  // A capability the entry does not expose cannot be registered: the shared-provider path answers
  // `unsupported-capability` and the endpoint path `not-found`, so offering it is a dead end.
  const offeredCapabilities = MODEL_SELECTION_CAPABILITIES.filter((capability) =>
    entry.capabilities.some((section) => section.capability === capability && section.availability !== "unavailable"),
  );
  const addOptions: SelectMenuComponentOptionData[] = offeredCapabilities.map((capability) => ({
    label: safeSelectOptionText(
      localizer(
        locale,
        capability === "decision" ? "commands.providers.add_decision_model" : "commands.providers.add_capability_model",
        {
          capability: localizer(locale, CAPABILITY_KEYS[capability].label),
        },
      ),
      100,
    ),
    value: buildModelSelectionValue("add", capability),
  }));
  const options: SelectMenuComponentOptionData[] = [
    ...addOptions,
    ...selection.visibleItems.map(({ capability, model }) => ({
      label: safeSelectOptionText(model.codeName, 100),
      value: buildModelSelectionValue("edit", capability, model),
      description: safeSelectOptionText(
        `${localizer(locale, CAPABILITY_KEYS[capability].label)} · ${localizer(
          locale,
          "commands.providers.marker_custom_registration",
        )}`,
        100,
      ),
    })),
  ];
  // Discord rejects a String Select with no options, so an entry exposing nothing renders none.
  if (options.length === 0) return [];
  const components: ComponentInContainerData[] = [
    {
      type: ComponentType.ActionRow,
      components: [
        {
          type: ComponentType.StringSelect,
          customId: buildProvidersRouteId(routeNamespace, {
            action: "model-select",
            locale,
            ...entryFields,
          }),
          placeholder: localizer(locale, "commands.providers.manage_models_placeholder"),
          options,
          disabled: readStatus !== "fresh" || !enabledActions?.has("model"),
        },
      ],
    },
  ];
  const modelPaginationRow = buildPaginationRow({
    locale,
    rangeIndex: selection.rangeIndex,
    rangeCount: selection.rangeCount,
    namespace: routeNamespace,
    version: PROVIDERS_ROUTE_VERSION,
    disabled: readStatus !== "fresh" || !enabledActions?.has("model"),
    buildSegments: {
      page: (rangeIndex) =>
        buildProvidersRouteSegments({
          action: "model-range",
          locale,
          ...entryFields,
          rangeIndex,
        }),
    },
  });
  if (modelPaginationRow) {
    components.push(modelPaginationRow);
  }
  return components;
}

function optionEntryDescriptionKey(
  locale: string,
  entry: ProviderPanelEntry,
  routeNamespace: ProvidersRouteNamespace,
  input: ProvidersPanelRenderInput,
): string | null {
  if (entry.kind !== "provider") return null;
  const option = findProviderOption(entry.provider);
  if (!option) return null;
  const context = {
    locale,
    scope: providerOptionScopeForPanel(routeNamespace, input),
    entry,
    data: entry.optionData,
    canManageServer: input.canManageServer ?? false,
  };
  const scopeKind = context.scope.kind;
  const owned = option.panel?.entryOwned?.(context) ?? false;
  if (owned && option.copy.entryDescriptionKeys.owned) return option.copy.entryDescriptionKeys.owned;
  return option.copy.entryDescriptionKeys[scopeKind];
}

function entryDescriptionKey(
  locale: string,
  entry: ProviderPanelEntry,
  routeNamespace: ProvidersRouteNamespace,
  input: ProvidersPanelRenderInput,
): string {
  return optionEntryDescriptionKey(locale, entry, routeNamespace, input) ?? ENTRY_KIND_KEYS[entry.kind].label;
}

function selectedEntryId(input: ProvidersPanelRenderInput): string | null {
  if (input.page.kind === "entry") return input.page.entryId ?? input.initialEntryId;
  if (input.page.kind === "remove") return input.page.entryId;
  return null;
}

function providerOptionScopeForPanel(
  routeNamespace: ProvidersRouteNamespace,
  input: ProvidersPanelRenderInput,
): ProviderOptionScope {
  return {
    kind: routeNamespace === PROVIDERS_ROUTE_NAMESPACE ? "server" : "personal",
    ownerId: input.optionOwnerId ?? 0,
    discordId: input.viewerId,
  };
}

export function buildProvidersPanelPayload(input: ProvidersPanelRenderInput): ProvidersPanelPayload {
  const { locale, entries, readStatus } = input;
  const routeNamespace = input.routeNamespace ?? PROVIDERS_ROUTE_NAMESPACE;
  const titleKey =
    routeNamespace === PROVIDERS_ROUTE_NAMESPACE ? "commands.providers.title" : "commands.providers.personal_title";
  const components: ComponentInContainerData[] = [
    {
      type: ComponentType.TextDisplay,
      content: `## ${localizer(locale, titleKey)}\n${localizer(locale, "commands.providers.selector_guidance")}`,
    },
  ];

  if (readStatus === "unavailable") {
    components.push(
      { type: ComponentType.TextDisplay, content: localizer(locale, "commands.providers.unavailable") },
      buildRetryRow(locale, routeNamespace),
    );
    return buildPayload(components, input.receipt);
  }

  const selectedId = selectedEntryId(input);
  const selectedIndex = selectedId ? entries.findIndex((entry) => entry.id === selectedId) : -1;
  const actionOptions: SelectMenuComponentOptionData[] = [
    {
      label: localizer(locale, "commands.providers.select_add_provider"),
      value: PROVIDERS_ADD_PROVIDER_VALUE,
      description: localizer(locale, "commands.providers.select_add_provider_description"),
      default: input.page.kind === "add-provider",
    },
    {
      label: localizer(locale, "commands.providers.select_add_endpoint"),
      value: PROVIDERS_ADD_ENDPOINT_VALUE,
      description: localizer(locale, "commands.providers.select_add_endpoint_description"),
    },
  ];
  for (const action of input.optionActions ?? []) {
    actionOptions.unshift({
      label: safeSelectOptionText(localizer(locale, action.labelKey), DISCORD_SELECT_OPTION_LABEL_MAX),
      value: action.value,
      description: safeSelectOptionText(
        localizer(locale, action.descriptionKey),
        DISCORD_SELECT_OPTION_DESCRIPTION_MAX,
      ),
    });
  }
  const entryPageSize = providersEntriesPerPage(actionOptions.length - 2);
  const implicitRangeIndex = selectedIndex < 0 ? 0 : Math.floor(selectedIndex / entryPageSize);
  const selection = resolveRangeSelection(entries, input.rangeIndex ?? implicitRangeIndex, {
    reservedOptions: actionOptions.length,
  });
  const options: SelectMenuComponentOptionData[] = [
    ...actionOptions,
    ...selection.visibleItems.map((entry) => ({
      label: safeSelectOptionText(entryDisplayName(locale, entry), DISCORD_SELECT_OPTION_LABEL_MAX),
      value: entry.id,
      description: safeSelectOptionText(
        localizer(locale, entryDescriptionKey(locale, entry, routeNamespace, input)),
        DISCORD_SELECT_OPTION_DESCRIPTION_MAX,
      ),
      default: entry.id === selectedId,
    })),
  ];
  const selectRow: ActionRowData<StringSelectMenuComponentData> = {
    type: ComponentType.ActionRow,
    components: [
      {
        type: ComponentType.StringSelect,
        customId: buildProvidersRouteId(routeNamespace, { action: "select", locale }),
        placeholder: localizer(locale, "commands.providers.select_placeholder"),
        options,
        disabled: readStatus !== "fresh",
      },
    ],
  };
  components.push(selectRow);

  const paginationRow = buildPaginationRow({
    locale,
    rangeIndex: selection.rangeIndex,
    rangeCount: selection.rangeCount,
    namespace: routeNamespace,
    version: PROVIDERS_ROUTE_VERSION,
    disabled: readStatus !== "fresh",
    buildSegments: {
      page: (rangeIndex) => buildProvidersRouteSegments({ action: "range", locale, rangeIndex }),
    },
  });
  if (paginationRow) {
    components.push(paginationRow);
  }

  // Built before the page branches because the entry page reserves their length out of the
  // message-wide text total before it sizes its own body.
  const footerComponents: ComponentInContainerData[] = [
    { type: ComponentType.Separator, divider: true, spacing: 1 },
    {
      type: ComponentType.TextDisplay,
      content: `-# ${localizer(
        locale,
        routeNamespace === PROVIDERS_ROUTE_NAMESPACE
          ? "commands.providers.routing_hint"
          : "commands.providers.personal_routing_hint",
      )}`,
    },
  ];
  if (readStatus === "stale") {
    footerComponents.push(buildRetryRow(locale, routeNamespace), {
      type: ComponentType.TextDisplay,
      content: withLinePrefix("-# ", localizer(locale, "commands.providers.stale_warning")),
    });
  }

  components.push({ type: ComponentType.Separator, divider: true, spacing: 1 });
  if (input.page.kind === "remove") {
    const removalPage = input.page;
    const entry = entries.find((candidate) => candidate.id === removalPage.entryId);
    if (entry) {
      const removalFields = removalRouteFields(entry);
      const option = entry.kind === "provider" ? findProviderOption(entry.provider) : undefined;
      components.push(
        {
          type: ComponentType.TextDisplay,
          content: `### ${localizer(locale, "commands.providers.remove_title")}
${localizer(locale, option?.copy.removeImpactKey ?? ENTRY_KIND_KEYS[entry.kind].impact, {
  name: renderProviderName(locale, entryDisplayName(locale, entry)),
})}`,
        },
        {
          type: ComponentType.ActionRow,
          components: [
            {
              type: ComponentType.Button,
              style: ButtonStyle.Danger,
              customId: buildProvidersRouteId(routeNamespace, {
                action: "remove-confirm",
                locale,
                ...removalFields,
              }),
              label: localizer(locale, "commands.providers.remove_confirm"),
              disabled: readStatus !== "fresh",
            },
            {
              type: ComponentType.Button,
              style: ButtonStyle.Secondary,
              customId: buildProvidersRouteId(routeNamespace, {
                action: "remove-cancel",
                locale,
                ...removalFields,
              }),
              label: localizer(locale, "commands.providers.cancel"),
            },
          ],
        },
      );
    } else {
      components.push({
        type: ComponentType.TextDisplay,
        content: localizer(locale, "commands.providers.changed_receipt_detail"),
      });
    }
  } else if (input.page.kind === "add-provider") {
    components.push({
      type: ComponentType.TextDisplay,
      content: `### ${localizer(locale, "commands.providers.select_add_provider")}\n${localizer(
        locale,
        "commands.providers.read_only_action_pending",
      )}`,
    });
  } else {
    const entry = entries.find((candidate) => candidate.id === selectedId) ?? entries[0];
    if (entry) {
      const modelSelector = buildEntryModelSelector(
        locale,
        entry,
        readStatus,
        input.page.kind === "entry" ? input.page.modelRangeIndex : 0,
        input.enabledActions,
        routeNamespace,
      );
      const guidance =
        modelSelector.length > 0 ? `\n\n${localizer(locale, "commands.providers.model_selector_guidance")}` : "";
      const option = entry.kind === "provider" ? findProviderOption(entry.provider) : undefined;
      const optionComponents = option?.panel?.entryComponents?.({
        locale,
        scope: providerOptionScopeForPanel(routeNamespace, input),
        entry,
        data: entry.optionData,
        canManageServer: input.canManageServer ?? false,
      });
      const fixedTextLength =
        measureFormattedPanelTextLength([...components, ...footerComponents]) +
        (optionComponents ? measureFormattedPanelTextLength([...optionComponents]) : 0) +
        (input.receipt ? measureFormattedPanelTextLength(buildPanelReceiptContainer(input.receipt)) : 0);
      const entryActions = buildEntryActions(locale, entry, readStatus, input.enabledActions, routeNamespace, input);
      components.push(
        {
          type: ComponentType.TextDisplay,
          content: buildEntryContent(
            locale,
            entry,
            routeNamespace,
            guidance,
            DISCORD_MESSAGE_TEXT_DISPLAY_TOTAL_MAX - fixedTextLength,
          ),
        },
        ...modelSelector,
        ...(optionComponents ?? []),
        ...(entryActions ? [entryActions] : []),
      );
    } else {
      components.push({
        type: ComponentType.TextDisplay,
        content: `### ${localizer(locale, "commands.providers.empty_heading")}\n${localizer(
          locale,
          "commands.providers.empty_description",
        )}`,
      });
    }
  }

  components.push(...footerComponents);
  return buildPayload(components, input.receipt);
}
