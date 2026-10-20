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
  CUSTOM_EPISODE_AGENDA_HINT_MAX,
  CUSTOM_EPISODE_BRIEF_MAX,
  CUSTOM_EPISODE_LIMIT,
  CUSTOM_EPISODE_TITLE_MAX,
  DAILY_EPISODE_CAP_MAX,
  EPISODE_FREQUENCY_LEVELS,
  NATURAL_NUDGE_INTEREST_DESCRIPTION_MAX,
  NATURAL_NUDGE_INTEREST_LABEL_MAX,
  NATURAL_NUDGE_CATEGORIES,
  NATURAL_NUDGE_INTEREST_LIMIT,
  NATURAL_NUDGE_TALKATIVENESS_LEVELS,
  type NaturalNudgeCategory,
  type NaturalNudgeInterest,
  type PersonaNaturalNudgeConfig,
} from "@/modules/natural-nudges/db/types";
import { NUDGE_PREREQUISITE_IDS, NUDGE_TOOL_NAMES, prerequisiteTool } from "@/modules/natural-nudges/runtime/episodes";
import {
  computeInterestFingerprint,
  type NaturalNudgesSettingsView,
  type NudgeEpisodeEntry,
  type NudgeEpisodesView,
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
export const NUDGE_REACH_OUT_WEIGHT_FIELD = "nudge_reach_out_weight";
export const NUDGE_REVIVE_WEIGHT_FIELD = "nudge_revive_weight";
export const NUDGE_NEW_TOPIC_WEIGHT_FIELD = "nudge_new_topic_weight";
export const NUDGE_ALTER_TALK_WEIGHT_FIELD = "nudge_alter_talk_weight";
export const NUDGE_DAILY_CAP_FIELD = "nudge_daily_cap";
export const NUDGE_EPISODE_TITLE_FIELD = "nudge_episode_title";
export const NUDGE_EPISODE_CATEGORY_FIELD = "nudge_episode_category";
export const NUDGE_EPISODE_BRIEF_FIELD = "nudge_episode_brief";
export const NUDGE_EPISODE_AGENDA_FIELD = "nudge_episode_agenda";

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
  reach_out: "commands.config.natural_nudges.category_reach_out",
  revive: "commands.config.natural_nudges.category_revive",
  new_topic: "commands.config.natural_nudges.category_new_topic",
  alter_talk: "commands.config.natural_nudges.category_alter_talk",
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

function episodeTitle(locale: string, entry: NudgeEpisodeEntry): string {
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

function chatFallbackLabel(locale: string, status: NaturalNudgesSettingsView["status"]): string {
  const none = localizer(locale, "commands.config.panel.none_label");
  if (!status?.chatModel) return localizer(locale, "commands.config.natural_nudges.model_chat_none");
  const model = formatModelSelectionLabel(
    status.chatModel.codename,
    getProviderDisplayName(status.chatModel.provider),
    none,
  );
  if (status.plannerModel.kind === "ready") {
    return localizer(locale, "commands.config.natural_nudges.model_same_as_chat", { model });
  }
  const key =
    status.plannerModel.kind === "unusable" && status.plannerModel.reason === "no_structured_output"
      ? "commands.config.natural_nudges.model_chat_no_structured"
      : "commands.config.natural_nudges.model_chat_unavailable";
  return localizer(locale, key, { model });
}

function plannerModelLabel(locale: string, view: NaturalNudgesSettingsView): string {
  const none = localizer(locale, "commands.config.panel.none_label");
  if (view.config.llm_id === null) return chatFallbackLabel(locale, view.status);
  for (const group of view.plannerModels) {
    const model = group.models.find((candidate) => candidate.id === view.config.llm_id);
    if (model) return formatModelSelectionLabel(model.name, getProviderDisplayName(group.provider), none);
  }
  return localizer(locale, "commands.config.natural_nudges.model_unavailable");
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
      `### ${t("commands.config.natural_nudges.episodes_title")}\n${t("commands.config.natural_nudges.episodes_description")}`,
    ),
    buildStateControlRow(
      [
        {
          value: false,
          label: t("commands.config.panel.off_button"),
          customId: buildConfigRouteId({ action: "nudge-episodes-set", locale, enabled: false }),
        },
        {
          value: true,
          label: t("commands.config.panel.on_button"),
          customId: buildConfigRouteId({ action: "nudge-episodes-set", locale, enabled: true }),
        },
      ],
      config.episodes_enabled,
      writesDisabled,
    ),
    text(
      `> ${t(
        !config.episodes_enabled
          ? "commands.config.natural_nudges.episodes_off"
          : !hasEligibleChannel
            ? "commands.config.natural_nudges.episodes_on_no_channels"
            : !hasUsableModel
              ? "commands.config.natural_nudges.episodes_on_no_model"
              : "commands.config.natural_nudges.episodes_on",
      )}`,
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
      `### ${t("commands.config.natural_nudges.model_title")}\n${t("commands.config.natural_nudges.model_description")}\n> ${plannerModelLabel(locale, view)}`,
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
          placeholder: safeSelectOptionText(t("commands.config.natural_nudges.model_placeholder"), 150),
          options: modelOptions.map((option) => ({
            label: safeSelectOptionText(option.label, 100),
            value: option.value,
          })),
          disabled: writesDisabled,
        },
      ],
    });
  } else {
    components.push(text(`-# ${t("commands.config.natural_nudges.model_none_available")}`));
  }

  components.push(
    text(
      `### ${t("commands.config.natural_nudges.frequency_title")}\n${t("commands.config.natural_nudges.frequency_description")}`,
    ),
    {
      type: ComponentType.ActionRow,
      components: [
        {
          type: ComponentType.StringSelect,
          customId: buildConfigRouteId({ action: "nudge-frequency-select", locale }),
          options: EPISODE_FREQUENCY_LEVELS.map((level) => ({
            label: safeSelectOptionText(t(FREQUENCY_LOCALE_KEYS[level]), 100),
            value: String(level),
            default: level === config.episode_frequency,
          })),
          disabled: writesDisabled,
        },
      ],
    },
    text(
      `> ${
        view.perDay > 0
          ? t("commands.config.natural_nudges.frequency_effect", {
              heat: Math.round(view.heat),
              per_week: Math.round(view.perDay * 7 * 10) / 10,
            })
          : t("commands.config.natural_nudges.frequency_effect_none")
      }`,
    ),
    text(
      `### ${t("commands.config.natural_nudges.limits_title")}\n${t("commands.config.natural_nudges.limits_description")}\n${withLinePrefix(
        "> ",
        [
          t("commands.config.natural_nudges.limits_reach_out", { weight: config.reach_out_weight }),
          t("commands.config.natural_nudges.limits_revive", { weight: config.revive_weight }),
          t("commands.config.natural_nudges.limits_new_topic", { weight: config.new_topic_weight }),
          t("commands.config.natural_nudges.limits_alter_talk", { weight: config.alter_talk_weight }),
          t("commands.config.natural_nudges.limits_daily_cap", { cap: config.daily_episode_cap }),
        ].join("\n"),
      )}`,
    ),
    {
      type: ComponentType.ActionRow,
      components: [
        button(
          t("commands.config.natural_nudges.limits_button"),
          { action: "nudge-limits-open", locale },
          writesDisabled,
        ),
      ],
    },
  );
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

function numberInput(
  locale: string,
  nonce: string,
  field: string,
  labelKey: string,
  descriptionKey: string,
  value: number,
) {
  return {
    type: 18,
    label: safeSelectOptionText(localizer(locale, labelKey), MODAL_TEXT_MAX),
    description: safeSelectOptionText(localizer(locale, descriptionKey), MODAL_DESCRIPTION_MAX),
    component: {
      type: 4,
      custom_id: buildConfigModalFieldId(field, nonce),
      style: TextInputStyle.Short,
      required: true,
      min_length: 1,
      max_length: 3,
      value: String(value),
    },
  };
}

export function buildLimitsModal(locale: string, nonce: string, view: NaturalNudgesSettingsView): RawModalPayload {
  return {
    custom_id: buildConfigRouteId({ action: "nudge-limits-submit", locale, nonce }),
    title: safeSelectOptionText(localizer(locale, "commands.config.natural_nudges.limits_title"), MODAL_TEXT_MAX),
    components: [
      numberInput(
        locale,
        nonce,
        NUDGE_REACH_OUT_WEIGHT_FIELD,
        "commands.config.natural_nudges.category_reach_out",
        "commands.config.natural_nudges.weight_input_description",
        view.config.reach_out_weight,
      ),
      numberInput(
        locale,
        nonce,
        NUDGE_REVIVE_WEIGHT_FIELD,
        "commands.config.natural_nudges.category_revive",
        "commands.config.natural_nudges.weight_input_description",
        view.config.revive_weight,
      ),
      numberInput(
        locale,
        nonce,
        NUDGE_NEW_TOPIC_WEIGHT_FIELD,
        "commands.config.natural_nudges.category_new_topic",
        "commands.config.natural_nudges.weight_input_description",
        view.config.new_topic_weight,
      ),
      numberInput(
        locale,
        nonce,
        NUDGE_ALTER_TALK_WEIGHT_FIELD,
        "commands.config.natural_nudges.category_alter_talk",
        "commands.config.natural_nudges.weight_input_description",
        view.config.alter_talk_weight,
      ),
      {
        ...numberInput(
          locale,
          nonce,
          NUDGE_DAILY_CAP_FIELD,
          "commands.config.natural_nudges.daily_cap_label",
          "commands.config.natural_nudges.daily_cap_input_description",
          view.config.daily_episode_cap,
        ),
        description: safeSelectOptionText(
          localizer(locale, "commands.config.natural_nudges.daily_cap_input_description", {
            max: DAILY_EPISODE_CAP_MAX,
          }),
          MODAL_DESCRIPTION_MAX,
        ),
      },
    ],
  };
}

export interface NudgeEpisodesRenderInput {
  locale: string;
  view: NudgeEpisodesView;
  start: number;
  selectedIndex?: number;
  removeConfirmNonce?: string;
  writesDisabled: boolean;
}

/** One option is kept for the add entry, so every page can keep it first. */
const EPISODE_PAGE_SIZE = CONFIG_PERSONA_COLLECTION_PAGE_SIZE;

export function buildNudgeEpisodesBody(input: NudgeEpisodesRenderInput): ComponentInContainerData[] {
  const { locale, view, writesDisabled } = input;
  const t = (key: string, vars: Record<string, string | number> = {}) => localizer(locale, key, vars);
  const customCount = view.entries.filter((entry) => entry.custom).length;
  const start = Math.min(
    Math.floor(input.start / EPISODE_PAGE_SIZE) * EPISODE_PAGE_SIZE,
    Math.max(0, Math.floor((view.entries.length - 1) / EPISODE_PAGE_SIZE) * EPISODE_PAGE_SIZE),
  );
  const components: ComponentInContainerData[] = [
    text(
      `## ${t("commands.config.natural_nudges.episodes_page_title")}\n${t("commands.config.natural_nudges.episodes_page_description")}\n${t("commands.config.natural_nudges.episode_select_intro")}`,
    ),
  ];
  const canAdd = customCount < CUSTOM_EPISODE_LIMIT;
  components.push({
    type: ComponentType.ActionRow,
    components: [
      {
        type: ComponentType.StringSelect,
        customId: buildConfigRouteId({ action: "nudge-episode-select", locale, start, fp: view.fingerprint }),
        placeholder: safeSelectOptionText(t("commands.config.natural_nudges.episode_select_placeholder"), 150),
        options: [
          ...(canAdd
            ? [{ label: t("commands.config.natural_nudges.episode_add_option"), value: NUDGE_ADD_VALUE }]
            : []),
          ...view.entries.slice(start, start + EPISODE_PAGE_SIZE).map((entry, offset) => ({
            label: safeSelectOptionText(episodeTitle(locale, entry), 100),
            description: safeSelectOptionText(
              t(
                entry.enabled
                  ? "commands.config.natural_nudges.episode_option_on"
                  : "commands.config.natural_nudges.episode_option_off",
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
    rangeIndex: start / EPISODE_PAGE_SIZE,
    rangeCount: Math.max(1, Math.ceil(view.entries.length / EPISODE_PAGE_SIZE)),
    namespace: CONFIG_ROUTE_NAMESPACE,
    version: CONFIG_ROUTE_VERSION,
    buildSegments: {
      page: (rangeIndex) =>
        buildConfigRouteSegments({ action: "nudge-episode-page", locale, start: rangeIndex * EPISODE_PAGE_SIZE }),
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
      text(t("commands.config.natural_nudges.episode_remove_confirm", { title: episodeTitle(locale, entry) })),
      {
        type: ComponentType.ActionRow,
        components: [
          button(
            t("commands.config.natural_nudges.episode_remove_button"),
            { action: "nudge-episode-remove-confirm", locale, index, fp, nonce: input.removeConfirmNonce },
            writesDisabled,
            true,
          ),
          button(
            t("general.pagination.cancel"),
            { action: "nudge-episode-remove-cancel", locale, index },
            writesDisabled,
          ),
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
      `### ${episodeTitle(locale, entry)}\n${withLinePrefix(
        "> ",
        [
          t("commands.config.natural_nudges.episode_category_line", {
            category: t(CATEGORY_LOCALE_KEYS[definition.category]),
          }),
          t(
            entry.custom
              ? "commands.config.natural_nudges.episode_custom"
              : "commands.config.natural_nudges.episode_builtin",
          ),
        ].join("\n"),
      )}`,
    ),
    text(
      `**${t("commands.config.natural_nudges.episode_brief_title")}**\n${renderFencedPreview(locale, definition.brief, {
        actionLabel: entry.custom ? t("commands.config.natural_nudges.episode_edit_button") : undefined,
      })}`,
    ),
    text(
      `**${t("commands.config.natural_nudges.episode_agenda_title")}**\n> ${definition.agendaHint ?? t("commands.config.natural_nudges.none")}\n**${t("commands.config.natural_nudges.episode_prerequisites_title")}**\n> ${prerequisites}\n**${t("commands.config.natural_nudges.episode_tools_title")}**\n> ${tools}`,
    ),
    buildStateControlRow(
      [
        {
          value: false,
          label: t("commands.config.panel.off_button"),
          customId: buildConfigRouteId({ action: "nudge-episode-toggle", locale, index, fp, enabled: false }),
        },
        {
          value: true,
          label: t("commands.config.panel.on_button"),
          customId: buildConfigRouteId({ action: "nudge-episode-toggle", locale, index, fp, enabled: true }),
        },
      ],
      entry.enabled,
      writesDisabled,
    ),
  );

  if (entry.custom) {
    components.push(
      text(t("commands.config.natural_nudges.episode_prerequisites_select_intro")),
      {
        type: ComponentType.ActionRow,
        components: [
          {
            type: ComponentType.StringSelect,
            customId: buildConfigRouteId({ action: "nudge-episode-prereqs-select", locale, index, fp }),
            placeholder: safeSelectOptionText(
              t("commands.config.natural_nudges.episode_prerequisites_placeholder"),
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
            customId: buildConfigRouteId({ action: "nudge-episode-tools-select", locale, index, fp }),
            placeholder: safeSelectOptionText(t("commands.config.natural_nudges.episode_tools_placeholder"), 150),
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
            t("commands.config.natural_nudges.episode_edit_button"),
            { action: "nudge-episode-edit-open", locale, index, fp },
            writesDisabled,
          ),
          button(
            t("commands.config.natural_nudges.episode_remove_button"),
            { action: "nudge-episode-remove-view", locale, index, fp },
            writesDisabled,
            true,
          ),
        ],
      },
    );
  }
  return components;
}

export function buildEpisodeModal(
  locale: string,
  nonce: string,
  target: { index: number; fp: string } | null,
  current?: NudgeEpisodeEntry,
): RawModalPayload {
  const t = (key: string, vars: Record<string, string | number> = {}) => localizer(locale, key, vars);
  const label = (key: string) => safeSelectOptionText(t(key), MODAL_TEXT_MAX);
  const description = (key: string, vars: Record<string, string | number> = {}) =>
    safeSelectOptionText(t(key, vars), MODAL_DESCRIPTION_MAX);
  return {
    custom_id: target
      ? buildConfigRouteId({ action: "nudge-episode-edit-submit", locale, index: target.index, fp: target.fp, nonce })
      : buildConfigRouteId({ action: "nudge-episode-add-submit", locale, nonce }),
    title: label(
      target
        ? "commands.config.natural_nudges.episode_edit_button"
        : "commands.config.natural_nudges.episode_add_title",
    ),
    components: [
      {
        type: 18,
        label: label("commands.config.natural_nudges.episode_title_label"),
        description: description("commands.config.natural_nudges.episode_title_description", {
          max: CUSTOM_EPISODE_TITLE_MAX,
        }),
        component: {
          type: 4,
          custom_id: buildConfigModalFieldId(NUDGE_EPISODE_TITLE_FIELD, nonce),
          style: TextInputStyle.Short,
          required: true,
          min_length: 1,
          max_length: CUSTOM_EPISODE_TITLE_MAX,
          ...(current?.custom ? { value: current.custom.title } : {}),
        },
      },
      {
        type: 18,
        label: label("commands.config.natural_nudges.episode_category_label"),
        description: description("commands.config.natural_nudges.episode_category_description"),
        component: {
          type: 3,
          custom_id: buildConfigModalFieldId(NUDGE_EPISODE_CATEGORY_FIELD, nonce),
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
        label: label("commands.config.natural_nudges.episode_brief_label"),
        description: description("commands.config.natural_nudges.episode_brief_description", {
          max: CUSTOM_EPISODE_BRIEF_MAX,
        }),
        component: {
          type: 4,
          custom_id: buildConfigModalFieldId(NUDGE_EPISODE_BRIEF_FIELD, nonce),
          style: TextInputStyle.Paragraph,
          required: true,
          min_length: 1,
          max_length: CUSTOM_EPISODE_BRIEF_MAX,
          ...(current?.custom ? { value: current.custom.brief } : {}),
        },
      },
      {
        type: 18,
        label: label("commands.config.natural_nudges.episode_agenda_label"),
        description: description("commands.config.natural_nudges.episode_agenda_description", {
          max: CUSTOM_EPISODE_AGENDA_HINT_MAX,
        }),
        component: {
          type: 4,
          custom_id: buildConfigModalFieldId(NUDGE_EPISODE_AGENDA_FIELD, nonce),
          style: TextInputStyle.Paragraph,
          required: false,
          max_length: CUSTOM_EPISODE_AGENDA_HINT_MAX,
          ...(current?.custom?.agenda_hint ? { value: current.custom.agenda_hint } : {}),
        },
      },
    ],
  };
}
