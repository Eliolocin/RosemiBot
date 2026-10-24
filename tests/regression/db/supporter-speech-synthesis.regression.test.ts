import { createMemberKeyMetadata } from "../../helpers/memberKeyMetadata";
import { useEnvSandbox } from "../../helpers/env";
import {
  initializeSupporterBillingSchema,
  SupporterIdentityRepository,
  SupporterEntitlementRepository,
  SupporterSponsorshipRepository,
} from "@/modules/supporter-billing/db";
import { MemberKeyRepository } from "@/modules/supporter-billing/db/repositories/memberKeys";
import { providerPanelOperations } from "@/utils/provider/providerPanelOperations";
import { createPersona } from "../../helpers/fixtures";
import { initializeLocalizer } from "@/utils/text/localizer";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { llmModelRepo, llmProviderRepo, personaRepository } from "@/utils/db/repositories";
import { setHostedSpeechSelection } from "@/utils/db/repositories/SpeechRepository";
import { resolveSpeechTargets } from "@/utils/provider/speechEndpointResolver";
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

  requests.filter(({ url }) => url.endsWith("/interactions") || url.includes("/text-to-speech/"));

  it("resolves refused server Subscription speech to no target when funding is unavailable or revoked", async () => {
    process.env.RUN_ENV = "production";
    process.env.TOMORI_SUPPORTER_BILLING_ENABLED = "true";
    process.env.TOMORI_SUPPORTER_OPENROUTER_MANAGEMENT_KEY = "synthetic-management-key";
    process.env.TOMORI_SUPPORTER_CONFIG_JSON = JSON.stringify({
      patreon: {
        campaignId: "synthetic-speech-refusal-campaign",
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
    await initializeSupporterBillingSchema(testSql);
    const fish = (await llmModelRepo.loadAvailableSpeechModels("openrouter", serverScope())).find(
      (model) => model.codename === "fish-audio/s2.1-pro",
    );
    if (!fish) throw new Error("Missing Fish speech model");
    const identity = await new SupporterIdentityRepository(testSql).upsertIdentity({
      discordUserId: "synthetic-speech-refusal-sponsor",
      patreonUserId: "synthetic-speech-refusal-user",
      patreonMemberId: "synthetic-speech-refusal-member",
      patreonCampaignId: "synthetic-speech-refusal-campaign",
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
    const createdKey = await memberKeys.storeCreated(
      initial,
      "synthetic-speech-refusal-hash",
      "synthetic-speech-refusal-member",
    );
    await memberKeys.save({ ...createdKey, applied_limit: 0.1, disabled: false, pending_action: null });
    const sponsorship = await new SupporterSponsorshipRepository(testSql).startActiveSponsorship({
      serverId: refs.serverId,
      serverDiscId: FIXTURE_IDS.serverDiscId,
      sponsorIdentityId: identity.supporter_identity_id,
      createdByDiscId: "synthetic-speech-refusal-sponsor",
    });
    await testSql`INSERT INTO saved_provider_configs (server_id, provider) VALUES (${refs.serverId}, 'supporter') ON CONFLICT DO NOTHING`;
    const markers = async () =>
      (await testSql`SELECT subscription_capabilities FROM server_model_configs WHERE server_id = ${refs.serverId}`)[0]
        .subscription_capabilities as string[];
    try {
      expect(
        await setHostedSpeechSelection(serverScope(), fish.speech_model_id, undefined, false, undefined, "supporter"),
      ).toBe(true);
      expect((await resolveSpeechTargets(refs.serverId)).clone?.apiKey).toBe("synthetic-speech-refusal-member");
      expect(await markers()).toContain("speech_clone");

      expect(
        await new SupporterSponsorshipRepository(testSql).revokeActiveSponsorship({
          sponsorshipId: sponsorship.sponsorship_id,
        }),
      ).toMatchObject({ status: "revoked" });
      expect(await markers()).toContain("speech_clone");
      const revoked = await resolveSpeechTargets(refs.serverId);
      expect(revoked.clone).toBeNull();
      expect(revoked.denials?.clone).toMatchObject({ reason: "missing_sponsorship", fundingScope: "server" });

      await new SupporterSponsorshipRepository(testSql).startActiveSponsorship({
        serverId: refs.serverId,
        serverDiscId: FIXTURE_IDS.serverDiscId,
        sponsorIdentityId: identity.supporter_identity_id,
        createdByDiscId: "synthetic-speech-refusal-sponsor",
      });
      expect((await resolveSpeechTargets(refs.serverId)).clone?.apiKey).toBe("synthetic-speech-refusal-member");

      await testSql`UPDATE supporter_entitlements SET is_active = false WHERE supporter_identity_id = ${identity.supporter_identity_id}`;
      expect((await resolveSpeechTargets(refs.serverId)).clone).toBeNull();
      await testSql`UPDATE supporter_entitlements SET is_active = true WHERE supporter_identity_id = ${identity.supporter_identity_id}`;

      const validConfig = process.env.TOMORI_SUPPORTER_CONFIG_JSON;
      process.env.TOMORI_SUPPORTER_CONFIG_JSON = "{}";
      expect((await resolveSpeechTargets(refs.serverId)).clone).toBeNull();
      process.env.TOMORI_SUPPORTER_CONFIG_JSON = validConfig;
    } finally {
      await testSql`DELETE FROM supporter_identities WHERE patreon_campaign_id = 'synthetic-speech-refusal-campaign'`;
      await testSql`DELETE FROM saved_provider_configs WHERE server_id = ${refs.serverId} AND provider = 'supporter'`;
      await setHostedSpeechSelection(serverScope(), null, "clone");
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
            await testSql`UPDATE server_model_configs SET decision_model_id = ${decision.decision_model_id},
              subscription_capabilities = CASE WHEN ${remaining === "supporter"}
                THEN array_append(array_remove(subscription_capabilities, 'decision'), 'decision')
                ELSE array_remove(subscription_capabilities, 'decision') END
              WHERE server_id = ${serverId}`;
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
                response_reviewer_llm_id: preserved && provider !== "openrouter" ? text.llm_id : null,
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
});
