import { RESPONSE_REVIEW_ITEMS } from "@/constants/responseReview";
import { CONFIG_MODEL_SELECT_FIELD } from "@/utils/discord/ui/configModelModals";
import {
  encodeConfigProviderPageValue,
  decodeConfigProviderRangeValue,
} from "@/utils/discord/interactions/configModelLoaders";
import { afterEach, beforeAll, expect, it, spyOn } from "bun:test";
import type { Client } from "discord.js";
import {
  assembledServerConfigSchema,
  responseReviewerPromptSchema,
  responseRuleCheckerRefSchema,
} from "@/types/db/schema";
import { configRepository } from "@/utils/db/repositories";
import { cache } from "@/utils/cache/tomoriStateCacheStore";
import { buildConfigRouteId, type ConfigPanelRoute } from "@/utils/discord/configPanelCatalog";
import { createConfigInteractionRoute } from "@/utils/discord/interactions/configRoutes";
import type { ConfigRouteDependencies, ConfigScope } from "@/utils/discord/interactions/configRouteContext";
import { InteractionRouteRegistry, type GlobalRoutableInteraction } from "@/utils/discord/interactions/routeRegistry";
import {
  responseDraftingOperations,
  checkerFingerprint,
  isCompatibleRuleChecker,
  type ResponseDraftingView,
} from "@/utils/discord/interactions/responseDraftingOperations";
import { buildConfigPanelPayload } from "@/utils/discord/ui/configPanel";
import {
  buildDraftPromptModal,
  buildDraftModelModal,
  buildDraftReviewItemsModal,
  DRAFT_CHECKER_PAGE_SIZE,
  DRAFT_CLEAR_VALUE,
  DRAFT_REVIEW_ITEMS_FIELD,
} from "@/utils/discord/ui/responseDraftingPanel";
import { validateRawModalLimits } from "@/utils/discord/ui/componentsV2Limits";
import { buildConfigModalFieldId } from "@/utils/discord/ui/configModals";
import { hasLocaleKey, initializeLocalizer } from "@/utils/text/localizer";
import { createPersona, createServerConfig } from "../../helpers/fixtures";
import { createRouteInteraction } from "../../helpers/routeInteraction";
import { collectTextDisplays, expectSafePanelPayload } from "../../helpers/panelLimits";
import { localizedCopy, localizedProse, RUNTIME_LOCALES, collectCaseFailures } from "../../helpers/localeCases";

beforeAll(initializeLocalizer);
const restores: Array<() => void> = [];
afterEach(() => {
  for (const restore of restores.splice(0)) restore();
  cache.delete("draft-fixture");
});
const view: ResponseDraftingView = {
  reviewers: [{ provider: "google", models: [{ id: 1, name: "gemini-2.5-flash", description: null }] }],
  checkers: [
    { reference: { scope: "workspace", registrationId: 5, toolName: "check_slop" }, label: "Fixture checker" },
  ],
  inheritedReviewerAvailable: true,
};

it("defaults to Off with inherited review and no auxiliary selections", () => {
  const input: Record<string, unknown> = { ...createServerConfig(), server_id: 1 };
  for (const key of [
    "response_reviewer_llm_id",
    "response_reviewer_prompt",
    "response_rule_checker_ref",
    "response_drafting_enabled",
    "response_review_items",
  ])
    delete input[key];
  const config = assembledServerConfigSchema.parse(input);
  expect(config.response_drafting_enabled).toBe(false);
  expect(config.response_review_items).toEqual(["persona", "examples", "history"]);
  expect(config.response_reviewer_llm_id).toBeNull();
  expect(config.response_reviewer_prompt).toBeNull();
  expect(config.response_rule_checker_ref).toBeNull();
  expect(responseRuleCheckerRefSchema.safeParse({ scope: "workspace", registrationId: 5, toolName: "" }).success).toBe(
    false,
  );
});

it("renders the fullest panel, unavailable states and real modals within Discord limits in every locale", () => {
  const failures = collectCaseFailures();
  for (const locale of RUNTIME_LOCALES)
    failures.check(locale, () => {
      for (const enabled of [false, true])
        for (const slot of ["reviewer", "checker"] as const) {
          const state = createPersona({
            config: {
              response_drafting_enabled: enabled,
              response_reviewer_prompt: `\`\`\`\n${"🙂".repeat(3996)}`,
              response_rule_checker_ref: view.checkers[0]?.reference ?? null,
            },
          });
          const payload = buildConfigPanelPayload({
            locale,
            actor: { workspaceKind: "guild", isManager: true },
            category: "plugins",
            page: "response-drafting",
            personas: [state],
            selectedPersonaId: null,
            readStatus: "fresh",
            responseDraftingView: view,
            draftPicker: slot === "checker" ? { slot, start: 0 } : { slot, start: 0, provider: "google" },
            receipt: {
              tone: "success",
              heading: localizedCopy("en-US", "commands.config.drafting.saved_heading"),
              detail: localizedCopy("en-US", "commands.config.drafting.saved_detail"),
            },
          });
          expectSafePanelPayload(payload, `${locale}/${slot}/${enabled}`);
          const rendered = collectTextDisplays(payload).join("\n");
          for (const item of RESPONSE_REVIEW_ITEMS) {
            const circle = state.config.response_review_items.includes(item.value) ? "🟢" : "🔴";
            expect(rendered).toMatch(
              new RegExp(
                `${circle} ${localizedProse(hasLocaleKey(locale, item.labelKey) ? locale : "en-US", item.labelKey).source}`,
              ),
            );
          }
          if (locale === "en-US") {
            const text = collectTextDisplays(payload).join("\n");
            expect(text).toMatch(
              localizedProse("en-US", enabled ? "commands.config.drafting.on" : "commands.config.drafting.off"),
            );
          }
          expect(validateRawModalLimits(buildDraftPromptModal(state, locale, "nonce123")).valid).toBe(true);
          expect(validateRawModalLimits(buildDraftReviewItemsModal(state, locale, "nonce123")).valid).toBe(true);
        }
      const state = createPersona({
        config: {
          response_reviewer_llm_id: 999,
          response_rule_checker_ref: { scope: "workspace", registrationId: 999, toolName: "check_slop" },
        },
      });
      const payload = buildConfigPanelPayload({
        locale,
        actor: { workspaceKind: "dm", isManager: true },
        category: "plugins",
        page: "response-drafting",
        personas: [state],
        selectedPersonaId: null,
        readStatus: "fresh",
        responseDraftingView: view,
      });
      expectSafePanelPayload(payload, `${locale}/unavailable`);
      // A removed selection surfaces in the dropdown placeholders, which never wrap.
      expect(JSON.stringify(payload)).toContain(localizedCopy(locale, "commands.config.drafting.unavailable"));
      const modal = buildDraftPromptModal(createPersona(), locale, "nonce123");
      expect(validateRawModalLimits(modal).valid).toBe(true);
      // An untranslated locale renders the English prompt, as the runtime falls back.
      const promptLocale = hasLocaleKey(locale, "commands.config.drafting.default_prompt") ? locale : "en-US";
      expect(JSON.stringify(modal)).toContain(
        JSON.stringify(localizedCopy(promptLocale, "commands.config.drafting.default_prompt")).slice(1, -1),
      );
      expect(
        validateRawModalLimits(
          buildDraftModelModal(
            createPersona(),
            locale,
            "nonce123",
            view.reviewers[0] ?? { provider: "google", models: [] },
            0,
          ),
        ).valid,
      ).toBe(true);
    });
  failures.expectNoFailures();
});

it("renders the checker select for a workspace without compatible checkers", () => {
  for (const binding of [null, { scope: "workspace" as const, registrationId: 5, toolName: "check_slop" }]) {
    const payload = buildConfigPanelPayload({
      locale: "en-US",
      actor: { workspaceKind: "guild", isManager: true },
      category: "plugins",
      page: "response-drafting",
      personas: [createPersona({ config: { response_rule_checker_ref: binding } })],
      selectedPersonaId: null,
      readStatus: "fresh",
      responseDraftingView: { ...view, checkers: [] },
    });
    expectSafePanelPayload(payload, `binding=${binding !== null}`);
    let checkerSelect: { disabled?: boolean; options?: Array<{ value: string }> } | undefined;
    JSON.stringify(payload, (_key, value) => {
      if (typeof value?.customId === "string" && value.customId.includes("draft-checker-select")) checkerSelect = value;
      return value;
    });
    expect(checkerSelect?.options?.map((option) => option.value)).toEqual([DRAFT_CLEAR_VALUE]);
    // Enabled for a stale binding because None is then the only way to clear it.
    expect(checkerSelect?.disabled).toBe(binding === null);
  }
});

it("disables Use Default only while the reviewer prompt is already the default", () => {
  const defaultButtonId = buildConfigRouteId({ action: "draft-default", locale: "en-US" });
  for (const prompt of [null, "Fixture prompt"]) {
    const payload = buildConfigPanelPayload({
      locale: "en-US",
      actor: { workspaceKind: "guild", isManager: true },
      category: "plugins",
      page: "response-drafting",
      personas: [createPersona({ config: { response_reviewer_prompt: prompt } })],
      selectedPersonaId: null,
      readStatus: "fresh",
      responseDraftingView: view,
    });
    let defaultButton: { disabled?: boolean } | undefined;
    JSON.stringify(payload, (_key, value) => {
      if (value?.customId === defaultButtonId) defaultButton = value;
      return value;
    });
    expect(defaultButton?.disabled).toBe(prompt === null);
  }
});

it("validates checker input contracts and Unicode prompt limits", () => {
  expect(
    isCompatibleRuleChecker({
      name: "lint_reply",
      parametersJsonSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
    }),
  ).toBe(true);
  for (const schema of [
    { type: 1 },
    { type: "object", properties: { text: { type: "string" } }, required: ["path"] },
    { type: "object", properties: { text: { type: "number" } }, required: ["text"] },
  ]) {
    expect(isCompatibleRuleChecker({ name: "check_slop", parametersJsonSchema: schema })).toBe(false);
  }
  expect(responseReviewerPromptSchema.safeParse("🙂".repeat(4000)).success).toBe(true);
  expect(responseReviewerPromptSchema.safeParse("🙂".repeat(4001)).success).toBe(false);
  expect(responseReviewerPromptSchema.safeParse(" \n ").success).toBe(false);
});

it("invalidates only after successful writes and leaves model choices intact on prompt/default and Off actions", async () => {
  const state = createPersona({ config: { response_reviewer_llm_id: 1 } });
  const entry = { personas: [state], mainPersona: state, cachedAt: Date.now() };
  const chat = spyOn(configRepository, "updateChatConfig").mockResolvedValue(false);
  const caps = spyOn(configRepository, "updateCapabilitiesConfig").mockResolvedValue(false);
  restores.push(
    () => chat.mockRestore(),
    () => caps.mockRestore(),
  );
  cache.set("draft-fixture", entry);
  expect(await responseDraftingOperations.setPrompt(state, "draft-fixture", "instructions")).toBe("write-failed");
  expect(await responseDraftingOperations.setEnabled(state, "draft-fixture", false)).toBe("write-failed");
  expect(await responseDraftingOperations.setReviewItems(state, "draft-fixture", [])).toBe("write-failed");
  expect(cache.has("draft-fixture")).toBe(true);
  chat.mockResolvedValue(true);
  caps.mockResolvedValue(true);
  expect(await responseDraftingOperations.setPrompt(state, "draft-fixture", null)).toBe("success");
  expect(chat).toHaveBeenLastCalledWith(state.server_id, { response_reviewer_prompt: null });
  expect(cache.has("draft-fixture")).toBe(false);
  expect(await responseDraftingOperations.setModel(state, "draft-fixture", "", null)).toBe("success");
  expect(chat).toHaveBeenLastCalledWith(state.server_id, { response_reviewer_llm_id: null });
  expect(await responseDraftingOperations.setChecker(state, "draft-fixture", null)).toBe("success");
  expect(chat).toHaveBeenLastCalledWith(state.server_id, { response_rule_checker_ref: null });
  expect(await responseDraftingOperations.setReviewItems(state, "draft-fixture", ["tools"])).toBe("success");
  expect(chat).toHaveBeenLastCalledWith(state.server_id, { response_review_items: ["tools"] });
  expect(await responseDraftingOperations.setEnabled(state, "draft-fixture", false)).toBe("success");
  expect(caps).toHaveBeenLastCalledWith(state.server_id, { response_drafting_enabled: false });
});

function harness(isManager = true, dm = false, currentView: ResponseDraftingView = view) {
  const state = createPersona();
  const scope: ConfigScope = {
    serverDiscId: "draft-fixture",
    guildId: dm ? null : "guild-1",
    internalServerId: state.server_id,
    userId: 1,
    actor: { workspaceKind: dm ? "dm" : "guild", isManager },
    personas: [state],
    readStatus: "fresh",
  };
  const writes: unknown[][] = [];
  let checkedValues: string[] | undefined;
  const deps: Partial<ConfigRouteDependencies> = {
    resolveScope: async (interaction) => {
      expect(
        interaction.deferred || interaction.replied || interaction.isButton() || interaction.isStringSelectMenu(),
      ).toBe(true);
      return scope;
    },
    loadResponseDraftingView: async () => currentView,
    loadDraftModels: async () => currentView.reviewers,
    loadDraftCheckers: async () => currentView.checkers,
    showModal: async (interaction, payload) => {
      expect(interaction.deferred).toBe(false);
      if (interaction.isModalSubmit()) throw new Error("Unexpected modal submit");
      await (interaction as unknown as ReturnType<typeof createRouteInteraction>).showModal(payload);
    },
    createNonce: () => "nonce123",
    recordAction: () => {},
    takeSelectValue: () => "2",
    takeCheckboxValues: (_id, field) => {
      expect(field).toBe(buildConfigModalFieldId(DRAFT_REVIEW_ITEMS_FIELD, "nonce123"));
      return checkedValues;
    },
    draftingOperations: {
      setEnabled: async (...args) => {
        writes.push(args);
        return "success";
      },
      setReviewItems: async (...args) => {
        writes.push(args);
        return "success";
      },
      setPrompt: async (...args) => {
        writes.push(args);
        return "success";
      },
      setModel: async (...args) => {
        writes.push(args);
        return "success";
      },
      setChecker: async (...args) => {
        writes.push(args);
        return "success";
      },
    },
  };
  const registry = new InteractionRouteRegistry([createConfigInteractionRoute(deps)]);
  const dispatch = async (
    route: ConfigPanelRoute,
    kind: "button" | "string-select" | "modal" = "button",
    values: string[] = [],
    fields: Record<string, string> = {},
  ) => {
    const interaction = createRouteInteraction({
      customId: buildConfigRouteId(route),
      kind,
      isManager,
      guildId: dm ? null : "guild-1",
      values,
      fields,
    });
    await registry.dispatch({} as Client, interaction as unknown as GlobalRoutableInteraction);
    return interaction;
  };
  return {
    dispatch,
    writes,
    deps,
    setCheckedValues: (values: string[] | undefined) => {
      checkedValues = values;
    },
  };
}

it("opens a prefilled prompt without deferral and rechecks manager permissions on replay", async () => {
  const h = harness();
  const opened = await h.dispatch({ action: "draft-prompt-open", locale: "en-US" });
  expect(opened.calls.map((call) => call.method)).toEqual(["showModal"]);
  const denied = harness(false);
  const replay = await denied.dispatch({ action: "draft-prompt-open", locale: "en-US" });
  expect(replay.calls.map((call) => call.method)).toEqual(["reply"]);
  await denied.dispatch({ action: "draft-prompt-submit", locale: "en-US", nonce: "nonce123" }, "modal", [], {
    [buildConfigModalFieldId("draft_prompt", "nonce123")]: "instructions",
  });
  expect(denied.writes).toHaveLength(0);
  const dm = harness(true, true);
  await dm.dispatch({ action: "draft-set", locale: "en-US", enabled: true });
  expect(dm.writes).toHaveLength(1);
});

it("prefills review items and saves a complete checkbox selection after acknowledgement", async () => {
  const h = harness();
  const opened = await h.dispatch({ action: "draft-items-open", locale: "en-US" });
  expect(opened.calls.map((call) => call.method)).toEqual(["showModal"]);
  const modal = buildDraftReviewItemsModal(createPersona(), "en-US", "nonce123");
  const component = modal.components[0]?.component;
  expect(component?.options?.filter((option) => option.default).map((option) => option.value)).toEqual([
    "persona",
    "examples",
    "history",
  ]);
  const route = { action: "draft-items-submit", locale: "en-US", nonce: "nonce123" } as const;
  for (const items of [["persona", "tools"], []]) {
    h.setCheckedValues(items);
    const saved = await h.dispatch(route, "modal");
    expect(saved.calls[0]?.method).toBe("deferUpdate");
    expect(h.writes.at(-1)?.at(-1)).toEqual(items);
  }
  const before = h.writes.length;
  for (const invalid of [undefined, ["unknown"], ["tools", "tools"]]) {
    h.setCheckedValues(invalid);
    await h.dispatch(route, "modal");
  }
  expect(h.writes.length).toBe(before);
  const denied = harness(false);
  await denied.dispatch({ action: "draft-items-open", locale: "en-US" });
  await denied.dispatch(route, "modal");
  expect(denied.writes).toHaveLength(0);
});

it("routes clearing, default, prompt, model selection and checker binding after acknowledgement", async () => {
  const h = harness();
  const clearing = await h.dispatch({ action: "draft-provider", locale: "en-US" }, "string-select", ["__none__"]);
  expect(clearing.calls[0]?.method).toBe("deferUpdate");
  expect(h.writes.at(-1)?.slice(-2)).toEqual(["", null]);
  await h.dispatch({ action: "draft-default", locale: "en-US" });
  expect(h.writes.at(-1)?.at(-1)).toBeNull();
  await h.dispatch({ action: "draft-prompt-submit", locale: "en-US", nonce: "nonce123" }, "modal", [], {
    [buildConfigModalFieldId("draft_prompt", "nonce123")]: "instructions",
  });
  expect(h.writes.at(-1)?.at(-1)).toBe("instructions");
  const opened = await h.dispatch({ action: "draft-provider", locale: "en-US" }, "string-select", ["google"]);
  expect(opened.calls[0]?.method).toBe("showModal");
  await h.dispatch({ action: "draft-model-submit", locale: "en-US", provider: "google", nonce: "nonce123" }, "modal");
  expect(h.writes.at(-1)?.slice(-2)).toEqual(["google", 2]);
  await h.dispatch(
    { action: "draft-checker-select", locale: "en-US", start: 0, fp: checkerFingerprint(view.checkers) },
    "string-select",
    ["0"],
  );
  expect(h.writes.at(-1)?.at(-1)).toEqual(view.checkers[0]?.reference);
  const count = h.writes.length;
  await h.dispatch({ action: "draft-checker-select", locale: "en-US", start: 0, fp: "stale___" }, "string-select", [
    "0",
  ]);
  expect(h.writes.length).toBe(count);
});

function selectOptions(payload: unknown, id: string): Array<{ value: string }> {
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;
  if (record.customId === id || record.custom_id === id) return record.options as Array<{ value: string }>;
  for (const value of Object.values(record)) {
    const options = selectOptions(value, id);
    if (options.length) return options;
  }
  return [];
}

it("keeps all reviewer provider windows and model pages reachable without pre-deferring a modal", async () => {
  const large: ResponseDraftingView = {
    ...view,
    reviewers: [
      {
        provider: "google",
        models: Array.from({ length: 55 }, (_, index) => ({
          id: index + 1,
          name: `fixture-${index}`,
          description: null,
        })),
      },
    ],
  };
  const h = harness(true, false, large);
  const initial = await h.dispatch({ action: "draft-provider", locale: "en-US" }, "string-select", ["google"]);
  expect(initial.calls[0]?.method).toBe("deferUpdate");
  const opened = await h.dispatch({ action: "draft-provider", locale: "en-US" }, "string-select", [
    encodeConfigProviderPageValue("google", 50),
  ]);
  expect(opened.calls[0]?.method).toBe("showModal");
  const options = selectOptions(
    opened.calls[0]?.payload,
    buildConfigModalFieldId(CONFIG_MODEL_SELECT_FIELD, "nonce123"),
  );
  expect(options.map((option) => option.value)).toEqual(["51", "52", "53", "54", "55"]);
  const many: ResponseDraftingView = {
    ...view,
    reviewers: Array.from({ length: 34 }, (_, index) => ({
      provider: `custom:${index + 1}`,
      models: [{ id: index + 1, name: `fixture-${index}`, description: null }],
    })),
  };
  const reached = new Set<string>();
  let start = 0;
  for (let page = 0; page < 2; page++) {
    const payload = buildConfigPanelPayload({
      locale: "en-US",
      actor: { workspaceKind: "guild", isManager: true },
      category: "plugins",
      page: "response-drafting",
      personas: [createPersona()],
      selectedPersonaId: null,
      readStatus: "fresh",
      responseDraftingView: many,
      draftPicker: { slot: "reviewer", provider: null, start },
    });
    expectSafePanelPayload(payload, `provider-window-${page}`);
    const choices = selectOptions(payload, buildConfigRouteId({ action: "draft-provider", locale: "en-US" }));
    for (const option of choices) {
      const range = decodeConfigProviderRangeValue(option.value);
      if (range) start = range.start;
      else if (option.value !== "__none__") reached.add(option.value);
    }
  }
  expect([...reached].sort()).toEqual(many.reviewers.map((group) => group.provider).sort());
});

it("preserves Unicode glyphs in existing configuration locale labels", () => {
  const cases: Array<[string, number]> = [
    ["commands.config.panel.channels_welcome_random_label", 0x2685],
    ["commands.config.panel.random_persona_label", 0x2685],
    ["commands.config.panel.voices.page.sample_select_placeholder", 0x2026],
  ];
  for (const [key, codepoint] of cases) {
    expect(Array.from(localizedCopy("en-US", key), (character) => character.codePointAt(0))).toContain(codepoint);
  }
});

it("leads the rule checker list with None and pages it without wrapping", () => {
  const checkers = Array.from({ length: DRAFT_CHECKER_PAGE_SIZE + 1 }, (_, index) => ({
    reference: { scope: "workspace" as const, registrationId: index + 1, toolName: `check_${index}` },
    label: `Checker ${index}`,
  }));
  const checkerOptions = (
    binding: (typeof checkers)[number]["reference"] | null,
    start: number,
  ): Array<{ value: string; label: string }> => {
    const payload = buildConfigPanelPayload({
      locale: "en-US",
      actor: { workspaceKind: "guild", isManager: true },
      category: "plugins",
      page: "response-drafting",
      personas: [createPersona({ config: { response_rule_checker_ref: binding } })],
      selectedPersonaId: null,
      readStatus: "fresh",
      responseDraftingView: { ...view, checkers },
      draftPicker: { slot: "checker", start },
    });
    const match = JSON.stringify(payload).match(/"customId":"[^"]*draft-checker-select[^"]*".*?"options":(\[.*?\])/);
    return JSON.parse(match?.[1] ?? "[]");
  };
  const checkerValues = (binding: (typeof checkers)[number]["reference"] | null, start: number): string[] =>
    checkerOptions(binding, start).map((option) => option.value);

  for (const binding of [null, checkers[0]?.reference ?? null]) {
    expect(checkerValues(binding, 0)[0]).toBe(DRAFT_CLEAR_VALUE);
  }
  expect(checkerValues(null, 0)).toContain(`page|${DRAFT_CHECKER_PAGE_SIZE}`);
  expect(checkerOptions(null, DRAFT_CHECKER_PAGE_SIZE)).toEqual([
    { value: DRAFT_CLEAR_VALUE, label: localizedCopy("en-US", "commands.config.panel.none_label") },
    { value: String(DRAFT_CHECKER_PAGE_SIZE), label: `Checker ${DRAFT_CHECKER_PAGE_SIZE}` },
    { value: "page|0", label: localizedCopy("en-US", "general.pagination.previous") },
  ]);
});
