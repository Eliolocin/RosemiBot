import { beforeAll, describe, expect, it } from "bun:test";
import { llmModelRepo, llmProviderRepo } from "@/utils/db/repositories";
import { callDecisionsForProvider } from "@/providers/utils/providerFeatureExecutors";
import { registerCustomEndpoint } from "@/utils/provider/customEndpointService";
import { createServerConfig } from "../../helpers/fixtures";
import { resetRepository } from "@/utils/db/repositories/ResetRepository";
import { initializeDatabase } from "@/utils/db/initializeDatabase";
import { splitSqlStatements } from "@/utils/db/sqlSplitter";
import { insertFixtures } from "./setup/fixtures";
import { DB_TESTS_AVAILABLE, executeTestSqlFile, setupTestDb, testSql } from "./setup/testDb";

describe.skipIf(!DB_TESTS_AVAILABLE)("Decision model persistence", () => {
  let serverId: number;
  let userId: number;
  beforeAll(async () => {
    await setupTestDb();
    await executeTestSqlFile("src/db/migrations/098_decision_models.sql");
    ({ serverId, userId } = await insertFixtures(testSql));
  });

  async function runDecisionRollback(): Promise<void> {
    const statements = splitSqlStatements(await Bun.file("src/db/migrations/098_decision_models.down.sql").text());
    // The production rollback runner does not wrap these statements in a transaction.
    for (const statement of statements) await testSql.unsafe(statement);
    await testSql`DELETE FROM schema_migrations WHERE name = '098_decision_models'`;
  }

  it("refuses to discard a selected catalog model before changing the schema", async () => {
    const [model] = await testSql<Array<{ decision_model_id: number }>>`
      SELECT decision_model_id FROM decision_models WHERE provider = 'openrouter' AND is_default = true
    `;
    if (!model) throw new Error("Missing catalog fixture");
    await testSql`UPDATE server_chat_configs SET response_decision_model_id = ${model.decision_model_id} WHERE server_id = ${serverId}`;
    try {
      await expect(runDecisionRollback()).rejects.toThrow();
      const [saved] = await testSql<Array<{ response_decision_model_id: number }>>`
        SELECT response_decision_model_id FROM server_chat_configs WHERE server_id = ${serverId}
      `;
      expect(saved?.response_decision_model_id).toBe(model.decision_model_id);
      const [constraint] = await testSql<Array<{ definition: string }>>`
        SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
        WHERE conrelid = 'scoped_model_registrations'::regclass AND conname = 'scoped_model_registrations_one_model'
      `;
      expect(constraint?.definition).toContain("decision_model_id");
    } finally {
      await testSql`UPDATE server_chat_configs SET response_decision_model_id = NULL WHERE server_id = ${serverId}`;
      await initializeDatabase({ client: testSql, includeRag: false });
    }
  });

  it.each([
    "startup schema",
    "manual migration",
  ])("downgrades unused Decision models from %s and restores on startup", async (source) => {
    const [before] = await testSql<Array<{ response_reviewer_prompt: string | null; llm_id: number | null }>>`
      SELECT scc.response_reviewer_prompt, smc.llm_id FROM server_chat_configs scc
      JOIN server_model_configs smc USING (server_id) WHERE scc.server_id = ${serverId}
    `;
    const fixturePrompt = "Keep the fictional persona's quiet voice.";
    try {
      await testSql`UPDATE server_chat_configs SET response_reviewer_prompt = ${fixturePrompt} WHERE server_id = ${serverId}`;
      if (source === "manual migration")
        await testSql`ALTER TABLE server_chat_configs DROP COLUMN response_decision_model_id`;
      await runDecisionRollback();
      const [tables] = await testSql<Array<{ decision_models: string | null }>>`
        SELECT to_regclass('decision_models')::text AS decision_models
      `;
      expect(tables?.decision_models).toBeNull();
      const columns = await testSql`
        SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema()
          AND ((table_name = 'scoped_model_registrations' AND column_name = 'decision_model_id')
            OR (table_name = 'server_chat_configs' AND column_name = 'response_decision_model_id'))
      `;
      expect(columns).toHaveLength(0);
      const [constraint] = await testSql<Array<{ definition: string }>>`
        SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
        WHERE conrelid = 'scoped_model_registrations'::regclass AND conname = 'scoped_model_registrations_check1'
      `;
      expect(constraint?.definition).toContain(
        "num_nonnulls(llm_id, embedding_model_id, diffusion_model_id, video_model_id) = 1",
      );
      const [after] = await testSql`
        SELECT scc.response_reviewer_prompt, smc.llm_id FROM server_chat_configs scc
        JOIN server_model_configs smc USING (server_id) WHERE scc.server_id = ${serverId}
      `;
      expect(after).toEqual({ ...before, response_reviewer_prompt: fixturePrompt });
    } finally {
      await initializeDatabase({ client: testSql, includeRag: false });
      await testSql`UPDATE server_chat_configs SET response_reviewer_prompt = ${before.response_reviewer_prompt} WHERE server_id = ${serverId}`;
    }
    const [restored] = await testSql<Array<{ definition: string }>>`
      SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
      WHERE conrelid = 'server_chat_configs'::regclass AND conname = 'server_chat_configs_response_decision_model_id_fkey'
    `;
    expect(restored?.definition).toContain("REFERENCES decision_models(decision_model_id)");
    expect(restored?.definition).toContain("ON DELETE SET NULL");
  });

  it("replays the migration without losing registrations and isolates owners and text catalogs", async () => {
    const id = await llmModelRepo.upsertDecisionModel({
      provider: "openrouter",
      codename: "fixture-decision",
      inputTokenLimit: 8192,
    });
    const registration = await llmProviderRepo.upsertDecisionModelRegistration({ serverId, decisionModelId: id });
    expect(registration).not.toBeNull();
    await expect(runDecisionRollback()).rejects.toThrow();
    expect(await llmProviderRepo.upsertDecisionModelRegistration({ serverId, decisionModelId: id })).toEqual(
      registration,
    );
    await executeTestSqlFile("src/db/migrations/098_decision_models.sql");
    const owned = await llmModelRepo.loadAvailableDecisionModels("openrouter", false, {
      kind: "server",
      ownerId: serverId,
    });
    expect(owned.map((model) => model.decision_model_id)).toContain(id);
    const personal = await llmModelRepo.loadAvailableDecisionModels("openrouter", false, {
      kind: "personal",
      ownerId: userId,
    });
    expect(personal.map((model) => model.decision_model_id)).not.toContain(id);
    expect(
      (
        await llmModelRepo.loadAvailableModelsForProvider("openrouter", false, { kind: "server", ownerId: serverId })
      )?.some((model) => model.llm_codename === "fixture-decision"),
    ).toBe(false);
    expect(
      await llmProviderRepo.deleteOwnedDecisionRegistration({ kind: "personal", ownerId: userId }, "openrouter", id),
    ).toBe(false);
    expect(
      await llmProviderRepo.deleteOwnedDecisionRegistration({ kind: "server", ownerId: serverId }, "openrouter", id),
    ).toBe(true);
    expect(await llmModelRepo.loadDecisionModelByProviderAndCodename("openrouter", "fixture-decision")).toBeNull();
    const seeds = personal.filter((model) => !model.is_scoped_registration);
    expect(seeds.some((model) => model.codename === "typesafe/jev-1.13" && model.input_token_limit === 32000)).toBe(
      true,
    );
    expect(seeds.every((model) => model.provider === "openrouter")).toBe(true);
  });

  it("registers and edits exact custom identities without activating text, then deletes only the owned registration", async () => {
    const input = {
      scope: { kind: "personal" as const, ownerId: userId, baseConfig: createServerConfig() },
      label: "fixture-system-one",
      capability: "decision" as const,
      apiStyle: "system-one" as const,
      endpointUrl: "https://example.invalid/gateway/v1",
      modelName: "jev-1.13.0",
      numCtx: 32000,
    };
    const saved = await registerCustomEndpoint(input);
    expect(saved).not.toBeNull();
    if (!saved?.modelId) throw new Error("Missing registered model");
    const config = await llmProviderRepo.loadUserSavedProviderConfig(userId, saved.provider);
    expect(config?.llm_id).toBeNull();
    expect(saved.customEndpoint.is_default).toBe(false);
    expect(await llmModelRepo.loadAvailableModelsForProvider(saved.provider)).toEqual(null);
    const edited = await registerCustomEndpoint({
      ...input,
      modelName: "jev-latest",
      editingEndpointId: saved.customEndpoint.custom_endpoint_id,
    });
    expect(edited?.modelId).toBe(saved.modelId);
    expect(edited?.customEndpoint.custom_endpoint_id).toBe(saved.customEndpoint.custom_endpoint_id);
    const options = await llmModelRepo.loadDecisionModelOptions({ kind: "personal", ownerId: userId });
    const selected = options.find(
      (option) => option.reference.customEndpointId === saved.customEndpoint.custom_endpoint_id,
    );
    expect(selected?.model.codename).toBe("jev-latest");
    expect(selected?.reference).toMatchObject({
      provider: saved.provider,
      modelId: saved.modelId,
      registrationId: null,
    });
    if (!selected) throw new Error("Missing owned model option");
    const result = await callDecisionsForProvider({
      scope: { kind: "server", ownerId: serverId },
      reference: selected.reference,
      evidence: "fixture",
      questions: [{ type: "predicate", id: "criterion", instructions: "fixture" }],
    });
    expect(result).toMatchObject({ status: "unavailable", reason: "not-owned", errorLogged: false });
    expect(
      await llmProviderRepo.deleteOwnedDecisionRegistration(
        { kind: "server", ownerId: serverId },
        saved.provider,
        saved.modelId,
      ),
    ).toBe(false);
    expect(
      await llmProviderRepo.deleteOwnedDecisionRegistration(
        { kind: "personal", ownerId: userId },
        saved.provider,
        saved.modelId,
      ),
    ).toBe(true);
    expect(
      (await llmModelRepo.loadDecisionModelOptions({ kind: "personal", ownerId: userId })).some(
        (option) => option.reference.provider === saved.provider,
      ),
    ).toBe(false);
    expect(await llmProviderRepo.loadUserSavedProviderConfig(userId, saved.provider)).not.toBeNull();
    expect(
      await llmProviderRepo.deleteUserCustomEndpointConnectionGroup(userId, [saved.customEndpoint.connection_id]),
    ).toBe(true);
    expect(await llmProviderRepo.loadUserSavedProviderConfig(userId, saved.provider)).toBeNull();
  });

  it("preserves Decision registrations during reset and removes only the deleted native provider owner's references", async () => {
    const id = await llmModelRepo.upsertDecisionModel({
      provider: "openrouter",
      codename: "fixture-shared-owner",
      inputTokenLimit: 8192,
    });
    await llmProviderRepo.upsertDecisionModelRegistration({ serverId, decisionModelId: id });
    await llmProviderRepo.upsertDecisionModelRegistration({ userId, decisionModelId: id });
    await testSql`INSERT INTO saved_provider_configs (server_id, provider, api_key, key_version) VALUES (${serverId}, 'openrouter', ${Buffer.from("fixture")}, 1) ON CONFLICT (server_id, provider) DO NOTHING`;
    await resetRepository.resetServerConfiguration(serverId);
    expect(
      (await llmModelRepo.loadDecisionModelOptions({ kind: "server", ownerId: serverId })).some(
        (option) => option.reference.modelId === id,
      ),
    ).toBe(true);
    expect(await llmProviderRepo.deleteServerProviderRegistration(serverId, "openrouter")).toBe(true);
    expect(
      (await llmModelRepo.loadAvailableDecisionModels("openrouter", false, { kind: "server", ownerId: serverId })).some(
        (model) => model.decision_model_id === id,
      ),
    ).toBe(false);
    expect(
      (await llmModelRepo.loadAvailableDecisionModels("openrouter", false, { kind: "personal", ownerId: userId })).some(
        (model) => model.decision_model_id === id,
      ),
    ).toBe(true);
    await llmProviderRepo.deleteDecisionModelRegistration({ userId, decisionModelId: id });
    await llmModelRepo.deleteOrphanedDecisionModel(id);
  });

  it("rejects chat styles and undocumented input limits without persisting decision models", async () => {
    for (const apiStyle of ["openai-compatible", "ollama-native"] as const) {
      expect(
        await registerCustomEndpoint({
          scope: { kind: "personal", ownerId: userId, baseConfig: createServerConfig() },
          label: "fixture-invalid",
          capability: "decision",
          apiStyle,
          endpointUrl: "https://example.invalid/v1",
          modelName: "fixture",
          numCtx: 8192,
        }),
      ).toBeNull();
    }
    expect(
      await llmModelRepo
        .upsertDecisionModel({ provider: "openrouter", codename: "fixture-invalid", inputTokenLimit: Number.NaN })
        .catch(() => null),
    ).toBeNull();
    expect(await llmModelRepo.loadDecisionModelByProviderAndCodename("openrouter", "fixture-invalid")).toBeNull();
  });

  it("executes through exact server and personal credentials using a local fake transport", async () => {
    const calls: Array<{ authorization: string | null; model: unknown; path: string }> = [];
    const transport = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: async (request) => {
        const body = (await request.json()) as { model: unknown };
        calls.push({
          authorization: request.headers.get("authorization"),
          model: body.model,
          path: new URL(request.url).pathname,
        });
        return Response.json({ model: "fixture-version", answers: { criterion: { type: "noul", noul: 0.8 } } });
      },
    });
    try {
      for (const scope of [
        { kind: "server" as const, ownerId: serverId, baseConfig: createServerConfig() },
        { kind: "personal" as const, ownerId: userId, baseConfig: createServerConfig() },
      ]) {
        const saved = await registerCustomEndpoint({
          scope,
          label: "fixture-credentials",
          capability: "decision",
          apiStyle: "system-one",
          endpointUrl: `http://localhost:${transport.port}/gateway/v1`,
          modelName: `${scope.kind}-decision`,
          numCtx: 8192,
          authToken: `${scope.kind}-fixture-key`,
        });
        if (!saved?.modelId) throw new Error("Missing credential fixture registration");
        const selected = (await llmModelRepo.loadDecisionModelOptions(scope)).find(
          (option) => option.reference.modelId === saved.modelId,
        );
        if (!selected) throw new Error("Missing credential fixture option");
        const result = await callDecisionsForProvider({
          scope,
          reference: selected.reference,
          evidence: "fixture",
          questions: [{ type: "predicate", id: "criterion", instructions: "fixture" }],
        });
        expect(result.status).toBe("completed");
        expect(calls.at(-1)).toEqual({
          authorization: `Bearer ${scope.kind}-fixture-key`,
          model: `${scope.kind}-decision`,
          path: "/gateway/v1/systemone",
        });
        const deleted =
          scope.kind === "server"
            ? await llmProviderRepo.deleteServerCustomEndpointConnectionGroup(serverId, [
                saved.customEndpoint.connection_id,
              ])
            : await llmProviderRepo.deleteUserCustomEndpointConnectionGroup(userId, [
                saved.customEndpoint.connection_id,
              ]);
        expect(deleted).toBe(true);
      }
    } finally {
      transport.stop(true);
    }
  });
});
