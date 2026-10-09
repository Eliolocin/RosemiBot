import { createHash } from "node:crypto";
import {
  ButtonStyle,
  ComponentType,
  type ActionRowData,
  type ButtonComponentData,
  type ComponentInContainerData,
  type ContainerComponentData,
  type SelectMenuComponentOptionData,
  type TextDisplayComponentData,
} from "discord.js";
import type { PanelReceipt } from "@/types/discord/panel";
import { buildInteractionRouteId } from "@/utils/discord/interactions/routeRegistry";
import { formatPanelComponentTree } from "@/utils/discord/ui/panelProse";
import { ColorCode } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";

const PANEL_ACCENT_BY_TONE = {
  success: 0x57f287,
  warning: 0xfee75c,
  error: 0xed4245,
  info: 0x65c6c5,
} as const;

export type PanelAccentTone = keyof typeof PANEL_ACCENT_BY_TONE;

/** An accent color in any of the shapes callers already hold: a decimal, a hex string, or RGB. */
export type AccentColorInput = string | number | readonly [red: number, green: number, blue: number];

/**
 * Normalizes an accent color to the decimal form Discord's payloads carry.
 *
 * Unparseable input falls back to the info accent rather than throwing, so a caller passing a
 * named color or a malformed hex still renders a card.
 */
export function resolveAccentColor(color?: AccentColorInput): number {
  if (typeof color === "number") {
    return color;
  }

  if (typeof color === "string") {
    const normalized = color.trim().replace("#", "");
    if (/^[0-9a-fA-F]{6}$/.test(normalized)) {
      return Number.parseInt(normalized, 16);
    }
  }

  if (Array.isArray(color) && color.length === 3) {
    const [red, green, blue] = color;
    return (red << 16) + (green << 8) + blue;
  }

  return Number.parseInt(ColorCode.INFO.replace("#", ""), 16);
}

export interface PaginationRouteSegments {
  page: (rangeIndex: number) => string[];
}

/**
 * Applies a Discord line marker to every line of `text`.
 *
 * The runtime formatter repeats markers on visual continuation lines. This helper remains useful
 * when callers assemble several semantic rows before the component tree reaches that boundary.
 */
export function withLinePrefix(prefix: string, text: string): string {
  return text
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

export interface BuildPanelContainerOptions {
  /**
   * Whether to apply panel layout wrapping across TextDisplay components.
   * Defaults to true. Notice cards disable this because they act as embed
   * replacements rather than interactive grid panels.
   */
  formatProse?: boolean;
}

export function buildPanelContainer(
  components: ComponentInContainerData[],
  accent?: number | PanelAccentTone,
  options?: BuildPanelContainerOptions,
): ContainerComponentData<ComponentInContainerData> {
  const accentColor = typeof accent === "string" ? PANEL_ACCENT_BY_TONE[accent] : (accent ?? PANEL_ACCENT_BY_TONE.info);
  const shouldFormatProse = options?.formatProse ?? true;
  return {
    type: ComponentType.Container,
    accentColor,
    components: shouldFormatProse ? formatPanelComponentTree(components) : components,
  };
}

export function buildOptionalThumbnailSection(
  heading: TextDisplayComponentData,
  thumbnailUrl?: string | null,
): ComponentInContainerData {
  return thumbnailUrl
    ? {
        type: ComponentType.Section,
        components: [heading],
        accessory: { type: ComponentType.Thumbnail, media: { url: thumbnailUrl } },
      }
    : heading;
}

export function buildPanelReceiptContainer(receipt: PanelReceipt): ContainerComponentData<ComponentInContainerData> {
  return buildPanelContainer(
    [
      {
        type: ComponentType.TextDisplay,
        content: `### ${receipt.heading}\n> ${receipt.detail}${receipt.metadata ? `\n-# ${receipt.metadata}` : ""}`,
      },
    ],
    receipt.tone,
  );
}

export function buildCategoryButtonRow<TCategory extends string>(
  categories: readonly { id: TCategory; label: string; customId: string }[],
  activeCategory: TCategory,
  disabled = false,
): ActionRowData<ButtonComponentData> {
  return {
    type: ComponentType.ActionRow,
    components: categories.map((cat) => ({
      type: ComponentType.Button,
      style: cat.id === activeCategory ? ButtonStyle.Primary : ButtonStyle.Secondary,
      customId: cat.customId,
      label: cat.label,
      disabled,
    })),
  };
}

export interface StateControlChoice<TValue> {
  value: TValue;
  label: string;
  customId: string;
  available?: boolean;
}

export function buildStateControlRow<TValue>(
  choices: readonly StateControlChoice<TValue>[],
  selectedValue: TValue,
  writesDisabled = false,
): ActionRowData<ButtonComponentData> {
  return {
    type: ComponentType.ActionRow,
    components: choices.map((choice) => {
      const isSelected = choice.value === selectedValue;
      const isAvailable = choice.available !== false;
      return {
        type: ComponentType.Button,
        style: isSelected ? ButtonStyle.Primary : ButtonStyle.Secondary,
        customId: choice.customId,
        label: choice.label,
        disabled: writesDisabled || isSelected || !isAvailable,
      };
    }),
  };
}

export interface RangeSelectOptionsInput {
  /** Total entries the modal has to cover across all of its pages. */
  totalCount: number;
  /** Entries one modal page holds, after any fixed entry the modal reserves for itself. */
  pageSize: number;
  /** Entry index whose range should open marked as current, or null when nothing is stored. */
  selectedIndex?: number | null;
  /** Renders one range's option text from the half-open entry range it covers. */
  describe(startIndex: number, endIndexExclusive: number): { label: string; description?: string };
}

/**
 * Builds one select option per page of a collection a modal has to present in slices.
 *
 * A modal carries no pagination row of its own, and {@link buildPaginationRow} disables the
 * position it is parked on, so a row driving a modal directly can never reopen its own page and
 * those entries stay unreachable. Naming each range as its own option is what keeps every entry
 * selectable. Each option's value is the entry index its page starts at.
 */
export function buildRangeSelectOptions(input: RangeSelectOptionsInput): SelectMenuComponentOptionData[] {
  const pageCount = Math.max(1, Math.ceil(input.totalCount / input.pageSize));
  return Array.from({ length: pageCount }, (_unused, pageIndex) => {
    const start = pageIndex * input.pageSize;
    const end = Math.min(start + input.pageSize, input.totalCount);
    const { label, description } = input.describe(start, end);
    return {
      label,
      value: String(start),
      description,
      default:
        input.selectedIndex !== null && input.selectedIndex !== undefined
          ? input.selectedIndex >= start && input.selectedIndex < end
          : false,
    };
  });
}

export interface PaginationRowOptions {
  locale: string;
  rangeIndex: number;
  rangeCount: number;
  namespace: string;
  version: string;
  buildSegments: PaginationRouteSegments;
  disabled?: boolean;
}

function buildPaginationIndicatorId(pageRouteId: string): string {
  const digest = createHash("sha256").update(`pagination-indicator:${pageRouteId}`).digest("base64url");
  return `pagination-indicator-${digest}`;
}

export function buildPaginationRow(options: PaginationRowOptions): ActionRowData<ButtonComponentData> | null {
  if (options.rangeCount <= 1) return null;

  const rangeIndex = Math.min(Math.max(options.rangeIndex, 0), options.rangeCount - 1);
  const buildCustomId = (targetRangeIndex: number) =>
    buildInteractionRouteId(options.namespace, options.version, ...options.buildSegments.page(targetRangeIndex));
  const indicatorCustomId = buildPaginationIndicatorId(buildCustomId(rangeIndex));

  return {
    type: ComponentType.ActionRow,
    components: [
      {
        type: ComponentType.Button,
        style: ButtonStyle.Secondary,
        customId: buildCustomId(Math.max(0, rangeIndex - 1)),
        label: localizer(options.locale, "general.pagination.previous"),
        disabled: options.disabled || rangeIndex === 0,
      },
      {
        type: ComponentType.Button,
        style: ButtonStyle.Secondary,
        customId: indicatorCustomId,
        label: localizer(options.locale, "general.pagination.page_info", {
          current: rangeIndex + 1,
          total: options.rangeCount,
        }),
        disabled: true,
      },
      {
        type: ComponentType.Button,
        style: ButtonStyle.Secondary,
        customId: buildCustomId(Math.min(options.rangeCount - 1, rangeIndex + 1)),
        label: localizer(options.locale, "general.pagination.next"),
        disabled: options.disabled || rangeIndex === options.rangeCount - 1,
      },
    ],
  };
}
