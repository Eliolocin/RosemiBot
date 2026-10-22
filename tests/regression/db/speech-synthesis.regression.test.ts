import { createMemberKeyMetadata } from "../../helpers/memberKeyMetadata";
import type { CustomEndpointRow } from "@/types/db/schema";
import { useEnvSandbox } from "../../helpers/env";
import {
  initializeSupporterBillingSchema,
  SupporterIdentityRepository,
  SupporterEntitlementRepository,
  SupporterSponsorshipRepository,
} from "@/modules/supporter-billing/db";
import { MemberKeyRepository } from "@/modules/supporter-billing/db/repositories/memberKeys";
import { providerPanelOperations, saveProviderModel } from "@/utils/provider/providerPanelOperations";
import { buildProvidersPanelPayload } from "@/utils/discord/ui/providersPanel";
import { setPersonalCapabilityEnabled } from "@/utils/provider/personalProviderHelpers";
import { getAvailableToolsWithMCP } from "@/tools/availability";
import { ChannelType, type ChatInputCommandInteraction, type Client } from "discord.js";
import { execute as generateVoiceMessage } from "@/commands/generate/voice-message";
import { GenerateVoiceMessageTool } from "@/tools/functionCalls/generateVoiceMessageTool";
import type { ToolContext, ToolAssemblyState } from "@/types/tool/interfaces";
import { createPersona, createUserRow } from "../../helpers/fixtures";
import { makeFakeInteraction } from "../../helpers/fakeInteraction";
import * as delivery from "@/utils/discord/webhook/voiceMessageDelivery";
import * as metadata from "@/utils/audio/voiceMessageMetadata";
import * as modals from "@/utils/discord/ui/modals";
import * as whitelist from "@/utils/cache/channelWhitelistCache";
import * as spotlight from "@/utils/cache/personalSpotlightCache";
import { cooldownRepository } from "@/utils/db/repositories/CooldownRepository";
import { storeVoiceSample, deleteStoredVoiceSample } from "@/utils/storage/voiceSampleStorage";
import { activateProviderSpeechDefaults } from "@/utils/provider/providerActivation";
import { initializeLocalizer } from "@/utils/text/localizer";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { llmModelRepo, llmProviderRepo, personaRepository } from "@/utils/db/repositories";
import {
  loadPendingSpeechVoiceDeletions,
  loadSpeechCredentialForCleanup,
  savePendingSpeechVoiceDeletion,
  setHostedSpeechSelection,
  setSpeechEndpointSelection,
} from "@/utils/db/repositories/SpeechRepository";
import { cleanupPendingGoogleVoices } from "@/utils/speech/googleVoiceLifecycle";
import { log } from "@/utils/misc/logger";
import { resolveSpeechTargets } from "@/utils/provider/speechEndpointResolver";
import { synthesizeVoiceMessage, type VoiceMessageSynthesisRequest } from "@/utils/speech/voiceMessageSynthesis";
import { encryptApiKey } from "@/utils/security/crypto";
import { createSpeechWav, createSpeechMp3 } from "../../helpers/speechAudio";
import { DB_TESTS_AVAILABLE, setupTestDb, testSql } from "./setup/testDb";
import { cleanupFixtures, insertFixtures, FIXTURE_IDS, type FixtureRefs } from "./setup/fixtures";

describe.skipIf(!DB_TESTS_AVAILABLE)("Hosted speech synthesis lifecycle and fallback", () => {
  useEnvSandbox([
    "RUN_ENV",
    "TOMORI_SUPPORTER_BILLING_ENABLED",
    "TOMORI_SUPPORTER_CONFIG_JSON",
    "TOMORI_SUPPORTER_OPENROUTER_MANAGEMENT_KEY",
  ]);
  let refs: FixtureRefs;
  let googleId: number;
  let liteId: number;
  let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;
  let created: number;
  let synthesisStatuses: number[];
  let deleteFails: boolean;
  let creationExpiry: string;
  let malformedSynthesis: boolean;
  let upstreamError: string;
  let onCreate: (() => Promise<void>) | undefined;
  let onSynthesize: (() => Promise<void>) | undefined;
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const wav = createSpeechWav();
  let mp3: Buffer;
  const serverScope = () => ({ kind: "server" as const, ownerId: refs.serverId });
  const personalScope = () => ({ kind: "personal" as const, ownerId: refs.userId });

  beforeAll(async () => {
    await setupTestDb();
    await initializeLocalizer();
    mp3 = await createSpeechMp3();
    refs = await insertFixtures(testSql);
    await testSql`INSERT INTO persona_voice_configs (persona_id) VALUES (${refs.personaId}) ON CONFLICT DO NOTHING`;
    const models = await llmModelRepo.loadAvailableSpeechModels("google", serverScope());
    googleId = models.find((model) => model.is_default)?.speech_model_id ?? 0;
    liteId = models.find((model) => !model.is_default)?.speech_model_id ?? 0;
    for (const personal of [false, true]) {
      const key = await encryptApiKey(personal ? "synthetic-personal-google" : "synthetic-server-google");
      if (personal)
        await testSql`INSERT INTO user_saved_provider_configs (user_id, provider, api_key, key_version) VALUES (${refs.userId}, 'google', ${key.encrypted}, ${key.version}) ON CONFLICT (user_id, provider) DO UPDATE SET api_key = EXCLUDED.api_key, key_version = EXCLUDED.key_version`;
      else
        await testSql`INSERT INTO saved_provider_configs (server_id, provider, api_key, key_version) VALUES (${refs.serverId}, 'google', ${key.encrypted}, ${key.version}) ON CONFLICT (server_id, provider) DO UPDATE SET api_key = EXCLUDED.api_key, key_version = EXCLUDED.key_version`;
    }
  });

  beforeEach(async () => {
    created = 0;
    synthesisStatuses = [];
    deleteFails = false;
    creationExpiry = "2099-01-01T00:00:00Z";
    malformedSynthesis = false;
    upstreamError = "synthetic upstream content";
    onCreate = undefined;
    onSynthesize = undefined;
    requests.length = 0;
    await testSql`DELETE FROM speech_voice_bindings`;
    await testSql`UPDATE persona_voice_configs SET speech_voice_design_prompt = 'Warm narration', speech_voice_id = 'preset_synthetic', voice_source_priority = 'design' WHERE persona_id = ${refs.personaId}`;
    await testSql`UPDATE server_byok_configs SET user_byok_mode = false WHERE server_id = ${refs.serverId}`;
    await testSql`INSERT INTO user_personalization_configs (user_id, personal_server_fallback_enabled) VALUES (${refs.userId}, true) ON CONFLICT (user_id) DO UPDATE SET personal_server_fallback_enabled = true`;
    await setHostedSpeechSelection(serverScope(), googleId);
    await setHostedSpeechSelection(personalScope(), googleId);
    fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(
        async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
          const url = input instanceof Request ? input.url : String(input);
          if (url.includes("/keys/"))
            return Response.json({
              data: createMemberKeyMetadata({ hash: url.slice(url.lastIndexOf("/") + 1), limit: 0.1 }),
            });
          requests.push({ url, init: init ?? {} });
          if (init?.method === "DELETE")
            return deleteFails
              ? Response.json({ error: { message: upstreamError } }, { status: 500 })
              : new Response(null, { status: 204 });
          if (url.includes("openrouter.ai/api/v1/models"))
            return Response.json(
              url.endsWith("/endpoints")
                ? { data: { endpoints: [{ supports_voice_cloning: true }] } }
                : { data: [{ id: "fish-audio/s2.1-pro", pricing: { prompt: "0.000015", completion: "0" } }] },
            );
          if (url.endsWith("/audio/speech"))
            return new Response(new Uint8Array(mp3), { headers: { "Content-Type": "audio/mpeg" } });
          if (init?.method === "GET") return new Response(null, { status: 404 });
          if (url.endsWith("/voices")) {
            const voiceId = `voice_synthetic_${++created}`;
            await onCreate?.();
            return Response.json({
              id: voiceId,
              usage: { total_input_tokens: 11 },
              expire_time: creationExpiry,
            });
          }
          await onSynthesize?.();
          const status = synthesisStatuses.shift() ?? 200;
          if (status !== 200)
            return Response.json({ usage: { total_input_tokens: 3 }, error: { message: upstreamError } }, { status });
          if (url.startsWith("https://api.elevenlabs.io/"))
            return new Response(new Uint8Array(wav), { headers: { "Content-Type": "audio/wav" } });
          const data = malformedSynthesis ? "invalid" : wav.toString("base64");
          malformedSynthesis = false;
          return Response.json({
            status: "completed",
            usage: { total_output_tokens: 9 },
            steps: [
              {
                type: "model_output",
                content: [{ type: "audio", mime_type: "audio/wav", data }],
              },
            ],
          });
        },
        { preconnect: () => undefined },
      ),
    );
  });

  afterEach(() => fetchSpy?.mockRestore());
  afterAll(async () => {
    await cleanupFixtures(testSql);
  });

  async function request(personal = false, temporary = false): Promise<VoiceMessageSynthesisRequest> {
    const target = (await resolveSpeechTargets(refs.serverId, personal ? refs.userId : undefined)).design;
    if (!target) throw new Error("Missing speech target");
    return {
      target,
      endpoint: null,
      endpointApiKey: "",
      elevenLabsApiKey: "",
      script: "Hello",
      source: { kind: "design", designPrompt: "Warm narration", ...(temporary ? {} : { personaId: refs.personaId }) },
    };
  }

  function routing(sourceIsExplicit = false): NonNullable<VoiceMessageSynthesisRequest["routing"]> {
    return {
      serverId: refs.serverId,
      userId: refs.userId,
      persona: {
        persona_id: refs.personaId,
        speech_voice_design_prompt: "Warm narration",
        speech_voice_id: "preset_synthetic",
        voice_source_priority: "design",
      },
      sourceIsExplicit,
    };
  }
  const syntheses = () =>
    requests.filter(({ url }) => url.endsWith("/interactions") || url.includes("/text-to-speech/"));
  const deletes = () => requests.filter(({ init }) => init.method === "DELETE");

  it("connects provider-add defaults to both callers in server and personal scope", async () => {
    const [sample] =
      await testSql`INSERT INTO voice_samples (server_id, name, file_path, duration_ms) VALUES (${refs.serverId}, 'Synthetic sample', 'pending', 200) RETURNING sample_id`;
    const storedPath = await storeVoiceSample({ serverId: refs.serverId, sampleId: sample.sample_id, buffer: wav });
    if (!storedPath) throw new Error("Missing stored sample");
    await testSql`UPDATE voice_samples SET file_path = ${storedPath} WHERE sample_id = ${sample.sample_id}`;
    const key = await encryptApiKey("synthetic-openrouter");
    await testSql`INSERT INTO saved_provider_configs (server_id, provider, api_key, key_version) VALUES (${refs.serverId}, 'openrouter', ${key.encrypted}, ${key.version}) ON CONFLICT (server_id, provider) DO UPDATE SET api_key = EXCLUDED.api_key, key_version = EXCLUDED.key_version`;
    await testSql`INSERT INTO user_saved_provider_configs (user_id, provider, api_key, key_version) VALUES (${refs.userId}, 'openrouter', ${key.encrypted}, ${key.version}) ON CONFLICT (user_id, provider) DO UPDATE SET api_key = EXCLUDED.api_key, key_version = EXCLUDED.key_version`;
    const endpoint = await llmProviderRepo.upsertCustomEndpoint({
      serverId: refs.serverId,
      label: "Synthetic Auto",
      capability: "speech",
      apiStyle: "tts-clone",
      endpointUrl: "http://127.0.0.1:9000",
      requiresAuth: false,
      extraConfig: { voice_mode: "auto" },
    });
    if (!endpoint?.custom_endpoint_id) throw new Error("Missing custom target");
    const preset = await llmProviderRepo.upsertCustomEndpoint({
      serverId: refs.serverId,
      label: "Synthetic ElevenLabs",
      capability: "speech",
      apiStyle: "elevenlabs",
      endpointUrl: "https://api.elevenlabs.io",
      requiresAuth: true,
    });
    if (!preset?.custom_endpoint_id || !preset.connection_id) throw new Error("Missing preset target");
    const saved = await llmProviderRepo.loadSavedProviderConfig(refs.serverId, "google");
    if (!saved) throw new Error("Missing credential fixture");
    await llmProviderRepo.upsertSavedProviderConfig(refs.serverId, {
      ...saved,
      provider: `custom:${preset.connection_id}`,
      api_key: key.encrypted,
      key_version: key.version,
    });
    await initializeSupporterBillingSchema(testSql);
    for (const personal of [false, true]) {
      const identity = await new SupporterIdentityRepository(testSql).upsertIdentity({
        discordUserId: personal ? FIXTURE_IDS.userDiscId : "synthetic-server-sponsor",
        patreonUserId: `synthetic-voice-user-${personal}`,
        patreonMemberId: `synthetic-voice-member-${personal}`,
        patreonCampaignId: "synthetic-voice-campaign",
      });
      await new SupporterEntitlementRepository(testSql).upsertSnapshot({
        supporterIdentityId: identity.supporter_identity_id,
        tierKey: "test",
        patreonTierId: "test",
        patronStatus: "active_patron",
        isActive: true,
        source: "oauth",
        lastVerifiedAt: new Date(),
        periodStart: new Date(Date.now() - 60_000),
        periodEnd: new Date(Date.now() + 3_600_000),
      });
      const memberKeys = new MemberKeyRepository(testSql);
      const initial = await memberKeys.initialize(identity);
      const created = await memberKeys.storeCreated(
        initial,
        `synthetic-voice-hash-${personal}`,
        `synthetic-${personal ? "personal" : "server"}-member`,
      );
      await memberKeys.save({ ...created, applied_limit: 0.1, disabled: false, pending_action: null });
      if (!personal)
        await new SupporterSponsorshipRepository(testSql).startActiveSponsorship({
          serverId: refs.serverId,
          serverDiscId: FIXTURE_IDS.serverDiscId,
          sponsorIdentityId: identity.supporter_identity_id,
          createdByDiscId: "synthetic-server-sponsor",
        });
    }
    await testSql`INSERT INTO saved_provider_configs (server_id, provider) VALUES (${refs.serverId}, 'supporter') ON CONFLICT DO NOTHING`;
    await testSql`INSERT INTO user_saved_provider_configs (user_id, provider) VALUES (${refs.userId}, 'supporter') ON CONFLICT DO NOTHING`;
    process.env.RUN_ENV = "production";
    process.env.TOMORI_SUPPORTER_OPENROUTER_MANAGEMENT_KEY = "synthetic-management-key";
    process.env.TOMORI_SUPPORTER_CONFIG_JSON = JSON.stringify({
      patreon: {
        campaignId: "synthetic-voice-campaign",
        oauthClientIdEnv: "CLIENT_ID",
        oauthClientSecretEnv: "CLIENT_SECRET",
        webhookSecretEnv: "WEBHOOK_SECRET",
        creatorRefreshTokenEnv: "REFRESH_TOKEN",
        manageUrl: "https://www.patreon.com/example",
      },
      jobs: { reconcileIntervalSeconds: 300, manualRefreshCooldownSeconds: 30 },
      tiers: {
        test: {
          displayNameKey: "supporter.tiers.test",
          patreonTierIds: ["test"],
          monthlyBudgetMicros: 100000,
          defaultModelByCapability: { text: "example/text", voice: { clone: "fish-audio/s2.1-pro" } },
        },
      },
    });
    const spies: Array<{ mockRestore(): void }> = [];
    let delivered = 0;
    let persona = createPersona({
      persona_id: refs.personaId,
      server_id: refs.serverId,
      speech_voice_design_prompt: "Warm narration",
      speech_voice_sample_id: sample.sample_id,
      speech_voice_id: "preset_synthetic",
      config: { voice_message_enabled: true },
    });
    const channel = { id: "channel-1", type: ChannelType.GuildText, isThread: () => false };
    const modal = makeFakeInteraction();
    spies.push(spyOn(personaRepository, "loadAllForServer").mockImplementation(async () => [persona]));
    spies.push(
      spyOn(cooldownRepository, "checkMessageTriggerCooldownWithWhitelist").mockResolvedValue({
        isOnCooldown: false,
        remainingSeconds: 0,
        cooldownType: 0,
      }),
    );
    spies.push(
      spyOn(whitelist, "getCachedWhitelistStatus").mockResolvedValue({
        hasActiveWhitelist: false,
        hasActiveChannelWhitelist: false,
        isChannelWhitelisted: false,
        hasActiveRoleWhitelist: false,
        isRoleWhitelisted: false,
        hasActivePersonaWhitelist: false,
        isTriggerAllowed: true,
        hasChannelCooldownOverride: false,
      }),
    );
    spies.push(spyOn(spotlight, "getCachedPersonalSpotlightStatus").mockResolvedValue(null));
    spies.push(spyOn(metadata, "generateVoiceMessageMetadata").mockResolvedValue(null));
    spies.push(
      spyOn(delivery, "deliverVoiceMessage").mockImplementation(async () => `synthetic-message-${++delivered}`),
    );
    spies.push(
      spyOn(modals, "promptWithRawModal").mockImplementation(
        async () =>
          ({ outcome: "submit", interaction: modal.interaction, values: { voice_message_script: "Hello" } }) as never,
      ),
    );
    try {
      for (const subscription of [false, true]) {
        process.env.TOMORI_SUPPORTER_BILLING_ENABLED = String(subscription);
        const previousTargets: CustomEndpointRow[] = [endpoint, preset];
        for (const previous of previousTargets) {
          for (const personal of [false, true]) {
            await testSql`UPDATE user_saved_provider_configs SET enabled_capabilities = '{}', assigned_capabilities = '{}' WHERE user_id = ${refs.userId}`;
            expect(await setSpeechEndpointSelection(refs.serverId, endpoint.custom_endpoint_id)).toBe(true);
            if (previous === preset)
              expect(await setSpeechEndpointSelection(refs.serverId, preset.custom_endpoint_id)).toBe(true);
            expect((await resolveSpeechTargets(refs.serverId, refs.userId)).clone?.endpoint?.custom_endpoint_id).toBe(
              previous.custom_endpoint_id,
            );
            const scope = personal ? personalScope() : serverScope();
            expect(await activateProviderSpeechDefaults(scope, "google")).toBe(true);
            if (subscription) {
              expect(
                await saveProviderModel({
                  serverDiscId: FIXTURE_IDS.serverDiscId,
                  ownerId: scope.ownerId,
                  scopeKind: scope.kind,
                  state: persona,
                  entryId: "provider:supporter",
                  capability: "speech",
                  codeName: "fish-audio/s2.1-pro",
                }),
              ).toMatchObject({ status: "success" });
            } else expect(await activateProviderSpeechDefaults(scope, "openrouter")).toBe(true);
            for (const mode of ["design", "clone"] as const) {
              persona = { ...persona, voice_source_priority: mode };
              await testSql`UPDATE persona_voice_configs SET speech_voice_sample_id = ${sample.sample_id}, voice_source_priority = ${mode} WHERE persona_id = ${refs.personaId}`;
              const targets = await resolveSpeechTargets(refs.serverId, refs.userId);
              expect(targets[mode]?.owner.kind).toBe(personal ? "personal" : "server");
              expect(targets[mode]?.kind).toBe("hosted-model");
              const command = makeFakeInteraction({ guildId: FIXTURE_IDS.serverDiscId, channel });
              Object.assign(command.interaction.options, { getAttachment: () => null });
              const before = requests.length;
              await generateVoiceMessage(
                {} as Client,
                command.interaction as unknown as ChatInputCommandInteraction,
                createUserRow({ user_id: refs.userId }),
                "en-US",
              );
              expect(
                requests
                  .slice(before)
                  .some(({ url }) => url.endsWith(mode === "design" ? "/interactions" : "/audio/speech")),
              ).toBe(true);
              const tool = new GenerateVoiceMessageTool();
              const speechToolState: NonNullable<ToolAssemblyState["speechToolState"]> = { userId: refs.userId };
              const available = await getAvailableToolsWithMCP([tool], "google", {
                server_id: String(refs.serverId),
                speechToolState,
                activePersonaHasElevenlabsVoice: true,
                activePersonaVoiceDesignPrompt: persona.speech_voice_design_prompt,
                activePersonaVoiceSampleId: persona.speech_voice_sample_id,
                activePersonaVoiceSourcePriority: mode,
                llm: persona.llm,
                config: persona.config,
              });
              expect(available.builtInTools.map((entry) => entry.name)).toContain("generate_voice_message");
              const result = await tool.execute({ title: "test", script: "Hello" }, {
                tomoriState: persona,
                channel,
                internalUserId: refs.userId,
                streamContext: { speechToolState },
                locale: "en-US",
              } as unknown as ToolContext);
              expect(result.success).toBe(true);
              const speechRequests = requests.slice(before).filter(({ url }) => url.endsWith("/audio/speech"));
              if (mode === "clone") {
                expect(speechRequests).toHaveLength(2);
                for (const { init } of speechRequests)
                  expect(new Headers(init.headers).get("Authorization")).toBe(
                    `Bearer ${subscription ? `synthetic-${personal ? "personal" : "server"}-member` : "synthetic-openrouter"}`,
                  );
              }
              for (const secret of ["synthetic-personal-member", "synthetic-server-member"]) {
                expect(JSON.stringify({ result, command: command.calls, modal: modal.calls })).not.toContain(secret);
              }
              expect(result.data).toMatchObject({
                mode,
                target: mode === "design" ? "gemini-3.8-flash-tts" : "fish-audio/s2.1-pro",
              });
            }
          }
        }
      }
      expect(delivered).toBe(32);
      for (const scope of [serverScope(), personalScope()]) {
        const row =
          scope.kind === "personal"
            ? await llmProviderRepo.loadUserSavedProviderConfig(scope.ownerId, "supporter")
            : await llmProviderRepo.loadSavedProviderConfig(scope.ownerId, "supporter");
        expect(row?.api_key).toBeNull();
      }
      expect(await llmProviderRepo.deleteUserSavedProviderConfig(refs.userId, "openrouter")).toBe(true);
      expect((await resolveSpeechTargets(refs.serverId, refs.userId)).clone?.apiKey).toBe("synthetic-personal-member");
      expect(
        await saveProviderModel({
          serverDiscId: FIXTURE_IDS.serverDiscId,
          ownerId: refs.serverId,
          scopeKind: "server",
          state: persona,
          entryId: "provider:supporter",
          capability: "speech",
          codeName: "fish-audio/s2.1-pro",
        }),
      ).toMatchObject({ status: "success" });
      process.env.TOMORI_SUPPORTER_BILLING_ENABLED = "false";
      expect((await resolveSpeechTargets(refs.serverId, refs.userId)).clone?.apiKey).toBe("synthetic-openrouter");
      process.env.TOMORI_SUPPORTER_BILLING_ENABLED = "true";
      expect(await llmProviderRepo.deleteSavedProviderConfig(refs.serverId, "openrouter")).toBe(true);
      expect((await resolveSpeechTargets(refs.serverId)).clone?.apiKey).toBe("synthetic-server-member");
      await testSql`UPDATE server_byok_configs SET user_byok_mode = true WHERE server_id = ${refs.serverId}`;
      expect(await setPersonalCapabilityEnabled(refs.userId, "speech_clone", false)).toBe(true);
      expect((await resolveSpeechTargets(refs.serverId, refs.userId)).clone).toBeNull();
      await testSql`UPDATE server_byok_configs SET user_byok_mode = false WHERE server_id = ${refs.serverId}`;
      expect((await resolveSpeechTargets(refs.serverId, refs.userId)).clone?.apiKey).toBe("synthetic-server-member");
      expect(await setPersonalCapabilityEnabled(refs.userId, "speech_clone", true)).toBe(true);
      const target = (await resolveSpeechTargets(refs.serverId, refs.userId)).clone;
      if (!target) throw new Error("Missing personal subscription speech target");
      const memberKeys = new MemberKeyRepository(testSql);
      const oldKey = await memberKeys.load("synthetic-voice-member-true");
      if (!oldKey) throw new Error("Missing personal member key");
      const changed = await memberKeys.storeCreated(oldKey, "synthetic-rotated-voice-hash", "synthetic-rotated-member");
      await memberKeys.save({ ...changed, applied_limit: 0.1, disabled: false, pending_action: null });
      const before = requests.length;
      const stale = await synthesizeVoiceMessage({
        target,
        endpoint: null,
        endpointApiKey: "",
        elevenLabsApiKey: "",
        script: "Hello",
        source: { kind: "clone-buffer", refAudio: wav, refText: null },
      });
      expect(stale.success).toBe(false);
      expect(stale.errorKind).toBe("invalid_request");
      expect(requests).toHaveLength(before);
      await testSql`UPDATE supporter_entitlements SET is_active = false WHERE supporter_identity_id = ${oldKey.supporter_identity_id}`;
      const inactive = await resolveSpeechTargets(refs.serverId, refs.userId);
      expect(inactive.clone).toBeNull();
      expect(inactive.design?.apiKey).toBe("synthetic-personal-google");
      const panels = await Promise.all([
        providerPanelOperations.loadServerProviderPanelScope(FIXTURE_IDS.serverDiscId, true),
        providerPanelOperations.loadPersonalProviderPanelScope(FIXTURE_IDS.userDiscId, FIXTURE_IDS.serverDiscId),
      ]);
      for (const panel of panels) {
        if (!panel) throw new Error("Missing provider panel");
        const payload = buildProvidersPanelPayload({
          ...panel.data,
          locale: "en-US",
          page: { kind: "entry", entryId: "provider:supporter" },
          routeNamespace: panel.routeNamespace,
        });
        const serialized = JSON.stringify(payload);
        for (const secret of ["synthetic-server-member", "synthetic-personal-member", "synthetic-rotated-member"]) {
          expect(serialized).not.toContain(secret);
        }
      }
    } finally {
      for (const spy of spies) spy.mockRestore();
      await testSql`DELETE FROM supporter_identities WHERE patreon_campaign_id = 'synthetic-voice-campaign'`;
      await llmProviderRepo.deleteUserSavedProviderConfig(refs.userId, "supporter");
      await llmProviderRepo.deleteSavedProviderConfig(refs.serverId, "supporter");
      await deleteStoredVoiceSample(storedPath);
      await testSql`UPDATE persona_voice_configs SET speech_voice_sample_id = NULL WHERE persona_id = ${refs.personaId}`;
      await testSql`DELETE FROM voice_samples WHERE sample_id = ${sample.sample_id}`;
    }
  });

  it("preserves shared OpenRouter models until the final provider entry is removed", async () => {
    process.env.RUN_ENV = "production";
    process.env.TOMORI_SUPPORTER_OPENROUTER_MANAGEMENT_KEY = "synthetic-management-key";
    process.env.TOMORI_SUPPORTER_BILLING_ENABLED = "true";
    const [text] =
      await testSql`INSERT INTO llms (llm_provider, llm_codename, is_scoped_registration) VALUES ('openrouter', 'synthetic/removal-text', true) RETURNING llm_id`;
    const [speech] =
      await testSql`INSERT INTO speech_models (provider, codename, voice_mode, is_scoped_registration) VALUES ('openrouter', 'synthetic/removal-speech', 'clone', true) RETURNING speech_model_id`;
    const [decision] =
      await testSql`INSERT INTO decision_models (provider, codename, input_token_limit, is_scoped_registration) VALUES ('openrouter', 'synthetic/removal-decision', 8192, true) RETURNING decision_model_id`;
    const key = await encryptApiKey("synthetic-removal-key");
    try {
      for (const scope of [serverScope(), personalScope()]) {
        for (const first of ["openrouter", "supporter"]) {
          const serverId = scope.kind === "server" ? scope.ownerId : null;
          const userId = scope.kind === "personal" ? scope.ownerId : null;
          for (const provider of ["openrouter", "supporter"]) {
            const apiKey = provider === "openrouter" ? key.encrypted : null;
            if (userId)
              await testSql`INSERT INTO user_saved_provider_configs (user_id, provider, api_key, key_version) VALUES (${userId}, ${provider}, ${apiKey}, ${key.version}) ON CONFLICT (user_id, provider) DO UPDATE SET api_key = EXCLUDED.api_key`;
            else
              await testSql`INSERT INTO saved_provider_configs (server_id, provider, api_key, key_version) VALUES (${serverId}, ${provider}, ${apiKey}, ${key.version}) ON CONFLICT (server_id, provider) DO UPDATE SET api_key = EXCLUDED.api_key`;
          }
          await testSql`INSERT INTO scoped_model_registrations (server_id, user_id, llm_id) VALUES (${serverId}, ${userId}, ${text.llm_id})`;
          await testSql`INSERT INTO scoped_model_registrations (server_id, user_id, speech_model_id) VALUES (${serverId}, ${userId}, ${speech.speech_model_id})`;
          await testSql`INSERT INTO scoped_model_registrations (server_id, user_id, decision_model_id) VALUES (${serverId}, ${userId}, ${decision.decision_model_id})`;
          const remaining = first === "openrouter" ? "supporter" : "openrouter";
          expect(
            await setHostedSpeechSelection(scope, speech.speech_model_id, undefined, false, undefined, remaining),
          ).toBe(true);
          if (serverId) {
            await testSql`UPDATE server_chat_configs SET response_reviewer_llm_id = ${text.llm_id} WHERE server_id = ${serverId}`;
            await testSql`UPDATE server_model_configs SET decision_model_id = ${decision.decision_model_id} WHERE server_id = ${serverId}`;
          }
          if (serverId) {
            const fallbackRefs = JSON.stringify([{ type: "llm", id: text.llm_id, credentialProvider: "supporter" }]);
            await testSql`UPDATE server_chat_configs SET fallback_model_refs = ${fallbackRefs}::jsonb WHERE server_id = ${serverId}`;
            const states = [
              await personaRepository.loadState(FIXTURE_IDS.serverDiscId),
              ...(await personaRepository.loadAllForServer(FIXTURE_IDS.serverDiscId)),
            ];
            for (const state of states) {
              expect(
                state?.fallback_chain?.find((entry) => entry.kind === "llm" && entry.model.llm_id === text.llm_id),
              ).toMatchObject({ credentialProvider: "supporter" });
            }
          }
          if (userId) {
            const panel = await providerPanelOperations.loadPersonalProviderPanelScope(
              FIXTURE_IDS.userDiscId,
              FIXTURE_IDS.serverDiscId,
            );
            if (!panel) throw new Error("Missing personal provider panel");
            for (const entry of panel.data.entries.filter(
              (entry) => entry.kind === "provider" && ["openrouter", "supporter"].includes(entry.provider),
            )) {
              if (entry.kind !== "provider") continue;
              const models = entry.capabilities.flatMap((capability) => capability.models);
              const selected = models.find(
                (model) => model.id === speech.speech_model_id && model.codeName === "synthetic/removal-speech",
              );
              expect(selected?.isWorkspaceActive).toBe(entry.id === `provider:${remaining}`);
            }
          }
          for (const [provider, preserved] of [
            [first, true],
            [remaining, false],
          ] as const) {
            expect(
              await providerPanelOperations.removeServerProviderEntry({
                serverDiscId: FIXTURE_IDS.serverDiscId,
                scopeKind: scope.kind,
                ownerId: scope.ownerId,
                state: createPersona({ server_id: refs.serverId }),
                entry: {
                  id: `provider:${provider}`,
                  kind: "provider",
                  provider,
                  displayName: provider,
                  savedAt: null,
                  rotationKeyCount: 0,
                  capabilities: [],
                },
              }),
            ).toMatchObject({ status: "success" });
            const [registered] =
              await testSql`SELECT COUNT(*)::int AS count FROM scoped_model_registrations WHERE server_id IS NOT DISTINCT FROM ${serverId} AND user_id IS NOT DISTINCT FROM ${userId} AND (llm_id = ${text.llm_id} OR speech_model_id = ${speech.speech_model_id} OR decision_model_id = ${decision.decision_model_id})`;
            expect(registered.count).toBe(preserved ? 3 : 0);
            if (serverId) {
              const [pins] =
                await testSql`SELECT response_reviewer_llm_id, decision_model_id, speech_clone_model_id FROM server_chat_configs JOIN server_model_configs USING (server_id) JOIN server_speech_configs USING (server_id) WHERE server_id = ${serverId}`;
              expect(pins).toEqual({
                response_reviewer_llm_id: preserved ? text.llm_id : null,
                decision_model_id: preserved ? decision.decision_model_id : null,
                speech_clone_model_id: preserved ? speech.speech_model_id : null,
              });
            } else if (preserved) {
              const saved = await llmProviderRepo.loadUserSavedProviderConfig(scope.ownerId, remaining);
              expect(saved?.speech_clone_model_id).toBe(speech.speech_model_id);
              expect(saved?.enabled_capabilities).toContain("speech_clone");
            }
          }
        }
      }
    } finally {
      await testSql`UPDATE server_chat_configs SET fallback_model_refs = '[]'::jsonb WHERE server_id = ${refs.serverId}`;
      await testSql`DELETE FROM llms WHERE llm_id = ${text.llm_id}`;
      await testSql`DELETE FROM speech_models WHERE speech_model_id = ${speech.speech_model_id}`;
      await testSql`DELETE FROM decision_models WHERE decision_model_id = ${decision.decision_model_id}`;
    }
  });

  it("rechecks BYOK before using a legacy server credential without a selected target", async () => {
    await testSql`UPDATE server_byok_configs SET user_byok_mode = true WHERE server_id = ${refs.serverId}`;
    const result = await synthesizeVoiceMessage({
      endpoint: null,
      endpointApiKey: "",
      elevenLabsApiKey: "synthetic-legacy-key",
      script: "Hello",
      source: { kind: "elevenlabs", voiceId: "synthetic-voice" },
      routing: routing(),
    });
    expect(result.success).toBe(false);
    expect(result.errorKind).toBe("invalid_request");
    expect(requests).toHaveLength(0);
  });

  it("reuses saved identity across models and direction changes while keeping usage per operation", async () => {
    const first = await synthesizeVoiceMessage(await request());
    await setHostedSpeechSelection(serverScope(), liteId);
    const second = await synthesizeVoiceMessage({ ...(await request()), voiceInstructions: "Quietly" });
    expect(first.success && second.success).toBe(true);
    expect(created).toBe(1);
    expect(syntheses()).toHaveLength(2);
    expect(first.attempts?.[0].operations.map((operation) => operation.operation)).toEqual(["create", "synthesize"]);
    expect(second.attempts?.[0].operations.map((operation) => operation.operation)).toEqual(["synthesize"]);
    expect(first.attempts?.[0].operations[0].usage?.total_input_tokens).toBe(11);
    expect(second.attempts?.[0].model).toBe("gemini-3.8-flash-lite-tts");
    expect(await testSql`SELECT * FROM speech_voice_bindings WHERE NOT pending_delete`).toHaveLength(1);
  });

  it("retains one binding under concurrent creation and deletes the surplus identity", async () => {
    let release: (() => void) | undefined;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    onCreate = async () => {
      if (created === 2) release?.();
      await barrier;
    };
    const input = await request();
    const results = await Promise.all([synthesizeVoiceMessage(input), synthesizeVoiceMessage(input)]);
    expect(results.every((result) => result.success)).toBe(true);
    expect(created).toBe(2);
    expect(syntheses()).toHaveLength(2);
    expect(deletes()).toHaveLength(1);
    const bindings = await testSql`SELECT * FROM speech_voice_bindings`;
    expect(bindings).toHaveLength(1);
    expect(
      syntheses().every(
        ({ init }) => JSON.parse(String(init.body)).generation_config.speech_config[0].voice === bindings[0].voice_id,
      ),
    ).toBe(true);
  });

  it("recreates a confirmed missing or expired identity once, and never for authentication or quotas", async () => {
    for (const status of [401, 429, 500, 404]) {
      requests.length = 0;
      created = 0;
      await testSql`DELETE FROM speech_voice_bindings`;
      synthesisStatuses = [status];
      const result = await synthesizeVoiceMessage(await request());
      expect(result.success).toBe(status === 404);
      expect(created).toBe(status === 404 ? 2 : 1);
      expect(syntheses()).toHaveLength(status === 404 ? 2 : 1);
      expect(result.attempts?.[0].operations[0].usage?.total_input_tokens).toBe(11);
    }
    await testSql`UPDATE speech_voice_bindings SET expires_at = NOW() - INTERVAL '1 second'`;
    requests.length = 0;
    const result = await synthesizeVoiceMessage(await request());
    expect(result.success).toBe(true);
    expect(created).toBe(3);
    expect(syntheses()).toHaveLength(1);
    synthesisStatuses = [404, 404];
    expect((await synthesizeVoiceMessage(await request())).success).toBe(false);
    expect(created).toBe(4);
  });

  it("cleans temporary identities after success, synthesis failure, and cancellation, and retries failed deletions", async () => {
    deleteFails = true;
    const first = await synthesizeVoiceMessage(await request(false, true));
    expect(first.success).toBe(true);
    expect(first.cleanupPending).toBe(true);
    expect(await testSql`SELECT * FROM speech_voice_bindings WHERE pending_delete`).toHaveLength(1);
    deleteFails = false;
    synthesisStatuses = [500];
    expect((await synthesizeVoiceMessage(await request(false, true))).success).toBe(false);
    expect(await testSql`SELECT * FROM speech_voice_bindings`).toHaveLength(0);
    const controller = new AbortController();
    onSynthesize = async () => {
      controller.abort();
      throw controller.signal.reason;
    };
    const cancelled = await synthesizeVoiceMessage({ ...(await request(false, true)), abortSignal: controller.signal });
    expect(cancelled.errorKind).toBe("cancelled");
    expect(await testSql`SELECT * FROM speech_voice_bindings`).toHaveLength(0);
    expect(deletes().every(({ init }) => !init.signal?.aborted)).toBe(true);
  });

  it("rejects a stale prompt written during creation and deletes its remote voice without synthesis", async () => {
    onCreate = async () => {
      await testSql`UPDATE persona_voice_configs SET speech_voice_design_prompt = 'Changed narration' WHERE persona_id = ${refs.personaId}`;
    };
    const result = await synthesizeVoiceMessage(await request());
    expect(result.success).toBe(false);
    expect(syntheses()).toHaveLength(0);
    expect(deletes()).toHaveLength(1);
    expect(await testSql`SELECT * FROM speech_voice_bindings`).toHaveLength(0);
  });

  it("stops cancelled creation and deletes known identities with malformed creation metadata", async () => {
    for (const cancelled of [true, false]) {
      requests.length = 0;
      const controller = new AbortController();
      creationExpiry = cancelled ? "2099-01-01T00:00:00Z" : "invalid";
      onCreate = async () => {
        if (cancelled) controller.abort();
      };
      const result = await synthesizeVoiceMessage({ ...(await request()), abortSignal: controller.signal });
      expect(result.errorKind).toBe(cancelled ? "cancelled" : "malformed_response");
      expect(syntheses()).toHaveLength(0);
      expect(deletes()).toHaveLength(cancelled ? 0 : 1);
      if (!cancelled) expect(deletes()[0].init.signal?.aborted).toBe(false);
      expect(await testSql`SELECT * FROM speech_voice_bindings`).toHaveLength(0);
    }
  });

  it("uses fresh server credentials once after a personal failure and retains both attempts' usage", async () => {
    for (const status of [401, 403, 402, 429, 500]) {
      await testSql`DELETE FROM speech_voice_bindings`;
      requests.length = 0;
      synthesisStatuses = [status];
      const result = await synthesizeVoiceMessage({ ...(await request(true)), routing: routing() });
      expect(result.success).toBe(true);
      expect(result.usedServerFallback).toBe(true);
      expect(result.attempts?.map((attempt) => attempt.owner.kind)).toEqual(["personal", "server"]);
      expect(result.attempts?.[0].errorKind).toBe(
        status < 402 || status === 403 ? "authentication" : status === 500 ? "provider_error" : "quota",
      );
      expect(result.attempts?.[0].operations[0].usage?.total_input_tokens).toBe(11);
      expect(result.attempts?.[0].operations[1].usage?.total_input_tokens).toBe(3);
      expect(syntheses().map(({ init }) => new Headers(init.headers).get("x-goog-api-key"))).toEqual([
        "synthetic-personal-google",
        "synthetic-server-google",
      ]);
      expect(syntheses()).toHaveLength(2);
    }
  });

  it("logs provider bodies for operators without the credential, and keeps request text out of metadata and user output", async () => {
    const input = await request(false, true);
    const apiKey = input.target?.apiKey ?? "";
    const requestText = ["private-script-marker", "private-description-marker", "private-direction-marker"];
    upstreamError = [...requestText, apiKey].join(" ");
    deleteFails = true;
    synthesisStatuses = [500];
    const errorSpy = spyOn(log, "error").mockResolvedValue(undefined);
    const warnSpy = spyOn(log, "warn").mockImplementation(() => undefined);
    try {
      const result = await synthesizeVoiceMessage({
        ...input,
        script: requestText[0],
        source: { kind: "design", designPrompt: requestText[1] },
        voiceInstructions: requestText[2],
      });
      expect(result.success).toBe(false);
      expect(result.cleanupPending).toBe(true);
      expect(result.attempts?.[0].operations.map(({ operation, success }) => ({ operation, success }))).toEqual([
        { operation: "create", success: true },
        { operation: "synthesize", success: false },
        { operation: "delete", success: false },
      ]);
      expect(errorSpy.mock.calls.map(([, , context]) => context?.errorType).sort()).toEqual([
        "SpeechOperationFailed",
        "SpeechVoiceCleanupFailed",
      ]);
      const synthesisLog = errorSpy.mock.calls.find(([, , context]) => context?.errorType === "SpeechOperationFailed");
      expect(result.providerDetail).toStartWith("HTTP 500: ");
      expect(synthesisLog?.[0]).toContain(result.providerDetail ?? "missing");
      expect(apiKey.length).toBeGreaterThan(0);
      expect(JSON.stringify({ result, errors: errorSpy.mock.calls, warnings: warnSpy.mock.calls })).not.toContain(
        apiKey,
      );
      const metadata = JSON.stringify(errorSpy.mock.calls.map(([, , context]) => context?.metadata));
      const userOutput = JSON.stringify({ details: result.details, attempts: result.attempts });
      for (const value of requestText) {
        expect(metadata).not.toContain(value);
        expect(userOutput).not.toContain(value);
      }
      expect(await testSql`SELECT * FROM speech_voice_bindings WHERE pending_delete`).toHaveLength(1);
    } finally {
      errorSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });

  it("logs a provider 400 with its body and keeps local refusals, cancellation, and key refusals out of error logs", async () => {
    upstreamError = "synthetic voice prompt rejected";
    synthesisStatuses = [400];
    const errorSpy = spyOn(log, "error").mockResolvedValue(undefined);
    const warnSpy = spyOn(log, "warn").mockImplementation(() => undefined);
    try {
      const rejected = await synthesizeVoiceMessage(await request());
      expect(rejected.errorKind).toBe("invalid_request");
      expect(rejected.providerDetail).toContain(upstreamError);
      expect(rejected.details).not.toContain(upstreamError);
      expect(errorSpy).toHaveBeenCalledTimes(1);
      const [message, , context] = errorSpy.mock.calls[0];
      expect(message).toContain(rejected.providerDetail ?? "missing");
      expect(context?.serverId).toBe(refs.serverId);
      expect(context?.metadata).toMatchObject({
        origin: "provider",
        providerStatus: 400,
        errorKind: "invalid_request",
      });

      for (const condition of ["local", "cancelled", "authentication"] as const) {
        errorSpy.mockClear();
        synthesisStatuses = condition === "authentication" ? [401] : [];
        const result = await synthesizeVoiceMessage({
          ...(await request()),
          ...(condition === "local" ? { script: "x".repeat(2001) } : {}),
          ...(condition === "cancelled" ? { abortSignal: AbortSignal.abort() } : {}),
        });
        expect(result.success).toBe(false);
        expect(errorSpy).not.toHaveBeenCalled();
      }
    } finally {
      errorSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });

  it("logs each failed attempt when personal synthesis and its server fallback both fail", async () => {
    synthesisStatuses = [500, 500];
    const errorSpy = spyOn(log, "error").mockResolvedValue(undefined);
    try {
      const result = await synthesizeVoiceMessage({ ...(await request(true)), routing: routing() });
      expect(result.success).toBe(false);
      expect(result.usedServerFallback).toBe(true);
      expect(
        errorSpy.mock.calls
          .filter(([, , context]) => context?.errorType === "SpeechOperationFailed")
          .map(([, , context]) => context?.metadata?.owner),
      ).toEqual(["personal", "server"]);
    } finally {
      errorSpy.mockRestore();
    }
  });

  async function useElevenLabsServerFallback() {
    const endpoint = await llmProviderRepo.upsertCustomEndpoint({
      serverId: refs.serverId,
      label: "Fallback ElevenLabs",
      capability: "speech",
      apiStyle: "elevenlabs",
      endpointUrl: "https://api.elevenlabs.io",
      requiresAuth: true,
    });
    if (!endpoint?.custom_endpoint_id || !endpoint.connection_id) throw new Error("Missing fallback target");
    const saved = await llmProviderRepo.loadSavedProviderConfig(refs.serverId, "google");
    if (!saved) throw new Error("Missing credential fixture");
    await llmProviderRepo.upsertSavedProviderConfig(refs.serverId, {
      ...saved,
      provider: `custom:${endpoint.connection_id}`,
    });
    expect(await setHostedSpeechSelection(serverScope(), null, "design")).toBe(true);
    expect(await setSpeechEndpointSelection(refs.serverId, endpoint.custom_endpoint_id)).toBe(true);
    return { ...endpoint, custom_endpoint_id: endpoint.custom_endpoint_id };
  }

  it("logs an ElevenLabs outage with its body and keeps its rate limit out of error logs", async () => {
    await useElevenLabsServerFallback();
    upstreamError = "synthetic elevenlabs outage";
    const errorSpy = spyOn(log, "error").mockResolvedValue(undefined);
    const warnSpy = spyOn(log, "warn").mockImplementation(() => undefined);
    try {
      for (const status of [500, 429]) {
        errorSpy.mockClear();
        synthesisStatuses = [429, status];
        const result = await synthesizeVoiceMessage({ ...(await request(true)), routing: routing() });
        expect(result.success).toBe(false);
        expect(result.backendKey).toBe("elevenlabs");
        expect(result.details).not.toContain(upstreamError);
        expect(result.providerDetail).toContain(upstreamError);
        const logged = errorSpy.mock.calls.filter(
          ([, , context]) => context?.errorType === "ElevenLabsOperationFailed",
        );
        expect(logged).toHaveLength(status === 500 ? 1 : 0);
        if (status === 500) expect(logged[0][0]).toContain(result.providerDetail ?? "missing");
      }
    } finally {
      errorSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });

  it("reports the custom endpoint label after personal fallback regardless of its model metadata", async () => {
    const endpoint = await useElevenLabsServerFallback();
    for (const modelName of [null, "", "   ", "custom-model"]) {
      await testSql`UPDATE custom_endpoints SET model_name = ${modelName} WHERE custom_endpoint_id = ${endpoint.custom_endpoint_id}`;
      synthesisStatuses = [429];
      const result = await synthesizeVoiceMessage({ ...(await request(true)), routing: routing() });
      expect(result.success).toBe(true);
      expect(result.usedServerFallback).toBe(true);
      expect(result.targetLabel).toBe(endpoint.label);
      expect(result.attempts?.map((attempt) => attempt.owner.kind)).toEqual(["personal", "server"]);
      expect(result.attempts?.at(-1)?.model).toBe(modelName ?? "");
    }
  });

  it("withholds fallback for opt-out, BYOK, invalid input, cancellation, and successful synthesis", async () => {
    for (const condition of ["disabled", "byok", "invalid", "cancelled", "success"] as const) {
      await testSql`DELETE FROM speech_voice_bindings`;
      requests.length = 0;
      await testSql`UPDATE user_personalization_configs SET personal_server_fallback_enabled = ${condition !== "disabled"} WHERE user_id = ${refs.userId}`;
      await testSql`UPDATE server_byok_configs SET user_byok_mode = ${condition === "byok"} WHERE server_id = ${refs.serverId}`;
      synthesisStatuses = condition === "success" ? [] : [500];
      const input = {
        ...(await request(true)),
        routing: routing(),
        ...(condition === "invalid" ? { script: "x".repeat(2001) } : {}),
        ...(condition === "cancelled" ? { abortSignal: AbortSignal.abort() } : {}),
      };
      const result = await synthesizeVoiceMessage(input);
      expect(result.attempts?.some((attempt) => attempt.owner.kind === "server")).toBe(false);
      expect(syntheses()).toHaveLength(condition === "invalid" || condition === "cancelled" ? 0 : 1);
      if (condition === "byok") {
        await setHostedSpeechSelection(personalScope(), null, "design");
        expect((await resolveSpeechTargets(refs.serverId, refs.userId)).design).toBeNull();
        await setHostedSpeechSelection(personalScope(), googleId);
      }
    }
  });

  it("preserves a failed personal cleanup when server fallback succeeds", async () => {
    deleteFails = true;
    expect((await synthesizeVoiceMessage(await request(true, true))).cleanupPending).toBe(true);
    requests.length = 0;
    synthesisStatuses = [429];
    const result = await synthesizeVoiceMessage({ ...(await request(true)), routing: routing() });
    expect(result.success).toBe(true);
    expect(result.cleanupPending).toBe(true);
    expect(result.usedServerFallback).toBe(true);
    expect(
      result.attempts?.[0].operations.some((operation) => operation.operation === "delete" && !operation.success),
    ).toBe(true);
    expect(syntheses()).toHaveLength(2);
  });

  it("falls back once for malformed provider audio while preserving its usage", async () => {
    malformedSynthesis = true;
    const result = await synthesizeVoiceMessage({ ...(await request(true)), routing: routing() });
    expect(result.success).toBe(true);
    expect(result.usedServerFallback).toBe(true);
    expect(result.attempts?.[0].errorKind).toBe("malformed_response");
    expect(
      result.attempts?.[0].operations.find((operation) => operation.operation === "synthesize")?.usage
        ?.total_output_tokens,
    ).toBe(9);
    expect(created).toBe(2);
    expect(syntheses()).toHaveLength(2);
  });

  it("re-resolves saved sources for server fallback while keeping explicit descriptions fixed", async () => {
    const endpoint = await llmProviderRepo.upsertCustomEndpoint({
      serverId: refs.serverId,
      label: "Synthetic preset",
      capability: "speech",
      apiStyle: "elevenlabs",
      endpointUrl: "https://api.elevenlabs.io",
      requiresAuth: true,
    });
    if (!endpoint?.custom_endpoint_id || !endpoint.connection_id) throw new Error("Missing test endpoint");
    const old = await llmProviderRepo.loadSavedProviderConfig(refs.serverId, "google");
    if (!old) throw new Error("Missing test config");
    const key = await encryptApiKey("synthetic-preset-key");
    await llmProviderRepo.upsertSavedProviderConfig(refs.serverId, {
      ...old,
      provider: `custom:${endpoint.connection_id}`,
      api_key: key.encrypted,
      key_version: key.version,
    });
    await setSpeechEndpointSelection(refs.serverId, endpoint.custom_endpoint_id);
    await setHostedSpeechSelection(serverScope(), null, "design");
    synthesisStatuses = [500];
    const result = await synthesizeVoiceMessage({ ...(await request(true)), routing: routing() });
    expect(result.success).toBe(true);
    expect(result.effectiveSource).toBe("elevenlabs");
    expect(result.backendKey).toBe("elevenlabs");
    expect(syntheses()).toHaveLength(2);
    requests.length = 0;
    synthesisStatuses = [500];
    const explicit = await synthesizeVoiceMessage({ ...(await request(true, true)), routing: routing(true) });
    expect(explicit.success).toBe(false);
    expect(syntheses()).toHaveLength(1);
    await setHostedSpeechSelection(serverScope(), googleId);
    requests.length = 0;
    synthesisStatuses = [429];
    const explicitInput = await request(true, true);
    explicitInput.source = { kind: "design", designPrompt: "One-off bright narrator" };
    const explicitFallback = await synthesizeVoiceMessage({
      ...explicitInput,
      routing: { ...routing(true), persona: { ...routing().persona, voice_source_priority: "clone" } },
    });
    expect(explicitFallback.success).toBe(true);
    expect(explicitFallback.effectiveSource).toBe("design");
    expect(explicitFallback.attempts?.map(({ source }) => source)).toEqual(["design", "design"]);
    expect(
      requests
        .filter(({ url }) => url.endsWith("/voices"))
        .map(({ init }) => JSON.parse(String(init.body)).voice.prompted.input),
    ).toEqual(["One-off bright narrator", "One-off bright narrator"]);
    requests.length = 0;
    synthesisStatuses = [401, 503];
    const failedFallback = await synthesizeVoiceMessage({ ...(await request(true)), routing: routing() });
    expect(failedFallback.success).toBe(false);
    expect(failedFallback.usedServerFallback).toBe(true);
    expect(failedFallback.attempts?.map(({ owner, source }) => [owner.kind, source])).toEqual([
      ["personal", "design"],
      ["server", "design"],
    ]);
    expect(syntheses()).toHaveLength(2);
    expect(syntheses().every(({ url }) => url.endsWith("/interactions"))).toBe(true);
  });

  it("cleans personal bindings with their old credential before replacement and registration removal", async () => {
    const old = (await llmProviderRepo.loadUserSavedProviderConfigs(refs.userId)).find(
      (row) => row.provider === "google",
    );
    if (!old) throw new Error("Missing personal test config");
    expect((await synthesizeVoiceMessage(await request(true))).success).toBe(true);
    const key = await encryptApiKey("synthetic-replaced-personal");
    expect(
      await llmProviderRepo.upsertUserSavedProviderConfig(refs.userId, {
        ...old,
        api_key: key.encrypted,
        key_version: key.version,
      }),
    ).toBe(true);
    expect(new Headers(deletes().at(-1)?.init.headers).get("x-goog-api-key")).toBe("synthetic-personal-google");
    expect((await synthesizeVoiceMessage(await request(true))).success).toBe(true);
    expect(await llmProviderRepo.deleteUserProviderRegistration(refs.userId, "google")).toBe(true);
    expect(new Headers(deletes().at(-1)?.init.headers).get("x-goog-api-key")).toBe("synthetic-replaced-personal");
    expect(await testSql`SELECT * FROM speech_voice_bindings`).toHaveLength(0);
    expect(await llmProviderRepo.upsertUserSavedProviderConfig(refs.userId, old)).toBe(true);
  });

  it("reports a failed old-key deletion once and excludes its retained row from later synthesis cleanup", async () => {
    const oldServer = await llmProviderRepo.loadSavedProviderConfig(refs.serverId, "google");
    const oldPersonal = (await llmProviderRepo.loadUserSavedProviderConfigs(refs.userId)).find(
      (row) => row.provider === "google",
    );
    if (!oldServer || !oldPersonal) throw new Error("Missing test credentials");
    const errorSpy = spyOn(log, "error").mockResolvedValue(undefined);
    try {
      for (const personal of [false, true]) {
        const saveKey = (key: { encrypted: Buffer; version: number }) =>
          personal
            ? llmProviderRepo.upsertUserSavedProviderConfig(refs.userId, {
                ...oldPersonal,
                api_key: key.encrypted,
                key_version: key.version,
              })
            : llmProviderRepo.upsertSavedProviderConfig(refs.serverId, {
                ...oldServer,
                api_key: key.encrypted,
                key_version: key.version,
              });
        expect((await synthesizeVoiceMessage(await request(personal))).success).toBe(true);
        const previous = await loadSpeechCredentialForCleanup(personal ? personalScope() : serverScope(), "google");
        if (!previous) throw new Error("Missing test credential owner");
        deleteFails = true;
        errorSpy.mockClear();
        const nextKey = await encryptApiKey("synthetic-replacement-cleanup-failure");
        expect(await saveKey(nextKey)).toBe(true);
        expect(errorSpy).toHaveBeenCalledTimes(1);
        const pending = await loadPendingSpeechVoiceDeletions(previous.credentialId, personal ? "personal" : "server");
        expect(pending).toHaveLength(1);
        expect(pending[0].credential_revision).toBe(previous.credentialRevision);
        requests.length = 0;
        errorSpy.mockClear();
        for (let invocation = 0; invocation < 2; invocation++) {
          const result = await synthesizeVoiceMessage(await request(personal));
          expect(result.success).toBe(true);
          expect(result.cleanupPending).toBe(false);
        }
        expect(errorSpy).not.toHaveBeenCalled();
        expect(deletes()).toHaveLength(0);
        expect(syntheses()).toHaveLength(2);
        expect(await loadPendingSpeechVoiceDeletions(previous.credentialId, personal ? "personal" : "server")).toEqual(
          pending,
        );
        deleteFails = false;
        const original = personal ? oldPersonal : oldServer;
        if (!original.api_key) throw new Error("Missing original test key");
        expect(await saveKey({ encrypted: original.api_key, version: original.key_version })).toBe(true);
      }
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("excludes another Cloud project's pending voices from cleanup requests, status, and repeated errors", async () => {
    const key = await encryptApiKey("original-project::global");
    const [credential] = await testSql`
      INSERT INTO saved_provider_configs (server_id, provider, api_key, key_version)
      VALUES (${refs.serverId}, 'vertex', ${key.encrypted}, ${key.version})
      RETURNING saved_config_id, credential_revision
    `;
    const pending = await savePendingSpeechVoiceDeletion(
      {
        persona_id: null,
        saved_config_id: credential.saved_config_id,
        user_saved_config_id: null,
        credential_revision: credential.credential_revision,
        transport: "vertex",
        project: "original-project",
        location: "global",
        prompt_hash: "synthetic-cloud-prompt",
      },
      "voice_other_project",
    );
    const errorSpy = spyOn(log, "error").mockResolvedValue(undefined);
    try {
      for (let invocation = 0; invocation < 2; invocation++) {
        expect(
          await cleanupPendingGoogleVoices(
            serverScope(),
            credential.saved_config_id,
            credential.credential_revision,
            "different-project::global",
            [],
          ),
        ).toBe(true);
      }
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
      expect(await loadPendingSpeechVoiceDeletions(credential.saved_config_id, "server")).toEqual([pending]);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("deletes retired prompts and persona voices, and uses the old key before credential replacement or removal", async () => {
    expect((await synthesizeVoiceMessage(await request())).success).toBe(true);
    await testSql`UPDATE persona_voice_configs SET speech_voice_design_prompt = 'Changed narration' WHERE persona_id = ${refs.personaId}`;
    const changed = await request();
    changed.source = { kind: "design", designPrompt: "Changed narration", personaId: refs.personaId };
    expect((await synthesizeVoiceMessage(changed)).success).toBe(true);
    expect(deletes()).toHaveLength(1);
    const old = await llmProviderRepo.loadSavedProviderConfig(refs.serverId, "google");
    if (!old) throw new Error("Missing test config");
    const key = await encryptApiKey("synthetic-replaced-google");
    expect(
      await llmProviderRepo.upsertSavedProviderConfig(refs.serverId, {
        ...old,
        api_key: key.encrypted,
        key_version: key.version,
      }),
    ).toBe(true);
    expect(new Headers(deletes().at(-1)?.init.headers).get("x-goog-api-key")).toBe("synthetic-server-google");
    expect(await testSql`SELECT * FROM speech_voice_bindings`).toHaveLength(0);
    const [alter] =
      await testSql`INSERT INTO personas (server_id, persona_nickname, is_alter) VALUES (${refs.serverId}, 'Juno', true) RETURNING persona_id`;
    await testSql`INSERT INTO persona_voice_configs (persona_id, speech_voice_design_prompt) VALUES (${alter.persona_id}, 'Warm narration')`;
    const alterInput = await request();
    alterInput.source = { kind: "design", designPrompt: "Warm narration", personaId: alter.persona_id };
    expect((await synthesizeVoiceMessage(alterInput)).success).toBe(true);
    expect(await personaRepository.removePersona(alter.persona_id)).toBe(true);
    expect(await testSql`SELECT * FROM speech_voice_bindings`).toHaveLength(0);
    expect(
      (
        await synthesizeVoiceMessage({
          ...(await request()),
          source: { kind: "design", designPrompt: "Changed narration", personaId: refs.personaId },
        })
      ).success,
    ).toBe(true);
    expect(await llmProviderRepo.deleteSavedProviderConfig(refs.serverId, "google")).toBe(true);
    expect(new Headers(deletes().at(-1)?.init.headers).get("x-goog-api-key")).toBe("synthetic-replaced-google");
    expect(await testSql`SELECT * FROM speech_voice_bindings`).toHaveLength(0);
  });
});
