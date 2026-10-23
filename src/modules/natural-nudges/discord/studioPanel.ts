import {
  ButtonStyle,
  ComponentType,
  MessageFlags,
  TextInputStyle,
  type ComponentInContainerData,
  type SelectMenuComponentOptionData,
  type TopLevelComponentData,
} from "discord.js";
import type { PanelReceipt } from "@/types/discord/panel";
import type { RawDiscordComponent } from "@/types/discord/rawApiTypes";
import {
  CUSTOM_IDLE_NUDGE_AGENDA_HINT_MAX,
  CUSTOM_IDLE_NUDGE_BRIEF_MAX,
  CUSTOM_IDLE_NUDGE_LIMIT,
  CUSTOM_IDLE_NUDGE_LIST_MAX,
  CUSTOM_IDLE_NUDGE_TITLE_MAX,
  NATURAL_NUDGE_CATEGORIES,
  type CustomIdleNudgeRow,
  type NaturalNudgeCategory,
} from "@/modules/natural-nudges/db/types";
import {
  CATEGORY_IMPLIED_PREREQUISITES,
  NUDGE_PREREQUISITE_IDS,
  NUDGE_TOOL_NAMES,
  prerequisiteTool,
  type IdleNudgeBlocker,
  type NudgeToolName,
} from "@/modules/natural-nudges/runtime/idleNudges";
import { buildNudgeStudioRouteId, nudgeStudioFieldId } from "@/modules/natural-nudges/discord/studioCatalog";
import type { NudgeStudioView, StudioEntry } from "@/modules/natural-nudges/discord/studioOperations";
import type { RawModalPayload } from "@/utils/discord/ui/configModals";
import { DISCORD_CHECKBOX_GROUP_OPTIONS_MAX } from "@/utils/discord/ui/componentsV2Limits";
import { safeSelectOptionText } from "@/utils/discord/ui/modals";
import {
  buildCategoryButtonRow,
  buildPanelContainer,
  buildPanelReceiptContainer,
  withLinePrefix,
} from "@/utils/discord/ui/panel";
import { escapeDiscordMarkdown } from "@/utils/text/discordMarkdown";
import { truncateDiscordText } from "@/utils/text/discordTextLimits";
import { localizer } from "@/utils/text/localizer";
import { buildTextPreview, textPreviewFooterKey, textPreviewFooterVars } from "@/utils/text/textPreview";

const MODAL_TITLE_MAX = 45;
const MODAL_DESCRIPTION_MAX = 100;
const TEXT_PLACEHOLDER_MAX = 100;
const SELECT_PLACEHOLDER_MAX = 150;
const OPTION_TEXT_MAX = 100;
/** Custom titles allow 80 characters, but 25 of them at full length would crowd the 4,000-character message. */
const LIST_TITLE_MAX = 40;
/** Leaves room for the headings, tips, and footer inside Discord's 4,000-character message budget. */
const LIST_TEXT_BUDGET = 2400;

type CategoryKeys = Record<NaturalNudgeCategory, string>;

const TAB_KEYS: CategoryKeys = {
  ping_user: "commands.nudge-studio.tab_ping_user",
  revive_topic: "commands.nudge-studio.tab_revive_topic",
  start_topic: "commands.nudge-studio.tab_start_topic",
  play_scene: "commands.nudge-studio.tab_play_scene",
};
const CATEGORY_KEYS: CategoryKeys = {
  ping_user: "commands.nudge-studio.category_ping_user",
  revive_topic: "commands.nudge-studio.category_revive_topic",
  start_topic: "commands.nudge-studio.category_start_topic",
  play_scene: "commands.nudge-studio.category_play_scene",
};
const TITLE_KEYS: CategoryKeys = {
  ping_user: "commands.nudge-studio.title_ping_user",
  revive_topic: "commands.nudge-studio.title_revive_topic",
  start_topic: "commands.nudge-studio.title_start_topic",
  play_scene: "commands.nudge-studio.title_play_scene",
};
const DESCRIPTION_KEYS: CategoryKeys = {
  ping_user: "commands.nudge-studio.description_ping_user",
  revive_topic: "commands.nudge-studio.description_revive_topic",
  start_topic: "commands.nudge-studio.description_start_topic",
  play_scene: "commands.nudge-studio.description_play_scene",
};
const CUSTOM_TITLE_KEYS: CategoryKeys = {
  ping_user: "commands.nudge-studio.custom_title_ping_user",
  revive_topic: "commands.nudge-studio.custom_title_revive_topic",
  start_topic: "commands.nudge-studio.custom_title_start_topic",
  play_scene: "commands.nudge-studio.custom_title_play_scene",
};
const TIPS_KEYS: CategoryKeys = {
  ping_user: "commands.nudge-studio.tips_ping_user",
  revive_topic: "commands.nudge-studio.tips_revive_topic",
  start_topic: "commands.nudge-studio.tips_start_topic",
  play_scene: "commands.nudge-studio.tips_play_scene",
};
const MODAL_ADD_TITLE_KEYS: CategoryKeys = {
  ping_user: "commands.nudge-studio.modal_add_title_ping_user",
  revive_topic: "commands.nudge-studio.modal_add_title_revive_topic",
  start_topic: "commands.nudge-studio.modal_add_title_start_topic",
  play_scene: "commands.nudge-studio.modal_add_title_play_scene",
};
const TITLE_PLACEHOLDER_KEYS: CategoryKeys = {
  ping_user: "commands.nudge-studio.title_placeholder_ping_user",
  revive_topic: "commands.nudge-studio.title_placeholder_revive_topic",
  start_topic: "commands.nudge-studio.title_placeholder_start_topic",
  play_scene: "commands.nudge-studio.title_placeholder_play_scene",
};
const BRIEF_DESCRIPTION_KEYS: CategoryKeys = {
  ping_user: "commands.nudge-studio.brief_description_ping_user",
  revive_topic: "commands.nudge-studio.brief_description_revive_topic",
  start_topic: "commands.nudge-studio.brief_description_start_topic",
  play_scene: "commands.nudge-studio.brief_description_play_scene",
};
const BRIEF_PLACEHOLDER_KEYS: CategoryKeys = {
  ping_user: "commands.nudge-studio.brief_placeholder_ping_user",
  revive_topic: "commands.nudge-studio.brief_placeholder_revive_topic",
  start_topic: "commands.nudge-studio.brief_placeholder_start_topic",
  play_scene: "commands.nudge-studio.brief_placeholder_play_scene",
};
const AGENDA_PLACEHOLDER_KEYS: CategoryKeys = {
  ping_user: "commands.nudge-studio.agenda_placeholder_ping_user",
  revive_topic: "commands.nudge-studio.agenda_placeholder_revive_topic",
  start_topic: "commands.nudge-studio.agenda_placeholder_start_topic",
  play_scene: "commands.nudge-studio.agenda_placeholder_play_scene",
};

const PREREQUISITE_KEYS: Record<string, string> = {
  hanging_conversation: "commands.nudge-studio.prerequisite_hanging_conversation",
  relationship_user: "commands.nudge-studio.prerequisite_relationship_user",
  recent_memory: "commands.nudge-studio.prerequisite_recent_memory",
  presence_activity: "commands.nudge-studio.prerequisite_presence_activity",
  two_personas: "commands.nudge-studio.prerequisite_two_personas",
};

const TOOL_KEYS: Record<NudgeToolName, string> = {
  web_search: "commands.nudge-studio.tool_web_search",
  fetch_url: "commands.nudge-studio.tool_fetch_url",
  image: "commands.nudge-studio.tool_image",
  generate_voice_message: "commands.nudge-studio.tool_generate_voice_message",
  generate_video: "commands.nudge-studio.tool_generate_video",
  select_sticker_for_response: "commands.nudge-studio.tool_select_sticker_for_response",
  create_task: "commands.nudge-studio.tool_create_task",
  update_task: "commands.nudge-studio.tool_update_task",
  create_thread: "commands.nudge-studio.tool_create_thread",
  peek_profile_picture: "commands.nudge-studio.tool_peek_profile_picture",
  interact_with_recent_message: "commands.nudge-studio.tool_interact_with_recent_message",
  create_long_term_memory: "commands.nudge-studio.tool_create_long_term_memory",
  update_long_term_memory: "commands.nudge-studio.tool_update_long_term_memory",
  update_short_term_memory: "commands.nudge-studio.tool_update_short_term_memory",
  process_youtube_video: "commands.nudge-studio.tool_process_youtube_video",
};

export const NUDGE_STUDIO_ADD_VALUE = "add";

function prerequisiteLabel(locale: string, id: string): string {
  const key = PREREQUISITE_KEYS[id];
  if (key) return localizer(locale, key);
  const tool = prerequisiteTool(id);
  return localizer(locale, "commands.nudge-studio.prerequisite_tool", {
    tool: tool ? localizer(locale, TOOL_KEYS[tool]) : id,
  });
}

function blockerLabel(locale: string, blocker: IdleNudgeBlocker): string {
  return blocker.kind === "two_personas"
    ? localizer(locale, "commands.nudge-studio.blocker_two_personas")
    : localizer(locale, "commands.nudge-studio.blocker_tool", { tool: localizer(locale, TOOL_KEYS[blocker.tool]) });
}

function studioEntryTitle(locale: string, entry: StudioEntry): string {
  return entry.definition.titleKey ? localizer(locale, entry.definition.titleKey) : (entry.definition.title ?? "");
}

function entryRow(locale: string, entry: StudioEntry): string {
  const circle = !entry.enabled ? "🔴" : entry.blocker ? "🟡" : "🟢";
  const base = entry.custom
    ? `*${escapeDiscordMarkdown(truncateDiscordText(studioEntryTitle(locale, entry), LIST_TITLE_MAX))}*`
    : escapeDiscordMarkdown(studioEntryTitle(locale, entry));
  const reason = entry.blocker ? blockerLabel(locale, entry.blocker) : null;
  const title =
    entry.custom && reason
      ? localizer(locale, "commands.nudge-studio.row_custom_blocked", { title: base, reason })
      : entry.custom
        ? localizer(locale, "commands.nudge-studio.row_custom", { title: base })
        : reason
          ? localizer(locale, "commands.nudge-studio.row_blocked", { title: base, reason })
          : base;
  return `${circle} ${title}`;
}

function text(content: string): ComponentInContainerData {
  return { type: ComponentType.TextDisplay, content };
}

export interface NudgeStudioRenderInput {
  locale: string;
  view: NudgeStudioView;
  receipt?: PanelReceipt;
}

export function buildNudgeStudioPayload(input: NudgeStudioRenderInput): {
  components: TopLevelComponentData[];
  flags: MessageFlags.IsComponentsV2;
} {
  const { locale, view } = input;
  const { category } = view;
  const t = (key: string, vars: Record<string, string | number> = {}) => localizer(locale, key, vars);
  const customs = view.entries.flatMap((entry) => (entry.custom ? [entry.custom] : []));
  const list = buildTextPreview(view.entries.map((entry) => entryRow(locale, entry)).join("\n"), LIST_TEXT_BUDGET);
  const listFooter = textPreviewFooterKey(list);

  const components: ComponentInContainerData[] = [
    buildCategoryButtonRow(
      NATURAL_NUDGE_CATEGORIES.map((id) => ({
        id,
        label: t(TAB_KEYS[id]),
        customId: buildNudgeStudioRouteId({ action: "view", locale, category: id }),
      })),
      category,
    ),
    { type: ComponentType.Separator, divider: true, spacing: 1 },
    text(`## ${t(TITLE_KEYS[category])}\n${t(DESCRIPTION_KEYS[category])}`),
    text(
      `${withLinePrefix("> ", list.text)}${listFooter ? `\n-# ${t(listFooter, textPreviewFooterVars(list, locale))}` : ""}`,
    ),
    {
      type: ComponentType.ActionRow,
      components: [
        {
          type: ComponentType.Button,
          style: ButtonStyle.Secondary,
          label: t("commands.nudge-studio.toggle_button"),
          customId: buildNudgeStudioRouteId({ action: "toggle-open", locale, category }),
        },
      ],
    },
    text(
      `### ${t(CUSTOM_TITLE_KEYS[category])}\n${t("commands.nudge-studio.custom_intro", {
        category: t(CATEGORY_KEYS[category]),
      })}\n${withLinePrefix("> - ", t(TIPS_KEYS[category]))}`,
    ),
  ];

  const canAdd = view.customCount < CUSTOM_IDLE_NUDGE_LIMIT;
  const options: SelectMenuComponentOptionData[] = [
    ...(canAdd ? [{ label: t("commands.nudge-studio.add_option"), value: NUDGE_STUDIO_ADD_VALUE }] : []),
    ...customs.map((custom) => ({
      label: safeSelectOptionText(custom.title, OPTION_TEXT_MAX),
      description: safeSelectOptionText(custom.brief, OPTION_TEXT_MAX),
      value: String(custom.custom_idle_nudge_id),
    })),
  ];
  if (options.length > 0) {
    components.push({
      type: ComponentType.ActionRow,
      components: [
        {
          type: ComponentType.StringSelect,
          customId: buildNudgeStudioRouteId({ action: "select", locale, category }),
          placeholder: safeSelectOptionText(t("commands.nudge-studio.select_placeholder"), SELECT_PLACEHOLDER_MAX),
          options,
        },
      ],
    });
  }
  if (!canAdd) components.push(text(t("commands.nudge-studio.limit_reached", { max: CUSTOM_IDLE_NUDGE_LIMIT })));
  components.push(
    {
      type: ComponentType.ActionRow,
      components: [
        {
          type: ComponentType.Button,
          style: ButtonStyle.Danger,
          label: t("commands.nudge-studio.remove_button"),
          customId: buildNudgeStudioRouteId({ action: "remove-open", locale, category }),
          disabled: customs.length === 0,
        },
      ],
    },
    text(`-# ${t("commands.nudge-studio.config_hint")}`),
  );

  return {
    components: [
      buildPanelContainer(components),
      ...(input.receipt ? [buildPanelReceiptContainer(input.receipt)] : []),
    ],
    flags: MessageFlags.IsComponentsV2,
  };
}

export function buildNudgeStudioTerminalPayload(locale: string, key: string) {
  return {
    components: [buildPanelContainer([text(localizer(locale, key))])],
    flags: MessageFlags.IsComponentsV2 as const,
  };
}

function label(
  locale: string,
  labelKey: string,
  descriptionKey: string,
  component: RawDiscordComponent,
  vars: Record<string, string | number> = {},
): RawDiscordComponent {
  return {
    type: 18,
    label: safeSelectOptionText(localizer(locale, labelKey), MODAL_TITLE_MAX),
    description: safeSelectOptionText(localizer(locale, descriptionKey, vars), MODAL_DESCRIPTION_MAX),
    component,
  };
}

/** Opens prefilled from `current` when editing, so the modal itself is where a custom idle nudge is read. */
export function buildIdleNudgeFormModal(
  locale: string,
  category: NaturalNudgeCategory,
  nonce: string,
  current?: CustomIdleNudgeRow,
): RawModalPayload {
  const t = (key: string) => localizer(locale, key);
  const implied = CATEGORY_IMPLIED_PREREQUISITES[category];
  const placeholder = (key: string, max: number) => safeSelectOptionText(t(key), max);
  return {
    custom_id: current
      ? buildNudgeStudioRouteId({ action: "edit-submit", locale, category, id: current.custom_idle_nudge_id, nonce })
      : buildNudgeStudioRouteId({ action: "add-submit", locale, category, nonce }),
    title: safeSelectOptionText(
      t(current ? "commands.nudge-studio.modal_edit_title" : MODAL_ADD_TITLE_KEYS[category]),
      MODAL_TITLE_MAX,
    ),
    components: [
      label(
        locale,
        "commands.nudge-studio.title_label",
        "commands.nudge-studio.title_description",
        {
          type: 4,
          custom_id: nudgeStudioFieldId("title", nonce),
          style: TextInputStyle.Short,
          required: true,
          min_length: 1,
          max_length: CUSTOM_IDLE_NUDGE_TITLE_MAX,
          placeholder: placeholder(TITLE_PLACEHOLDER_KEYS[category], TEXT_PLACEHOLDER_MAX),
          ...(current ? { value: current.title } : {}),
        },
        { max: CUSTOM_IDLE_NUDGE_TITLE_MAX },
      ),
      label(locale, "commands.nudge-studio.brief_label", BRIEF_DESCRIPTION_KEYS[category], {
        type: 4,
        custom_id: nudgeStudioFieldId("brief", nonce),
        style: TextInputStyle.Paragraph,
        required: true,
        min_length: 1,
        max_length: CUSTOM_IDLE_NUDGE_BRIEF_MAX,
        placeholder: placeholder(BRIEF_PLACEHOLDER_KEYS[category], TEXT_PLACEHOLDER_MAX),
        ...(current ? { value: current.brief } : {}),
      }),
      label(
        locale,
        "commands.nudge-studio.agenda_label",
        "commands.nudge-studio.agenda_description",
        {
          type: 4,
          custom_id: nudgeStudioFieldId("agenda", nonce),
          style: TextInputStyle.Paragraph,
          required: false,
          max_length: CUSTOM_IDLE_NUDGE_AGENDA_HINT_MAX,
          placeholder: placeholder(AGENDA_PLACEHOLDER_KEYS[category], TEXT_PLACEHOLDER_MAX),
          ...(current?.agenda_hint ? { value: current.agenda_hint } : {}),
        },
        { max: CUSTOM_IDLE_NUDGE_AGENDA_HINT_MAX },
      ),
      label(
        locale,
        "commands.nudge-studio.needs_label",
        "commands.nudge-studio.needs_description",
        {
          type: 3,
          custom_id: nudgeStudioFieldId("needs", nonce),
          required: false,
          min_values: 0,
          max_values: CUSTOM_IDLE_NUDGE_LIST_MAX,
          placeholder: placeholder("commands.nudge-studio.needs_placeholder", SELECT_PLACEHOLDER_MAX),
          options: NUDGE_PREREQUISITE_IDS.filter((id) => id !== implied).map((id) => ({
            label: safeSelectOptionText(prerequisiteLabel(locale, id), OPTION_TEXT_MAX),
            value: id,
            default: current?.prerequisites.includes(id) ?? false,
          })),
        },
        { max: CUSTOM_IDLE_NUDGE_LIST_MAX },
      ),
      label(
        locale,
        "commands.nudge-studio.tools_label",
        "commands.nudge-studio.tools_description",
        {
          type: 3,
          custom_id: nudgeStudioFieldId("tools", nonce),
          required: false,
          min_values: 0,
          max_values: CUSTOM_IDLE_NUDGE_LIST_MAX,
          placeholder: placeholder("commands.nudge-studio.tools_placeholder", SELECT_PLACEHOLDER_MAX),
          options: NUDGE_TOOL_NAMES.map((tool) => ({
            label: safeSelectOptionText(t(TOOL_KEYS[tool]), OPTION_TEXT_MAX),
            value: tool,
            default: current?.recommended_tools.includes(tool) ?? false,
          })),
        },
        { max: CUSTOM_IDLE_NUDGE_LIST_MAX },
      ),
    ],
  };
}

export interface ChecklistOption {
  value: string;
  label: string;
  description?: string;
  checked: boolean;
}

/** Number of Checkbox Groups a checklist of `count` options takes. */
export function checklistGroupCount(count: number): number {
  return Math.ceil(count / DISCORD_CHECKBOX_GROUP_OPTIONS_MAX);
}

function buildChecklistModal(
  locale: string,
  customId: string,
  titleKey: string,
  listLabel: string,
  descriptionKey: string,
  nonce: string,
  options: readonly ChecklistOption[],
): RawModalPayload {
  const components: RawDiscordComponent[] = [];
  for (let group = 0; group < checklistGroupCount(options.length); group++) {
    const chunk = options.slice(
      group * DISCORD_CHECKBOX_GROUP_OPTIONS_MAX,
      (group + 1) * DISCORD_CHECKBOX_GROUP_OPTIONS_MAX,
    );
    components.push({
      type: 18,
      label: safeSelectOptionText(
        group === 0 ? listLabel : localizer(locale, "commands.nudge-studio.checklist_continued", { list: listLabel }),
        MODAL_TITLE_MAX,
      ),
      ...(group === 0
        ? { description: safeSelectOptionText(localizer(locale, descriptionKey), MODAL_DESCRIPTION_MAX) }
        : {}),
      component: {
        type: 22,
        custom_id: nudgeStudioFieldId("checklist", nonce, group),
        min_values: 0,
        max_values: chunk.length,
        required: false,
        options: chunk.map((option) => ({
          value: option.value,
          label: safeSelectOptionText(option.label, OPTION_TEXT_MAX),
          ...(option.description ? { description: safeSelectOptionText(option.description, OPTION_TEXT_MAX) } : {}),
          default: option.checked,
        })),
      },
    });
  }
  return {
    custom_id: customId,
    title: safeSelectOptionText(localizer(locale, titleKey), MODAL_TITLE_MAX),
    components,
  };
}

/** Checkbox options for Toggle Availability: every idle nudge in the category, checked when enabled. */
export function availabilityOptions(locale: string, view: NudgeStudioView): ChecklistOption[] {
  return view.entries.map((entry) => ({
    value: entry.definition.key,
    label: studioEntryTitle(locale, entry),
    description: entry.definition.brief,
    checked: entry.enabled,
  }));
}

export function buildAvailabilityModal(
  locale: string,
  category: NaturalNudgeCategory,
  nonce: string,
  options: readonly ChecklistOption[],
): RawModalPayload {
  return buildChecklistModal(
    locale,
    buildNudgeStudioRouteId({ action: "toggle-submit", locale, category, nonce }),
    "commands.nudge-studio.toggle_modal_title",
    localizer(locale, TITLE_KEYS[category]),
    "commands.nudge-studio.toggle_group_description",
    nonce,
    options,
  );
}

/** Checkbox options for removal: every custom idle nudge in the category, all checked. */
export function removalOptions(view: NudgeStudioView): ChecklistOption[] {
  return view.entries.flatMap((entry) =>
    entry.custom
      ? [
          {
            value: String(entry.custom.custom_idle_nudge_id),
            label: entry.custom.title,
            description: entry.custom.brief,
            checked: true,
          },
        ]
      : [],
  );
}

export function buildRemovalModal(
  locale: string,
  category: NaturalNudgeCategory,
  nonce: string,
  options: readonly ChecklistOption[],
): RawModalPayload {
  return buildChecklistModal(
    locale,
    buildNudgeStudioRouteId({ action: "remove-submit", locale, category, nonce }),
    "commands.nudge-studio.remove_modal_title",
    localizer(locale, CUSTOM_TITLE_KEYS[category]),
    "commands.nudge-studio.remove_group_description",
    nonce,
    options,
  );
}
