import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { llmModelRepo, llmProviderRepo } from "@/utils/db/repositories";
import { encryptApiKey } from "@/utils/security/crypto";
import { DB_TESTS_AVAILABLE, executeTestSqlFile, setupTestDb, testSql } from "./setup/testDb";

describe.skipIf(!DB_TESTS_AVAILABLE)("Hosted speech default backfill", () => {
  const migration = path.join(process.cwd(), "src/db/migrations/107_backfill_hosted_speech_defaults.sql");
  const serverDiscIds = ["_rt_speech_backfill_both", "_rt_speech_backfill_vertex", "_rt_speech_backfill_custom"];
  const userDiscIds = ["_rt_speech_backfill_user", "_rt_speech_backfill_owned"];
  const servers: Record<string, number> = {};
  const users: Record<string, number> = {};
  const defaults: Record<string, number> = {};

  async function saveServerKey(serverId: number, provider: string) {
    const key = await encryptApiKey(`test-backfill-${provider}-server`);
    await testSql`
      INSERT INTO saved_provider_configs (server_id, provider, api_key, key_version)
      VALUES (${serverId}, ${provider}, ${key.encrypted}, ${key.version})
    `;
  }

  async function saveUserKey(userId: number, provider: string) {
    const key = await encryptApiKey(`test-backfill-${provider}-user`);
    await testSql`
      INSERT INTO user_saved_provider_configs (user_id, provider, api_key, key_version)
      VALUES (${userId}, ${provider}, ${key.encrypted}, ${key.version})
    `;
  }

  async function serverSelection(serverId: number) {
    const [row] = await testSql`
      SELECT speech_design_model_id, speech_clone_model_id, speech_design_endpoint_id, speech_clone_endpoint_id
      FROM server_speech_configs WHERE server_id = ${serverId}
    `;
    return row ?? null;
  }

  async function personalSpeech(userId: number) {
    return testSql`
      SELECT provider, speech_design_model_id, speech_clone_model_id, assigned_capabilities, enabled_capabilities
      FROM user_saved_provider_configs WHERE user_id = ${userId} ORDER BY provider
    `;
  }

  beforeAll(async () => {
    await setupTestDb();
    await testSql`DELETE FROM servers WHERE server_disc_id IN ${testSql(serverDiscIds)}`;
    await testSql`DELETE FROM users WHERE user_disc_id IN ${testSql(userDiscIds)}`;
    for (const discId of serverDiscIds) {
      const [row] = await testSql`INSERT INTO servers (server_disc_id) VALUES (${discId}) RETURNING server_id`;
      servers[discId] = row.server_id;
    }
    for (const discId of userDiscIds) {
      const [row] = await testSql`INSERT INTO users (user_disc_id) VALUES (${discId}) RETURNING user_id`;
      users[discId] = row.user_id;
    }
    for (const provider of ["google", "openrouter", "vertex"]) {
      const models = await llmModelRepo.loadAvailableSpeechModels(provider, { kind: "server", ownerId: 0 });
      const mode = provider === "openrouter" ? "clone" : "design";
      const defaultModel = models.find((model) => model.is_default && model.voice_mode === mode);
      if (!defaultModel) throw new Error(`Missing seeded speech default for ${provider}`);
      defaults[provider] = defaultModel.speech_model_id;
    }
  });

  afterAll(async () => {
    await testSql`DELETE FROM servers WHERE server_disc_id IN ${testSql(serverDiscIds)}`;
    await testSql`DELETE FROM users WHERE user_disc_id IN ${testSql(userDiscIds)}`;
  });

  it("fills empty owners by provider priority and leaves owners with existing speech untouched", async () => {
    const both = servers._rt_speech_backfill_both ?? 0;
    const vertexOnly = servers._rt_speech_backfill_vertex ?? 0;
    const custom = servers._rt_speech_backfill_custom ?? 0;
    for (const provider of ["vertex", "google", "openrouter"]) await saveServerKey(both, provider);
    await saveServerKey(vertexOnly, "vertex");
    await saveServerKey(custom, "google");
    const elevenLabs = await llmProviderRepo.upsertCustomEndpoint({
      serverId: custom,
      label: "ElevenLabs",
      capability: "speech",
      apiStyle: "elevenlabs",
      endpointUrl: "https://api.elevenlabs.io",
      requiresAuth: false,
      extraConfig: {},
    });
    expect(elevenLabs?.custom_endpoint_id).toBeGreaterThan(0);

    const user = users._rt_speech_backfill_user ?? 0;
    const owned = users._rt_speech_backfill_owned ?? 0;
    for (const provider of ["google", "openrouter"]) {
      await saveUserKey(user, provider);
      await saveUserKey(owned, provider);
    }
    await testSql`
      UPDATE user_saved_provider_configs
      SET speech_clone_model_id = ${defaults.openrouter ?? 0},
        assigned_capabilities = ARRAY['speech_clone'], enabled_capabilities = '{}'
      WHERE user_id = ${owned} AND provider = 'openrouter'
    `;

    await executeTestSqlFile(migration);

    expect(await serverSelection(both)).toMatchObject({
      speech_design_model_id: defaults.google,
      speech_clone_model_id: defaults.openrouter,
    });
    expect(await serverSelection(vertexOnly)).toMatchObject({
      speech_design_model_id: defaults.vertex,
      speech_clone_model_id: null,
    });
    const customSelection = await serverSelection(custom);
    expect(customSelection?.speech_design_model_id ?? null).toBeNull();
    expect(customSelection?.speech_clone_model_id ?? null).toBeNull();

    const personal = await personalSpeech(user);
    expect(personal.find((row: { provider: string }) => row.provider === "google")).toMatchObject({
      speech_design_model_id: defaults.google,
      assigned_capabilities: ["speech_design"],
      enabled_capabilities: ["speech_design"],
    });
    expect(personal.find((row: { provider: string }) => row.provider === "openrouter")).toMatchObject({
      speech_clone_model_id: defaults.openrouter,
      assigned_capabilities: ["speech_clone"],
      enabled_capabilities: ["speech_clone"],
    });
    const untouched = await personalSpeech(owned);
    expect(untouched.find((row: { provider: string }) => row.provider === "google")?.speech_design_model_id).toBeNull();
    expect(untouched.find((row: { provider: string }) => row.provider === "openrouter")?.enabled_capabilities).toEqual(
      [],
    );
  });
});
