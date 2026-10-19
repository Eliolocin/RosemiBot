import { beforeAll, describe, expect, it } from "bun:test";
import type { GuildMcpServerRow, PersonalMemoryRow, ServerMemoryRow, StPresetRow } from "@/types/db/schema";
import { PrivacyLevel } from "@/types/db/schema";
import type { PanelReceipt } from "@/types/discord/panel";
import type { ProviderPanelEntry } from "@/types/discord/providerPanel";
import type { DocumentChunkRow, DocumentListRow } from "@/utils/discord/interactions/memoriesDocumentOperations";
import { CONFIG_ST_PRESETS_PANEL_ROUTE_ADAPTER } from "@/utils/discord/configPanelCatalog";
import { PROVIDERS_ROUTE_NAMESPACE } from "@/utils/discord/providersPanelCatalog";
import {
  type ComponentsV2MessagePayload,
  DISCORD_MESSAGE_TEXT_DISPLAY_TOTAL_MAX,
  getDiscordTextLength,
} from "@/utils/discord/ui/componentsV2Limits";
import { MAX_MCP_PANEL_PAGE_SIZE } from "@/utils/discord/ui/mcpsPanel";
import { buildMemoriesPanelPayload } from "@/utils/discord/ui/memoriesPanel";
import { buildPersonalMemoriesPanelPayload } from "@/utils/discord/ui/personalMemoriesPanel";
import { buildProvidersPanelPayload, PROVIDERS_ENTRIES_PER_SELECTOR_PAGE } from "@/utils/discord/ui/providersPanel";
import { buildStPresetsPanelPayload, MAX_PRESETS_PER_SELECTOR_PAGE } from "@/utils/discord/ui/stPresetsPanel";
import { MAX_PRESET_NAME_LENGTH } from "@/utils/stPreset/stPresetImportParser";
import { initializeLocalizer } from "@/utils/text/localizer";
import { createPersona } from "../../helpers/fixtures";
import { collectCaseFailures, RUNTIME_LOCALES } from "../../helpers/localeCases";
import { collectTextDisplays, expectSafePanelPayload } from "../../helpers/panelLimits";
import { buildConfigMcpPagePayload } from "../../helpers/configMcpPage";

beforeAll(async () => initializeLocalizer());

/**
 * Builds one payload from one panel at one locale and receipt state.
 *
 * These rows are the cases that differ only in their panel builder and the worst-case fixture it is
 * handed, so all of them live here instead of repeating the locale and receipt sweep per panel. A
 * panel whose fixture needs its own composite builder (moderation's scope graph, the setup draft
 * modes, the personal config view inputs, the transfer surfaces) keeps its own suite, because
 * restating that builder here would duplicate more than the case it replaced.
 */
type PanelPayloadBuilder = (locale: string, receipt: PanelReceipt | undefined) => ComponentsV2MessagePayload;

/**
 * A row: the label, the panel's own realistic receipt, and the builder.
 *
 * The receipt travels with the row because the text-display budget depends on its length, so the
 * receipt a panel's suite proved is part of that panel's worst case.
 */
type PanelPayloadRow = [label: string, receipt: PanelReceipt, build: PanelPayloadBuilder];

const MCP_RECEIPT: PanelReceipt = {
  tone: "success",
  heading: "MCP Action Completed Successfully",
  detail: "The MCP registration was saved and its current discovery snapshot was refreshed.",
  metadata: "trace: mcp-op-987654 | actor: 123456789012345678 | elapsed: 48ms",
};

const PRESETS_RECEIPT: PanelReceipt = {
  tone: "success",
  heading: "Preset Action Completed Successfully",
  detail: "The preset was saved and the active prompt-node state was refreshed.",
  metadata: "trace: preset-op-987654 | actor: 123456789012345678 | elapsed: 48ms",
};

const PROVIDERS_RECEIPT: PanelReceipt = {
  tone: "success",
  heading: "Provider Action Completed Successfully",
  detail: "The provider configuration was saved and the current model routing state was refreshed.",
  metadata: "trace: provider-op-987654 | actor: 123456789012345678 | elapsed: 48ms",
};

/** The budget rows measure how much of the cap truncation uses, so their receipt wording is generic. */
const BUDGET_RECEIPT: PanelReceipt = {
  tone: "success",
  heading: "Panel Action Completed Successfully",
  detail: "The stored record was updated and the panel was refreshed with the new preview.",
  metadata: "trace: panel-op-987654 | actor: 123456789012345678 | elapsed: 48ms",
};

/** The single persona the memory panels render against. */
const MAIN_PERSONA = createPersona({ persona_nickname: "Main Persona" });

function oversizedMcpRow(id: number): GuildMcpServerRow {
  return {
    guild_mcp_id: id,
    server_id: 1,
    name: "M".repeat(20_000),
    url: `https://safe-${id}.example.invalid/${"u".repeat(20_000)}`,
    auth_token: Buffer.from("ciphertext"),
    key_version: 9,
    is_enabled: id % 2 === 1,
    server_type: id % 3 === 0 ? "web_search" : null,
    last_discovered_tool_names: [`tool-${id}`, "open_resource"],
    created_at: new Date(id),
  };
}

/** A full MCP page: every stored name and endpoint far past any display budget. */
const OVERSIZED_MCP_CONFIGS: GuildMcpServerRow[] = Array.from({ length: MAX_MCP_PANEL_PAGE_SIZE }, (_, index) =>
  oversizedMcpRow(index + 1),
);

/** A full preset page: every stored name over the import limit and every description 20,000 characters. */
const OVERSIZED_PRESETS: StPresetRow[] = Array.from({ length: MAX_PRESETS_PER_SELECTOR_PAGE }, (_, index) => ({
  preset_id: index + 1,
  server_id: 1,
  preset_name: "P".repeat(MAX_PRESET_NAME_LENGTH + 1),
  raw_json: {},
  is_active: index === 0,
  description: "D".repeat(20_000),
  created_at: new Date(index + 1),
  updated_at: new Date(index + 1),
}));

/**
 * A full provider page whose display names and model codenames are 20,000 characters. The provider
 * key stays short because it is part of every entry route ID, which must fit Discord's 100.
 */
const OVERSIZED_PROVIDER_ENTRIES: ProviderPanelEntry[] = Array.from(
  { length: PROVIDERS_ENTRIES_PER_SELECTOR_PAGE },
  (_, index) => ({
    id: `provider-full-${index + 1}`,
    kind: "provider" as const,
    provider: `provider-${index + 1}`,
    displayName: "P".repeat(20_000),
    savedAt: null,
    rotationKeyCount: 2,
    capabilities: [
      {
        capability: "text" as const,
        availability: "available" as const,
        models: [
          {
            id: index + 1,
            codeName: "M".repeat(20_000),
            isWorkspaceActive: true,
            isWorkspaceFallback: false,
            isProviderFallback: false,
            isCustomRegistration: true,
          },
        ],
      },
    ],
  }),
);

const PROVIDER_ACTIONS = new Set<"add-provider" | "add-endpoint" | "model" | "edit" | "remove">([
  "add-provider",
  "add-endpoint",
  "model",
  "edit",
  "remove",
]);

/** A stored memory at the length the memories panel truncates. */
const MAX_CONTENT_MEMORY: ServerMemoryRow = {
  server_memory_id: 1,
  server_id: 1,
  persona_lineage_id: 100,
  user_id: 1,
  content: "M".repeat(10_000),
  tags: ["important", "guidelines"],
  channel_disc_ids: [],
  channel_scope_pending: false,
  created_at: new Date(),
  updated_at: new Date(),
};

/** A stored document with one preview chunk at the same length. */
const MAX_CONTENT_DOCUMENT: DocumentListRow = {
  document_id: 1,
  document_name: "Document 1.pdf",
  first_chunk: "First chunk preview of document #1",
  channel_disc_ids: [],
  channel_scope_pending: false,
  isHistory: false,
};

const MAX_CONTENT_CHUNK: DocumentChunkRow = {
  document_chunk_id: 1,
  chunk_index: 0,
  content: "D".repeat(10_000),
};

/** A personal memory at the same length, owned by the given lineage so the category filter keeps it. */
function maxContentPersonalMemory(personaLineageId: number): PersonalMemoryRow {
  return {
    personal_memory_id: 1,
    user_id: 1,
    persona_lineage_id: personaLineageId,
    content: "M".repeat(10_000),
    tags: ["preference", "interaction-style"],
    created_at: new Date(),
    updated_at: new Date(),
  };
}

const WORST_CASE_ROWS: PanelPayloadRow[] = [
  [
    "MCP collection page",
    MCP_RECEIPT,
    (locale, receipt) =>
      buildConfigMcpPagePayload({
        locale,
        scope: "guild",
        configs: OVERSIZED_MCP_CONFIGS,
        readStatus: "fresh",
        page: { kind: "collection", rangeIndex: 0 },
        receipt,
      }),
  ],
  [
    "MCP removal page",
    MCP_RECEIPT,
    (locale, receipt) =>
      buildConfigMcpPagePayload({
        locale,
        scope: "guild",
        configs: OVERSIZED_MCP_CONFIGS,
        readStatus: "fresh",
        page: { kind: "remove", entityId: OVERSIZED_MCP_CONFIGS[0]?.guild_mcp_id ?? 1 },
        receipt,
      }),
  ],
  [
    "SillyTavern presets preset page",
    PRESETS_RECEIPT,
    (locale, receipt) =>
      buildStPresetsPanelPayload({
        locale,
        scope: "guild",
        presets: OVERSIZED_PRESETS,
        activePresetId: OVERSIZED_PRESETS[0]?.preset_id ?? null,
        readStatus: "fresh",
        page: { kind: "preset", presetId: OVERSIZED_PRESETS[0]?.preset_id },
        receipt,
        routes: CONFIG_ST_PRESETS_PANEL_ROUTE_ADAPTER,
      }),
  ],
  [
    "SillyTavern presets delete page",
    PRESETS_RECEIPT,
    (locale, receipt) =>
      buildStPresetsPanelPayload({
        locale,
        scope: "guild",
        presets: OVERSIZED_PRESETS,
        activePresetId: OVERSIZED_PRESETS[0]?.preset_id ?? null,
        readStatus: "fresh",
        page: { kind: "delete", presetId: OVERSIZED_PRESETS[0]?.preset_id ?? 1 },
        receipt,
        routes: CONFIG_ST_PRESETS_PANEL_ROUTE_ADAPTER,
      }),
  ],
  [
    "providers entry page",
    PROVIDERS_RECEIPT,
    (locale, receipt) =>
      buildProvidersPanelPayload({
        locale,
        entries: OVERSIZED_PROVIDER_ENTRIES,
        initialEntryId: OVERSIZED_PROVIDER_ENTRIES[0]?.id ?? null,
        readStatus: "fresh",
        page: { kind: "entry", entryId: OVERSIZED_PROVIDER_ENTRIES[0]?.id },
        receipt,
        enabledActions: PROVIDER_ACTIONS,
        routeNamespace: PROVIDERS_ROUTE_NAMESPACE,
      }),
  ],
  [
    "providers removal page",
    PROVIDERS_RECEIPT,
    (locale, receipt) =>
      buildProvidersPanelPayload({
        locale,
        entries: OVERSIZED_PROVIDER_ENTRIES,
        initialEntryId: OVERSIZED_PROVIDER_ENTRIES[0]?.id ?? null,
        readStatus: "fresh",
        page: { kind: "remove", entryId: OVERSIZED_PROVIDER_ENTRIES[0]?.id },
        receipt,
        enabledActions: PROVIDER_ACTIONS,
        routeNamespace: PROVIDERS_ROUTE_NAMESPACE,
      }),
  ],
];

const BUDGET_ROWS: PanelPayloadRow[] = [
  [
    "server memories main page",
    BUDGET_RECEIPT,
    (locale, receipt) =>
      buildMemoriesPanelPayload({
        locale,
        category: "memories",
        selectedLineageId: 100,
        personas: [MAIN_PERSONA],
        memories: [MAX_CONTENT_MEMORY],
        canManage: true,
        readStatus: "fresh",
        page: { kind: "main" },
        receipt,
      }),
  ],
  [
    "server memories removal page",
    BUDGET_RECEIPT,
    (locale, receipt) =>
      buildMemoriesPanelPayload({
        locale,
        category: "memories",
        selectedLineageId: 100,
        personas: [MAIN_PERSONA],
        memories: [MAX_CONTENT_MEMORY],
        canManage: true,
        readStatus: "fresh",
        page: { kind: "remove", memoryId: 1 },
        receipt,
      }),
  ],
  [
    "server memories vectorize page",
    BUDGET_RECEIPT,
    (locale, receipt) =>
      buildMemoriesPanelPayload({
        locale,
        category: "memories",
        selectedLineageId: 100,
        personas: [MAIN_PERSONA],
        memories: [MAX_CONTENT_MEMORY],
        canManage: true,
        readStatus: "fresh",
        page: { kind: "vectorize", memoryId: 1, personaId: 1 },
        receipt,
      }),
  ],
  [
    "server document page",
    BUDGET_RECEIPT,
    (locale, receipt) =>
      buildMemoriesPanelPayload({
        locale,
        category: "documents",
        selectedLineageId: 100,
        selectedDocumentPersonaId: 1,
        personas: [MAIN_PERSONA],
        memories: [],
        documents: [MAX_CONTENT_DOCUMENT],
        documentCount: 1,
        documentChunks: [MAX_CONTENT_CHUNK],
        canManage: true,
        readStatus: "fresh",
        page: { kind: "documents", selectedDocumentId: 1 },
        receipt,
      }),
  ],
  [
    "personal memories global main page",
    BUDGET_RECEIPT,
    (locale, receipt) =>
      buildPersonalMemoriesPanelPayload({
        locale,
        category: "global",
        selectedLineageId: 0,
        personas: [],
        memories: [maxContentPersonalMemory(0)],
        stmCount: 0,
        privacyLevel: PrivacyLevel.MINIMAL,
        readStatus: "fresh",
        page: { kind: "main" },
        receipt,
      }),
  ],
  [
    "personal memories global removal page",
    BUDGET_RECEIPT,
    (locale, receipt) =>
      buildPersonalMemoriesPanelPayload({
        locale,
        category: "global",
        selectedLineageId: 0,
        personas: [],
        memories: [maxContentPersonalMemory(0)],
        stmCount: 0,
        privacyLevel: PrivacyLevel.MINIMAL,
        readStatus: "fresh",
        page: { kind: "remove", memoryId: 1 },
        receipt,
      }),
  ],
  [
    "personal memories persona main page",
    BUDGET_RECEIPT,
    (locale, receipt) =>
      buildPersonalMemoriesPanelPayload({
        locale,
        category: "persona",
        selectedLineageId: 100,
        personas: [MAIN_PERSONA],
        memories: [maxContentPersonalMemory(100)],
        stmCount: 0,
        privacyLevel: PrivacyLevel.MINIMAL,
        readStatus: "fresh",
        page: { kind: "main" },
        receipt,
      }),
  ],
  [
    "personal memories persona removal page",
    BUDGET_RECEIPT,
    (locale, receipt) =>
      buildPersonalMemoriesPanelPayload({
        locale,
        category: "persona",
        selectedLineageId: 100,
        personas: [MAIN_PERSONA],
        memories: [maxContentPersonalMemory(100)],
        stmCount: 0,
        privacyLevel: PrivacyLevel.MINIMAL,
        readStatus: "fresh",
        page: { kind: "remove", memoryId: 1 },
        receipt,
      }),
  ],
];

/**
 * Cutting truncates within 3 characters of the available budget, so a panel that leaves more than
 * this unused fills less of the budget than it could. The remainder alone passes a payload over the
 * cap, which is how a wrapped `ja` footer reached 4,004 unnoticed, so the rows assert the cap too.
 */
const PAYLOAD_TIGHTNESS_TOLERANCE = 3;

describe("panel payload worst cases", () => {
  it.each(
    WORST_CASE_ROWS,
  )("holds the Components V2 limits for %s in every runtime locale and receipt state", (label, panelReceipt, build) => {
    const cases = collectCaseFailures();
    for (const locale of RUNTIME_LOCALES) {
      for (const receipt of [undefined, panelReceipt]) {
        const caseLabel = `${label}/${locale}/receipt=${Boolean(receipt)}`;
        cases.check(caseLabel, () => expectSafePanelPayload(build(locale, receipt), caseLabel));
      }
    }
    cases.expectNoFailures();
  });
});

describe("panel text-display budgets at the stored maximum", () => {
  it.each(
    BUDGET_ROWS,
  )("keeps %s within and tight against the text-display budget in every runtime locale and receipt state", (label, panelReceipt, build) => {
    const cases = collectCaseFailures();
    for (const locale of RUNTIME_LOCALES) {
      for (const receipt of [undefined, panelReceipt]) {
        const caseLabel = `${label}/${locale}/receipt=${Boolean(receipt)}`;
        cases.check(caseLabel, () => {
          const total = collectTextDisplays(build(locale, receipt)).reduce(
            (sum, content) => sum + getDiscordTextLength(content),
            0,
          );
          expect(total, caseLabel).toBeLessThanOrEqual(DISCORD_MESSAGE_TEXT_DISPLAY_TOTAL_MAX);
          expect(DISCORD_MESSAGE_TEXT_DISPLAY_TOTAL_MAX - total, caseLabel).toBeLessThanOrEqual(
            PAYLOAD_TIGHTNESS_TOLERANCE,
          );
        });
      }
    }
    cases.expectNoFailures();
  });
});
