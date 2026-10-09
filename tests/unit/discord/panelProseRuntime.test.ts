import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ComponentType } from "discord.js";
import { PrivacyLevel, type TomoriState, type UserRow, type UserSavedProviderConfigRow } from "@/types/db/schema";
import { buildConfigPanelPayload } from "@/utils/discord/ui/configPanel";
import type { ConfigActor } from "@/utils/discord/interactions/configPermissionPolicy";
import { CONFIG_PAGES_BY_CATEGORY, type ConfigCategory } from "@/utils/discord/configPanelCatalog";
import { buildMemoriesPanelPayload } from "@/utils/discord/ui/memoriesPanel";
import {
  buildPersonalConfigPanelPayload,
  type PersonalConfigModelDisplayInfo,
} from "@/utils/discord/ui/personalConfigPanel";
import { buildPersonalMemoriesPanelPayload } from "@/utils/discord/ui/personalMemoriesPanel";
import {
  buildSetupSuccessPayload,
  buildSetupWizardPayload,
  type SetupSettingsCatalogs,
} from "@/utils/discord/ui/setupPanel";
import { SETUP_DRAFT_SCHEMA_VERSION, type SetupDraftRecord } from "@/types/discord/setupWizard";
import { formatPanelProse } from "@/utils/discord/ui/panelProse";
import { getSupportedLocales, initializeLocalizer, localizer } from "@/utils/text/localizer";
import { createPersona } from "../../helpers/fixtures";
import { expectForEveryLocale } from "../../helpers/localeCases";

await initializeLocalizer();

/** Rendered walks run per locale because wrapping depends on the interpolated translation. */
const AUTHORED_LOCALES = getSupportedLocales();

const PANEL_CONTAINER_SOURCE_EXCLUSIONS = new Set([
  "src/utils/discord/ui/componentsV2Limits.ts",
  "src/utils/discord/ui/panel.ts",
]);

interface UnformattedTextDisplay {
  content: string;
  where: string;
}

/**
 * Scanned paths come back with forward slashes, matching how the exclusion keys are written. An
 * OS-native separator would let the shared-boundary gate report its own exclusions as bypasses.
 */
function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && entry.name.endsWith(".ts") ? [path.replaceAll("\\", "/")] : [];
  });
}

function collectUnformattedTextDisplays(node: unknown, besideThumbnail = false): UnformattedTextDisplay[] {
  if (Array.isArray(node)) return node.flatMap((child) => collectUnformattedTextDisplays(child, besideThumbnail));
  if (typeof node !== "object" || node === null) return [];

  const record = node as Record<string, unknown>;
  const accessory = record.accessory as { type?: number } | undefined;
  const inThumbnailSection =
    besideThumbnail || (record.type === ComponentType.Section && accessory?.type === ComponentType.Thumbnail);

  if (record.type === ComponentType.TextDisplay && typeof record.content === "string") {
    return formatPanelProse(record.content, inThumbnailSection) === record.content
      ? []
      : [{ content: record.content, where: inThumbnailSection ? "beside thumbnail" : "panel body" }];
  }

  return Object.values(record).flatMap((child) => collectUnformattedTextDisplays(child, inThumbnailSection));
}

describe("panel prose runtime formatting", () => {
  it("keeps direct Container construction inside the shared panel boundary", () => {
    const bypasses = sourceFiles("src")
      .filter((path) => !PANEL_CONTAINER_SOURCE_EXCLUSIONS.has(path))
      .filter((path) => readFileSync(path, "utf8").includes("type: ComponentType.Container"));

    expect(bypasses).toEqual([]);
  });

  it("formats persona-scoped memories automatically beside its avatar", () =>
    expectForEveryLocale((locale) => {
      const personas = [
        {
          persona_id: 55,
          persona_lineage_id: 1770,
          persona_nickname: "Aphel",
          is_alter: false,
        } as unknown as TomoriState,
      ];
      const build = (selectedPersonaAvatarUrl: string | null) =>
        buildPersonalMemoriesPanelPayload({
          locale,
          category: "persona",
          selectedLineageId: 1770,
          personas,
          selectedPersonaAvatarUrl,
          memories: [],
          stmCount: 0,
          privacyLevel: PrivacyLevel.MINIMAL,
          readStatus: "fresh",
          page: { kind: "main" },
        });

      expect(collectUnformattedTextDisplays(build("https://cdn.example.invalid/55.png"))).toEqual([]);
      expect(collectUnformattedTextDisplays(build(null))).toEqual([]);
    }, AUTHORED_LOCALES));

  it("formats persona naming automatically beside its avatar", () =>
    expectForEveryLocale((locale) => {
      const user = {
        user_id: 1,
        user_disc_id: "user-123",
        language_pref: "en-US",
        privacy_level: PrivacyLevel.MINIMAL,
      } as unknown as UserRow;
      const personas = [
        {
          persona_id: 55,
          persona_lineage_id: 1770,
          persona_nickname: "Aphel",
          is_alter: false,
        } as unknown as TomoriState,
      ];
      const build = (selectedPersonaAvatarUrl: string | null) =>
        buildPersonalConfigPanelPayload({
          locale,
          category: "profile",
          page: "persona",
          user,
          resolvedNickname: "Bau",
          personas,
          guildId: "guild-123",
          selectedLineageId: 1770,
          selectedPersonaAvatarUrl,
          memoryCount: 0,
          stmCount: 0,
          readStatus: "fresh",
        });

      expect(collectUnformattedTextDisplays(build("https://cdn.example.invalid/55.png"))).toEqual([]);
      expect(collectUnformattedTextDisplays(build(null))).toEqual([]);
    }, AUTHORED_LOCALES));

  it("formats workspace persona memories automatically beside its avatar", () =>
    expectForEveryLocale((locale) => {
      const personas = [
        {
          persona_id: 55,
          persona_lineage_id: 1770,
          persona_nickname: "Aphel",
          is_alter: false,
        } as unknown as TomoriState,
      ];
      const build = (selectedPersonaAvatarUrl: string | null) =>
        buildMemoriesPanelPayload({
          locale,
          category: "memories",
          selectedLineageId: 1770,
          personas,
          selectedPersonaAvatarUrl,
          memories: [],
          canManage: true,
          readStatus: "fresh",
          page: { kind: "main" },
        });

      expect(collectUnformattedTextDisplays(build("https://cdn.example.invalid/55.png"))).toEqual([]);
      expect(collectUnformattedTextDisplays(build(null))).toEqual([]);
    }, AUTHORED_LOCALES));

  /**
   * The Documents page grew its own thumbnail, and it renders one only under the persona scope.
   * Walking the serverwide payload alone would leave that Section unvisited while the file-level
   * coverage check above still passed, because the Memories page already puts this builder in the
   * covered set.
   */
  it("formats workspace documents automatically beside its persona avatar", () =>
    expectForEveryLocale((locale) => {
      const personas = [
        {
          persona_id: 55,
          persona_lineage_id: 1770,
          persona_nickname: "Aphel",
          is_alter: false,
        } as unknown as TomoriState,
      ];
      const build = (selectedDocumentPersonaId: number, selectedPersonaAvatarUrl: string | null) =>
        buildMemoriesPanelPayload({
          locale,
          category: "documents",
          selectedLineageId: selectedDocumentPersonaId,
          selectedDocumentPersonaId,
          personas,
          selectedPersonaAvatarUrl,
          memories: [],
          documents: [],
          documentCount: 0,
          documentChunkCount: 0,
          canManage: true,
          readStatus: "fresh",
          page: { kind: "documents" },
        });

      expect(collectUnformattedTextDisplays(build(55, "https://cdn.example.invalid/55.png"))).toEqual([]);
      expect(collectUnformattedTextDisplays(build(0, null))).toEqual([]);
    }, AUTHORED_LOCALES));

  /**
   * The Models parameter summary composes each quote row at runtime from a label key and a stored
   * value. Walking the built payload covers those composed rows even when the summary moves into a
   * child builder that the panel-boundary source check cannot see.
   *
   * The sampler columns are Postgres `real`, so `Math.fround` reproduces what the driver returns
   * rather than what someone typed. These are the values whose readback is widest inside each
   * column's own bounds: 0.01 returns as 0.009999999776482582 and -0.03 as -0.029999999329447746,
   * which produce the widest Generation row. The two integer columns carry their widest in-range
   * values instead, since they cannot pick up the artifact.
   */
  it("formats the Models parameter summary through the runtime boundary in every provider state", () =>
    expectForEveryLocale((locale) => {
      const user = {
        user_id: 1,
        user_disc_id: "user-123",
        language_pref: "en-US",
        privacy_level: PrivacyLevel.MINIMAL,
      } as unknown as UserRow;

      const widestConfig = {
        provider: "vertexexpress",
        llm_temperature: Math.fround(0.01),
        llm_min_p: Math.fround(0.01),
        llm_top_p: Math.fround(0.01),
        llm_top_k: 256,
        llm_frequency_penalty: Math.fround(-0.03),
        llm_presence_penalty: Math.fround(-0.03),
        llm_max_output_tokens: 131072,
        thinking_level: "minimal",
      } as unknown as UserSavedProviderConfigRow;

      const build = (parametersProviders: string[]) =>
        buildPersonalConfigPanelPayload({
          locale,
          category: "models",
          page: "parameters",
          user,
          resolvedNickname: "Bau",
          personas: [],
          guildId: "guild-123",
          memoryCount: 0,
          stmCount: 0,
          readStatus: "fresh",
          selectedParametersProvider: parametersProviders[0],
          modelDisplayInfo: {
            parametersProviders,
            selectedParametersConfig: parametersProviders.length > 0 ? widestConfig : undefined,
            fallbacksProviders: [],
            fallbackSlots: [],
            randomizerEnabled: false,
            canEnableRandomizer: false,
          } as unknown as PersonalConfigModelDisplayInfo,
        });

      // Zero, one, and several saved providers are three different renderings of this page, and the
      // longest provider display name is the one that can push a summary row over the budget.
      expect(collectUnformattedTextDisplays(build([]))).toEqual([]);
      expect(collectUnformattedTextDisplays(build(["vertexexpress"]))).toEqual([]);
      expect(collectUnformattedTextDisplays(build(["vertexexpress", "openrouter", "novelai"]))).toEqual([]);
    }, AUTHORED_LOCALES));
  /**
   * `/config` filters its own body by actor, so a member and a DM owner render different pages
   * behind the same thumbnail Section. Each is walked because a heading only one of them reaches
   * would otherwise never be measured.
   */
  it("formats /config Persona General automatically beside its avatar", () =>
    expectForEveryLocale((locale) => {
      const personas = [
        {
          persona_id: 55,
          server_id: 9,
          persona_nickname: "Aphel",
          is_alter: false,
          trigger_words: ["aphel"],
          naming_config: { prefixes: {}, suffixes: {}, addressTerms: {} },
        } as unknown as TomoriState,
        {
          persona_id: 56,
          server_id: 9,
          persona_nickname: "Wren",
          is_alter: true,
          trigger_words: [],
          naming_config: { prefixes: {}, suffixes: {}, addressTerms: {} },
        } as unknown as TomoriState,
      ];
      const build = (actor: ConfigActor, selectedPersonaId: number, avatarUrl: string | null) =>
        buildConfigPanelPayload({
          locale,
          actor,
          category: "persona",
          page: "general",
          personas,
          selectedPersonaId,
          selectedPersonaAvatarUrl: avatarUrl,
          readStatus: "fresh",
        });

      const guildManager: ConfigActor = { workspaceKind: "guild", isManager: true };
      const guildMember: ConfigActor = { workspaceKind: "guild", isManager: false };
      const dmOwner: ConfigActor = { workspaceKind: "dm", isManager: true };

      expect(collectUnformattedTextDisplays(build(guildManager, 55, "https://cdn.example.invalid/55.png"))).toEqual([]);
      expect(collectUnformattedTextDisplays(build(guildManager, 56, null))).toEqual([]);
      expect(collectUnformattedTextDisplays(build(guildMember, 55, null))).toEqual([]);
      expect(collectUnformattedTextDisplays(build(dmOwner, 55, null))).toEqual([]);
    }, AUTHORED_LOCALES));

  /**
   * The Sprites page is the only `/config` body whose detail lines interpolate stored values beside
   * a Thumbnail, and the loop below renders it with no sprites at all. The widest legal sprite name
   * and usage note are the inputs that decide whether those lines fit, so they are walked here.
   */
  it("formats /config Persona Sprites automatically beside its sprite image", () =>
    expectForEveryLocale((locale) => {
      const personas = [
        {
          persona_id: 55,
          server_id: 9,
          persona_nickname: "Aphel",
          is_alter: false,
          trigger_words: [],
          naming_config: { prefixes: {}, suffixes: {}, addressTerms: {} },
        } as unknown as TomoriState,
      ];
      const widestSprite = {
        sprite_id: 1,
        persona_id: 55,
        sprite_name: "s".repeat(64),
        sprite_key: "s".repeat(64),
        avatar_url: "https://cdn.example.invalid/sprites/happy.png",
        usage_instructions: "u".repeat(300),
        is_identity: true,
      };
      const build = (actor: ConfigActor, selectedPersonaAvatarUrl: string | null) =>
        buildConfigPanelPayload({
          locale,
          actor,
          category: "persona",
          page: "sprites",
          personas,
          selectedPersonaId: 55,
          selectedPersonaAvatarUrl,
          personaSprites: [widestSprite],
          selectedSpriteIndex: 0,
          readStatus: "fresh",
        });

      const guildManager: ConfigActor = { workspaceKind: "guild", isManager: true };
      const guildMember: ConfigActor = { workspaceKind: "guild", isManager: false };
      const dmOwner: ConfigActor = { workspaceKind: "dm", isManager: true };

      expect(collectUnformattedTextDisplays(build(guildManager, "https://cdn.example.invalid/55.png"))).toEqual([]);
      expect(collectUnformattedTextDisplays(build(guildManager, null))).toEqual([]);
      expect(collectUnformattedTextDisplays(build(guildMember, null))).toEqual([]);
      expect(collectUnformattedTextDisplays(build(dmOwner, null))).toEqual([]);
    }, AUTHORED_LOCALES));

  it("formats every /config page placeholder and confirmation at runtime", () =>
    expectForEveryLocale((locale) => {
      const personas = [
        createPersona({ persona_id: 55, server_id: 9, persona_nickname: "Aphel", trigger_words: [] }),
        createPersona({ persona_id: 56, server_id: 9, persona_nickname: "Wren", is_alter: true, trigger_words: [] }),
      ];
      const actor: ConfigActor = { workspaceKind: "guild", isManager: true };
      // Collected rather than asserted per page, so a translation pass sees every overflowing page at once.
      const pageViolations: Array<UnformattedTextDisplay & { page: string }> = [];

      for (const [category, pages] of Object.entries(CONFIG_PAGES_BY_CATEGORY)) {
        for (const page of pages) {
          const payload = buildConfigPanelPayload({
            locale,
            actor,
            category: category as ConfigCategory,
            page,
            personas,
            selectedPersonaId: 55,
            readStatus: "fresh",
          });
          for (const violation of collectUnformattedTextDisplays(payload)) {
            pageViolations.push({ page: `${category}/${page}`, ...violation });
          }
        }
      }
      expect(pageViolations).toEqual([]);

      const confirm = buildConfigPanelPayload({
        locale,
        actor,
        category: "persona",
        page: "general",
        personas,
        selectedPersonaId: 56,
        readStatus: "fresh",
        view: { kind: "promote-confirm", personaId: 56, nonce: "nonce1234567" },
      });
      expect(collectUnformattedTextDisplays(confirm)).toEqual([]);
    }, AUTHORED_LOCALES));

  /**
   * The setup receipt is the terminal panel of `/setup`, and most of its prose is composed at
   * runtime from a locale key plus a stored name, so the static scan above measures the template
   * rather than the rendered line. The completion explanation names a model and an endpoint, both of
   * which reach their documented maximum, and the DM explanation is long enough to exercise
   * runtime wrapping.
   */
  it("formats the setup receipt at runtime for every provider mode and context", () =>
    expectForEveryLocale((locale) => {
      const maxEndpointLabel = "e".repeat(40);
      const maxModelCode = "m".repeat(200);

      const build = (
        providerAccess: Parameters<typeof buildSetupSuccessPayload>[0]["providerAccess"],
        modelName: string | null,
        providerLabel: string,
        context: "guild" | "dm",
      ) =>
        buildSetupSuccessPayload({
          locale,
          context,
          providerAccess,
          modelName,
          providerLabel,
          personaName: "Lighthouse",
          notes: [
            {
              label: localizer("en-US", "commands.setup.novelai_expressions_warning_field"),
              detail: localizer("en-US", "commands.setup.novelai_expressions_warning_value"),
            },
          ],
          learnMore: localizer("en-US", "commands.setup.wizard.receipt_learn_more", { help: "</help:123456>" }),
          footerKey: context === "dm" ? "commands.setup.wizard.receipt_footer_avatar_skipped_dm" : undefined,
        });

      const catalogAccess = {
        mode: "catalog",
        provider: "anthropic",
        encryptedApiKey: Buffer.from("k"),
        keyVersion: 1,
      } as const;

      const cases = [
        build(catalogAccess, "claude-sonnet-4", "Anthropic", "guild"),
        build(catalogAccess, "claude-sonnet-4", "Anthropic", "dm"),
        build(catalogAccess, null, "Anthropic", "guild"),
        build(
          {
            mode: "custom-endpoint",
            connection: {
              label: maxEndpointLabel,
              apiStyle: "openai-compatible",
              endpointUrl: "https://example.invalid/v1",
              encryptedAuthToken: null,
              keyVersion: 1,
            },
            textModel: { modelCode: maxModelCode, numCtx: 8192, capabilities: ["tools"] },
          },
          maxModelCode,
          maxEndpointLabel,
          "guild",
        ),
        build({ mode: "user-byok" }, null, "", "guild"),
      ];

      for (const payload of cases) {
        expect(collectUnformattedTextDisplays(payload)).toEqual([]);
      }
    }, AUTHORED_LOCALES));

  /**
   * The wizard anchor is what the actor reviews before committing, and every quote row under a step
   * is composed from a stored draft value rather than from a locale template. The static scan above
   * only sees what sits inside a `content:` literal, so it measures none of these rows: the endpoint
   * label, the custom model code, and the two catalog preset names each reach the longest value their
   * own editor accepts.
   */
  it("formats the setup wizard anchor at runtime for every draft state", () =>
    expectForEveryLocale((locale) => {
      const maxEndpointLabel = "e".repeat(40);
      const maxModelCode = "m".repeat(200);
      const maxProviderId = "g".repeat(40);
      const maxPersonaName = "p".repeat(100);
      const maxPromptName = "r".repeat(100);

      const catalogs: SetupSettingsCatalogs = {
        personas: [{ id: 7, name: maxPersonaName, description: "A steady, watchful companion." }],
        prompts: [{ name: maxPromptName, description: "The standard reply style." }],
        promptTexts: new Map([[maxPromptName, "You are Tomori."]]),
      };

      const maxSettings = {
        presetId: 7,
        humanizer: 3,
        timezoneOffset: -12,
        systemPrompt: { kind: "preset" as const, presetName: maxPromptName },
      };

      const build = (
        overrides: Partial<SetupDraftRecord>,
        isHosted: boolean,
        settingsCatalogs: SetupSettingsCatalogs | null = catalogs,
      ) =>
        buildSetupWizardPayload({
          draft: {
            schemaVersion: SETUP_DRAFT_SCHEMA_VERSION,
            actorDiscId: "actor-1234567890",
            workspaceKey: "workspace-1234567890",
            context: "guild",
            providerAccess: null,
            startingSettings: null,
            policiesAccepted: false,
            requiresPolicies: false,
            ...overrides,
          },
          locale,
          isHosted,
          nonce: "nonce-abc-12345",
          settingsCatalogs,
        });

      const cases: Array<[string, ReturnType<typeof build>]> = [
        ["pending hosted", build({ requiresPolicies: true }, true)],
        [
          "ready with maximum catalog names",
          build(
            {
              requiresPolicies: true,
              policiesAccepted: true,
              providerAccess: {
                mode: "catalog",
                provider: maxProviderId,
                encryptedApiKey: Buffer.from("key"),
                keyVersion: 1,
              },
              startingSettings: maxSettings,
            },
            true,
          ),
        ],
        [
          "custom endpoint at maximum label and model length",
          build(
            {
              providerAccess: {
                mode: "custom-endpoint",
                connection: {
                  label: maxEndpointLabel,
                  apiStyle: "openai-compatible",
                  endpointUrl: "https://example.invalid/v1",
                  encryptedAuthToken: null,
                  keyVersion: 1,
                },
                textModel: { modelCode: maxModelCode, numCtx: 131072, capabilities: ["tools"] },
              },
              startingSettings: maxSettings,
            },
            false,
          ),
        ],
        [
          "settings re-pended by catalog drift",
          build({ providerAccess: { mode: "user-byok" }, startingSettings: maxSettings, context: "dm" }, false, {
            personas: [],
            prompts: [],
            promptTexts: new Map(),
          }),
        ],
        ["settings that could not be checked", build({ startingSettings: maxSettings, context: "dm" }, false, null)],
      ];

      const violations = cases.flatMap(([label, payload]) =>
        collectUnformattedTextDisplays(payload).map(
          (violation) => `${label}: ${violation.where}: ${violation.content.slice(0, 120)}`,
        ),
      );
      expect(violations).toEqual([]);
    }, AUTHORED_LOCALES));
});
