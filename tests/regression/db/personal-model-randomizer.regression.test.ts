import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { join } from "node:path";
import type {
  AssembledServerConfig,
  FallbackModelRef,
  LlmRow,
  TomoriState,
  UserSavedProviderConfigUpsert,
} from "@/types/db/schema";
import { llmModelRepo, llmProviderRepo } from "@/utils/db/repositories";
import { applyPersonalProviderSelectionsToTomoriState } from "@/utils/provider/personalProviderRuntime";
import {
  buildSavedProviderConfigFromExistingOrDefaults,
  buildUserSavedProviderConfigFromExistingOrDefaults,
} from "@/utils/provider/savedProviderConfig";
import { DB_TESTS_AVAILABLE, executeTestSqlFile, setupTestDb, testSql } from "./setup/testDb";
import { createPersona } from "../../helpers/fixtures";

const USER_DISC_A = "_rt_randomizer_user_a";
const USER_DISC_B = "_rt_randomizer_user_b";
const BACKFILL_DISC_ACTIVE = "_rt_fallback_backfill_active";
const BACKFILL_DISC_STORED = "_rt_fallback_backfill_stored";
const BACKFILL_DISC_NONE = "_rt_fallback_backfill_none";
const SERVER_DISC = "_rt_randomizer_server";
const ALL_USER_DISCS = [USER_DISC_A, USER_DISC_B, BACKFILL_DISC_ACTIVE, BACKFILL_DISC_STORED, BACKFILL_DISC_NONE];

const MIGRATIONS_DIR = join(import.meta.dir, "..", "..", "..", "src", "db", "migrations");

describe.skipIf(!DB_TESTS_AVAILABLE)("Personal fallback chain and randomizer data layer (migration 116)", () => {
  let userAId: number;
  let userBId: number;
  let serverId: number;
  let sampleLlm: LlmRow;

  beforeAll(async () => {
    await setupTestDb();

    // Clean up any stale fixtures from prior interrupted runs.
    await testSql`DELETE FROM users WHERE user_disc_id = ANY(${testSql.array(ALL_USER_DISCS, "TEXT")})`;
    await testSql`DELETE FROM servers WHERE server_disc_id = ${SERVER_DISC}`;

    const [serverRow] = await testSql<[{ server_id: number }]>`
      INSERT INTO servers (server_disc_id) VALUES (${SERVER_DISC}) RETURNING server_id
    `;
    serverId = Number(serverRow.server_id);

    const [userARow] = await testSql<[{ user_id: number }]>`
      INSERT INTO users (user_disc_id) VALUES (${USER_DISC_A}) RETURNING user_id
    `;
    userAId = Number(userARow.user_id);

    const [userBRow] = await testSql<[{ user_id: number }]>`
      INSERT INTO users (user_disc_id) VALUES (${USER_DISC_B}) RETURNING user_id
    `;
    userBId = Number(userBRow.user_id);

    const available = await llmModelRepo.loadAvailableLlms();
    if (!available || available.length === 0) {
      throw new Error("No seeded LLMs found in database");
    }
    sampleLlm = available[0];
  });

  afterAll(async () => {
    await testSql`DELETE FROM users WHERE user_disc_id = ANY(${testSql.array(ALL_USER_DISCS, "TEXT")})`;
    await testSql`DELETE FROM servers WHERE server_disc_id = ${SERVER_DISC}`;
  });

  function makeBaseConfig(overrides: Partial<AssembledServerConfig> = {}): AssembledServerConfig {
    return {
      server_id: serverId,
      model_randomizer_enabled: false,
      thinking_level: "auto",
      llm_temperature: 0.7,
      llm_top_p: 0.95,
      llm_top_k: 0,
      llm_frequency_penalty: 0.0,
      llm_presence_penalty: 0.0,
      llm_min_p: 0.05,
      llm_disabled_params: [],
      llm_logit_biases: [],
      fallback_llm_ids: [],
      fallback_model_refs: [],
      ...overrides,
    } as unknown as AssembledServerConfig;
  }

  function makeState(randomizerEnabled: boolean): TomoriState {
    return createPersona({
      // The server id and the model row come from the provisioned test database, so both are
      // overrides rather than shared factory defaults.
      server_id: serverId,
      persona_id: 1,
      persona_lineage_id: 1,
      persona_nickname: "test",
      is_alter: false,
      llm: sampleLlm,
      config: makeBaseConfig({ model_randomizer_enabled: randomizerEnabled }),
    });
  }

  async function savePersonalTextRow(
    userId: number,
    provider: string,
    enabledCapabilities: UserSavedProviderConfigUpsert["enabled_capabilities"],
  ): Promise<UserSavedProviderConfigUpsert> {
    const config = await buildUserSavedProviderConfigFromExistingOrDefaults({
      userId,
      provider,
      apiKey: null,
      keyVersion: 1,
      baseConfig: makeBaseConfig(),
      llmId: sampleLlm.llm_id,
      enabledCapabilities,
    });
    expect(await llmProviderRepo.upsertUserSavedProviderConfig(userId, config)).toBe(true);
    return config;
  }

  async function resetPersonalState(userIds: number[]): Promise<void> {
    await testSql`DELETE FROM user_saved_provider_configs WHERE user_id = ANY(${testSql.array(userIds, "INT")})`;
    await testSql`DELETE FROM user_personalization_configs WHERE user_id = ANY(${testSql.array(userIds, "INT")})`;
  }

  it("preserves saved sampler settings when rebuilding personal and server provider snapshots", async () => {
    const savedParameters = {
      llm_temperature: 0.5,
      llm_top_p: 0.75,
      llm_top_k: 32,
      llm_frequency_penalty: 0.25,
      llm_presence_penalty: 0.5,
      llm_min_p: 0.125,
      llm_max_output_tokens: 1_024,
      thinking_level: "low" as const,
    };
    const baseConfig = makeBaseConfig({ llm_max_output_tokens: 8_192 });
    const personal = await buildUserSavedProviderConfigFromExistingOrDefaults({
      userId: userAId,
      provider: "google",
      apiKey: null,
      keyVersion: 1,
      baseConfig,
      llmId: sampleLlm.llm_id,
    });
    const server = await buildSavedProviderConfigFromExistingOrDefaults({
      serverId,
      provider: "google",
      apiKey: null,
      keyVersion: 1,
      baseConfig,
      llmId: sampleLlm.llm_id,
    });
    expect(personal.llm_max_output_tokens).toBe(baseConfig.llm_max_output_tokens);
    expect(server.llm_max_output_tokens).toBe(baseConfig.llm_max_output_tokens);
    expect(await llmProviderRepo.upsertUserSavedProviderConfig(userAId, { ...personal, ...savedParameters })).toBe(
      true,
    );
    expect(await llmProviderRepo.upsertSavedProviderConfig(serverId, { ...server, ...savedParameters })).toBe(true);

    const rebuiltPersonal = await buildUserSavedProviderConfigFromExistingOrDefaults({
      userId: userAId,
      provider: "google",
      apiKey: null,
      keyVersion: 1,
      baseConfig,
      existingConfig: await llmProviderRepo.loadUserSavedProviderConfig(userAId, "google"),
    });
    const rebuiltServer = await buildSavedProviderConfigFromExistingOrDefaults({
      serverId,
      provider: "google",
      apiKey: null,
      keyVersion: 1,
      baseConfig,
      existingConfig: await llmProviderRepo.loadSavedProviderConfig(serverId, "google"),
    });
    expect(await llmProviderRepo.upsertUserSavedProviderConfig(userAId, rebuiltPersonal)).toBe(true);
    expect(await llmProviderRepo.upsertSavedProviderConfig(serverId, rebuiltServer)).toBe(true);

    expect(await llmProviderRepo.loadUserSavedProviderConfig(userAId, "google")).toMatchObject(savedParameters);
    expect(await llmProviderRepo.loadSavedProviderConfig(serverId, "google")).toMatchObject(savedParameters);
  });

  it("overrides server true with personal false when an active personal text route has randomizer disabled", async () => {
    await resetPersonalState([userAId]);
    await savePersonalTextRow(userAId, "google", ["text"]);

    const result = await applyPersonalProviderSelectionsToTomoriState(makeState(true), userAId);

    expect(result.activeConfigs.text?.provider).toBe("google");
    expect(result.tomoriState.config.model_randomizer_enabled).toBe(false);
  });

  it("overrides server false with personal true when an active personal text route has randomizer enabled", async () => {
    await resetPersonalState([userAId]);
    await savePersonalTextRow(userAId, "google", ["text"]);
    expect(await llmProviderRepo.updatePersonalModelRandomizer(userAId, true)).toBe(true);

    const result = await applyPersonalProviderSelectionsToTomoriState(makeState(false), userAId);

    expect(result.tomoriState.config.model_randomizer_enabled).toBe(true);
  });

  it("obeys server flag when no personal text route is active", async () => {
    await resetPersonalState([userAId]);

    const resultNoRowsTrue = await applyPersonalProviderSelectionsToTomoriState(makeState(true), userAId);
    expect(resultNoRowsTrue.tomoriState.config.model_randomizer_enabled).toBe(true);
    const resultNoRowsFalse = await applyPersonalProviderSelectionsToTomoriState(makeState(false), userAId);
    expect(resultNoRowsFalse.tomoriState.config.model_randomizer_enabled).toBe(false);

    const nonTextConfig = await savePersonalTextRow(userAId, "google", ["image"]);
    await llmProviderRepo.updatePersonalModelRandomizer(userAId, true);

    const nonTextResult = await applyPersonalProviderSelectionsToTomoriState(makeState(false), userAId);
    expect(nonTextResult.activeConfigs.text).toBeUndefined();
    expect(nonTextResult.tomoriState.config.model_randomizer_enabled).toBe(false);

    // Text is enabled but the row has no model, so personal text is still not active.
    await llmProviderRepo.upsertUserSavedProviderConfig(userAId, {
      ...nonTextConfig,
      llm_id: null,
      enabled_capabilities: ["text"],
      assigned_capabilities: ["text"],
    });

    const nullModelResult = await applyPersonalProviderSelectionsToTomoriState(makeState(false), userAId);
    expect(nullModelResult.activeConfigs.text).toBeUndefined();
    expect(nullModelResult.tomoriState.config.model_randomizer_enabled).toBe(false);
  });

  it("keeps the chain and randomizer when provider rows are rewritten or the text provider changes", async () => {
    await resetPersonalState([userAId]);
    const google = await savePersonalTextRow(userAId, "google", ["text"]);
    const openrouter = await savePersonalTextRow(userAId, "openrouter", []);
    const chain = [
      { type: "llm" as const, id: 900_001 },
      { type: "custom_endpoint" as const, id: 900_002 },
    ];
    expect(await llmProviderRepo.updatePersonalFallbackModelRefs(userAId, chain)).toBe(true);
    expect(await llmProviderRepo.updatePersonalModelRandomizer(userAId, true)).toBe(true);

    expect(await llmProviderRepo.upsertUserSavedProviderConfig(userAId, { ...google, llm_temperature: 0.25 })).toBe(
      true,
    );
    expect(
      await llmProviderRepo.upsertUserSavedProviderConfig(userAId, {
        ...google,
        enabled_capabilities: [],
        assigned_capabilities: [],
      }),
    ).toBe(true);
    expect(
      await llmProviderRepo.upsertUserSavedProviderConfig(userAId, {
        ...openrouter,
        enabled_capabilities: ["text"],
        assigned_capabilities: ["text"],
      }),
    ).toBe(true);

    expect(await llmProviderRepo.loadPersonalFallbackSettings(userAId)).toEqual({
      fallback_model_refs: chain,
      model_randomizer_enabled: true,
    });
  });

  it("scopes the user-level setters to one user and creates a missing personalization row", async () => {
    await resetPersonalState([userAId, userBId]);

    expect(await llmProviderRepo.updatePersonalModelRandomizer(userAId, true)).toBe(true);
    expect(await llmProviderRepo.updatePersonalFallbackModelRefs(userAId, [{ type: "llm", id: 900_003 }])).toBe(true);

    expect(await llmProviderRepo.loadPersonalFallbackSettings(userAId)).toEqual({
      fallback_model_refs: [{ type: "llm", id: 900_003 }],
      model_randomizer_enabled: true,
    });
    expect(await llmProviderRepo.loadPersonalFallbackSettings(userBId)).toEqual({
      fallback_model_refs: [],
      model_randomizer_enabled: false,
    });

    // The model-reference check reads the chain in SQL, so it must be stored as a JSONB array rather
    // than the scalar string Bun produces for a bound `JSON.stringify(...)::jsonb`.
    const [stored] = await testSql<[{ shape: string }]>`
      SELECT jsonb_typeof(fallback_model_refs) AS shape FROM user_personalization_configs WHERE user_id = ${userAId}
    `;
    expect(stored.shape).toBe("array");

    expect(await llmProviderRepo.updatePersonalModelRandomizer(999_999_999, true)).toBe(false);
  });

  it("backfills from the active text row, else the stored text row, and leaves users without one at defaults", async () => {
    const userIds: Record<string, number> = {};
    for (const disc of [BACKFILL_DISC_ACTIVE, BACKFILL_DISC_STORED, BACKFILL_DISC_NONE]) {
      const [row] = await testSql<[{ user_id: number }]>`
        INSERT INTO users (user_disc_id) VALUES (${disc}) RETURNING user_id
      `;
      userIds[disc] = Number(row.user_id);
    }

    const activeChain: FallbackModelRef[] = [{ type: "llm", id: 900_010 }];
    const storedChain: FallbackModelRef[] = [{ type: "llm", id: 900_020 }];
    const ignoredChain: FallbackModelRef[] = [{ type: "llm", id: 900_099 }];

    // Every DB regression file shares one disposable database, so the up migration is re-applied
    // from `finally` to keep a failed assertion here from breaking later suites.
    await executeTestSqlFile(join(MIGRATIONS_DIR, "116_personal_fallback_chain_user_level.down.sql"));
    try {
      // `stringEncoded` reproduces the old per-provider writer, whose bound `JSON.stringify(...)::jsonb`
      // Bun stored as a scalar JSONB string; the other rows hold a real array.
      const insertRow = async (
        userId: number,
        provider: string,
        llmId: number | null,
        capabilities: { enabled: string[]; assigned: string[] },
        refs: FallbackModelRef[],
        randomizer: boolean,
        stringEncoded = false,
      ) => {
        await testSql`
          INSERT INTO user_saved_provider_configs
            (user_id, provider, llm_id, enabled_capabilities, assigned_capabilities, fallback_model_refs, model_randomizer_enabled)
          VALUES (
            ${userId}, ${provider}, ${llmId},
            ${`{${capabilities.enabled.join(",")}}`}::text[], ${`{${capabilities.assigned.join(",")}}`}::text[],
            ${stringEncoded ? JSON.stringify(refs) : refs}, ${randomizer}
          )
        `;
      };
      const llmId = sampleLlm.llm_id as number;
      const noCapabilities = { enabled: [], assigned: [] };

      // `anthropic` sorts first, so only the capability ordering can pick `deepseek`.
      const active = userIds[BACKFILL_DISC_ACTIVE];
      await insertRow(active, "anthropic", llmId, noCapabilities, ignoredChain, false);
      await insertRow(active, "deepseek", llmId, { enabled: ["text"], assigned: ["text"] }, activeChain, true, true);

      const stored = userIds[BACKFILL_DISC_STORED];
      await insertRow(stored, "anthropic", llmId, noCapabilities, ignoredChain, false);
      await insertRow(stored, "deepseek", llmId, { enabled: [], assigned: ["text"] }, storedChain, true);

      const none = userIds[BACKFILL_DISC_NONE];
      await insertRow(none, "novelai", null, { enabled: ["image"], assigned: ["image"] }, ignoredChain, true);

      const [encoded] = await testSql<[{ shape: string }]>`
        SELECT jsonb_typeof(fallback_model_refs) AS shape
        FROM user_saved_provider_configs
        WHERE user_id = ${active} AND provider = 'deepseek'
      `;
      expect(encoded.shape).toBe("string");
    } finally {
      await executeTestSqlFile(join(MIGRATIONS_DIR, "116_personal_fallback_chain_user_level.sql"));
    }

    expect(await llmProviderRepo.loadPersonalFallbackSettings(userIds[BACKFILL_DISC_ACTIVE])).toEqual({
      fallback_model_refs: activeChain,
      model_randomizer_enabled: true,
    });
    expect(await llmProviderRepo.loadPersonalFallbackSettings(userIds[BACKFILL_DISC_STORED])).toEqual({
      fallback_model_refs: storedChain,
      model_randomizer_enabled: true,
    });
    expect(await llmProviderRepo.loadPersonalFallbackSettings(userIds[BACKFILL_DISC_NONE])).toEqual({
      fallback_model_refs: [],
      model_randomizer_enabled: false,
    });

    const [leftover] = await testSql<[{ count: number }]>`
      SELECT COUNT(*)::int AS count
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'user_saved_provider_configs'
        AND column_name IN ('fallback_model_refs', 'model_randomizer_enabled')
    `;
    expect(leftover.count).toBe(0);
  });
});
