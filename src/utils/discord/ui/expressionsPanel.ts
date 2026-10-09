import {
  ButtonStyle,
  ComponentType,
  MessageFlags,
  TextInputStyle,
  type ComponentInContainerData,
  type TopLevelComponentData,
  type InteractionButtonComponentData,
} from "discord.js";
import type { CustomExpressionRow } from "@/types/db/schema";
import type { RawDiscordComponent } from "@/types/discord/rawApiTypes";
import type { PanelReceipt } from "@/types/discord/panel";
import { getManualEditEmotionKeys, isValidEmotionKey } from "@/types/misc/emotions";
import {
  EXPRESSION_CATEGORIES,
  EXPRESSIONS_ROUTE_NAMESPACE,
  EXPRESSIONS_ROUTE_VERSION,
  buildExpressionsRouteId,
  buildExpressionsRouteSegments,
  expressionFieldId,
  type ExpressionCategory,
  type ExpressionsPanelRoute,
} from "@/utils/discord/expressionsPanelCatalog";
import {
  buildCategoryButtonRow,
  buildOptionalThumbnailSection,
  buildPaginationRow,
  buildPanelContainer,
  buildPanelReceiptContainer,
} from "@/utils/discord/ui/panel";
import { safeSelectOptionText } from "@/utils/discord/ui/modals";
import { escapeDiscordMarkdown } from "@/utils/text/discordMarkdown";
import { buildTextPreview, textPreviewFooterKey, textPreviewFooterVars } from "@/utils/text/textPreview";
import { localizer } from "@/utils/text/localizer";

export interface ExpressionPanelItem {
  id: string;
  name: string;
  description: string;
  emotion: string;
  initialized: boolean;
  usable: boolean;
  fp: string;
  revision: string | number;
  thumbnail?: string;
  custom?: CustomExpressionRow;
}

export interface ExpressionsPanelData {
  serverId: number;
  emojis: ExpressionPanelItem[];
  stickers: ExpressionPanelItem[];
  customs: ExpressionPanelItem[];
  personas: Array<{ id: number; name: string }>;
}

export type ExpressionPanelPreview =
  | { kind: "gallery"; url: string }
  | { kind: "link"; url: string }
  | { kind: "unavailable" };

// One whole sentence per count combination, because translations inflect the noun and the clause together.
const NATIVE_SUMMARY_KEYS = {
  emojis: {
    one: "emojis_usable_one",
    oneUninitialized: "emojis_usable_one_uninitialized",
    many: "emojis_usable",
    manyOneUninitialized: "emojis_usable_uninitialized_one",
    manyUninitialized: "emojis_usable_uninitialized",
  },
  stickers: {
    one: "stickers_usable_one",
    oneUninitialized: "stickers_usable_one_uninitialized",
    many: "stickers_usable",
    manyOneUninitialized: "stickers_usable_uninitialized_one",
    manyUninitialized: "stickers_usable_uninitialized",
  },
} as const;

export function resolveExpressionsSelection(
  data: ExpressionsPanelData,
  category: ExpressionCategory,
  page: number,
  selectedId: string,
) {
  const items = data[category];
  const pageSize = category === "customs" ? 24 : 25;
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const visible = items.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  return {
    page: currentPage,
    pageCount,
    visible,
    selected: visible.find((item) => item.id === selectedId) ?? visible[0],
  };
}

export function buildExpressionsPanelPayload(input: {
  locale: string;
  category: ExpressionCategory;
  page: number;
  selectedId: string;
  personaPage: number;
  data: ExpressionsPanelData;
  usageCount: number | null;
  receipt?: PanelReceipt;
  confirmDelete?: boolean;
  preview?: ExpressionPanelPreview;
}): { components: TopLevelComponentData[]; flags: MessageFlags.IsComponentsV2 } {
  const { locale, category, data } = input;
  const t = (key: string, vars?: Record<string, string | number>) =>
    localizer(locale, `commands.expressions.manage.${key}`, vars);
  const { page, pageCount, visible, selected } = resolveExpressionsSelection(
    data,
    category,
    input.page,
    input.selectedId,
  );
  const personaPage = Math.min(input.personaPage, Math.max(0, Math.ceil(data.personas.length / 25) - 1));
  const route: ExpressionsPanelRoute = {
    action: "view",
    locale,
    category,
    page,
    entityId: selected?.id ?? "none",
    fp: selected?.fp ?? "none",
    personaPage,
    nonce: "none",
  };
  const button = (
    action: ExpressionsPanelRoute["action"],
    key: string,
    disabled = false,
    danger = false,
  ): InteractionButtonComponentData => ({
    type: ComponentType.Button as const,
    style: danger ? ButtonStyle.Danger : ButtonStyle.Secondary,
    customId: buildExpressionsRouteId({ ...route, action }),
    label: t(key),
    disabled,
  });
  const components: ComponentInContainerData[] = [
    buildCategoryButtonRow(
      EXPRESSION_CATEGORIES.map((value) => ({
        id: value,
        label: t(value),
        customId: buildExpressionsRouteId({
          ...route,
          category: value,
          page: 0,
          entityId: "none",
          fp: "none",
          personaPage: 0,
        }),
      })),
      category,
    ),
    { type: ComponentType.Separator, divider: true, spacing: 1 },
    { type: ComponentType.TextDisplay, content: `## ${t("title")}` },
  ];
  if (category === "customs") {
    const count = data.customs.length;
    components.push({
      type: ComponentType.TextDisplay,
      content:
        count === 0 ? t("custom_count_none") : count === 1 ? t("custom_count_one") : t("custom_count", { count }),
    });
  } else if (data[category].length) {
    const usable = data[category].filter((item) => item.usable);
    const pending = usable.filter((item) => !item.initialized).length;
    const keys = NATIVE_SUMMARY_KEYS[category];
    const summaryKey =
      usable.length === 1
        ? pending
          ? keys.oneUninitialized
          : keys.one
        : pending === 0
          ? keys.many
          : pending === 1
            ? keys.manyOneUninitialized
            : keys.manyUninitialized;
    const lines = [t(summaryKey, { count: usable.length, uninitialized: pending })];
    if (pending) lines.push(t(pending === 1 ? "initialize_hint_one" : "initialize_hint"));
    components.push({ type: ComponentType.TextDisplay, content: lines.join("\n") });
  }
  if (category === "customs" || visible.length) {
    components.push({
      type: ComponentType.ActionRow,
      components: [
        {
          type: ComponentType.StringSelect,
          customId: buildExpressionsRouteId({ ...route, action: "select" }),
          placeholder: t(category === "customs" ? "select_custom" : "select"),
          options: [
            ...(category === "customs" ? [{ label: t("add"), value: "add" }] : []),
            ...visible.map((item) => ({
              label: safeSelectOptionText(item.name, 100),
              value: item.id,
              default: item.id === selected?.id,
            })),
          ],
        },
      ],
    });
  } else
    components.push({
      type: ComponentType.TextDisplay,
      content: t(category === "emojis" ? "empty_emojis" : "empty_stickers"),
    });
  const pagination = buildPaginationRow({
    locale,
    namespace: EXPRESSIONS_ROUTE_NAMESPACE,
    version: EXPRESSIONS_ROUTE_VERSION,
    rangeIndex: page,
    rangeCount: pageCount,
    buildSegments: {
      page: (next) =>
        buildExpressionsRouteSegments({ ...route, action: "page", page: next, entityId: "none", fp: "none" }),
    },
  });
  if (pagination) components.push(pagination);
  if (selected) {
    const preview = (text: string, limit: number) => {
      const result = buildTextPreview(escapeDiscordMarkdown(text), limit);
      const footer = textPreviewFooterKey(result);
      return result.text + (footer ? `\n-# ${localizer(locale, footer, textPreviewFooterVars(result, locale))}` : "");
    };
    const details = [
      t("name_value", { value: preview(selected.name, 160) }),
      t("description_value", { value: selected.initialized ? preview(selected.description, 1000) : t("unset") }),
      t("emotion_value", { value: selected.initialized ? selected.emotion : t("unset") }),
      t("usage_value", { count: input.usageCount ?? t("count_unknown") }),
    ];
    if (selected.custom)
      details.push(
        t("format_value", {
          value:
            selected.custom.source_kind === "link"
              ? t("link")
              : `${selected.custom.extension} (${t(selected.custom.mime_type?.startsWith("video/") ? "video" : "image")})`,
        }),
      );
    components.push(
      buildOptionalThumbnailSection(
        { type: ComponentType.TextDisplay, content: details.map((line) => `> ${line}`).join("\n") },
        category === "customs" ? undefined : selected.thumbnail,
      ),
    );
    if (category === "customs" && input.confirmDelete) {
      components.push(
        { type: ComponentType.TextDisplay, content: t("delete_prompt") },
        {
          type: ComponentType.ActionRow,
          components: [button("confirm", "confirm_delete", false, true), button("view", "cancel")],
        },
      );
    } else {
      components.push({
        type: ComponentType.ActionRow,
        components: [
          button("edit", category === "customs" ? "edit_custom" : "edit"),
          category === "customs"
            ? button("delete", "delete", false, true)
            : button(
                "clear",
                "clear",
                !selected.description && (!selected.emotion || selected.emotion === "unset"),
                true,
              ),
        ],
      });
    }
    if (selected.custom && !input.confirmDelete) {
      const row = selected.custom;
      const allowed = data.personas.filter((persona) => row.persona_ids.includes(persona.id));
      const allowedNames = allowed.map((persona) => persona.name).join(", ");
      const whitelistText = !row.restricted
        ? t("unrestricted")
        : !allowed.length
          ? t("restricted_empty")
          : t("restricted", { personas: preview(allowedNames, 800) });
      components.push({ type: ComponentType.TextDisplay, content: `### ${t("whitelist")}\n${whitelistText}` });
      const personaSlice = data.personas.slice(personaPage * 25, (personaPage + 1) * 25);
      components.push({
        type: ComponentType.ActionRow,
        components: [
          button("add-persona", "add_persona", !personaSlice.some((persona) => !row.persona_ids.includes(persona.id))),
          button(
            "remove-persona",
            "remove_persona",
            !personaSlice.some((persona) => row.persona_ids.includes(persona.id)),
          ),
        ],
      });
      const personaPagination = buildPaginationRow({
        locale,
        namespace: EXPRESSIONS_ROUTE_NAMESPACE,
        version: EXPRESSIONS_ROUTE_VERSION,
        rangeIndex: personaPage,
        rangeCount: Math.ceil(data.personas.length / 25),
        buildSegments: {
          page: (next) => buildExpressionsRouteSegments({ ...route, action: "persona-page", personaPage: next }),
        },
      });
      if (personaPagination)
        components.push({ type: ComponentType.TextDisplay, content: t("persona_pages") }, personaPagination);
    }
  }
  components.push({ type: ComponentType.TextDisplay, content: `-# ${t("stats_hint")}` });
  if (category === "customs" && selected && input.preview) {
    if (input.preview.kind === "gallery") {
      components.push({ type: ComponentType.MediaGallery, items: [{ media: { url: input.preview.url } }] });
    } else if (input.preview.kind === "link") {
      components.push({
        type: ComponentType.ActionRow,
        components: [
          { type: ComponentType.Button, style: ButtonStyle.Link, label: t("open_link"), url: input.preview.url },
        ],
      });
    } else {
      components.push({ type: ComponentType.TextDisplay, content: t("preview_unavailable") });
    }
  }
  return {
    components: [
      buildPanelContainer(components),
      ...(input.receipt ? [buildPanelReceiptContainer(input.receipt)] : []),
    ],
    flags: MessageFlags.IsComponentsV2,
  };
}

export function buildExpressionsTerminalPayload(locale: string, key: string) {
  return {
    components: [buildPanelContainer([{ type: ComponentType.TextDisplay, content: localizer(locale, key) }])],
    flags: MessageFlags.IsComponentsV2 as const,
    attachments: [],
  };
}

export function buildExpressionsEditModal(route: ExpressionsPanelRoute, selected?: ExpressionPanelItem) {
  const t = (key: string) => localizer(route.locale, `commands.expressions.manage.${key}`);
  const field = (
    name: "name" | "description" | "emotion" | "link" | "file",
    component: RawDiscordComponent,
    description?: string,
  ): RawDiscordComponent => ({
    type: 18,
    label: t(`${name}_label`),
    ...(description ? { description } : {}),
    component: { ...component, custom_id: expressionFieldId(route.nonce, name) },
  });
  const keys = getManualEditEmotionKeys();
  if (selected && isValidEmotionKey(selected.emotion) && !keys.includes(selected.emotion))
    keys.splice(keys.length - 1, 1, selected.emotion);
  const components: RawDiscordComponent[] = [];
  if (route.category === "customs")
    components.push(
      field("name", {
        type: 4,
        style: TextInputStyle.Short,
        required: true,
        max_length: 100,
        value: selected?.name ?? "",
      }),
    );
  components.push(
    field(
      "description",
      { type: 4, style: TextInputStyle.Paragraph, required: true, max_length: 500, value: selected?.description ?? "" },
      t("description_help"),
    ),
    field("emotion", {
      type: 3,
      required: true,
      options: keys.map((key) => ({
        label: key.charAt(0).toUpperCase() + key.slice(1),
        value: key,
        default: selected?.emotion === key,
      })),
    }),
  );
  if (route.category === "customs")
    components.push(
      field(
        "link",
        { type: 4, style: TextInputStyle.Short, required: false, max_length: 2000 },
        t(selected ? "link_replace_help" : "link_help"),
      ),
      field(
        "file",
        { type: 19, required: false, min_values: 0, max_values: 1 },
        t(selected ? "file_replace_help" : "file_help"),
      ),
    );
  return {
    custom_id: buildExpressionsRouteId({ ...route, action: "save" }),
    title: safeSelectOptionText(t(selected ? "edit_title" : "add_title"), 45),
    components,
  };
}

export function buildExpressionPersonaModal(
  route: ExpressionsPanelRoute,
  personas: ExpressionsPanelData["personas"],
  add: boolean,
) {
  const t = (key: string) => localizer(route.locale, `commands.expressions.manage.${key}`);
  return {
    custom_id: buildExpressionsRouteId({ ...route, action: add ? "allow" : "deny" }),
    title: safeSelectOptionText(t(add ? "add_persona" : "remove_persona"), 45),
    components: [
      {
        type: 18,
        label: t("persona_label"),
        component: {
          type: 3,
          custom_id: expressionFieldId(route.nonce, "persona"),
          required: true,
          options: personas.map((persona) => ({
            label: safeSelectOptionText(persona.name, 100),
            value: String(persona.id),
          })),
        },
      },
    ] satisfies RawDiscordComponent[],
  };
}
