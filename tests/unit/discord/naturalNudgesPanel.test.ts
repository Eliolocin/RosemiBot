import { beforeAll, describe, expect, it } from "bun:test";
import {
  EPISODE_FREQUENCY_LEVELS,
  NATURAL_NUDGE_CATEGORIES,
  defaultServerNaturalNudgeConfig,
} from "@/modules/natural-nudges/db/types";
import type { NaturalNudgesSettingsView } from "@/modules/natural-nudges/discord/operations";
import {
  NUDGE_EPISODE_CATEGORY_FIELD,
  buildEpisodeModal,
  buildNaturalNudgesSettingsBody,
} from "@/modules/natural-nudges/discord/panel";
import { buildConfigRouteId } from "@/utils/discord/configPanelCatalog";
import { buildConfigModalFieldId } from "@/utils/discord/ui/configModals";
import { initializeLocalizer } from "@/utils/text/localizer";
import { localizedCopy } from "../../helpers/localeCases";

const LOCALE = "en-US";
const NONCE = "nonce1234567";
const CHANNEL_ID = "111111111111111111";
const CHAT_MODEL_LABEL = "chat-model (OpenRouter)";
const PLANNER_MODEL_LABEL = "planner-model (OpenRouter)";

const t = (key: string, variables: Record<string, string | number> = {}): string =>
  localizedCopy(LOCALE, key, variables);

const ROUTE_IDS = {
  channels: buildConfigRouteId({ action: "nudge-channels-select", locale: LOCALE }),
  idleFrequency: buildConfigRouteId({ action: "nudge-frequency-select", locale: LOCALE }),
  activeFrequency: buildConfigRouteId({ action: "nudge-chime-in-frequency-select", locale: LOCALE }),
  provider: buildConfigRouteId({ action: "nudge-provider", locale: LOCALE }),
};

const FREQUENCY_KEYS: Record<number, string> = {
  0: "commands.config.natural_nudges.frequency_0",
  1: "commands.config.natural_nudges.frequency_1",
  2: "commands.config.natural_nudges.frequency_2",
  3: "commands.config.natural_nudges.frequency_3",
};

const CATEGORY_KEYS = {
  reach_out: "commands.config.natural_nudges.category_reach_out",
  revive: "commands.config.natural_nudges.category_revive",
  new_topic: "commands.config.natural_nudges.category_new_topic",
  alter_talk: "commands.config.natural_nudges.category_alter_talk",
} as const;

interface Observed {
  type: number;
  customId?: string;
  content?: string;
  label?: string;
  placeholder?: string;
  description?: string;
  options?: Array<{ label?: string; value?: string }>;
}

/** Modal field labels carry their description; the select they wrap carries the options. */
const MODAL_LABEL_TYPE = 18;

function walk(value: unknown): Observed[] {
  if (Array.isArray(value)) return value.flatMap(walk);
  if (typeof value !== "object" || value === null) return [];
  const record = value as Record<string, unknown>;
  const here: Observed[] =
    typeof record.type === "number"
      ? [
          {
            type: record.type,
            customId:
              typeof record.customId === "string"
                ? record.customId
                : typeof record.custom_id === "string"
                  ? record.custom_id
                  : undefined,
            content: typeof record.content === "string" ? record.content : undefined,
            label: typeof record.label === "string" ? record.label : undefined,
            placeholder: typeof record.placeholder === "string" ? record.placeholder : undefined,
            description: typeof record.description === "string" ? record.description : undefined,
            options: Array.isArray(record.options)
              ? record.options.map((option) => {
                  const choice = option as Record<string, unknown>;
                  return {
                    label: typeof choice.label === "string" ? choice.label : undefined,
                    value: typeof choice.value === "string" ? choice.value : undefined,
                  };
                })
              : undefined,
          },
        ]
      : [];
  return [...here, ...Object.values(record).flatMap(walk)];
}

function makeView(overrides: Partial<NaturalNudgesSettingsView> = {}): NaturalNudgesSettingsView {
  return {
    config: { ...defaultServerNaturalNudgeConfig(1), channel_disc_ids: [CHANNEL_ID] },
    runtime: { server_id: 1, episode_jitter: 1, consecutive_failures: 0, stopped_at: null },
    plannerModels: [{ provider: "openrouter", models: [{ id: 7, name: "planner-model", description: null }] }],
    trackingEnabled: true,
    heat: 120,
    perDay: 2,
    chimeInRange: { min: 40, max: 80 },
    status: {
      effectiveChannelIds: [CHANNEL_ID],
      plannerModel: { kind: "ready", llmId: 7, source: "chat" },
      chatModel: { codename: "chat-model", provider: "openrouter" },
      matcher: { kind: "decision", model: "decision-model" },
    },
    ...overrides,
  };
}

const modelSectionText = (): string =>
  `### ${t("commands.config.natural_nudges.model_title")}\n${t("commands.config.natural_nudges.model_description")}`;

beforeAll(async () => {
  await initializeLocalizer();
});

describe("Natural Nudges settings panel", () => {
  it("orders the shared channel section, both modes, and the model last", () => {
    const body = buildNaturalNudgesSettingsBody(LOCALE, makeView(), false, false);
    const seen = walk(body);
    const headingAt = (key: string) => seen.findIndex((component) => component.content?.startsWith(`### ${t(key)}`));

    const order = [
      seen.findIndex((component) => component.content?.startsWith(`## ${t("commands.config.natural_nudges.title")}`)),
      headingAt("commands.config.natural_nudges.channels_title"),
      seen.findIndex((component) => component.customId === ROUTE_IDS.channels),
      headingAt("commands.config.natural_nudges.episodes_title"),
      seen.findIndex((component) => component.customId === ROUTE_IDS.idleFrequency),
      headingAt("commands.config.natural_nudges.chime_ins_title"),
      seen.findIndex((component) => component.customId === ROUTE_IDS.activeFrequency),
      headingAt("commands.config.natural_nudges.model_title"),
    ];

    expect(order.every((index) => index >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((left, right) => left - right));
    expect(seen.findIndex((component) => component.customId === ROUTE_IDS.provider)).toBeGreaterThan(order[7]);
  });

  it("labels both frequency selects through the same key", () => {
    const body = buildNaturalNudgesSettingsBody(LOCALE, makeView(), false, false);
    const seen = walk(body);
    const expected = EPISODE_FREQUENCY_LEVELS.map((level) =>
      t("commands.config.natural_nudges.chime_in_frequency_option", { level: t(FREQUENCY_KEYS[level]) }),
    );

    for (const customId of [ROUTE_IDS.idleFrequency, ROUTE_IDS.activeFrequency]) {
      const select = seen.find((component) => component.customId === customId);
      expect(select?.options?.map((option) => option.label)).toEqual(expected);
    }
  });

  it("carries the current model in the select placeholder instead of a quote row", () => {
    const defaultBody = buildNaturalNudgesSettingsBody(LOCALE, makeView(), false, false);
    const defaultSeen = walk(defaultBody);
    const defaultSelect = defaultSeen.find((component) => component.customId === ROUTE_IDS.provider);

    expect(defaultSelect?.placeholder).toBe(
      t("commands.config.natural_nudges.model_same_as_chat", { model: CHAT_MODEL_LABEL }),
    );
    expect(defaultSeen.some((component) => component.content === modelSectionText())).toBe(true);
    expect(defaultSeen.some((component) => component.content?.startsWith("-# "))).toBe(false);

    const pinnedBody = buildNaturalNudgesSettingsBody(
      LOCALE,
      makeView({ config: { ...defaultServerNaturalNudgeConfig(1), llm_id: 7, channel_disc_ids: [CHANNEL_ID] } }),
      false,
      false,
    );
    const pinnedSelect = walk(pinnedBody).find((component) => component.customId === ROUTE_IDS.provider);
    expect(pinnedSelect?.placeholder).toBe(
      t("commands.config.natural_nudges.model_placeholder_selected", { model: PLANNER_MODEL_LABEL }),
    );
    expect(pinnedSelect?.options?.[0]?.label).toBe(t("commands.config.natural_nudges.model_same_as_chat_option"));
  });

  it("explains an unusable default or a server with no structured model in one footnote", () => {
    const unusableDefault = buildNaturalNudgesSettingsBody(
      LOCALE,
      makeView({
        status: {
          effectiveChannelIds: [CHANNEL_ID],
          plannerModel: { kind: "unusable", llmId: 9, source: "chat", reason: "no_structured_output" },
          chatModel: { codename: "chat-model", provider: "openrouter" },
          matcher: { kind: "decision", model: "decision-model" },
        },
      }),
      false,
      false,
    );
    expect(walk(unusableDefault).filter((component) => component.content?.startsWith("-# "))).toEqual([
      expect.objectContaining({
        content: `-# ${t("commands.config.natural_nudges.model_chat_no_structured", { model: CHAT_MODEL_LABEL })}`,
      }),
    ]);

    const noStructuredModels = buildNaturalNudgesSettingsBody(LOCALE, makeView({ plannerModels: [] }), false, false);
    const noStructuredSeen = walk(noStructuredModels);
    expect(noStructuredSeen.some((component) => component.customId === ROUTE_IDS.provider)).toBe(false);
    expect(noStructuredSeen.filter((component) => component.content?.startsWith("-# "))).toEqual([
      expect.objectContaining({ content: `-# ${t("commands.config.natural_nudges.model_none_available")}` }),
    ]);
  });

  it("labels the custom episode category choices by category key", () => {
    const modal = buildEpisodeModal(LOCALE, NONCE, null);
    const seen = walk(modal);
    const categoryField = seen.find(
      (component) =>
        component.type === MODAL_LABEL_TYPE &&
        component.label === t("commands.config.natural_nudges.episode_category_label"),
    );
    const categorySelect = seen.find(
      (component) => component.customId === buildConfigModalFieldId(NUDGE_EPISODE_CATEGORY_FIELD, NONCE),
    );

    expect(categoryField?.description).toBe(t("commands.config.natural_nudges.episode_category_description"));
    expect(categorySelect?.options?.map((option) => option.label)).toEqual(
      NATURAL_NUDGE_CATEGORIES.map((category) => t(CATEGORY_KEYS[category])),
    );
    expect(categorySelect?.options?.map((option) => option.value)).toEqual([...NATURAL_NUDGE_CATEGORIES]);
  });
});
