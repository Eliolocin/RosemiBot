import { computePersonaNudgeFingerprint } from "@/modules/natural-nudges/db/types";
import {
  ButtonStyle,
  ComponentType,
  MessageFlags,
  TextInputStyle,
  type ComponentInContainerData,
  type SelectMenuComponentOptionData,
  type TopLevelComponentData,
} from "discord.js";
import type { TomoriState } from "@/types/db/schema";
import type { PanelReceipt } from "@/types/discord/panel";
import type { RawDiscordComponent } from "@/types/discord/rawApiTypes";
import {
  CUSTOM_IDLE_NUDGE_AGENDA_HINT_MAX,
  CUSTOM_IDLE_NUDGE_BRIEF_MAX,
  CUSTOM_IDLE_NUDGE_LIMIT,
  CUSTOM_IDLE_NUDGE_LIST_MAX,
  CUSTOM_IDLE_NUDGE_TITLE_MAX,
  NATURAL_NUDGE_CATEGORIES,
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
import {
  buildNudgeStudioRouteId,
  buildNudgeStudioRouteSegments,
  NUDGE_STUDIO_ROUTE_NAMESPACE,
  NUDGE_STUDIO_ROUTE_VERSION,
  nudgeStudioFieldId,
} from "@/modules/natural-nudges/discord/studioCatalog";
import type {
  IdleNudgeFormContent,
  NudgeStudioView,
  StudioEntry,
} from "@/modules/natural-nudges/discord/studioOperations";
import { personaNudgeLocalId, idleNudgeContentFromDefinition } from "@/modules/natural-nudges/discord/studioOperations";
import { resolveRangeSelection } from "@/utils/discord/interactions/panelController";
import type { ResolvedRangeSelection } from "@/types/discord/panel";
import type { RawModalPayload } from "@/utils/discord/ui/configModals";
import {
  DISCORD_CHECKBOX_GROUP_OPTIONS_MAX,
  DISCORD_MODAL_COMPONENTS_MAX,
} from "@/utils/discord/ui/componentsV2Limits";
import { safeSelectOptionText } from "@/utils/discord/ui/modals";
import {
  buildCategoryButtonRow,
  buildPaginationRow,
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
/** A row lists this many scoped personas before folding the rest into a count, so one row stays one line. */
const SCOPE_NAMES_SHOWN = 3;
/** Rows, Toggle Availability options, and editable entries one page shows; one slot stays free for Add. */
export const NUDGE_STUDIO_PAGE_SIZE = 12;

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

export function nudgeCategoryLabel(locale: string, category: NaturalNudgeCategory): string {
  return localizer(locale, CATEGORY_KEYS[category]);
}

export function nudgeBlockerLabel(locale: string, blocker: IdleNudgeBlocker): string {
  if (blocker.kind === "tool")
    return localizer(locale, "commands.nudge-studio.blocker_tool", {
      tool: localizer(locale, TOOL_KEYS[blocker.tool]),
    });
  return localizer(
    locale,
    blocker.kind === "two_personas"
      ? "commands.nudge-studio.blocker_two_personas"
      : "commands.nudge-studio.blocker_no_persona",
  );
}

export function studioEntryTitle(locale: string, entry: StudioEntry): string {
  return entry.definition.titleKey ? localizer(locale, entry.definition.titleKey) : (entry.definition.title ?? "");
}

export function studioEntrySource(entry: StudioEntry): "builtin" | "server" | "persona" {
  if (entry.definition.builtIn) return "builtin";
  return entry.definition.ownerPersonaId === undefined ? "server" : "persona";
}

export function studioEntrySelectionValue(entry: StudioEntry): string {
  return entry.definition.key;
}

export function studioEntryOwnerName(entry: StudioEntry, personaNames: ReadonlyMap<number, string>): string | null {
  const ownerId = entry.definition.ownerPersonaId;
  return ownerId === undefined ? null : (personaNames.get(ownerId) ?? String(ownerId));
}

/** The edit modal and its fingerprint; the owner comes from the selected persona, never from the client. */
export function personaNudgeFormTarget(
  entry: StudioEntry,
): { ownerId: number; idleNudgeId: string; fp: string } | null {
  const ownerId = entry.definition.ownerPersonaId;
  const idleNudgeId = personaNudgeLocalId(entry.definition);
  if (ownerId === undefined || idleNudgeId === null) return null;
  return {
    ownerId,
    idleNudgeId,
    fp: computePersonaNudgeFingerprint(ownerId, {
      category: entry.definition.category,
      title: entry.definition.title ?? "",
      brief: entry.definition.brief,
      agenda_hint: entry.definition.agendaHint,
      prerequisites: entry.definition.prerequisites,
      recommended_tools: entry.definition.recommendedTools,
    }),
  };
}

/** Deleted personas stay in a stored scope, so they are skipped here and a scope with none left reads as null. */
function scopeNames(
  locale: string,
  scope: readonly number[] | undefined,
  personaNames: ReadonlyMap<number, string>,
): string | null {
  const names = (scope ?? []).flatMap((personaId) => personaNames.get(personaId) ?? []);
  if (names.length === 0) return null;
  const shown = names.slice(0, SCOPE_NAMES_SHOWN);
  const hidden = names.length - shown.length;
  const more = hidden > 0 ? [localizer(locale, "commands.nudge-studio.note_scope_more", { count: hidden })] : [];
  return new Intl.ListFormat(locale, { type: "conjunction" }).format([...shown, ...more]);
}

function statusCircle(entry: StudioEntry): string {
  return !entry.enabled ? "🔴" : entry.blocker ? "🟡" : "🟢";
}

function sourceNote(locale: string, entry: StudioEntry, personaNames: ReadonlyMap<number, string>): string {
  switch (studioEntrySource(entry)) {
    case "builtin":
      return localizer(locale, "commands.nudge-studio.note_source_builtin");
    case "server":
      return localizer(locale, "commands.nudge-studio.note_source_server");
    case "persona":
      return localizer(locale, "commands.nudge-studio.note_source_persona", {
        persona: escapeDiscordMarkdown(studioEntryOwnerName(entry, personaNames) ?? ""),
      });
  }
}

function entryRow(locale: string, entry: StudioEntry, personaNames: ReadonlyMap<number, string>): string {
  const circle = statusCircle(entry);
  const title = entry.custom
    ? `*${escapeDiscordMarkdown(truncateDiscordText(studioEntryTitle(locale, entry), LIST_TITLE_MAX))}*`
    : escapeDiscordMarkdown(truncateDiscordText(studioEntryTitle(locale, entry), LIST_TITLE_MAX));
  const personas = scopeNames(locale, entry.scope, personaNames);
  const notes = [
    sourceNote(locale, entry, personaNames),
    personas
      ? localizer(locale, "commands.nudge-studio.note_scope", { personas: escapeDiscordMarkdown(personas) })
      : null,
    entry.blocker ? nudgeBlockerLabel(locale, entry.blocker) : null,
  ].filter((note): note is string => note !== null);
  const joined = new Intl.ListFormat(locale, { type: "unit", style: "short" }).format(notes);
  return `${circle} ${localizer(locale, "commands.nudge-studio.row_notes", { title, notes: joined })}`;
}

function text(content: string): ComponentInContainerData {
  return { type: ComponentType.TextDisplay, content };
}

export interface NudgeStudioRenderInput {
  locale: string;
  view: NudgeStudioView;
  /** Page of the Toggle Availability menu, clamped to the pages the category has. */
  page?: number;
  receipt?: PanelReceipt;
}

function selectionFor(view: NudgeStudioView, requestedPage: number): ResolvedRangeSelection<StudioEntry> {
  return resolveRangeSelection(view.entries, requestedPage, NUDGE_STUDIO_PAGE_SIZE);
}

function entryOptionLabel(locale: string, entry: StudioEntry, personaNames: ReadonlyMap<number, string>): string {
  const title = studioEntryTitle(locale, entry);
  const owner = studioEntryOwnerName(entry, personaNames);
  return safeSelectOptionText(
    owner ? localizer(locale, "commands.nudge-studio.option_owner", { title, persona: owner }) : title,
    OPTION_TEXT_MAX,
  );
}

function buildAvailabilityControls(
  locale: string,
  view: NudgeStudioView,
  selection: ResolvedRangeSelection<StudioEntry>,
): ComponentInContainerData[] {
  const { category } = view;
  const pagination = buildPaginationRow({
    locale,
    rangeIndex: selection.rangeIndex,
    rangeCount: selection.rangeCount,
    namespace: NUDGE_STUDIO_ROUTE_NAMESPACE,
    version: NUDGE_STUDIO_ROUTE_VERSION,
    buildSegments: { page: (page) => buildNudgeStudioRouteSegments({ action: "view", locale, category, page }) },
  });
  return [
    {
      type: ComponentType.ActionRow,
      components: [
        {
          type: ComponentType.StringSelect,
          customId: buildNudgeStudioRouteId({ action: "toggle-open", locale, category, page: selection.rangeIndex }),
          placeholder: safeSelectOptionText(
            localizer(locale, "commands.nudge-studio.toggle_placeholder"),
            SELECT_PLACEHOLDER_MAX,
          ),
          options: selection.visibleItems.map((entry) => ({
            label: entryOptionLabel(locale, entry, view.personaNames),
            description: safeSelectOptionText(entry.definition.brief, OPTION_TEXT_MAX),
            emoji: { name: statusCircle(entry) },
            value: entry.definition.key,
          })),
        },
      ],
    },
    ...(pagination ? [pagination] : []),
  ];
}

export function buildNudgeStudioPayload(input: NudgeStudioRenderInput): {
  components: TopLevelComponentData[];
  flags: MessageFlags.IsComponentsV2;
} {
  const { locale, view } = input;
  const { category } = view;
  const t = (key: string, vars: Record<string, string | number> = {}) => localizer(locale, key, vars);
  const selection = selectionFor(view, input.page ?? 0);
  const editable = selection.visibleItems.filter(
    (entry) => entry.custom !== undefined || entry.definition.ownerPersonaId !== undefined,
  );
  const list = buildTextPreview(
    selection.visibleItems.map((entry) => entryRow(locale, entry, view.personaNames)).join("\n"),
    LIST_TEXT_BUDGET,
  );
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
    ...buildAvailabilityControls(locale, view, selection),
    text(
      `### ${t(CUSTOM_TITLE_KEYS[category])}\n${t("commands.nudge-studio.custom_intro", {
        category: t(CATEGORY_KEYS[category]),
      })}\n${withLinePrefix("> - ", t(TIPS_KEYS[category]))}`,
    ),
  ];

  const canAdd = view.customCount < CUSTOM_IDLE_NUDGE_LIMIT;
  const options: SelectMenuComponentOptionData[] = [
    ...(canAdd ? [{ label: t("commands.nudge-studio.add_option"), value: NUDGE_STUDIO_ADD_VALUE }] : []),
    ...editable.map((entry) => ({
      label: entryOptionLabel(locale, entry, view.personaNames),
      description: safeSelectOptionText(entry.definition.brief, OPTION_TEXT_MAX),
      value: studioEntrySelectionValue(entry),
    })),
  ];
  if (options.length > 0) {
    components.push({
      type: ComponentType.ActionRow,
      components: [
        {
          type: ComponentType.StringSelect,
          customId: buildNudgeStudioRouteId({
            action: "select",
            locale,
            category,
            page: selection.rangeIndex,
          }),
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
          customId: buildNudgeStudioRouteId({
            action: "remove-open",
            locale,
            category,
            page: selection.rangeIndex,
          }),
          disabled: editable.length === 0,
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

export interface IdleNudgeFormModalOptions {
  /** The submit route this surface owns; omitted uses the Nudge Studio route. */
  customId?: string;
  /** Overrides the add or edit title, for the surface's own copy. */
  titleKey?: string;
}

/** Opens prefilled from `current` when editing, so the modal itself is where a custom idle nudge is read. */
export function buildIdleNudgeFormModal(
  locale: string,
  category: NaturalNudgeCategory,
  nonce: string,
  current?: IdleNudgeFormContent,
  options: IdleNudgeFormModalOptions = {},
): RawModalPayload {
  const t = (key: string) => localizer(locale, key);
  const implied = CATEGORY_IMPLIED_PREREQUISITES[category];
  const placeholder = (key: string, max: number) => safeSelectOptionText(t(key), max);
  if (current && !options.customId) throw new Error("An edit modal needs its submit route");
  return {
    custom_id: options.customId ?? buildNudgeStudioRouteId({ action: "add-submit", locale, category, nonce }),
    title: safeSelectOptionText(
      t(options.titleKey ?? (current ? "commands.nudge-studio.modal_edit_title" : MODAL_ADD_TITLE_KEYS[category])),
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

export function buildNudgeChecklistModal(
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

/**
 * Checkbox options for Toggle Availability: every persona, checked when it may use the idle nudge, so an
 * idle nudge that is off opens with nothing checked. Personas past what one modal holds are left out, and
 * the submit leaves unpresented personas as they are.
 */
export function availabilityOptions(personas: readonly TomoriState[], entry: StudioEntry): ChecklistOption[] {
  return personas
    .flatMap((persona) => (persona.persona_id ? [{ id: persona.persona_id, name: persona.persona_nickname }] : []))
    .slice(0, DISCORD_MODAL_COMPONENTS_MAX * DISCORD_CHECKBOX_GROUP_OPTIONS_MAX)
    .map(({ id, name }) => ({
      value: String(id),
      label: name,
      checked: entry.enabled && (entry.scope?.includes(id) ?? true),
    }));
}

export function buildAvailabilityModal(
  locale: string,
  category: NaturalNudgeCategory,
  entry: StudioEntry,
  page: number,
  nonce: string,
  options: readonly ChecklistOption[],
): RawModalPayload {
  return buildNudgeChecklistModal(
    locale,
    buildNudgeStudioRouteId({ action: "toggle-submit", locale, category, key: entry.definition.key, page, nonce }),
    "commands.nudge-studio.toggle_modal_title",
    studioEntryTitle(locale, entry),
    "commands.nudge-studio.toggle_group_description",
    nonce,
    options,
  );
}

/** A persona-owned row may only enable or disable its own owner, so its checklist holds one option. */
export function personaAvailabilityOptions(locale: string, entry: StudioEntry, ownerName: string): ChecklistOption[] {
  return [
    {
      value: "available",
      label: localizer(locale, "commands.nudge-studio.persona_toggle_option", { persona: ownerName }),
      checked: entry.enabled,
    },
  ];
}

export function buildPersonaAvailabilityModal(
  locale: string,
  category: NaturalNudgeCategory,
  entry: StudioEntry,
  page: number,
  nonce: string,
  ownerName: string,
): RawModalPayload {
  const target = personaNudgeFormTarget(entry);
  if (!target) throw new Error("Persona availability requires a persona-owned nudge");
  return buildNudgeChecklistModal(
    locale,
    buildNudgeStudioRouteId({
      action: "persona-toggle-submit",
      locale,
      category,
      page,
      ownerId: target.ownerId,
      idleNudgeId: target.idleNudgeId,
      nonce,
    }),
    "commands.nudge-studio.toggle_modal_title",
    studioEntryTitle(locale, entry),
    "commands.nudge-studio.persona_toggle_group_description",
    nonce,
    personaAvailabilityOptions(locale, entry, ownerName),
  );
}

/** Removal keys tag their source, so one checklist can present server and persona entries without mixing them up. */
export function studioRemovalKey(entry: StudioEntry): string | null {
  if (entry.custom) return `c:${entry.custom.custom_idle_nudge_id}`;
  const ownerId = entry.definition.ownerPersonaId;
  const idleNudgeId = personaNudgeLocalId(entry.definition);
  return ownerId === undefined || idleNudgeId === null
    ? null
    : `p:${ownerId}:${idleNudgeId}:${computePersonaNudgeFingerprint(ownerId, idleNudgeContentFromDefinition(entry.definition))}`;
}

export function parseStudioRemovalKey(
  value: string,
):
  | { kind: "custom"; id: number }
  | { kind: "persona"; ownerPersonaId: number; idleNudgeId: string; fp: string }
  | null {
  const custom = /^c:(\d+)$/.exec(value);
  if (custom) {
    const id = Number(custom[1]);
    return Number.isSafeInteger(id) && id > 0 ? { kind: "custom", id } : null;
  }
  const persona = /^p:(\d+):([A-Za-z0-9_-]{1,24}):([A-Za-z0-9_-]{8})$/.exec(value);
  if (!persona) return null;
  const ownerPersonaId = Number(persona[1]);
  return Number.isSafeInteger(ownerPersonaId) && ownerPersonaId > 0
    ? { kind: "persona", ownerPersonaId, idleNudgeId: persona[2] as string, fp: persona[3] as string }
    : null;
}

/** Checkbox options for removal: the editable entries on the visible page, all checked. */
export function removalOptions(entries: readonly StudioEntry[]): ChecklistOption[] {
  return entries.flatMap((entry) => {
    const value = studioRemovalKey(entry);
    if (!value) return [];
    return [
      {
        value,
        label: entry.custom?.title ?? entry.definition.title ?? "",
        description: entry.definition.brief,
        checked: true,
      },
    ];
  });
}

export function buildRemovalModal(
  locale: string,
  category: NaturalNudgeCategory,
  nonce: string,
  options: readonly ChecklistOption[],
  page = 0,
): RawModalPayload {
  return buildNudgeChecklistModal(
    locale,
    buildNudgeStudioRouteId({ action: "remove-submit", locale, category, nonce, page }),
    "commands.nudge-studio.remove_modal_title",
    localizer(locale, CUSTOM_TITLE_KEYS[category]),
    "commands.nudge-studio.remove_group_description",
    nonce,
    options,
  );
}
