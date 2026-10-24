import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { workspaceConfigExportDataSchema } from "@/types/db/dataExport";
import { llmModelRepo, llmProviderRepo, importRepository } from "@/utils/db/repositories";
import { initializeLocalizer } from "@/utils/text/localizer";
import { useEnvSandbox } from "../../helpers/env";
import { DB_TESTS_AVAILABLE, setupTestDb, testSql } from "./setup/testDb";

describe.skipIf(!DB_TESTS_AVAILABLE)("config import payer resolution", () => {
  useEnvSandbox(["RUN_ENV", "TOMORI_SUPPORTER_BILLING_ENABLED"]);

  const subscriptionDiscId = "_rt_import_payer_subscription";
  const byokDiscId = "_rt_import_payer_byok";
  const unchangedDiscId = "_rt_import_payer_unchanged";
  const personalUserDiscId = "_rt_import_payer_user";

  let subscriptionServerId: number;
  let byokServerId: number;
  let unchangedServerId: number;
  let personalUserId: number;
  let reviewerA: number;
  let reviewerB: number;
  let designA: number;
  let designB: number;
  let cloneA: number;
  let cloneB: number;
  let decisionId: number;

  const SERVER_CONFIG_ROWS = [
    "server_model_configs",
    "server_chat_configs",
    "server_speech_configs",
    "server_natural_nudge_configs",
  ] as const;

  async function createServer(discId: string): Promise<number> {
    const [server] = await testSql`INSERT INTO servers (server_disc_id) VALUES (${discId}) RETURNING server_id`;
    for (const table of SERVER_CONFIG_ROWS) {
      await testSql.unsafe(`INSERT INTO ${table} (server_id) VALUES ($1)`, [server.server_id]);
    }
    return server.server_id;
  }

  async function subscriptionCapabilities(serverId: number): Promise<string[]> {
    const [row] =
      await testSql`SELECT subscription_capabilities FROM server_model_configs WHERE server_id = ${serverId}`;
    return row.subscription_capabilities;
  }

  async function insertSpeakerModel(codename: string, voiceMode: "design" | "clone"): Promise<number> {
    const [row] = await testSql`
      INSERT INTO speech_models (provider, codename, voice_mode, is_default)
      VALUES ('openrouter', ${codename}, ${voiceMode}, false)
      RETURNING speech_model_id
    `;
    return row.speech_model_id;
  }

  function chatSection(reviewerId: number) {
    return workspaceConfigExportDataSchema.shape.chat.parse({
      llm_temperature: 0.7,
      humanizer_degree: 1,
      timezone_offset: 0,
      llm_logit_biases: [],
      response_reviewer_llm_id: reviewerId,
    });
  }

  function speechSection(designId: number | null, cloneId: number | null) {
    return workspaceConfigExportDataSchema.shape.speech.parse({
      speech_design_model_id: designId,
      speech_clone_model_id: cloneId,
    });
  }

  beforeEach(() => {
    process.env.RUN_ENV = "production";
    process.env.TOMORI_SUPPORTER_BILLING_ENABLED = "true";
  });

  beforeAll(async () => {
    await setupTestDb();
    await initializeLocalizer();

    await testSql`DELETE FROM servers WHERE server_disc_id IN (${subscriptionDiscId}, ${byokDiscId}, ${unchangedDiscId})`;
    await testSql`DELETE FROM users WHERE user_disc_id = ${personalUserDiscId}`;
    await testSql`DELETE FROM speech_models WHERE codename LIKE '_rt_import_%'`;

    subscriptionServerId = await createServer(subscriptionDiscId);
    byokServerId = await createServer(byokDiscId);
    unchangedServerId = await createServer(unchangedDiscId);

    await testSql`
      INSERT INTO saved_provider_configs (server_id, provider, api_key, key_version)
      VALUES (${subscriptionServerId}, 'supporter', NULL, 1),
        (${byokServerId}, 'supporter', NULL, 1),
        (${byokServerId}, 'openrouter', ${Buffer.from("synthetic-byok")}, 1),
        (${unchangedServerId}, 'openrouter', ${Buffer.from("synthetic-byok")}, 1)
    `;

    const reviewerACodename = "_rt_import_reviewer_a";
    const reviewerBCodename = "_rt_import_reviewer_b";
    const reviewerCaps = {
      hasTools: true,
      seesImages: false,
      seesVideos: false,
      seesYoutube: false,
      supportsStructuredOutput: true,
    };
    reviewerA = (await llmModelRepo.upsertScopedLlm(reviewerACodename, reviewerCaps)) ?? 0;
    reviewerB = (await llmModelRepo.upsertScopedLlm(reviewerBCodename, reviewerCaps)) ?? 0;
    expect(reviewerA).toBeGreaterThan(0);
    expect(reviewerB).toBeGreaterThan(0);
    for (const serverId of [subscriptionServerId, byokServerId, unchangedServerId]) {
      await llmProviderRepo.upsertOpenRouterModelRegistration({ serverId, llmId: reviewerA });
      await llmProviderRepo.upsertOpenRouterModelRegistration({ serverId, llmId: reviewerB });
    }

    designA = await insertSpeakerModel("_rt_import_design_a", "design");
    designB = await insertSpeakerModel("_rt_import_design_b", "design");
    cloneA = await insertSpeakerModel("_rt_import_clone_a", "clone");
    cloneB = await insertSpeakerModel("_rt_import_clone_b", "clone");
    const [decision] = await testSql`INSERT INTO decision_models
      (provider, codename, input_token_limit, supported_primitives)
      VALUES ('openrouter', '_rt_import_decision', 32000, '["predicate", "choice"]'::jsonb)
      RETURNING decision_model_id`;
    decisionId = decision.decision_model_id;
    await testSql`INSERT INTO scoped_model_registrations (server_id, decision_model_id)
      VALUES (${byokServerId}, ${decisionId})`;

    const [user] = await testSql`
      INSERT INTO users (user_disc_id) VALUES (${personalUserDiscId}) RETURNING user_id
    `;
    personalUserId = user.user_id;
    await testSql`
      INSERT INTO user_personalization_configs (user_id, user_nickname)
      VALUES (${personalUserId}, '_rt_import_user')
    `;
  });

  afterAll(async () => {
    await testSql`DELETE FROM servers WHERE server_disc_id IN (${subscriptionDiscId}, ${byokDiscId}, ${unchangedDiscId})`;
    await testSql`DELETE FROM users WHERE user_disc_id = ${personalUserDiscId}`;
    await testSql`DELETE FROM llms WHERE llm_codename IN ('_rt_import_reviewer_a', '_rt_import_reviewer_b')`;
    await testSql`DELETE FROM speech_models WHERE codename LIKE '_rt_import_%'`;
    await testSql`DELETE FROM decision_models WHERE codename = '_rt_import_decision'`;
  });

  it("funds imported reviewer and speech selections from a Subscription-only destination", async () => {
    const result = await importRepository.importWorkspaceConfig(
      subscriptionDiscId,
      {
        chat: chatSection(reviewerA),
        speech: speechSection(designA, cloneA),
      },
      ["chat", "speech"],
    );
    expect(result.success).toBe(true);

    expect(await subscriptionCapabilities(subscriptionServerId)).toEqual(
      expect.arrayContaining(["reviewer", "speech_design", "speech_clone"]),
    );
  });

  it("keeps imported selections on BYOK when the destination also has an OpenRouter key", async () => {
    await testSql`
      UPDATE server_model_configs
      SET subscription_capabilities = ARRAY['reviewer', 'speech_design', 'speech_clone']
      WHERE server_id = ${byokServerId}
    `;
    await testSql`
      UPDATE server_chat_configs SET response_reviewer_llm_id = ${reviewerA} WHERE server_id = ${byokServerId}
    `;
    await testSql`
      UPDATE server_speech_configs
      SET speech_design_model_id = ${designA}, speech_clone_model_id = ${cloneA}
      WHERE server_id = ${byokServerId}
    `;

    const result = await importRepository.importWorkspaceConfig(
      byokDiscId,
      {
        chat: chatSection(reviewerB),
        speech: speechSection(designB, cloneB),
      },
      ["chat", "speech"],
    );
    expect(result.success).toBe(true);

    const capabilities = await subscriptionCapabilities(byokServerId);
    expect(capabilities).not.toContain("reviewer");
    expect(capabilities).not.toContain("speech_design");
    expect(capabilities).not.toContain("speech_clone");
  });

  it("keeps the marker for an imported selection that matches the destination", async () => {
    await testSql`
      UPDATE server_model_configs
      SET subscription_capabilities = ARRAY['reviewer', 'speech_design']
      WHERE server_id = ${unchangedServerId}
    `;
    await testSql`
      UPDATE server_chat_configs SET response_reviewer_llm_id = ${reviewerA} WHERE server_id = ${unchangedServerId}
    `;
    await testSql`
      UPDATE server_speech_configs SET speech_design_model_id = ${designA} WHERE server_id = ${unchangedServerId}
    `;

    const result = await importRepository.importWorkspaceConfig(
      unchangedDiscId,
      {
        chat: chatSection(reviewerB),
        speech: speechSection(designA, null),
      },
      ["chat", "speech"],
    );
    expect(result.success).toBe(true);

    const capabilities = await subscriptionCapabilities(unchangedServerId);
    expect(capabilities).not.toContain("reviewer");
    expect(capabilities).toContain("speech_design");
  });

  it("personal config import leaves workspace payer markers untouched", async () => {
    const before = await subscriptionCapabilities(subscriptionServerId);
    const result = await importRepository.importPersonalConfig(
      personalUserDiscId,
      { profile: { user_nickname: "Mirri", language_pref: "en-US" } },
      ["profile"],
    );
    expect(result.success).toBe(true);
    expect(await subscriptionCapabilities(subscriptionServerId)).toEqual(before);
  });

  it("preserves unchanged nudge payers and resolves changed pins from destination credentials", async () => {
    for (const [discId, serverId] of [
      [subscriptionDiscId, subscriptionServerId],
      [byokDiscId, byokServerId],
    ] as const) {
      await testSql`UPDATE server_model_configs SET subscription_capabilities = ARRAY['nudge_planner', 'nudge_checker'] WHERE server_id = ${serverId}`;
      await testSql`UPDATE server_natural_nudge_configs SET llm_id = ${reviewerA}, checker_llm_id = ${reviewerA}, checker_decision_model_id = NULL WHERE server_id = ${serverId}`;
      expect(
        (
          await importRepository.importWorkspaceConfig(
            discId,
            { nudges: { llm_id: reviewerA, checker_llm_id: reviewerA } },
            ["nudges"],
          )
        ).success,
      ).toBe(true);
      expect(await subscriptionCapabilities(serverId)).toEqual(
        expect.arrayContaining(["nudge_planner", "nudge_checker"]),
      );
      expect(
        (
          await importRepository.importWorkspaceConfig(
            discId,
            { nudges: { llm_id: reviewerB, checker_llm_id: reviewerB } },
            ["nudges"],
          )
        ).success,
      ).toBe(true);
      for (const marker of ["nudge_planner", "nudge_checker"]) {
        expect((await subscriptionCapabilities(serverId)).includes(marker)).toBe(serverId === subscriptionServerId);
      }
    }
    expect(
      (
        await importRepository.importWorkspaceConfig(
          byokDiscId,
          { nudges: { checker_decision_model_id: decisionId } },
          ["nudges"],
        )
      ).success,
    ).toBe(true);
    expect(await subscriptionCapabilities(byokServerId)).not.toContain("nudge_checker");
    const [checker] =
      await testSql`SELECT checker_llm_id, checker_decision_model_id FROM server_natural_nudge_configs WHERE server_id = ${byokServerId}`;
    expect(checker).toMatchObject({ checker_llm_id: null, checker_decision_model_id: decisionId });
  });

  it("removes only the deleted provider's nudge pins and clears owned markers when a model is removed", async () => {
    for (const provider of ["supporter", "openrouter"] as const) {
      await testSql`INSERT INTO saved_provider_configs (server_id, provider, api_key, key_version)
        VALUES (${byokServerId}, 'supporter', NULL, 1), (${byokServerId}, 'openrouter', ${Buffer.from("fixture")}, 1)
        ON CONFLICT (server_id, provider) DO NOTHING`;
      await testSql`UPDATE server_model_configs SET subscription_capabilities = ARRAY['nudge_planner', 'decision'], decision_model_id = ${decisionId} WHERE server_id = ${byokServerId}`;
      await testSql`UPDATE server_natural_nudge_configs SET llm_id = ${reviewerA}, checker_llm_id = NULL, checker_decision_model_id = ${decisionId} WHERE server_id = ${byokServerId}`;
      expect(await llmProviderRepo.deleteServerProviderRegistration(byokServerId, provider)).toBe(true);
      const [pins] =
        await testSql`SELECT llm_id, checker_decision_model_id FROM server_natural_nudge_configs WHERE server_id = ${byokServerId}`;
      expect(pins).toMatchObject({
        llm_id: provider === "supporter" ? null : reviewerA,
        checker_decision_model_id: provider === "openrouter" ? null : decisionId,
      });
      const [core] =
        await testSql`SELECT decision_model_id FROM server_model_configs WHERE server_id = ${byokServerId}`;
      expect(core.decision_model_id).toBe(provider === "supporter" ? null : decisionId);
    }
    await testSql`UPDATE server_model_configs SET subscription_capabilities = ARRAY['nudge_planner', 'nudge_checker', 'text'] WHERE server_id = ${byokServerId}`;
    await testSql`UPDATE server_natural_nudge_configs SET llm_id = ${reviewerA}, checker_llm_id = ${reviewerA}, checker_decision_model_id = NULL WHERE server_id = ${byokServerId}`;
    expect(await llmProviderRepo.deleteOpenRouterModelRegistration({ serverId: byokServerId, llmId: reviewerA })).toBe(
      true,
    );
    expect(await subscriptionCapabilities(byokServerId)).toEqual(["text"]);
    const [pins] =
      await testSql`SELECT llm_id, checker_llm_id FROM server_natural_nudge_configs WHERE server_id = ${byokServerId}`;
    expect(pins).toMatchObject({ llm_id: null, checker_llm_id: null });
    await testSql`UPDATE server_model_configs SET decision_model_id = ${decisionId}, subscription_capabilities = ARRAY['decision', 'nudge_checker', 'text'] WHERE server_id = ${byokServerId}`;
    await testSql`UPDATE server_natural_nudge_configs SET checker_decision_model_id = ${decisionId} WHERE server_id = ${byokServerId}`;
    expect(
      await llmProviderRepo.deleteDecisionModelRegistration({ serverId: byokServerId, decisionModelId: decisionId }),
    ).toBe(true);
    expect(await subscriptionCapabilities(byokServerId)).toEqual(["text"]);
    const [decisionPins] = await testSql`SELECT config.decision_model_id, nudges.checker_decision_model_id
      FROM server_model_configs config JOIN server_natural_nudge_configs nudges USING (server_id) WHERE config.server_id = ${byokServerId}`;
    expect(decisionPins).toMatchObject({ decision_model_id: null, checker_decision_model_id: null });
  });
});
