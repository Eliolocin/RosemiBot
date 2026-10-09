import { afterAll, beforeAll, describe, expect, it, spyOn } from "bun:test";
import type { CallableTool } from "@google/genai";
import type { AssembledServerConfig } from "@/types/db/schema";
import {
  configRepository,
  personaRepository,
  llmModelRepo,
  llmProviderRepo,
  exportRepository,
  importRepository,
} from "@/utils/db/repositories";
import { resetRepository } from "@/utils/db/repositories/ResetRepository";
import { cache } from "@/utils/cache/tomoriStateCacheStore";
import { seedModelsFromCatalog } from "@/db/seed/catalog/modelSeed";
import {
  responseDraftingOperations,
  loadResponseDraftingView,
  loadDraftingModelGroups,
  loadDraftCheckerChoices,
} from "@/utils/discord/interactions/responseDraftingOperations";
import { getGuildMcpManager } from "@/utils/mcp/guildMcpManager";
import { registerCustomEndpoint } from "@/utils/provider/customEndpointService";
import { initializeLocalizer } from "@/utils/text/localizer";
import { createPersona, createServerConfig } from "../../helpers/fixtures";
import { FIXTURE_IDS, insertFixtures, cleanupFixtures, type FixtureRefs } from "./setup/fixtures";
import { DB_TESTS_AVAILABLE, setupTestDb, testSql, executeTestSqlFile } from "./setup/testDb";
import { workspaceConfigExportSchema } from "@/types/db/dataExport";

describe.skipIf(!DB_TESTS_AVAILABLE)("Response Drafting persistence", () => {
  let refs: FixtureRefs;
  let reviewerId: number;
  let decisionId: number;
  let otherServerId: number;
  beforeAll(async () => {
    await setupTestDb();
    await initializeLocalizer();
    refs = await insertFixtures(testSql);
    await resetRepository.resetServerConfiguration(refs.serverId);
    const reviewer = await llmModelRepo.upsertScopedLlm("_rt_reviewer", {
      hasTools: true,
      seesImages: false,
      seesVideos: false,
      seesYoutube: false,
      supportsStructuredOutput: true,
    });
    if (!reviewer) throw new Error("Missing reviewer fixture");
    reviewerId = reviewer;
    decisionId = await llmModelRepo.upsertDecisionModel({
      provider: "openrouter",
      codename: "_rt_decision",
      inputTokenLimit: 8192,
    });
    await llmProviderRepo.upsertOpenRouterModelRegistration({ serverId: refs.serverId, llmId: reviewerId });
    await llmProviderRepo.upsertDecisionModelRegistration({ serverId: refs.serverId, decisionModelId: decisionId });
    await testSql`INSERT INTO saved_provider_configs (server_id, provider, api_key, key_version) VALUES (${refs.serverId}, 'openrouter', ${Buffer.from("fixture")}, 1) ON CONFLICT (server_id, provider) DO NOTHING`;
    const [other] = await testSql`INSERT INTO servers (server_disc_id) VALUES ('_rt_draft_other') RETURNING server_id`;
    otherServerId = other.server_id;
    for (const table of [
      "server_chat_configs",
      "server_capabilities_configs",
      "server_model_configs",
      "server_welcome_configs",
    ]) {
      await testSql.unsafe(`INSERT INTO ${table} (server_id) VALUES ($1)`, [otherServerId]);
    }
  });
  afterAll(async () => {
    cache.delete(FIXTURE_IDS.serverDiscId);
    await testSql`DELETE FROM servers WHERE server_id = ${otherServerId}`;
    await cleanupFixtures(testSql);
    await testSql`DELETE FROM llms WHERE llm_codename = '_rt_reviewer'`;
    await testSql`DELETE FROM decision_models WHERE codename = '_rt_decision'`;
  });
  const state = () => createPersona({ server_id: refs.serverId });

  it("loads defaults and every saved field through both assembled SELECTs and the capabilities repository", async () => {
    const initial = await personaRepository.loadState(FIXTURE_IDS.serverDiscId);
    expect(initial?.config.response_drafting_enabled).toBe(false);
    for (const key of [
      "response_reviewer_llm_id",
      "response_decision_model_id",
      "response_reviewer_prompt",
      "response_rule_checker_ref",
    ] as const)
      expect(initial?.config[key]).toBeNull();
    const [primary] =
      await testSql`SELECT llm_id, api_key FROM server_model_configs WHERE server_id = ${refs.serverId}`;
    expect(
      await responseDraftingOperations.setModel(
        state(),
        FIXTURE_IDS.serverDiscId,
        "reviewer",
        "openrouter",
        reviewerId,
      ),
    ).toBe("success");
    expect(
      await responseDraftingOperations.setModel(
        state(),
        FIXTURE_IDS.serverDiscId,
        "decision",
        "openrouter",
        decisionId,
      ),
    ).toBe("success");
    const prompt = "🙂".repeat(4000);
    expect(await responseDraftingOperations.setPrompt(state(), FIXTURE_IDS.serverDiscId, prompt)).toBe("success");
    expect(await responseDraftingOperations.setEnabled(state(), FIXTURE_IDS.serverDiscId, true)).toBe("success");
    const binding = { scope: "workspace" as const, registrationId: 99, toolName: "check_slop" as const };
    await configRepository.updateChatConfig(refs.serverId, { response_rule_checker_ref: binding });
    await executeTestSqlFile("src/db/schema.sql");
    const expected = {
      response_drafting_enabled: true,
      response_reviewer_llm_id: reviewerId,
      response_decision_model_id: decisionId,
      response_reviewer_prompt: prompt,
      response_rule_checker_ref: binding,
    };
    for (const loaded of [
      await personaRepository.loadState(FIXTURE_IDS.serverDiscId),
      ...(await personaRepository.loadAllForServer(FIXTURE_IDS.serverDiscId)),
    ])
      expect(loaded?.config).toMatchObject(expected);
    const legacy = await (
      personaRepository as unknown as {
        sqlLoadTomoriConfigByTomoriId(id: number): Promise<AssembledServerConfig | null>;
      }
    ).sqlLoadTomoriConfigByTomoriId(refs.personaId);
    expect(legacy).toMatchObject(expected);
    expect(
      (await configRepository.toExportShape(FIXTURE_IDS.serverDiscId))?.capabilities?.response_drafting_enabled,
    ).toBe(true);
    const [after] = await testSql`SELECT llm_id, api_key FROM server_model_configs WHERE server_id = ${refs.serverId}`;
    expect(after).toEqual(primary);
    expect(await responseDraftingOperations.setChecker(state(), FIXTURE_IDS.serverDiscId, null)).toBe("success");
  });

  it("rejects guessed, deleted and cross-owner models", async () => {
    const other = createPersona({ server_id: otherServerId });
    expect(
      await responseDraftingOperations.setModel(other, "_rt_draft_other", "reviewer", "openrouter", reviewerId),
    ).toBe("stale");
    expect(
      await responseDraftingOperations.setModel(other, "_rt_draft_other", "decision", "openrouter", decisionId),
    ).toBe("stale");
    expect(
      await responseDraftingOperations.setModel(state(), FIXTURE_IDS.serverDiscId, "reviewer", "google", reviewerId),
    ).toBe("stale");
    expect(
      await responseDraftingOperations.setModel(
        state(),
        FIXTURE_IDS.serverDiscId,
        "decision",
        "openrouter",
        2147483647,
      ),
    ).toBe("stale");
    expect(await responseDraftingOperations.setPrompt(state(), FIXTURE_IDS.serverDiscId, " ")).toBe("invalid");
    expect(await configRepository.updateChatConfig(-1, { response_reviewer_prompt: "fixture" })).toBe(false);
  });

  it("preserves cached and durable settings after a rejected write and reloads them in a fresh process", async () => {
    const [before] =
      await testSql`SELECT response_reviewer_llm_id, response_decision_model_id, response_reviewer_prompt, response_rule_checker_ref FROM server_chat_configs WHERE server_id = ${refs.serverId}`;
    const cached = await personaRepository.loadState(FIXTURE_IDS.serverDiscId);
    if (!cached) throw new Error("Missing workspace fixture");
    cache.set(FIXTURE_IDS.serverDiscId, { personas: [cached], mainPersona: cached, cachedAt: Date.now() });
    expect(await configRepository.updateChatConfig(refs.serverId, { response_reviewer_llm_id: 2147483647 })).toBe(
      false,
    );
    expect(cache.get(FIXTURE_IDS.serverDiscId)?.mainPersona).toBe(cached);
    const [after] =
      await testSql`SELECT response_reviewer_llm_id, response_decision_model_id, response_reviewer_prompt, response_rule_checker_ref FROM server_chat_configs WHERE server_id = ${refs.serverId}`;
    expect(after).toEqual(before);
    // A new process has no persona cache and reads the committed config through the runtime repository.
    const script = `
      import {personaRepository} from "./src/utils/db/repositories";
      const state = await personaRepository.loadState(${JSON.stringify(FIXTURE_IDS.serverDiscId)});
      const expected = ${JSON.stringify(before)};
      if(!state || !Object.entries(expected).every(([key,value])=>JSON.stringify(state.config[key])===JSON.stringify(value))) process.exit(1);
      process.exit(0);
    `;
    const child = Bun.spawn([process.execPath, "--eval", script], {
      cwd: process.cwd(),
      env: process.env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exit] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(exit).toBe(0);
    cache.delete(FIXTURE_IDS.serverDiscId);
  });

  it("round-trips local selections, rejects external imports before writes, and resets to defaults", async () => {
    const result = await exportRepository.exportWorkspaceConfig(FIXTURE_IDS.serverDiscId);
    expect(result.success).toBe(true);
    const exported = workspaceConfigExportSchema.parse(result.data);
    expect(exported.data.chat).toMatchObject({
      response_reviewer_llm_id: reviewerId,
      response_decision_model_id: decisionId,
    });
    expect(JSON.stringify(exported)).not.toContain("api_key");
    expect(JSON.stringify(exported)).not.toContain("auth_token");
    const rejected = await importRepository.importWorkspaceConfig("_rt_draft_other", exported, ["chat"]);
    expect(rejected.success).toBe(false);
    expect(rejected.error).toBe("commands.config.drafting.import_unavailable");
    const [other] =
      await testSql`SELECT response_reviewer_prompt FROM server_chat_configs WHERE server_id = ${otherServerId}`;
    expect(other.response_reviewer_prompt).toBeNull();
    expect((await importRepository.importWorkspaceConfig(FIXTURE_IDS.serverDiscId, exported)).success).toBe(true);
    await resetRepository.resetServerConfiguration(refs.serverId);
    const reset = await personaRepository.loadState(FIXTURE_IDS.serverDiscId);
    expect(reset?.config).toMatchObject({
      response_drafting_enabled: false,
      response_reviewer_llm_id: null,
      response_decision_model_id: null,
      response_reviewer_prompt: null,
      response_rule_checker_ref: null,
    });
  });

  it("binds compatible owned enabled MCP registrations and retains unavailable references", async () => {
    const [checker] =
      await testSql`INSERT INTO guild_mcp_servers (server_id, name, url, is_enabled, last_discovered_tool_names) VALUES (${refs.serverId}, '_rt_checker', 'https://example.invalid/mcp', true, ARRAY['check_slop']) RETURNING guild_mcp_id`;
    const fake: CallableTool = {
      tool: async () => ({
        functionDeclarations: [
          {
            name: "check_slop",
            parametersJsonSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
          },
        ],
      }),
      callTool: async () => {
        throw new Error("Checker must not execute in configuration");
      },
    };
    const registered = spyOn(getGuildMcpManager(), "getRegisteredTool").mockResolvedValue(fake);
    try {
      const choices = await loadDraftCheckerChoices(refs.serverId);
      const reference = choices.find(
        (choice) => choice.reference.scope === "workspace" && choice.reference.registrationId === checker.guild_mcp_id,
      )?.reference;
      expect(reference).toBeDefined();
      if (!reference) throw new Error("Missing checker");
      expect(await responseDraftingOperations.setChecker(state(), FIXTURE_IDS.serverDiscId, reference)).toBe("success");
      expect(
        await responseDraftingOperations.setChecker(
          createPersona({ server_id: otherServerId }),
          "_rt_draft_other",
          reference,
        ),
      ).toBe("stale");
      await testSql`UPDATE guild_mcp_servers SET is_enabled = false WHERE guild_mcp_id = ${checker.guild_mcp_id}`;
      expect((await loadResponseDraftingView(state(), "en-US")).checkers).not.toContainEqual(choices[0]);
      const [saved] =
        await testSql`SELECT response_rule_checker_ref FROM server_chat_configs WHERE server_id = ${refs.serverId}`;
      expect(
        typeof saved.response_rule_checker_ref === "string"
          ? JSON.parse(saved.response_rule_checker_ref)
          : saved.response_rule_checker_ref,
      ).toEqual(reference);
      await testSql`DELETE FROM guild_mcp_servers WHERE guild_mcp_id = ${checker.guild_mcp_id}`;
      expect(await responseDraftingOperations.setChecker(state(), FIXTURE_IDS.serverDiscId, reference)).toBe("stale");
      expect(await responseDraftingOperations.setChecker(state(), FIXTURE_IDS.serverDiscId, null)).toBe("success");
    } finally {
      registered.mockRestore();
    }
  });

  it("clears registration/provider references only for the deleted owner after commit", async () => {
    await llmProviderRepo.upsertOpenRouterModelRegistration({ serverId: otherServerId, llmId: reviewerId });
    await llmProviderRepo.upsertDecisionModelRegistration({ serverId: otherServerId, decisionModelId: decisionId });
    for (const serverId of [refs.serverId, otherServerId])
      await configRepository.updateChatConfig(serverId, {
        response_reviewer_llm_id: reviewerId,
        response_decision_model_id: decisionId,
      });
    const cached = state();
    cache.set(FIXTURE_IDS.serverDiscId, { personas: [cached], mainPersona: cached, cachedAt: Date.now() });
    expect(await llmProviderRepo.deleteServerProviderRegistration(refs.serverId, "absent-provider")).toBe(false);
    expect(cache.has(FIXTURE_IDS.serverDiscId)).toBe(true);
    expect(
      await llmProviderRepo.deleteOpenRouterModelRegistration({ serverId: refs.serverId, llmId: reviewerId }),
    ).toBe(true);
    expect(
      await llmProviderRepo.deleteDecisionModelRegistration({ serverId: refs.serverId, decisionModelId: decisionId }),
    ).toBe(true);
    expect(cache.has(FIXTURE_IDS.serverDiscId)).toBe(false);
    const rows = await testSql<
      Array<{ server_id: number; response_reviewer_llm_id: number | null; response_decision_model_id: number | null }>
    >`SELECT server_id, response_reviewer_llm_id, response_decision_model_id FROM server_chat_configs WHERE server_id IN (${refs.serverId}, ${otherServerId})`;
    expect(rows.find((row) => row.server_id === refs.serverId)).toMatchObject({
      response_reviewer_llm_id: null,
      response_decision_model_id: null,
    });
    expect(rows.find((row) => row.server_id === otherServerId)).toMatchObject({
      response_reviewer_llm_id: reviewerId,
      response_decision_model_id: decisionId,
    });
    await llmProviderRepo.upsertOpenRouterModelRegistration({ serverId: refs.serverId, llmId: reviewerId });
    await llmProviderRepo.upsertDecisionModelRegistration({ serverId: refs.serverId, decisionModelId: decisionId });
    await configRepository.updateChatConfig(refs.serverId, {
      response_reviewer_llm_id: reviewerId,
      response_decision_model_id: decisionId,
    });
    expect(await llmProviderRepo.deleteServerProviderRegistration(refs.serverId, "openrouter")).toBe(true);
    const [removed] =
      await testSql`SELECT response_reviewer_llm_id, response_decision_model_id FROM server_chat_configs WHERE server_id = ${refs.serverId}`;
    expect(removed).toMatchObject({ response_reviewer_llm_id: null, response_decision_model_id: null });
    expect(await loadDraftingModelGroups(refs.serverId, "reviewer", "en-US")).toEqual([]);
  });

  it("clears auxiliary references when an owned custom connection group is removed", async () => {
    const scope = { kind: "server" as const, ownerId: refs.serverId, baseConfig: createServerConfig() };
    const reviewer = await registerCustomEndpoint({
      scope,
      label: "_rt_draft_custom",
      capability: "text",
      apiStyle: "openai-compatible",
      endpointUrl: "https://example.invalid/v1",
      modelName: "reviewer",
      supportsStructOutput: true,
    });
    const decision = await registerCustomEndpoint({
      scope,
      label: "_rt_draft_decision",
      capability: "decision",
      apiStyle: "system-one",
      endpointUrl: "https://example.invalid/decision/v1",
      modelName: "decision",
      numCtx: 8192,
    });
    if (!reviewer?.modelId || !decision?.modelId) throw new Error("Missing custom fixture");
    expect(
      await responseDraftingOperations.setModel(
        state(),
        FIXTURE_IDS.serverDiscId,
        "reviewer",
        reviewer.provider,
        reviewer.modelId,
      ),
    ).toBe("success");
    expect(
      await responseDraftingOperations.setModel(
        state(),
        FIXTURE_IDS.serverDiscId,
        "decision",
        decision.provider,
        decision.modelId,
      ),
    ).toBe("success");
    expect(
      await llmProviderRepo.deleteServerCustomEndpointConnectionGroup(otherServerId, [
        reviewer.customEndpoint.connection_id,
      ]),
    ).toBe(false);
    const cached = state();
    cache.set(FIXTURE_IDS.serverDiscId, { personas: [cached], mainPersona: cached, cachedAt: Date.now() });
    expect(
      await llmProviderRepo.deleteServerCustomEndpointConnectionGroup(refs.serverId, [
        reviewer.customEndpoint.connection_id,
        decision.customEndpoint.connection_id,
      ]),
    ).toBe(true);
    expect(cache.has(FIXTURE_IDS.serverDiscId)).toBe(false);
    const [cleared] =
      await testSql`SELECT response_reviewer_llm_id, response_decision_model_id FROM server_chat_configs WHERE server_id = ${refs.serverId}`;
    expect(cleared).toMatchObject({ response_reviewer_llm_id: null, response_decision_model_id: null });
  });

  it("clears retired catalog selections during seeding and restores inheritance on deletion", async () => {
    await testSql`UPDATE llms SET is_deprecated = true WHERE llm_id = ${reviewerId}`;
    await testSql`UPDATE decision_models SET is_deprecated = true WHERE decision_model_id = ${decisionId}`;
    await seedModelsFromCatalog(testSql);
    const [retired] =
      await testSql`SELECT response_reviewer_llm_id, response_decision_model_id FROM server_chat_configs WHERE server_id = ${otherServerId}`;
    expect(retired).toMatchObject({ response_reviewer_llm_id: null, response_decision_model_id: null });
    await configRepository.updateChatConfig(otherServerId, {
      response_reviewer_llm_id: reviewerId,
      response_decision_model_id: decisionId,
    });
    await testSql`DELETE FROM llms WHERE llm_id = ${reviewerId}`;
    await testSql`DELETE FROM decision_models WHERE decision_model_id = ${decisionId}`;
    const [deleted] =
      await testSql`SELECT response_reviewer_llm_id, response_decision_model_id FROM server_chat_configs WHERE server_id = ${otherServerId}`;
    expect(deleted).toMatchObject({ response_reviewer_llm_id: null, response_decision_model_id: null });
  });
});
