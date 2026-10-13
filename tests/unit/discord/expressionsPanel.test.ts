import { beforeAll, describe, expect, it } from "bun:test";
import { ComponentType } from "discord.js";
import {
  buildExpressionsEditModal,
  buildExpressionsPanelPayload,
  buildExpressionPersonaModal,
  type ExpressionsPanelData,
} from "@/utils/discord/ui/expressionsPanel";
import {
  buildExpressionsRouteId,
  parseExpressionsPanelRoute,
  type ExpressionsPanelRoute,
} from "@/utils/discord/expressionsPanelCatalog";
import { parseInteractionRoute } from "@/utils/discord/interactions/routeRegistry";
import { EmotionKey } from "@/types/misc/emotions";
import type { RawDiscordComponent } from "@/types/discord/rawApiTypes";
import { initializeLocalizer } from "@/utils/text/localizer";
import { createCustomExpression } from "../../helpers/fixtures";
import { expectForEveryLocale, localizedCopy, localizedProse } from "../../helpers/localeCases";
import { collectTextDisplays, expectSafePanelPayload } from "../../helpers/panelLimits";

beforeAll(async () => initializeLocalizer());

function data(size: number): ExpressionsPanelData {
  const customs = Array.from({ length: size }, (_, index) => {
    const row = createCustomExpression({
      custom_expression_id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      name: `Expression ${index}`,
      description: "`long description` ".repeat(25).slice(0, 500),
      restricted: true,
      persona_ids: Array.from({ length: 70 }, (_, i) => i + 1),
    });
    return {
      id: row.custom_expression_id,
      name: row.name,
      description: row.description,
      emotion: row.emotion_key,
      initialized: true,
      usable: true,
      fp: "abcd1234",
      revision: row.revision,
      custom: row,
      thumbnail: row.original_link ?? undefined,
    };
  });
  const native = customs.map(({ custom: _custom, ...item }, index) => ({
    ...item,
    id: String(123456789012345600n + BigInt(index)),
    initialized: index % 2 === 0,
    usable: index % 3 !== 0,
  }));
  return {
    serverId: 1,
    emojis: native,
    stickers: native,
    customs,
    personas: Array.from({ length: 70 }, (_, index) => ({ id: index + 1, name: "`Persona` ".repeat(10) })),
  };
}

const baseRoute: ExpressionsPanelRoute = {
  action: "edit",
  locale: "en-US",
  category: "customs",
  page: 0,
  entityId: "00000000-0000-4000-8000-000000000001",
  fp: "abcd1234",
  personaPage: 0,
  nonce: "abcdef123456",
};

describe("expressions manager panel", () => {
  it("stays within message limits across locales, page boundaries, empty states, confirmations, and receipts", () => {
    expectForEveryLocale((locale) => {
      for (const count of [0, 1, 24, 25, 49]) {
        for (const category of ["emojis", "stickers", "customs"] as const) {
          for (const preview of [
            { kind: "gallery", url: "attachment://expression-preview.mp4" },
            { kind: "link", url: "https://tenor.com/view/wave-gif-12345" },
            { kind: "unavailable" },
          ] as const) {
            for (const [confirmDelete, page] of [
              [false, 0],
              [false, 1],
              [true, 0],
              [true, 1],
            ] as const) {
              const payload = buildExpressionsPanelPayload({
                locale,
                category,
                page,
                selectedId: "none",
                personaPage: page,
                data: data(count),
                usageCount: null,
                confirmDelete,
                preview,
                receipt: {
                  tone: "success",
                  heading: localizedCopy("en-US", "commands.expressions.manage.saved_title"),
                  detail: localizedCopy("en-US", "commands.expressions.manage.saved_detail"),
                },
              });
              expectSafePanelPayload(payload, `${locale}:${category}:${count}:${confirmDelete}:${page}`);
            }
          }
        }
      }
    });
  });

  it("places the custom gallery last and keeps native thumbnails", () => {
    const rows = data(1);
    for (const category of ["emojis", "stickers", "customs"] as const) {
      const payload = buildExpressionsPanelPayload({
        locale: "en-US",
        category,
        page: 0,
        selectedId: "none",
        personaPage: 0,
        data: rows,
        usageCount: 0,
        preview: { kind: "gallery", url: "attachment://expression-preview.mp4" },
      });
      const container = JSON.parse(JSON.stringify(payload.components[0])) as RawDiscordComponent;
      const sections = container.components?.filter((item) => item.type === ComponentType.Section);
      if (category === "customs") {
        expect(sections).toHaveLength(0);
        expect(container.components?.at(-1)?.type).toBe(ComponentType.MediaGallery);
      } else {
        expect(sections?.[0]).toMatchObject({ accessory: { type: ComponentType.Thumbnail } });
        expect(container.components?.some((item) => item.type === ComponentType.MediaGallery)).toBe(false);
      }
    }
  });

  it("reserves an Add slot on every custom page and never marks the action selected", () => {
    const rows = data(49);
    for (const page of [0, 1, 2]) {
      const payload = buildExpressionsPanelPayload({
        locale: "en-US",
        category: "customs",
        page,
        selectedId: "none",
        personaPage: 0,
        data: rows,
        usageCount: 23,
      });
      const container = JSON.parse(JSON.stringify(payload.components[0])) as RawDiscordComponent;
      const menu = container.components
        ?.flatMap((component) => component.components ?? [])
        .find((item) => item.type === ComponentType.StringSelect);
      expect(menu?.options?.[0]).toMatchObject({ value: "add" });
      expect(menu?.options?.[0]?.default).toBeFalsy();
      expect(menu?.options?.length).toBeLessThanOrEqual(25);
      expect(menu?.options?.length).toBe(page === 2 ? 2 : 25);
    }
  });

  it("shows a restricted-empty whitelist explicitly and retains valid saved emotions in the five-field editor", () => {
    const rows = data(1);
    rows.customs[0].custom = createCustomExpression({
      restricted: true,
      persona_ids: [],
      emotion_key: EmotionKey.GRIEF,
    });
    rows.customs[0].emotion = EmotionKey.GRIEF;
    const payload = buildExpressionsPanelPayload({
      locale: "en-US",
      category: "customs",
      page: 0,
      selectedId: rows.customs[0].id,
      personaPage: 0,
      data: rows,
      usageCount: null,
    });
    expect(collectTextDisplays(payload).join(" ")).toMatch(
      localizedProse("en-US", "commands.expressions.manage.restricted_empty"),
    );
    const modal = buildExpressionsEditModal(baseRoute, rows.customs[0]);
    expect(modal.components).toHaveLength(5);
    const emotion = modal.components.find((component) => component.component?.type === 3)?.component;
    expect(emotion?.options?.length).toBeLessThanOrEqual(25);
    expect(emotion?.options?.filter((option) => option.default).map((option) => option.value)).toEqual([
      EmotionKey.GRIEF,
    ]);
    expect(modal.components[0].component?.value).toBe(rows.customs[0].name);
    expect(modal.components[1].component?.value).toBe(rows.customs[0].description);
    expect(modal.components[3].component?.value).toBeUndefined();
  });

  it("keeps IDs bounded and routes entity IDs and persona pages without names", () => {
    const customId = buildExpressionsRouteId({ ...baseRoute, page: 99999, personaPage: 99999 });
    expect(customId.length).toBeLessThanOrEqual(100);
    const parsed = parseInteractionRoute(customId);
    expect(parsed && parseExpressionsPanelRoute(parsed)).toEqual({ ...baseRoute, page: 99999, personaPage: 99999 });
    const modal = buildExpressionPersonaModal(baseRoute, data(1).personas.slice(25, 50), true);
    expect(modal.components[0].component.options).toHaveLength(25);
  });
});
