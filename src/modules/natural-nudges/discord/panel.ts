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
  IDLE_NUDGE_FREQUENCY_LEVELS,
  NATURAL_NUDGE_INTEREST_DESCRIPTION_MAX,
  NATURAL_NUDGE_INTEREST_LABEL_MAX,
  NATURAL_NUDGE_INTEREST_LIMIT,
  NATURAL_NUDGE_TALKATIVENESS_LEVELS,
  type NaturalNudgeInterest,
  type PersonaNaturalNudgeConfig,
} from "@/modules/natural-nudges/db/types";
import {
  computeInterestFingerprint,
  type NaturalNudgesSettingsView,
} from "@/modules/natural-nudges/discord/operations";
import { commandRegistry } from "@/utils/discord/commandRegistry";
import { buildConfigRouteId, CONFIG_MODEL_PAGE_SIZE } from "@/utils/discord/configPanelCatalog";
import { encodeConfigProviderPageValue } from "@/utils/discord/interactions/configModelLoaders";
import type { StructuredOutputModelGroup } from "@/utils/discord/interactions/configModelOperations";
import { buildConfigModalFieldId, type RawModalPayload } from "@/utils/discord/ui/configModals";
import { buildConfigModelSelectModal } from "@/utils/discord/ui/configModelModals";
import { DISCORD_SELECT_OPTIONS_MAX } from "@/utils/discord/ui/componentsV2Limits";
import { safeSelectOptionText } from "@/utils/discord/ui/modals";
import { formatModelSelectionLabel } from "@/utils/discord/ui/modelRoutingControls";
import { buildStateControlRow, withLinePrefix } from "@/utils/discord/ui/panel";
import { getProviderDisplayName } from "@/utils/provider/providerInfoRegistry";
import { localizer } from "@/utils/text/localizer";

export const NUDGE_ADD_VALUE = "add";
export const NUDGE_CLEAR_MODEL_VALUE = "__none__";
export const NUDGE_INTEREST_LABEL_FIELD = "nudge_interest_label";
export const NUDGE_INTEREST_DESCRIPTION_FIELD = "nudge_interest_description";

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
    text(
      `-# ${t("commands.config.natural_nudges.idle_nudges_studio_hint", {
        command: commandRegistry.getCommandMention("nudge-studio"),
      })}`,
    ),
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
