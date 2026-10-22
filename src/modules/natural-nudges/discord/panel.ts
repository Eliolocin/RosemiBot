import {
  ButtonStyle,
  ChannelType,
  ComponentType,
  SelectMenuDefaultValueType,
  TextInputStyle,
  type ButtonComponentData,
  type ComponentInContainerData,
  type SelectMenuComponentOptionData,
} from "discord.js";
import type { TomoriState } from "@/types/db/schema";
import {
  CUSTOM_IDLE_NUDGE_AGENDA_HINT_MAX,
  CUSTOM_IDLE_NUDGE_BRIEF_MAX,
  CUSTOM_IDLE_NUDGE_LIMIT,
  CUSTOM_IDLE_NUDGE_TITLE_MAX,
  IDLE_NUDGE_FREQUENCY_LEVELS,
  NATURAL_NUDGE_INTEREST_DESCRIPTION_MAX,
  NATURAL_NUDGE_INTEREST_LABEL_MAX,
  NATURAL_NUDGE_CATEGORIES,
  NATURAL_NUDGE_INTEREST_LIMIT,
  NATURAL_NUDGE_TALKATIVENESS_LEVELS,
  type NaturalNudgeCategory,
  type NaturalNudgeInterest,
  type PersonaNaturalNudgeConfig,
} from "@/modules/natural-nudges/db/types";
import {
  NUDGE_PREREQUISITE_IDS,
  NUDGE_TOOL_NAMES,
  prerequisiteTool,
} from "@/modules/natural-nudges/runtime/idleNudges";
import {
  computeInterestFingerprint,
  type NaturalNudgesSettingsView,
  type IdleNudgeEntry,
  type IdleNudgesView,
} from "@/modules/natural-nudges/discord/operations";
import {
  buildConfigRouteId,
  buildConfigRouteSegments,
  CONFIG_MODEL_PAGE_SIZE,
  CONFIG_PERSONA_COLLECTION_PAGE_SIZE,
  CONFIG_ROUTE_NAMESPACE,
  CONFIG_ROUTE_VERSION,
} from "@/utils/discord/configPanelCatalog";
import { encodeConfigProviderPageValue } from "@/utils/discord/interactions/configModelLoaders";
import type { StructuredOutputModelGroup } from "@/utils/discord/interactions/configModelOperations";
import { buildConfigModalFieldId, type RawModalPayload } from "@/utils/discord/ui/configModals";
import { buildConfigModelSelectModal } from "@/utils/discord/ui/configModelModals";
import { DISCORD_SELECT_OPTIONS_MAX } from "@/utils/discord/ui/componentsV2Limits";
import { safeSelectOptionText } from "@/utils/discord/ui/modals";
import { formatModelSelectionLabel } from "@/utils/discord/ui/modelRoutingControls";
import { buildPaginationRow, buildStateControlRow, withLinePrefix } from "@/utils/discord/ui/panel";
import { getProviderDisplayName } from "@/utils/provider/providerInfoRegistry";
import { localizer } from "@/utils/text/localizer";
import { renderFencedPreview } from "@/utils/text/textPreview";

export const NUDGE_ADD_VALUE = "add";
export const NUDGE_CLEAR_MODEL_VALUE = "__none__";
export const NUDGE_INTEREST_LABEL_FIELD = "nudge_interest_label";
export const NUDGE_INTEREST_DESCRIPTION_FIELD = "nudge_interest_description";
export const NUDGE_IDLE_NUDGE_TITLE_FIELD = "nudge_idle_nudge_title";
export const NUDGE_IDLE_NUDGE_CATEGORY_FIELD = "nudge_idle_nudge_category";
export const NUDGE_IDLE_NUDGE_BRIEF_FIELD = "nudge_idle_nudge_brief";
export const NUDGE_IDLE_NUDGE_AGENDA_FIELD = "nudge_idle_nudge_agenda";

const MODAL_TEXT_MAX = 45;
const MODAL_DESCRIPTION_MAX = 100;

const TALKATIVENESS_LOCALE_KEYS: Record<number, string> = {
  0: "commands.config.natural_nudges.talkativeness_0",
  1: "commands.config.natural_nudges.talkativeness_1",
  2: "commands.config.natural_nudges.talkativeness_2",
  3: "commands.config.natural_nudges.talkativeness_3",
  4: "commands.config.natural_nudges.talkativeness_4",
};

const TALKATIVENESS_EFFECT_KEYS: Record<number, string> = {
  0: "commands.config.natural_nudges.talkativeness_0_effect",
  1: "commands.config.natural_nudges.talkativeness_1_effect",
  2: "commands.config.natural_nudges.talkativeness_2_effect",
  3: "commands.config.natural_nudges.talkativeness_3_effect",
  4: "commands.config.natural_nudges.talkativeness_4_effect",
};

const FREQUENCY_LOCALE_KEYS: Record<number, string> = {
  0: "commands.config.natural_nudges.frequency_0",
  1: "commands.config.natural_nudges.frequency_1",
  2: "commands.config.natural_nudges.frequency_2",
  3: "commands.config.natural_nudges.frequency_3",
};

const CATEGORY_LOCALE_KEYS: Record<NaturalNudgeCategory, string> = {
  ping_user: "commands.config.natural_nudges.category_ping_user",
  revive_topic: "commands.config.natural_nudges.category_revive_topic",
  start_topic: "commands.config.natural_nudges.category_start_topic",
  play_scene: "commands.config.natural_nudges.category_play_scene",
};

const PREREQUISITE_LOCALE_KEYS = {
  hanging_conversation: "commands.config.natural_nudges.prerequisite_hanging_conversation",
  relationship_user: "commands.config.natural_nudges.prerequisite_relationship_user",
  recent_memory: "commands.config.natural_nudges.prerequisite_recent_memory",
  presence_activity: "commands.config.natural_nudges.prerequisite_presence_activity",
  two_personas: "commands.config.natural_nudges.prerequisite_two_personas",
} as const;

const TOOL_LOCALE_KEYS: Record<(typeof NUDGE_TOOL_NAMES)[number], string> = {
  web_search: "commands.config.natural_nudges.tool_web_search",
  fetch_url: "commands.config.natural_nudges.tool_fetch_url",
  image: "commands.config.natural_nudges.tool_image",
  generate_voice_message: "commands.config.natural_nudges.tool_generate_voice_message",
  generate_video: "commands.config.natural_nudges.tool_generate_video",
  select_sticker_for_response: "commands.config.natural_nudges.tool_select_sticker_for_response",
  create_task: "commands.config.natural_nudges.tool_create_task",
  update_task: "commands.config.natural_nudges.tool_update_task",
  create_thread: "commands.config.natural_nudges.tool_create_thread",
  peek_profile_picture: "commands.config.natural_nudges.tool_peek_profile_picture",
  interact_with_recent_message: "commands.config.natural_nudges.tool_interact_with_recent_message",
  create_long_term_memory: "commands.config.natural_nudges.tool_create_long_term_memory",
  update_long_term_memory: "commands.config.natural_nudges.tool_update_long_term_memory",
  update_short_term_memory: "commands.config.natural_nudges.tool_update_short_term_memory",
  process_youtube_video: "commands.config.natural_nudges.tool_process_youtube_video",
};

function text(content: string): ComponentInContainerData {
  return { type: ComponentType.TextDisplay, content };
}

function button(
  label: string,
  route: Parameters<typeof buildConfigRouteId>[0],
  disabled: boolean,
  danger = false,
): ButtonComponentData {
  return {
    type: ComponentType.Button,
    style: danger ? ButtonStyle.Danger : ButtonStyle.Secondary,
    label: safeSelectOptionText(label, 80),
    customId: buildConfigRouteId(route),
    disabled,
  };
}

function prerequisiteLabel(locale: string, id: string): string {
  if (id in PREREQUISITE_LOCALE_KEYS)
    return localizer(locale, PREREQUISITE_LOCALE_KEYS[id as keyof typeof PREREQUISITE_LOCALE_KEYS]);
  const tool = prerequisiteTool(id);
  return tool
    ? localizer(locale, "commands.config.natural_nudges.prerequisite_tool", {
        tool: localizer(locale, TOOL_LOCALE_KEYS[tool]),
      })
    : localizer(locale, "commands.config.natural_nudges.prerequisite_unknown", { id });
}

function toolLabel(locale: string, tool: string): string {
  return tool in TOOL_LOCALE_KEYS ? localizer(locale, TOOL_LOCALE_KEYS[tool as keyof typeof TOOL_LOCALE_KEYS]) : tool;
}

function idleNudgeTitle(locale: string, entry: IdleNudgeEntry): string {
  return entry.definition.titleKey ? localizer(locale, entry.definition.titleKey) : (entry.definition.title ?? "");
}

function formatInterest(interest: NaturalNudgeInterest): string {
  return `**${interest.label}**: ${interest.description}`;
}

export interface PersonaNudgesRenderInput {
  locale: string;
  persona: TomoriState;
  config: PersonaNaturalNudgeConfig | undefined;
  selectedInterestIndex?: number;
  /** Read-only for members and while the workspace read is stale. */
  writesDisabled: boolean;
}

export function buildPersonaNudgesBody(input: PersonaNudgesRenderInput): ComponentInContainerData[] {
  const { locale, persona, config, writesDisabled } = input;
  const t = (key: string, vars: Record<string, string | number> = {}) => localizer(locale, key, vars);
  const personaId = persona.persona_id as number;
  const components: ComponentInContainerData[] = [
    text(
      `### ${t("commands.config.natural_nudges.persona_title")}\n${t("commands.config.natural_nudges.persona_description")}`,
    ),
  ];
  if (!config) {
    components.push(text(t("commands.config.panel.unavailable")));
    return components;
  }

  components.push(
    text(
      `**${t("commands.config.natural_nudges.talkativeness_title")}**\n${t("commands.config.natural_nudges.talkativeness_description")}`,
    ),
    {
      type: ComponentType.ActionRow,
      components: [
        {
          type: ComponentType.StringSelect,
          customId: buildConfigRouteId({ action: "nudge-talk-select", locale, personaId }),
          options: NATURAL_NUDGE_TALKATIVENESS_LEVELS.map((level) => ({
            label: safeSelectOptionText(t(TALKATIVENESS_LOCALE_KEYS[level]), 100),
            value: String(level),
            default: level === config.talkativeness,
          })),
          disabled: writesDisabled,
        },
      ],
    },
    text(`> ${t(TALKATIVENESS_EFFECT_KEYS[config.talkativeness])}`),
  );

  const interests = config.interests;
  components.push(
    text(
      `**${t("commands.config.natural_nudges.interests_title")}**\n${t("commands.config.natural_nudges.interests_description", { max: NATURAL_NUDGE_INTEREST_LIMIT })}\n${
        interests.length > 0
          ? withLinePrefix("> ", interests.map(formatInterest).join("\n"))
          : `> ${t("commands.config.natural_nudges.interests_none")}`
      }${persona.is_pointer && !config?.has_override ? `\n-# ${t("commands.config.natural_nudges.interests_preset_note")}` : ""}`,
    ),
  );

  const canAdd = interests.length < NATURAL_NUDGE_INTEREST_LIMIT;
  const options: SelectMenuComponentOptionData[] = [
    ...(canAdd ? [{ label: t("commands.config.natural_nudges.interest_add_option"), value: NUDGE_ADD_VALUE }] : []),
    ...interests.map((interest, index) => ({
      label: safeSelectOptionText(interest.label, 100),
      description: safeSelectOptionText(interest.description, 100),
      value: String(index),
      default: index === input.selectedInterestIndex,
    })),
  ];
  if (options.length > 0) {
    components.push({
      type: ComponentType.ActionRow,
      components: [
        {
          type: ComponentType.StringSelect,
          customId: buildConfigRouteId({ action: "nudge-interest-select", locale, personaId }),
          placeholder: safeSelectOptionText(t("commands.config.natural_nudges.interest_select_placeholder"), 150),
          options,
          disabled: writesDisabled,
        },
      ],
    });
  }

  const selected = input.selectedInterestIndex !== undefined ? interests[input.selectedInterestIndex] : undefined;
  if (selected && input.selectedInterestIndex !== undefined) {
    const index = input.selectedInterestIndex;
    const fp = computeInterestFingerprint(personaId, index, selected);
    components.push({
      type: ComponentType.ActionRow,
      components: [
        button(
          t("commands.config.natural_nudges.interest_edit_button"),
          { action: "nudge-interest-edit-open", locale, personaId, index, fp },
          writesDisabled,
        ),
        button(
          t("commands.config.natural_nudges.interest_remove_button"),
          { action: "nudge-interest-remove", locale, personaId, index, fp },
          writesDisabled,
          true,
        ),
      ],
    });
  }
  return components;
}

export function buildInterestModal(
  locale: string,
  nonce: string,
  route: { personaId: number; index?: number; fp?: string },
  current?: NaturalNudgeInterest,
): RawModalPayload {
  const t = (key: string, vars: Record<string, string | number> = {}) => localizer(locale, key, vars);
  const customId =
    route.index !== undefined && route.fp !== undefined
      ? buildConfigRouteId({
          action: "nudge-interest-edit-submit",
          locale,
          personaId: route.personaId,
          index: route.index,
          fp: route.fp,
          nonce,
        })
      : buildConfigRouteId({ action: "nudge-interest-add-submit", locale, personaId: route.personaId, nonce });
  return {
    custom_id: customId,
    title: safeSelectOptionText(t("commands.config.natural_nudges.interest_modal_title"), MODAL_TEXT_MAX),
    components: [
      {
        type: 18,
        label: safeSelectOptionText(t("commands.config.natural_nudges.interest_label_label"), MODAL_TEXT_MAX),
        description: safeSelectOptionText(
          t("commands.config.natural_nudges.interest_label_description", { max: NATURAL_NUDGE_INTEREST_LABEL_MAX }),
          MODAL_DESCRIPTION_MAX,
        ),
        component: {
          type: 4,
          custom_id: buildConfigModalFieldId(NUDGE_INTEREST_LABEL_FIELD, nonce),
          style: TextInputStyle.Short,
          required: true,
          min_length: 1,
          max_length: NATURAL_NUDGE_INTEREST_LABEL_MAX,
          ...(current ? { value: current.label } : {}),
        },
      },
      {
        type: 18,
        label: safeSelectOptionText(t("commands.config.natural_nudges.interest_description_label"), MODAL_TEXT_MAX),
        description: safeSelectOptionText(
          t("commands.config.natural_nudges.interest_description_description", {
            max: NATURAL_NUDGE_INTEREST_DESCRIPTION_MAX,
          }),
          MODAL_DESCRIPTION_MAX,
        ),
        component: {
          type: 4,
          custom_id: buildConfigModalFieldId(NUDGE_INTEREST_DESCRIPTION_FIELD, nonce),
          style: TextInputStyle.Paragraph,
          required: true,
          min_length: 1,
          max_length: NATURAL_NUDGE_INTEREST_DESCRIPTION_MAX,
          ...(current ? { value: current.description } : {}),
        },
      },
    ],
  };
}

/** Provider entries for the planner select; a provider with more models than one modal holds is split. */
function plannerProviderOptions(locale: string, groups: readonly StructuredOutputModelGroup[]) {
  return groups.flatMap((group) => {
    const name = getProviderDisplayName(group.provider);
    if (group.models.length <= CONFIG_MODEL_PAGE_SIZE) return [{ label: name, value: group.provider }];
    const pages: Array<{ label: string; value: string }> = [];
    for (let start = 0; start < group.models.length; start += CONFIG_MODEL_PAGE_SIZE) {
      pages.push({
        label: localizer(locale, "commands.config.panel.provider_page_label", {
          provider: name,
          page: start / CONFIG_MODEL_PAGE_SIZE + 1,
        }),
        value: encodeConfigProviderPageValue(group.provider, start),
      });
    }
    return pages;
  });
}

function formatChatModel(locale: string, chatModel: { codename: string; provider: string }): string {
  return formatModelSelectionLabel(
    chatModel.codename,
    getProviderDisplayName(chatModel.provider),
    localizer(locale, "commands.config.panel.none_label"),
  );
}

/** The placeholder is the only place the select can name the model it will actually use. */
function plannerModelPlaceholder(locale: string, view: NaturalNudgesSettingsView): string {
  const t = (key: string, vars: Record<string, string | number> = {}) => localizer(locale, key, vars);
  const chat = view.status?.chatModel;
  if (view.config.llm_id === null) {
    return chat
      ? t("commands.config.natural_nudges.model_same_as_chat", { model: formatChatModel(locale, chat) })
      : t("commands.config.natural_nudges.model_placeholder");
  }
  const none = localizer(locale, "commands.config.panel.none_label");
  for (const group of view.plannerModels) {
    const model = group.models.find((candidate) => candidate.id === view.config.llm_id);
    if (model) {
      return t("commands.config.natural_nudges.model_placeholder_selected", {
        model: formatModelSelectionLabel(model.name, getProviderDisplayName(group.provider), none),
      });
    }
  }
  return t("commands.config.natural_nudges.model_placeholder_selected", {
    model: t("commands.config.natural_nudges.model_unavailable"),
  });
}

/** A placeholder cannot say why the default cannot plan nudges, so that reason gets its own line. */
function plannerDefaultNotice(locale: string, view: NaturalNudgesSettingsView): string | null {
  const { status } = view;
  if (view.config.llm_id !== null || !status || status.plannerModel.kind === "ready") return null;
  const t = (key: string, vars: Record<string, string | number> = {}) => localizer(locale, key, vars);
  if (!status.chatModel) return t("commands.config.natural_nudges.model_chat_none");
  const model = formatChatModel(locale, status.chatModel);
  const key =
    status.plannerModel.kind === "unusable" && status.plannerModel.reason === "no_structured_output"
      ? "commands.config.natural_nudges.model_chat_no_structured"
      : "commands.config.natural_nudges.model_chat_unavailable";
  return t(key, { model });
}

function idleNudgeEffect(
  locale: string,
  view: NaturalNudgesSettingsView,
  hasEligibleChannel: boolean,
  hasUsableModel: boolean,
): string {
  const t = (key: string, vars: Record<string, string | number> = {}) => localizer(locale, key, vars);
  const { config } = view;
  if (!config.idle_nudges_enabled) return t("commands.config.natural_nudges.idle_nudges_off");
  if (!hasEligibleChannel) return t("commands.config.natural_nudges.idle_nudges_on_no_channels");
  if (!hasUsableModel) return t("commands.config.natural_nudges.idle_nudges_on_no_model");
  if (view.perDay <= 0) return t("commands.config.natural_nudges.frequency_effect_none");
  return `${t("commands.config.natural_nudges.idle_nudges_on")} ${t("commands.config.natural_nudges.frequency_effect", {
    heat: Math.round(view.heat),
    per_week: Math.round(view.perDay * 7 * 10) / 10,
  })}`;
}

function activeNudgeEffect(locale: string, view: NaturalNudgesSettingsView, hasEligibleChannel: boolean): string {
  const t = (key: string, vars: Record<string, string | number> = {}) => localizer(locale, key, vars);
  const { config, status } = view;
  if (!config.active_nudges_enabled) return t("commands.config.natural_nudges.active_nudges_off");
  if (!hasEligibleChannel) return t("commands.config.natural_nudges.active_nudges_on_no_channels");
  // Modal paths render without status, so the matcher is only judged when it was resolved.
  if (status && !status.matcher) return t("commands.config.natural_nudges.active_nudges_on_no_matcher");
  if (!view.activeNudgeRange) return t("commands.config.natural_nudges.active_nudges_on_cold");
  const matcher =
    status?.matcher?.kind === "decision"
      ? t("commands.config.natural_nudges.active_nudges_matcher_decision", { model: status.matcher.model })
      : t("commands.config.natural_nudges.active_nudges_matcher_llm");
  return t("commands.config.natural_nudges.active_nudges_on", {
    min: view.activeNudgeRange.min,
    max: view.activeNudgeRange.max,
    matcher,
  });
}

function buildActiveNudgeSection(
  locale: string,
  view: NaturalNudgesSettingsView,
  hasEligibleChannel: boolean,
  writesDisabled: boolean,
): ComponentInContainerData[] {
  const t = (key: string, vars: Record<string, string | number> = {}) => localizer(locale, key, vars);
  const { config } = view;
  return [
    text(
      `### ${t("commands.config.natural_nudges.active_nudges_title")}\n${t("commands.config.natural_nudges.active_nudges_description")}`,
    ),
    buildStateControlRow(
      [
        {
          value: false,
          label: t("commands.config.panel.off_button"),
          customId: buildConfigRouteId({ action: "nudge-active-nudges-set", locale, enabled: false }),
        },
        {
          value: true,
          label: t("commands.config.panel.on_button"),
          customId: buildConfigRouteId({ action: "nudge-active-nudges-set", locale, enabled: true }),
        },
      ],
      config.active_nudges_enabled,
      writesDisabled,
    ),
    text(`> ${activeNudgeEffect(locale, view, hasEligibleChannel)}`),
    {
      type: ComponentType.ActionRow,
      components: [
        {
          type: ComponentType.StringSelect,
          customId: buildConfigRouteId({ action: "nudge-active-nudges-frequency-select", locale }),
          options: IDLE_NUDGE_FREQUENCY_LEVELS.map((level) => ({
            label: safeSelectOptionText(
              t("commands.config.natural_nudges.active_nudge_frequency_option", {
                level: t(FREQUENCY_LOCALE_KEYS[level]),
              }),
              100,
            ),
            value: String(level),
            default: level === config.active_nudge_frequency,
          })),
          disabled: writesDisabled,
        },
      ],
    },
  ];
}

export function buildNaturalNudgesSettingsBody(
  locale: string,
  view: NaturalNudgesSettingsView,
  byokMode: boolean,
  writesDisabled: boolean,
): ComponentInContainerData[] {
  const t = (key: string, vars: Record<string, string | number> = {}) => localizer(locale, key, vars);
  const { config, status } = view;
  const hasEligibleChannel = (status?.effectiveChannelIds ?? config.channel_disc_ids).length > 0;
  const hasUsableModel = status ? status.plannerModel.kind === "ready" : config.llm_id !== null;
  const notices = [
    !view.trackingEnabled ? t("commands.config.natural_nudges.notice_tracking_disabled") : "",
    byokMode ? t("commands.config.natural_nudges.notice_byok") : "",
    view.runtime.stopped_at ? t("commands.config.natural_nudges.notice_stopped") : "",
  ].filter(Boolean);
  const components: ComponentInContainerData[] = [
    text(
      `## ${t("commands.config.natural_nudges.title")}\n${t("commands.config.natural_nudges.description")}${
        notices.length > 0 ? `\n${notices.map((notice) => `-# ${notice}`).join("\n")}` : ""
      }`,
    ),
    text(
      `### ${t("commands.config.natural_nudges.channels_title")}\n${t("commands.config.natural_nudges.channels_description")}`,
    ),
    {
      type: ComponentType.ActionRow,
      components: [
        {
          type: ComponentType.ChannelSelect,
          customId: buildConfigRouteId({ action: "nudge-channels-select", locale }),
          channelTypes: [ChannelType.GuildText],
          minValues: 0,
          maxValues: 25,
          placeholder: safeSelectOptionText(t("commands.config.natural_nudges.channels_placeholder"), 150),
          defaultValues: config.channel_disc_ids
            .slice(0, 25)
            .map((id) => ({ id, type: SelectMenuDefaultValueType.Channel })),
          disabled: writesDisabled,
        },
      ],
    },
    text(
      `### ${t("commands.config.natural_nudges.idle_nudges_title")}\n${t("commands.config.natural_nudges.idle_nudges_description")}`,
    ),
    buildStateControlRow(
      [
        {
          value: false,
          label: t("commands.config.panel.off_button"),
          customId: buildConfigRouteId({ action: "nudge-idle-nudges-set", locale, enabled: false }),
        },
        {
          value: true,
          label: t("commands.config.panel.on_button"),
          customId: buildConfigRouteId({ action: "nudge-idle-nudges-set", locale, enabled: true }),
        },
      ],
      config.idle_nudges_enabled,
      writesDisabled,
    ),
    text(`> ${idleNudgeEffect(locale, view, hasEligibleChannel, hasUsableModel)}`),
    {
      type: ComponentType.ActionRow,
      components: [
        {
          type: ComponentType.StringSelect,
          customId: buildConfigRouteId({ action: "nudge-idle-nudges-frequency-select", locale }),
          options: IDLE_NUDGE_FREQUENCY_LEVELS.map((level) => ({
            label: safeSelectOptionText(
              t("commands.config.natural_nudges.active_nudge_frequency_option", {
                level: t(FREQUENCY_LOCALE_KEYS[level]),
              }),
              100,
            ),
            value: String(level),
            default: level === config.idle_nudge_frequency,
          })),
          disabled: writesDisabled,
        },
      ],
    },
    ...buildActiveNudgeSection(locale, view, hasEligibleChannel, writesDisabled),
    text(
      `### ${t("commands.config.natural_nudges.model_title")}\n${t("commands.config.natural_nudges.model_description")}`,
    ),
  ];

  const providerOptions = plannerProviderOptions(locale, view.plannerModels);
  const modelOptions = [
    ...(config.llm_id !== null
      ? [{ label: t("commands.config.natural_nudges.model_same_as_chat_option"), value: NUDGE_CLEAR_MODEL_VALUE }]
      : []),
    ...providerOptions,
  ].slice(0, DISCORD_SELECT_OPTIONS_MAX);
  if (modelOptions.length > 0) {
    components.push({
      type: ComponentType.ActionRow,
      components: [
        {
          type: ComponentType.StringSelect,
          customId: buildConfigRouteId({ action: "nudge-provider", locale }),
          placeholder: safeSelectOptionText(plannerModelPlaceholder(locale, view), 150),
          options: modelOptions.map((option) => ({
            label: safeSelectOptionText(option.label, 100),
            value: option.value,
          })),
          disabled: writesDisabled,
        },
      ],
    });
  }
  const modelNotice =
    providerOptions.length === 0
      ? t("commands.config.natural_nudges.model_none_available")
      : plannerDefaultNotice(locale, view);
  if (modelNotice) components.push(text(`-# ${modelNotice}`));
  return components;
}

export function buildPlannerModelModal(
  locale: string,
  nonce: string,
  group: StructuredOutputModelGroup,
  start: number,
  currentModelId: number | null,
): RawModalPayload {
  const payload = buildConfigModelSelectModal(
    locale,
    "text",
    group.provider,
    nonce,
    group.models.slice(start, start + CONFIG_MODEL_PAGE_SIZE),
    currentModelId,
  );
  payload.custom_id = buildConfigRouteId({ action: "nudge-model-submit", locale, provider: group.provider, nonce });
  payload.title = safeSelectOptionText(
    localizer(locale, "commands.config.natural_nudges.model_modal_title"),
    MODAL_TEXT_MAX,
  );
  return payload;
}

export interface IdleNudgesRenderInput {
  locale: string;
  view: IdleNudgesView;
  start: number;
  selectedIndex?: number;
  removeConfirmNonce?: string;
  writesDisabled: boolean;
}

/** One option is kept for the add entry, so every page can keep it first. */
const IDLE_NUDGE_PAGE_SIZE = CONFIG_PERSONA_COLLECTION_PAGE_SIZE;

export function buildIdleNudgesBody(input: IdleNudgesRenderInput): ComponentInContainerData[] {
  const { locale, view, writesDisabled } = input;
  const t = (key: string, vars: Record<string, string | number> = {}) => localizer(locale, key, vars);
  const customCount = view.entries.filter((entry) => entry.custom).length;
  const start = Math.min(
    Math.floor(input.start / IDLE_NUDGE_PAGE_SIZE) * IDLE_NUDGE_PAGE_SIZE,
    Math.max(0, Math.floor((view.entries.length - 1) / IDLE_NUDGE_PAGE_SIZE) * IDLE_NUDGE_PAGE_SIZE),
  );
  const components: ComponentInContainerData[] = [
    text(
      `## ${t("commands.config.natural_nudges.idle_nudges_page_title")}\n${t("commands.config.natural_nudges.idle_nudges_page_description")}\n${t("commands.config.natural_nudges.idle_nudge_select_intro")}`,
    ),
  ];
  const canAdd = customCount < CUSTOM_IDLE_NUDGE_LIMIT;
  components.push({
    type: ComponentType.ActionRow,
    components: [
      {
        type: ComponentType.StringSelect,
        customId: buildConfigRouteId({ action: "nudge-idle-select", locale, start, fp: view.fingerprint }),
        placeholder: safeSelectOptionText(t("commands.config.natural_nudges.idle_nudge_select_placeholder"), 150),
        options: [
          ...(canAdd
            ? [{ label: t("commands.config.natural_nudges.idle_nudge_add_option"), value: NUDGE_ADD_VALUE }]
            : []),
          ...view.entries.slice(start, start + IDLE_NUDGE_PAGE_SIZE).map((entry, offset) => ({
            label: safeSelectOptionText(idleNudgeTitle(locale, entry), 100),
            description: safeSelectOptionText(
              t(
                entry.enabled
                  ? "commands.config.natural_nudges.idle_nudge_option_on"
                  : "commands.config.natural_nudges.idle_nudge_option_off",
                { category: t(CATEGORY_LOCALE_KEYS[entry.definition.category]) },
              ),
              100,
            ),
            value: String(start + offset),
            default: start + offset === input.selectedIndex,
          })),
        ],
        disabled: writesDisabled,
      },
    ],
  });
  const paginationRow = buildPaginationRow({
    locale,
    rangeIndex: start / IDLE_NUDGE_PAGE_SIZE,
    rangeCount: Math.max(1, Math.ceil(view.entries.length / IDLE_NUDGE_PAGE_SIZE)),
    namespace: CONFIG_ROUTE_NAMESPACE,
    version: CONFIG_ROUTE_VERSION,
    buildSegments: {
      page: (rangeIndex) =>
        buildConfigRouteSegments({ action: "nudge-idle-page", locale, start: rangeIndex * IDLE_NUDGE_PAGE_SIZE }),
    },
    disabled: writesDisabled,
  });
  if (paginationRow) components.push(paginationRow);

  const index = input.selectedIndex;
  const entry = index !== undefined ? view.entries[index] : undefined;
  if (index === undefined || !entry) return components;
  const fp = view.fingerprint;
  const { definition } = entry;

  if (input.removeConfirmNonce) {
    components.push(
      text(t("commands.config.natural_nudges.idle_nudge_remove_confirm", { title: idleNudgeTitle(locale, entry) })),
      {
        type: ComponentType.ActionRow,
        components: [
          button(
            t("commands.config.natural_nudges.idle_nudge_remove_button"),
            { action: "nudge-idle-remove-confirm", locale, index, fp, nonce: input.removeConfirmNonce },
            writesDisabled,
            true,
          ),
          button(t("general.pagination.cancel"), { action: "nudge-idle-remove-cancel", locale, index }, writesDisabled),
        ],
      },
    );
    return components;
  }

  const prerequisites =
    definition.prerequisites.length > 0
      ? definition.prerequisites.map((id) => prerequisiteLabel(locale, id)).join(", ")
      : t("commands.config.natural_nudges.none");
  const tools =
    definition.recommendedTools.length > 0
      ? definition.recommendedTools.map((tool) => toolLabel(locale, tool)).join(", ")
      : t("commands.config.natural_nudges.none");
  components.push(
    text(
      `### ${idleNudgeTitle(locale, entry)}\n${withLinePrefix(
        "> ",
        [
          t("commands.config.natural_nudges.idle_nudge_category_line", {
            category: t(CATEGORY_LOCALE_KEYS[definition.category]),
          }),
          t(
            entry.custom
              ? "commands.config.natural_nudges.idle_nudge_custom"
              : "commands.config.natural_nudges.idle_nudge_builtin",
          ),
        ].join("\n"),
      )}`,
    ),
    text(
      `**${t("commands.config.natural_nudges.idle_nudge_brief_title")}**\n${renderFencedPreview(
        locale,
        definition.brief,
        {
          actionLabel: entry.custom ? t("commands.config.natural_nudges.idle_nudge_edit_button") : undefined,
        },
      )}`,
    ),
    text(
      `**${t("commands.config.natural_nudges.idle_nudge_agenda_title")}**\n> ${definition.agendaHint ?? t("commands.config.natural_nudges.none")}\n**${t("commands.config.natural_nudges.idle_nudge_prerequisites_title")}**\n> ${prerequisites}\n**${t("commands.config.natural_nudges.idle_nudge_tools_title")}**\n> ${tools}`,
    ),
    buildStateControlRow(
      [
        {
          value: false,
          label: t("commands.config.panel.off_button"),
          customId: buildConfigRouteId({ action: "nudge-idle-toggle", locale, index, fp, enabled: false }),
        },
        {
          value: true,
          label: t("commands.config.panel.on_button"),
          customId: buildConfigRouteId({ action: "nudge-idle-toggle", locale, index, fp, enabled: true }),
        },
      ],
      entry.enabled,
      writesDisabled,
    ),
  );

  if (entry.custom) {
    components.push(
      text(t("commands.config.natural_nudges.idle_nudge_prerequisites_select_intro")),
      {
        type: ComponentType.ActionRow,
        components: [
          {
            type: ComponentType.StringSelect,
            customId: buildConfigRouteId({ action: "nudge-idle-prereqs-select", locale, index, fp }),
            placeholder: safeSelectOptionText(
              t("commands.config.natural_nudges.idle_nudge_prerequisites_placeholder"),
              150,
            ),
            minValues: 0,
            maxValues: NUDGE_PREREQUISITE_IDS.length,
            options: NUDGE_PREREQUISITE_IDS.map((id) => ({
              label: safeSelectOptionText(prerequisiteLabel(locale, id), 100),
              value: id,
              default: definition.prerequisites.includes(id),
            })),
            disabled: writesDisabled,
          },
        ],
      },
      {
        type: ComponentType.ActionRow,
        components: [
          {
            type: ComponentType.StringSelect,
            customId: buildConfigRouteId({ action: "nudge-idle-tools-select", locale, index, fp }),
            placeholder: safeSelectOptionText(t("commands.config.natural_nudges.idle_nudge_tools_placeholder"), 150),
            minValues: 0,
            maxValues: NUDGE_TOOL_NAMES.length,
            options: NUDGE_TOOL_NAMES.map((tool) => ({
              label: safeSelectOptionText(toolLabel(locale, tool), 100),
              value: tool,
              default: definition.recommendedTools.includes(tool),
            })),
            disabled: writesDisabled,
          },
        ],
      },
      {
        type: ComponentType.ActionRow,
        components: [
          button(
            t("commands.config.natural_nudges.idle_nudge_edit_button"),
            { action: "nudge-idle-edit-open", locale, index, fp },
            writesDisabled,
          ),
          button(
            t("commands.config.natural_nudges.idle_nudge_remove_button"),
            { action: "nudge-idle-remove-view", locale, index, fp },
            writesDisabled,
            true,
          ),
        ],
      },
    );
  }
  return components;
}

export function buildIdleNudgeModal(
  locale: string,
  nonce: string,
  target: { index: number; fp: string } | null,
  current?: IdleNudgeEntry,
): RawModalPayload {
  const t = (key: string, vars: Record<string, string | number> = {}) => localizer(locale, key, vars);
  const label = (key: string) => safeSelectOptionText(t(key), MODAL_TEXT_MAX);
  const description = (key: string, vars: Record<string, string | number> = {}) =>
    safeSelectOptionText(t(key, vars), MODAL_DESCRIPTION_MAX);
  return {
    custom_id: target
      ? buildConfigRouteId({ action: "nudge-idle-edit-submit", locale, index: target.index, fp: target.fp, nonce })
      : buildConfigRouteId({ action: "nudge-idle-add-submit", locale, nonce }),
    title: label(
      target
        ? "commands.config.natural_nudges.idle_nudge_edit_button"
        : "commands.config.natural_nudges.idle_nudge_add_title",
    ),
    components: [
      {
        type: 18,
        label: label("commands.config.natural_nudges.idle_nudge_title_label"),
        description: description("commands.config.natural_nudges.idle_nudge_title_description", {
          max: CUSTOM_IDLE_NUDGE_TITLE_MAX,
        }),
        component: {
          type: 4,
          custom_id: buildConfigModalFieldId(NUDGE_IDLE_NUDGE_TITLE_FIELD, nonce),
          style: TextInputStyle.Short,
          required: true,
          min_length: 1,
          max_length: CUSTOM_IDLE_NUDGE_TITLE_MAX,
          ...(current?.custom ? { value: current.custom.title } : {}),
        },
      },
      {
        type: 18,
        label: label("commands.config.natural_nudges.idle_nudge_category_label"),
        description: description("commands.config.natural_nudges.idle_nudge_category_description"),
        component: {
          type: 3,
          custom_id: buildConfigModalFieldId(NUDGE_IDLE_NUDGE_CATEGORY_FIELD, nonce),
          required: true,
          min_values: 1,
          max_values: 1,
          options: NATURAL_NUDGE_CATEGORIES.map((category) => ({
            label: safeSelectOptionText(t(CATEGORY_LOCALE_KEYS[category]), 100),
            value: category,
          })),
        },
      },
      {
        type: 18,
        label: label("commands.config.natural_nudges.idle_nudge_brief_label"),
        description: description("commands.config.natural_nudges.idle_nudge_brief_description", {
          max: CUSTOM_IDLE_NUDGE_BRIEF_MAX,
        }),
        component: {
          type: 4,
          custom_id: buildConfigModalFieldId(NUDGE_IDLE_NUDGE_BRIEF_FIELD, nonce),
          style: TextInputStyle.Paragraph,
          required: true,
          min_length: 1,
          max_length: CUSTOM_IDLE_NUDGE_BRIEF_MAX,
          ...(current?.custom ? { value: current.custom.brief } : {}),
        },
      },
      {
        type: 18,
        label: label("commands.config.natural_nudges.idle_nudge_agenda_label"),
        description: description("commands.config.natural_nudges.idle_nudge_agenda_description", {
          max: CUSTOM_IDLE_NUDGE_AGENDA_HINT_MAX,
        }),
        component: {
          type: 4,
          custom_id: buildConfigModalFieldId(NUDGE_IDLE_NUDGE_AGENDA_FIELD, nonce),
          style: TextInputStyle.Paragraph,
          required: false,
          max_length: CUSTOM_IDLE_NUDGE_AGENDA_HINT_MAX,
          ...(current?.custom?.agenda_hint ? { value: current.custom.agenda_hint } : {}),
        },
      },
    ],
  };
}
