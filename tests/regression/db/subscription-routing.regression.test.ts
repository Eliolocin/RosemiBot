import * as triggerProcessor from "@/utils/chat/triggerProcessor";
import * as replyDecision from "@/utils/chat/replyDecision";
import type { Client, Message } from "discord.js";
import { createPersona } from "../../helpers/fixtures";
import type { ChatTurnContext, LockedChatTurn, GenerationTurnResult } from "@/utils/chat/types";
import type { TomoriState } from "@/types/db/schema";
import { planChatTurns } from "@/utils/chat/turnPlanner";
import { runPostTurnEffects } from "@/utils/chat/postTurnEffects";
import * as guards from "@/utils/chat/admissionGuards";
import { textQuotaTriggerStates } from "@/utils/chat/textQuotaState";
import { initializeLocalizer } from "@/utils/text/localizer";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, spyOn } from "bun:test";
import { configRepository, llmModelRepo, llmProviderRepo, personaRepository } from "@/utils/db/repositories";
import { loadHostedSpeechSelection, setHostedSpeechSelection } from "@/utils/db/repositories/SpeechRepository";
import { resolveCapabilityCredentials } from "@/utils/provider/credentialResolver";
import { encryptApiKey } from "@/utils/security/crypto";
import { initializeDatabase } from "@/utils/db/initializeDatabase";
import * as managed from "@/modules/supporter-billing/runtime/managedProvider";
import type { SupporterFundingContext } from "@/modules/supporter-billing/runtime/types";
import { SupporterRequestDeniedError } from "@/modules/supporter-billing/runtime/funding";
import { useEnvSandbox } from "../../helpers/env";
import { cleanupFixtures, insertFixtures, type FixtureRefs, FIXTURE_IDS } from "./setup/fixtures";
import { DB_TESTS_AVAILABLE, executeTestSqlFile, setupTestDb, testSql } from "./setup/testDb";

describe.skipIf(!DB_TESTS_AVAILABLE)("subscription capability ownership", () => {
  useEnvSandbox(["RUN_ENV", "TOMORI_SUPPORTER_BILLING_ENABLED"]);
  let refs: FixtureRefs;
  let llmId: number;
  let speechId: number;
  let googleSpeechId: number;
  beforeAll(async () => {
    await setupTestDb();
    refs = await insertFixtures(testSql);
    const [llm] = await testSql`INSERT INTO llms (llm_codename, llm_provider)
      VALUES ('_rt/subscription-routing', 'openrouter') RETURNING llm_id`;
    llmId = llm.llm_id;
    const models = await llmModelRepo.loadAvailableSpeechModels("openrouter", {
      kind: "server",
      ownerId: refs.serverId,
    });
    speechId = models.find((model) => model.voice_mode === "clone")?.speech_model_id ?? 0;
    googleSpeechId =
      (await llmModelRepo.loadAvailableSpeechModels("google", { kind: "server", ownerId: refs.serverId }))[0]
        ?.speech_model_id ?? 0;
    expect(speechId).toBeGreaterThan(0);
    expect(googleSpeechId).toBeGreaterThan(0);
    const key = await encryptApiKey("synthetic-server-byok");
    await testSql`INSERT INTO saved_provider_configs (server_id, provider, api_key, key_version, llm_id)
      VALUES (${refs.serverId}, 'openrouter', ${key.encrypted}, ${key.version}, ${llmId}),
        (${refs.serverId}, 'supporter', NULL, 1, ${llmId}),
        (${refs.serverId}, 'google', ${key.encrypted}, ${key.version}, NULL)
      ON CONFLICT (server_id, provider) DO UPDATE SET api_key = EXCLUDED.api_key, llm_id = EXCLUDED.llm_id`;
  });
  afterAll(async () => {
    await cleanupFixtures(testSql);
    await testSql`DELETE FROM llms WHERE llm_id = ${llmId}`;
  });

  /** Plans one trigger against a channel that records every notice the planner posts. */
  async function planTurnsFor(
    personas: TomoriState[],
    messageId: string,
  ): Promise<{ plan: Awaited<ReturnType<typeof planChatTurns>>; sends: Array<{ embeds?: unknown[] }> }> {
    const sends: Array<{ embeds?: unknown[] }> = [];
    const channel = {
      id: "_rt_planner_channel",
      isThread: () => false,
      send: async (payload: { embeds?: unknown[] }) => {
        sends.push(payload);
        return { id: `_rt_planner_sent_${sends.length}` };
      },
    } as unknown as Message["channel"];
    const client = { user: { id: "_rt_bot" } } as Client;
    const message = {
      id: messageId,
      channelId: channel.id,
      channel,
      client,
      author: { id: FIXTURE_IDS.userDiscId, username: "Mirri", bot: false },
      content: "hello",
      guild: null,
    } as Message;
    const locked: LockedChatTurn = {
      channelId: channel.id,
      lockedAt: Date.now(),
      queueDepth: 0,
      skipLock: false,
      admission: {
        disposition: "run",
        locale: "en-US",
        client,
        message,
        channel,
        guild: null,
        isDMChannel: false,
        serverDiscId: FIXTURE_IDS.serverDiscId,
        userDiscId: FIXTURE_IDS.userDiscId,
        referencedMessage: null,
        tomoriState: personas[0],
        allPersonas: personas,
        incoming: {
          client,
          message,
          isFromQueue: false,
          retryCount: 0,
          skipLock: false,
          isPersonaJob: false,
          isUserImpersonation: false,
          isManuallyTriggered: false,
          textQuotaSource: "user",
          shouldSurfaceUserErrors: true,
        },
      },
    };
    const spies = [
      spyOn(guards, "validateDirectChatTrigger").mockResolvedValue({
        shouldContinue: true,
        isReplyToBot: false,
        replyPersona: null,
        isBotMentioned: true,
        isDirectUserIntent: true,
        isUserImpersonation: false,
      }),
      spyOn(guards, "evaluateChatAccess").mockResolvedValue({
        whitelistStatus: null,
        personalSpotlightStatus: null,
        allowedPersonaIds: null,
        blockedPersonaIds: new Set(),
        rejectedByWhitelist: false,
      }),
      spyOn(guards, "enforceGlobalRateLimit").mockResolvedValue(true),
      spyOn(guards, "enforceServerTriggerCooldownForAdmission").mockResolvedValue(true),
      spyOn(triggerProcessor, "determineMatchingPersonas").mockReturnValue(personas),
      spyOn(replyDecision, "shouldBotReply").mockReturnValue(true),
    ];
    try {
      return { plan: await planChatTurns(locked), sends };
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  }

  it("keeps the same OpenRouter model on the selected payer and exposes it through runtime state", async () => {
    process.env.RUN_ENV = "production";
    process.env.TOMORI_SUPPORTER_BILLING_ENABLED = "true";
    const funding: SupporterFundingContext = {
      credentialSource: "supporter",
      fundingScope: "server",
      capability: "text",
      provider: "openrouter",
      modelCodename: "_rt/subscription-routing",
      tierKey: "synthetic",
      sponsorshipId: 1,
      serverId: refs.serverId,
      personalUserId: null,
      sponsorIdentityId: 1,
      sponsorDiscordUserId: "_rt_sponsor",
      entitlementId: 1,
      renewalAt: null,
    };
    const member = spyOn(managed, "resolveSupporterCapabilityCredentials").mockResolvedValue({
      apiKey: "synthetic-member",
      funding,
    });
    try {
      expect(await configRepository.updateModelConfig(refs.serverId, { llm_id: llmId }, "openrouter")).toBe(true);
      expect((await resolveCapabilityCredentials(refs.serverId, "text")).apiKey).toBe("synthetic-server-byok");
      expect(member).not.toHaveBeenCalled();
      expect(await configRepository.updateModelConfig(refs.serverId, { llm_id: llmId }, "supporter")).toBe(true);
      expect((await resolveCapabilityCredentials(refs.serverId, "text")).apiKey).toBe("synthetic-member");
      const state = await personaRepository.loadState(FIXTURE_IDS.serverDiscId);
      expect(state?.config.subscription_capabilities).toContain("text");
      expect(await configRepository.updateModelConfig(refs.serverId, { llm_temperature: 0.8 })).toBe(true);
      expect((await configRepository.loadModelCapabilityIds(refs.serverId))?.subscription_capabilities).toContain(
        "text",
      );
      expect(await configRepository.updateModelConfig(refs.serverId, { llm_id: llmId }, "openrouter")).toBe(true);
      expect((await resolveCapabilityCredentials(refs.serverId, "text")).apiKey).toBe("synthetic-server-byok");
    } finally {
      member.mockRestore();
    }
  });

  it("does not change ownership when a model write fails", async () => {
    await configRepository.updateModelConfig(refs.serverId, { llm_id: llmId }, "openrouter");
    expect(await configRepository.updateModelConfig(refs.serverId, { llm_id: 2147483647 }, "supporter")).toBe(false);
    const config = await configRepository.loadModelCapabilityIds(refs.serverId);
    expect(config?.llm_id).toBe(llmId);
    expect(config?.subscription_capabilities).not.toContain("text");
  });

  it("stores reviewer model and payer together and rolls both back on failure", async () => {
    expect(
      await configRepository.updateChatConfig(refs.serverId, { response_reviewer_llm_id: llmId }, "supporter"),
    ).toBe(true);
    expect((await configRepository.loadModelCapabilityIds(refs.serverId))?.subscription_capabilities).toContain(
      "reviewer",
    );
    expect(
      await configRepository.updateChatConfig(refs.serverId, { response_reviewer_llm_id: 2147483647 }, "openrouter"),
    ).toBe(false);
    const state = await personaRepository.loadState(FIXTURE_IDS.serverDiscId);
    expect(state?.config.response_reviewer_llm_id).toBe(llmId);
    expect(state?.config.subscription_capabilities).toContain("reviewer");
    expect(
      await configRepository.updateChatConfig(refs.serverId, { response_reviewer_llm_id: llmId }, "openrouter"),
    ).toBe(true);
    expect((await configRepository.loadModelCapabilityIds(refs.serverId))?.subscription_capabilities).not.toContain(
      "reviewer",
    );
  });

  it("keeps both speech selections on their selected payer even when a BYOK key exists", async () => {
    const scope = { kind: "server" as const, ownerId: refs.serverId };
    expect(await setHostedSpeechSelection(scope, speechId, "clone", false, undefined, "supporter")).toBe(true);
    expect((await loadHostedSpeechSelection(refs.serverId, "clone", undefined, true))?.subscription).toBe(true);
    expect(await setHostedSpeechSelection(scope, speechId, "clone", false, undefined, "openrouter")).toBe(true);
    expect((await loadHostedSpeechSelection(refs.serverId, "clone", undefined, true))?.subscription).toBe(false);
  });

  it("admits and consumes server-funded quota once while personal subscription routes stay outside it", async () => {
    await initializeLocalizer();
    process.env.RUN_ENV = "production";
    process.env.TOMORI_SUPPORTER_BILLING_ENABLED = "true";
    await testSql`INSERT INTO text_quota_configs (server_id, daily_user_quota, enabled) VALUES (${refs.serverId}, 1, true)
      ON CONFLICT (server_id) DO UPDATE SET daily_user_quota = 1, enabled = true`;
    await testSql`DELETE FROM text_quotas WHERE server_id = ${refs.serverId}`;
    const funding: SupporterFundingContext = {
      credentialSource: "supporter",
      fundingScope: "server",
      capability: "text",
      provider: "openrouter",
      modelCodename: "_rt/subscription-routing",
      tierKey: "synthetic",
      sponsorshipId: 1,
      serverId: refs.serverId,
      personalUserId: null,
      sponsorIdentityId: 1,
      sponsorDiscordUserId: "_rt_sponsor",
      entitlementId: 1,
      renewalAt: null,
    };
    const model = await llmModelRepo.loadById(llmId);
    if (!model) throw new Error("Fixture model missing");
    const persona = createPersona({
      server_id: refs.serverId,
      persona_id: refs.personaId,
      persona_lineage_id: refs.personaLineageId,
      llm: model,
      config: { llm_id: llmId, subscription_capabilities: ["text"] },
    });
    await configRepository.updateModelConfig(refs.serverId, { llm_id: llmId }, "supporter");
    const channel = {
      id: "_rt_quota_channel",
      isThread: () => false,
      send: async () => undefined,
    } as unknown as Message["channel"];
    const client = { user: { id: "_rt_bot" } } as Client;
    const message = {
      id: "_rt_quota_message",
      channelId: channel.id,
      channel,
      client,
      author: { id: FIXTURE_IDS.userDiscId, username: "Mirri", bot: false },
      content: "hello",
      guild: null,
    } as Message;
    const locked: LockedChatTurn = {
      channelId: channel.id,
      lockedAt: Date.now(),
      queueDepth: 0,
      skipLock: false,
      admission: {
        disposition: "run",
        locale: "en-US",
        client,
        message,
        channel,
        guild: null,
        isDMChannel: false,
        serverDiscId: FIXTURE_IDS.serverDiscId,
        userDiscId: FIXTURE_IDS.userDiscId,
        referencedMessage: null,
        tomoriState: persona,
        allPersonas: [persona],
        incoming: {
          client,
          message,
          isFromQueue: false,
          retryCount: 0,
          skipLock: false,
          isPersonaJob: false,
          isUserImpersonation: false,
          isManuallyTriggered: true,
          textQuotaSource: "user",
        },
      },
    };
    const spies: Array<{ mockRestore(): void }> = [
      spyOn(managed, "resolveSupporterCapabilityCredentials").mockImplementation(async ({ scope }) => ({
        apiKey: "synthetic-member",
        funding:
          scope.kind === "server"
            ? funding
            : {
                ...funding,
                fundingScope: "personal",
                personalUserId: refs.userId,
                serverId: null,
                sponsorshipId: null,
              },
      })),
      spyOn(guards, "validateDirectChatTrigger").mockResolvedValue({
        shouldContinue: true,
        isReplyToBot: false,
        replyPersona: null,
        isBotMentioned: true,
        isDirectUserIntent: true,
        isUserImpersonation: false,
      }),
      spyOn(guards, "evaluateChatAccess").mockResolvedValue({
        whitelistStatus: null,
        personalSpotlightStatus: null,
        allowedPersonaIds: null,
        blockedPersonaIds: new Set(),
        rejectedByWhitelist: false,
      }),
      spyOn(guards, "enforceGlobalRateLimit").mockResolvedValue(true),
      spyOn(guards, "enforceServerTriggerCooldownForAdmission").mockResolvedValue(true),
    ];
    try {
      const plan = await planChatTurns(locked);
      expect(plan.turns).toHaveLength(1);
      const turn = plan.turns[0];
      expect(turn.shouldApplyTextQuota).toBe(true);
      expect(turn.textQuotaState?.consumed).toBe(false);
      const context = {
        ...turn,
        turn,
        currentPersona: persona,
        tomoriState: persona,
        client,
        message,
        channel,
        simplifiedMessages: [],
        streamingContext: {},
        reunionPresence: null,
        isStopResponse: false,
      } as unknown as ChatTurnContext;
      const result: GenerationTurnResult = {
        status: "completed",
        streamResults: [],
        personaResponses: [{ personaName: persona.persona_nickname, text: "ok", personaId: refs.personaId }],
      };
      await runPostTurnEffects(context, result);
      await runPostTurnEffects(context, result);
      const [usage] =
        await testSql`SELECT usage_count FROM text_quotas WHERE server_id = ${refs.serverId} AND user_disc_id = ${FIXTURE_IDS.userDiscId}`;
      expect(usage.usage_count).toBe(1);
      textQuotaTriggerStates.clear();
      message.id = "_rt_quota_next";
      expect((await planChatTurns(locked)).turns).toHaveLength(0);
      await testSql`INSERT INTO user_saved_provider_configs (user_id, provider, llm_id, enabled_capabilities, assigned_capabilities)
        VALUES (${refs.userId}, 'supporter', ${llmId}, ARRAY['text'], ARRAY['text'])`;
      expect((await planChatTurns(locked)).turns[0]?.shouldApplyTextQuota).toBe(false);
      await testSql`DELETE FROM user_saved_provider_configs WHERE user_id = ${refs.userId} AND provider = 'supporter'`;
      await testSql`DELETE FROM text_quotas WHERE server_id = ${refs.serverId}`;
      const badModel = await llmModelRepo.loadDefaultModel("zai");
      if (!badModel) throw new Error("Native fixture model missing");
      const unavailable = createPersona({
        server_id: refs.serverId,
        persona_id: refs.personaId + 1,
        is_alter: true,
        llm: badModel,
        persona_llm: badModel,
        config: persona.config,
      });
      locked.admission.allPersonas = [unavailable, persona];
      locked.admission.incoming.isManuallyTriggered = false;
      spies.push(spyOn(triggerProcessor, "determineMatchingPersonas").mockReturnValue([unavailable, persona]));
      spies.push(spyOn(replyDecision, "shouldBotReply").mockReturnValue(true));
      const remaining = await planChatTurns(locked);
      expect(remaining.turns.map((entry) => entry.persona.persona_id)).toEqual([refs.personaId]);
    } finally {
      for (const spy of spies) spy.mockRestore();
      textQuotaTriggerStates.clear();
      await testSql`DELETE FROM user_saved_provider_configs WHERE user_id = ${refs.userId} AND provider = 'supporter'`;
    }
  });

  it("clears only the removed provider entry's selections without transferring the payer", async () => {
    const key = await encryptApiKey("synthetic-server-byok");
    for (const removed of ["supporter", "openrouter"] as const) {
      await testSql`INSERT INTO saved_provider_configs (server_id, provider, api_key, key_version, llm_id, vision_llm_id)
        VALUES (${refs.serverId}, 'openrouter', ${key.encrypted}, ${key.version}, ${llmId}, ${llmId}),
          (${refs.serverId}, 'supporter', NULL, 1, ${llmId}, ${llmId})
        ON CONFLICT (server_id, provider) DO UPDATE SET api_key = EXCLUDED.api_key, llm_id = EXCLUDED.llm_id, vision_llm_id = EXCLUDED.vision_llm_id`;
      await configRepository.updateModelConfig(refs.serverId, { llm_id: llmId }, "openrouter");
      await configRepository.updateModelConfig(refs.serverId, { vision_llm_id: llmId }, "supporter");
      await configRepository.updateChatConfig(refs.serverId, { response_reviewer_llm_id: llmId }, "supporter");
      await setHostedSpeechSelection(
        { kind: "server", ownerId: refs.serverId },
        speechId,
        "clone",
        false,
        undefined,
        "openrouter",
      );
      expect(await llmProviderRepo.deleteServerProviderRegistration(refs.serverId, removed)).toBe(true);
      const state = await personaRepository.loadState(FIXTURE_IDS.serverDiscId);
      expect(state?.config.llm_id).toBe(removed === "openrouter" ? null : llmId);
      expect(state?.config.vision_llm_id).toBe(removed === "supporter" ? null : llmId);
      expect(state?.config.response_reviewer_llm_id).toBe(removed === "supporter" ? null : llmId);
      expect(state?.config.speech_clone_model_id).toBe(removed === "openrouter" ? null : speechId);
      await testSql`INSERT INTO saved_provider_configs (server_id, provider, api_key, key_version, llm_id, vision_llm_id)
        VALUES (${refs.serverId}, ${removed}, ${removed === "openrouter" ? key.encrypted : null}, ${key.version}, ${llmId}, ${llmId})`;
    }
  });

  it("restores ownership storage after rollback and backfills only unambiguous subscription selections", async () => {
    const migration = path.join(process.cwd(), "src/db/migrations/902_subscription_capability_ownership.sql");
    const down = path.join(process.cwd(), "src/db/migrations/902_subscription_capability_ownership.down.sql");
    const key = await encryptApiKey("synthetic-server-byok");
    try {
      await executeTestSqlFile(down);
      await testSql`DELETE FROM schema_migrations WHERE name = '902_subscription_capability_ownership'`;
      const [absent] = await testSql`SELECT COUNT(*)::INT AS count FROM information_schema.columns
        WHERE table_name = 'server_model_configs' AND column_name = 'subscription_capabilities'`;
      expect(absent.count).toBe(0);
      await initializeDatabase({ client: testSql, includeRag: false });
      const [column] = await testSql`SELECT is_nullable FROM information_schema.columns
        WHERE table_name = 'server_model_configs' AND column_name = 'subscription_capabilities'`;
      expect(column.is_nullable).toBe("NO");
      await testSql`UPDATE server_speech_configs SET speech_design_model_id = ${googleSpeechId}, speech_clone_model_id = ${speechId}
        WHERE server_id = ${refs.serverId}`;
      for (const byok of [true, false]) {
        await testSql`UPDATE saved_provider_configs SET api_key = ${byok ? key.encrypted : null}
          WHERE server_id = ${refs.serverId} AND provider = 'openrouter'`;
        await testSql`UPDATE server_model_configs SET llm_id = ${llmId}, api_key = ${byok ? key.encrypted : null},
          subscription_capabilities = '{}' WHERE server_id = ${refs.serverId}`;
        await executeTestSqlFile(migration);
        await executeTestSqlFile(migration);
        const config = await configRepository.loadModelCapabilityIds(refs.serverId);
        expect(config?.subscription_capabilities.includes("text")).toBe(!byok);
        expect(config?.subscription_capabilities.includes("speech_clone")).toBe(!byok);
        expect(config?.subscription_capabilities).not.toContain("speech_design");
      }
    } finally {
      await executeTestSqlFile(migration);
      await testSql`UPDATE saved_provider_configs SET api_key = ${key.encrypted}
        WHERE server_id = ${refs.serverId} AND provider = 'openrouter'`;
    }
    expect((await configRepository.loadModelCapabilityIds(refs.serverId))?.subscription_capabilities).toContain("text");
    expect((await loadHostedSpeechSelection(refs.serverId, "clone", undefined, true))?.subscription).toBe(true);
  });

  it("posts one quota refusal for a trigger that matched several personas", async () => {
    await initializeLocalizer();
    await configRepository.updateModelConfig(refs.serverId, { llm_id: llmId }, "openrouter");
    const today = new Date().toISOString().split("T")[0];
    await testSql`INSERT INTO text_quota_configs (server_id, daily_user_quota, serverwide_quota, serverwide_quota_resets_in, enabled)
      VALUES (${refs.serverId}, 1, 0, 365, true)
      ON CONFLICT (server_id) DO UPDATE SET daily_user_quota = 1, serverwide_quota = 0, enabled = true`;
    await testSql`DELETE FROM text_quotas WHERE server_id = ${refs.serverId}`;
    await testSql`INSERT INTO text_quotas (server_id, user_disc_id, usage_count, quota_date)
      VALUES (${refs.serverId}, ${FIXTURE_IDS.userDiscId}, 1, ${today}::date)`;
    try {
      const model = await llmModelRepo.loadById(llmId);
      if (!model) throw new Error("Fixture model missing");
      const personas = [1, 2, 3].map((offset) =>
        createPersona({
          server_id: refs.serverId,
          persona_id: refs.personaId + offset,
          persona_lineage_id: refs.personaLineageId + offset,
          is_alter: true,
          llm: model,
          config: { llm_id: llmId },
        }),
      );
      const { plan, sends } = await planTurnsFor(personas, "_rt_quota_refusal_once");
      expect(plan.turns).toHaveLength(0);
      expect(sends).toHaveLength(1);
    } finally {
      await testSql`DELETE FROM text_quotas WHERE server_id = ${refs.serverId}`;
      await testSql`UPDATE text_quota_configs SET daily_user_quota = 0, serverwide_quota = 0, enabled = false
        WHERE server_id = ${refs.serverId}`;
      textQuotaTriggerStates.clear();
    }
  });

  it("posts one credential refusal and still answers with a valid later persona", async () => {
    await initializeLocalizer();
    await configRepository.updateModelConfig(refs.serverId, { llm_id: llmId }, "openrouter");
    await testSql`UPDATE text_quota_configs SET daily_user_quota = 0, serverwide_quota = 0, enabled = false
      WHERE server_id = ${refs.serverId}`;
    await testSql`DELETE FROM user_saved_provider_configs WHERE user_id = ${refs.userId}`;
    try {
      const validModel = await llmModelRepo.loadById(llmId);
      if (!validModel) throw new Error("Fixture model missing");
      const unavailableModel = {
        ...validModel,
        llm_id: 2147483000,
        llm_provider: "custom:999",
        llm_codename: "_rt/absent-provider",
      };
      const personas = [1, 2].map((offset) =>
        createPersona({
          server_id: refs.serverId,
          persona_id: refs.personaId + offset,
          persona_lineage_id: refs.personaLineageId + offset,
          is_alter: true,
          llm: unavailableModel,
          persona_llm: unavailableModel,
          config: { llm_id: llmId },
        }),
      );
      personas.push(
        createPersona({
          server_id: refs.serverId,
          persona_id: refs.personaId + 3,
          persona_lineage_id: refs.personaLineageId + 3,
          is_alter: true,
          llm: validModel,
          config: { llm_id: llmId },
        }),
      );

      const { plan, sends } = await planTurnsFor(personas, "_rt_credential_refusal_once");
      expect(plan.turns.map((turn) => turn.persona.persona_id)).toEqual([refs.personaId + 3]);
      expect(sends).toHaveLength(1);
    } finally {
      await testSql`DELETE FROM user_saved_provider_configs WHERE user_id = ${refs.userId}`;
    }
  });

  it("stops text commands at a lapsed personal subscription only after an explicit server-fallback opt-out", async () => {
    process.env.RUN_ENV = "production";
    process.env.TOMORI_SUPPORTER_BILLING_ENABLED = "true";
    await configRepository.updateModelConfig(refs.serverId, { llm_id: llmId }, "openrouter");
    await testSql`DELETE FROM user_saved_provider_configs WHERE user_id = ${refs.userId}`;
    await testSql`INSERT INTO user_saved_provider_configs (user_id, provider, llm_id, enabled_capabilities, assigned_capabilities)
      VALUES (${refs.userId}, 'supporter', ${llmId}, ARRAY['text'], ARRAY['text'])`;
    const member = spyOn(managed, "resolveSupporterCapabilityCredentials").mockRejectedValue(
      new SupporterRequestDeniedError("inactive_entitlement", undefined, "text", "personal"),
    );
    try {
      await testSql`UPDATE user_personalization_configs SET personal_server_fallback_enabled = true
        WHERE user_id = ${refs.userId}`;
      expect((await resolveCapabilityCredentials(refs.serverId, "text", { userId: refs.userId })).apiKey).toBe(
        "synthetic-server-byok",
      );
      await testSql`UPDATE user_personalization_configs SET personal_server_fallback_enabled = false
        WHERE user_id = ${refs.userId}`;
      await expect(resolveCapabilityCredentials(refs.serverId, "text", { userId: refs.userId })).rejects.toMatchObject({
        reason: "inactive_entitlement",
        capability: "text",
        fundingScope: "personal",
      });
    } finally {
      member.mockRestore();
      await testSql`DELETE FROM user_saved_provider_configs WHERE user_id = ${refs.userId}`;
      await testSql`UPDATE user_personalization_configs SET personal_server_fallback_enabled = true
        WHERE user_id = ${refs.userId}`;
    }
  });
});
