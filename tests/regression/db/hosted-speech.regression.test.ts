import { resetRepository } from "@/utils/db/repositories/ResetRepository";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, spyOn } from "bun:test";
import { llmModelRepo, llmProviderRepo, configRepository, personaRepository } from "@/utils/db/repositories";
import {
  loadHostedSpeechSelection,
  setHostedSpeechSelection,
  setSpeechEndpointSelection,
  saveSpeechVoiceBinding,
  loadSpeechVoiceBinding,
  loadPendingSpeechVoiceDeletions,
  deleteSpeechModelRegistration,
} from "@/utils/db/repositories/SpeechRepository";
import { setPersonalCapabilityEnabled } from "@/utils/provider/personalProviderHelpers";
import { resolveSpeechTargets } from "@/utils/provider/speechEndpointResolver";
import { resolveVoiceSourceCandidates } from "@/utils/speech/voiceSourceResolution";
import { encryptApiKey } from "@/utils/security/crypto";
import { activateProviderSpeechDefaults } from "@/utils/provider/providerActivation";
import { registerHostedSpeechModelForScope } from "@/utils/provider/openrouterModelRegistry";
import { saveProviderModel } from "@/utils/provider/providerPanelOperations";
import { cache } from "@/utils/cache/tomoriStateCacheStore";
import { createPersona } from "../../helpers/fixtures";
import { DB_TESTS_AVAILABLE, executeTestSqlFile, setupTestDb, testSql } from "./setup/testDb";
import { insertFixtures, cleanupFixtures, FIXTURE_IDS, type FixtureRefs } from "./setup/fixtures";

describe.skipIf(!DB_TESTS_AVAILABLE)("Hosted speech persistence", () => {
  let refs: FixtureRefs;
  let googleId: number;
  let fishId: number;
  let googleCredentialId: number;
  let personalCredentialId: number;
  let foreignServerId: number;
  const migration = path.join(process.cwd(), "src/db/migrations/102_hosted_speech_models.sql");
  const scope = () => ({ kind: "server" as const, ownerId: refs.serverId });
  const personal = () => ({ kind: "personal" as const, ownerId: refs.userId });

  beforeAll(async () => {
    await setupTestDb();
    refs = await insertFixtures(testSql);
    await testSql`INSERT INTO persona_voice_configs (persona_id) VALUES (${refs.personaId})`;
    const [foreign] =
      await testSql`INSERT INTO servers (server_disc_id) VALUES ('_rt_speech_foreign') RETURNING server_id`;
    foreignServerId = foreign.server_id;
    const google = await llmModelRepo.loadAvailableSpeechModels("google", scope());
    const fish = await llmModelRepo.loadAvailableSpeechModels("openrouter", scope());
    googleId = google.find((model) => model.is_default)?.speech_model_id ?? 0;
    fishId = fish.find((model) => model.is_default)?.speech_model_id ?? 0;
    for (const provider of ["google", "openrouter"]) {
      const serverKey = await encryptApiKey(`test-server-${provider}-speech`);
      const personalKey = await encryptApiKey(`test-personal-${provider}-speech`);
      const [serverCredential] = await testSql`
        INSERT INTO saved_provider_configs (server_id, provider, api_key, key_version)
        VALUES (${refs.serverId}, ${provider}, ${serverKey.encrypted}, ${serverKey.version})
        ON CONFLICT (server_id, provider) DO UPDATE SET api_key = EXCLUDED.api_key, key_version = EXCLUDED.key_version
        RETURNING saved_config_id
      `;
      const [userCredential] = await testSql`
        INSERT INTO user_saved_provider_configs (user_id, provider, api_key, key_version)
        VALUES (${refs.userId}, ${provider}, ${personalKey.encrypted}, ${personalKey.version})
        ON CONFLICT (user_id, provider) DO UPDATE SET api_key = EXCLUDED.api_key, key_version = EXCLUDED.key_version
        RETURNING user_saved_config_id
      `;
      if (provider === "google") {
        googleCredentialId = serverCredential.saved_config_id;
        personalCredentialId = userCredential.user_saved_config_id;
      }
    }
  });

  afterAll(async () => {
    await cleanupFixtures(testSql);
    await testSql`DELETE FROM servers WHERE server_id = ${foreignServerId}`;
  });

  it("seeds paid Clone and Flash Design defaults without activating them", async () => {
    const google = await llmModelRepo.loadAvailableSpeechModels("google", scope());
    const fish = await llmModelRepo.loadAvailableSpeechModels("openrouter", scope());
    expect(google.find((model) => model.is_default)?.codename).toBe("gemini-3.8-flash-tts");
    expect(fish.find((model) => model.is_default)?.codename).toBe("fish-audio/s2.1-pro");
    expect(fish.some((model) => model.codename === "fish-audio/s2.1-pro-free:free" && !model.is_default)).toBe(true);
    expect(google.some((model) => model.codename === "gemini-3.8-flash-lite-tts" && !model.is_default)).toBe(true);
    expect(await loadHostedSpeechSelection(refs.serverId, "design")).toBeNull();
  });

  it("replaces all supported endpoint slots atomically and preserves the other mode", async () => {
    const auto = await llmProviderRepo.upsertCustomEndpoint({
      serverId: refs.serverId,
      label: "Speech Auto",
      capability: "speech",
      apiStyle: "tts-clone",
      endpointUrl: "http://127.0.0.1:9000",
      requiresAuth: false,
      extraConfig: { voice_mode: "auto" },
    });
    if (!auto?.custom_endpoint_id) throw new Error("Missing Auto endpoint");
    expect(await setSpeechEndpointSelection(refs.serverId, auto.custom_endpoint_id)).toBe(true);
    expect(await setHostedSpeechSelection(scope(), fishId)).toBe(true);
    let targets = await resolveSpeechTargets(refs.serverId);
    expect(targets.design?.kind).toBe("custom-endpoint");
    expect(targets.clone?.kind).toBe("hosted-model");
    expect(await setHostedSpeechSelection(scope(), googleId)).toBe(true);
    expect(await setHostedSpeechSelection(scope(), fishId, "design")).toBe(false);
    expect(await setHostedSpeechSelection({ kind: "server", ownerId: foreignServerId }, googleId)).toBe(false);
    targets = await resolveSpeechTargets(refs.serverId);
    expect(targets.design?.apiKey).toBe("test-server-google-speech");
    expect(targets.clone?.apiKey).toBe("test-server-openrouter-speech");
    const state = await personaRepository.loadState(FIXTURE_IDS.serverDiscId);
    expect(state?.config.speech_design_model_id).toBe(googleId);
    expect(state?.config.speech_clone_model_id).toBe(fishId);
    await executeTestSqlFile(migration);
    expect((await resolveSpeechTargets(refs.serverId)).clone?.apiKey).toBe("test-server-openrouter-speech");
    const models = {
      design: targets.design?.kind === "hosted-model" ? targets.design.model : null,
      clone: targets.clone?.kind === "hosted-model" ? targets.clone.model : null,
    };
    for (const priority of ["design", "clone"] as const) {
      expect(
        resolveVoiceSourceCandidates({
          targets: models,
          persona: {
            speech_voice_design_prompt: "Warm narration",
            speech_voice_sample_id: 12,
            voice_source_priority: priority,
          },
        })[0]?.shape,
      ).toBe(priority);
    }
    expect(await setSpeechEndpointSelection(refs.serverId, auto.custom_endpoint_id)).toBe(true);
    targets = await resolveSpeechTargets(refs.serverId);
    expect(targets.design?.endpoint?.custom_endpoint_id).toBe(auto.custom_endpoint_id);
    expect(targets.clone?.endpoint?.custom_endpoint_id).toBe(auto.custom_endpoint_id);
    await executeTestSqlFile(migration);
    expect((await resolveSpeechTargets(refs.serverId)).clone?.endpoint?.custom_endpoint_id).toBe(
      auto.custom_endpoint_id,
    );
  });

  it("keeps personal ownership, enabling, credentials, and server inheritance independent per mode", async () => {
    expect(await setHostedSpeechSelection(scope(), googleId)).toBe(true);
    expect(await setHostedSpeechSelection(scope(), fishId)).toBe(true);
    expect(await setHostedSpeechSelection(personal(), googleId)).toBe(true);
    expect(await setHostedSpeechSelection(personal(), fishId)).toBe(true);
    let targets = await resolveSpeechTargets(refs.serverId, refs.userId);
    expect(targets.design?.apiKey).toBe("test-personal-google-speech");
    expect(targets.clone?.apiKey).toBe("test-personal-openrouter-speech");
    expect(targets.design?.owner).toEqual(personal());
    const vertex = (await llmModelRepo.loadAvailableSpeechModels("vertex", scope())).find((model) => model.is_default);
    if (!vertex) throw new Error("Missing Vertex model");
    expect(await setHostedSpeechSelection(personal(), vertex.speech_model_id)).toBe(false);
    expect((await resolveSpeechTargets(refs.serverId, refs.userId)).design?.apiKey).toBe("test-personal-google-speech");
    expect(await setPersonalCapabilityEnabled(refs.userId, "speech_design", false)).toBe(true);
    targets = await resolveSpeechTargets(refs.serverId, refs.userId);
    expect(targets.design?.apiKey).toBe("test-server-google-speech");
    expect(targets.clone?.apiKey).toBe("test-personal-openrouter-speech");
    expect(await setPersonalCapabilityEnabled(refs.userId, "speech_design", true)).toBe(true);
    expect(await setHostedSpeechSelection(personal(), fishId, "design")).toBe(false);
    expect((await resolveSpeechTargets(refs.serverId, refs.userId)).design?.apiKey).toBe("test-personal-google-speech");
    const rows = await llmProviderRepo.loadUserSavedProviderConfigs(refs.userId);
    expect(rows.find((row) => row.provider === "google")?.assigned_capabilities).toContain("speech_design");
    expect(rows.find((row) => row.provider === "openrouter")?.enabled_capabilities).toContain("speech_clone");
  });

  it("applies provider defaults only to their supported modes and preserves persona sources", async () => {
    const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(
        async (input: Parameters<typeof fetch>[0]) =>
          Response.json(
            String(input).endsWith("/endpoints")
              ? { data: { endpoints: [{ supports_voice_cloning: true }] } }
              : { data: [{ id: "fish-audio/s2.1-pro" }, { id: "fish-audio/s2.1-pro-free:free" }] },
          ),
        { preconnect: () => undefined },
      ),
    );
    try {
      await testSql`UPDATE persona_voice_configs SET speech_voice_design_prompt = 'Warm narration', voice_source_priority = 'clone' WHERE persona_id = ${refs.personaId}`;
      const [savedPersona] =
        await testSql`SELECT speech_voice_design_prompt, voice_source_priority FROM persona_voice_configs WHERE persona_id = ${refs.personaId}`;
      const result = await registerHostedSpeechModelForScope(scope(), "openrouter", "fish-audio/s2.1-pro-free:free");
      expect(result.status).toBe("registered");
      expect((await loadHostedSpeechSelection(refs.serverId, "clone"))?.model.codename).toBe(
        "fish-audio/s2.1-pro-free:free",
      );
      expect(await activateProviderSpeechDefaults(scope(), "openrouter")).toBe(true);
      expect((await loadHostedSpeechSelection(refs.serverId, "clone"))?.model.speech_model_id).toBe(fishId);
      const lite = (await llmModelRepo.loadAvailableSpeechModels("google", scope())).find((model) => !model.is_default);
      if (!lite) throw new Error("Missing Flash-Lite model");
      expect(await setHostedSpeechSelection(scope(), lite.speech_model_id)).toBe(true);
      expect(await activateProviderSpeechDefaults(scope(), "google")).toBe(true);
      expect((await loadHostedSpeechSelection(refs.serverId, "design"))?.model.speech_model_id).toBe(googleId);
      expect((await loadHostedSpeechSelection(refs.serverId, "clone"))?.model.speech_model_id).toBe(fishId);
      expect(await activateProviderSpeechDefaults(personal(), "google")).toBe(true);
      expect(await activateProviderSpeechDefaults(personal(), "openrouter")).toBe(true);
      const [persona] =
        await testSql`SELECT speech_voice_design_prompt, voice_source_priority FROM persona_voice_configs WHERE persona_id = ${refs.personaId}`;
      expect(persona).toEqual(savedPersona);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("replaces curated defaults without registration rows in both scopes and preserves Clone", async () => {
    const lite = (await llmModelRepo.loadAvailableSpeechModels("google", scope())).find((model) => !model.is_default);
    if (!lite) throw new Error("Missing Flash-Lite model");
    for (const owner of [scope(), personal()]) {
      await deleteSpeechModelRegistration(owner, googleId);
      expect(await setHostedSpeechSelection(owner, googleId)).toBe(true);
      const result = await registerHostedSpeechModelForScope(owner, "google", lite.codename, googleId);
      expect(result.status).toBe("registered");
      const userId = owner.kind === "personal" ? owner.ownerId : undefined;
      expect((await loadHostedSpeechSelection(refs.serverId, "design", userId))?.model.speech_model_id).toBe(
        lite.speech_model_id,
      );
      expect((await loadHostedSpeechSelection(refs.serverId, "clone", userId))?.model.speech_model_id).toBe(fishId);
      expect(await setHostedSpeechSelection(owner, googleId, undefined, true, lite.speech_model_id)).toBe(true);
    }
  });

  it("handles replacement failures without changing selections or scoped ownership", async () => {
    const state = createPersona({ server_id: refs.serverId });
    const before = await llmProviderRepo.loadUserSavedProviderConfigs(refs.userId);
    expect(
      await saveProviderModel({
        state,
        serverDiscId: FIXTURE_IDS.serverDiscId,
        scopeKind: "personal",
        ownerId: refs.userId,
        entryId: "provider:google",
        capability: "speech",
        codeName: "gemini-3.8-flash-tts",
        editingModelId: fishId,
      }),
    ).toEqual({ status: "write-failed" });
    expect(await llmProviderRepo.loadUserSavedProviderConfigs(refs.userId)).toEqual(before);
    expect(
      await registerHostedSpeechModelForScope(
        { kind: "server", ownerId: foreignServerId },
        "google",
        "gemini-3.8-flash-tts",
      ),
    ).toEqual({ status: "write_failed" });
    const lite = (await llmModelRepo.loadAvailableSpeechModels("google", scope())).find((model) => !model.is_default);
    if (!lite) throw new Error("Missing Flash-Lite model");
    await testSql`UPDATE speech_models SET is_scoped_registration = true WHERE speech_model_id = ${lite.speech_model_id}`;
    try {
      expect(await setHostedSpeechSelection(scope(), lite.speech_model_id, undefined, true)).toBe(true);
      expect(
        await registerHostedSpeechModelForScope(personal(), "google", "gemini-3.8-flash-tts", lite.speech_model_id),
      ).toEqual({ status: "write_failed" });
      expect((await loadHostedSpeechSelection(refs.serverId, "design"))?.model.speech_model_id).toBe(
        lite.speech_model_id,
      );
      expect(await llmProviderRepo.loadUserSavedProviderConfigs(refs.userId)).toEqual(before);
      expect(await setHostedSpeechSelection(scope(), googleId, undefined, true, lite.speech_model_id)).toBe(true);
    } finally {
      await testSql`UPDATE speech_models SET is_scoped_registration = false WHERE speech_model_id = ${lite.speech_model_id}`;
    }
  });

  it("invalidates cached state after commit and preserves it on failed activation", async () => {
    const persona = createPersona({ server_id: refs.serverId });
    const entry = { personas: [persona], mainPersona: persona, cachedAt: Date.now() };
    cache.set(FIXTURE_IDS.serverDiscId, entry);
    expect(await setHostedSpeechSelection(scope(), fishId, "design")).toBe(false);
    expect(cache.get(FIXTURE_IDS.serverDiscId)).toBe(entry);
    const registrations =
      await testSql`SELECT speech_model_id FROM scoped_model_registrations WHERE server_id = ${refs.serverId} ORDER BY speech_model_id`;
    expect(await setHostedSpeechSelection(scope(), googleId, undefined, true, fishId)).toBe(false);
    expect(
      await testSql`SELECT speech_model_id FROM scoped_model_registrations WHERE server_id = ${refs.serverId} ORDER BY speech_model_id`,
    ).toEqual(registrations);
    expect(cache.get(FIXTURE_IDS.serverDiscId)).toBe(entry);
    expect(await setHostedSpeechSelection(scope(), googleId)).toBe(true);
    expect(cache.has(FIXTURE_IDS.serverDiscId)).toBe(false);
  });

  it("preserves hosted targets through reset and configuration export and clears only removed registrations", async () => {
    expect(await setHostedSpeechSelection(scope(), googleId, undefined, true)).toBe(true);
    expect(await setHostedSpeechSelection(scope(), fishId, undefined, true)).toBe(true);
    const [server] = await testSql`SELECT server_disc_id FROM servers WHERE server_id = ${refs.serverId}`;
    const exported = await configRepository.toExportShape(server.server_disc_id);
    if (!exported) throw new Error("Missing speech configuration export");
    await resetRepository.resetServerConfiguration(refs.serverId);
    expect((await loadHostedSpeechSelection(refs.serverId, "clone"))?.model.speech_model_id).toBe(fishId);
    await setHostedSpeechSelection(scope(), null, "design");
    expect(await configRepository.fromExportShape(server.server_disc_id, exported)).toBe(true);
    await deleteSpeechModelRegistration(scope(), fishId);
    expect(await loadHostedSpeechSelection(refs.serverId, "clone")).toBeNull();
    expect((await loadHostedSpeechSelection(refs.serverId, "design"))?.model.speech_model_id).toBe(googleId);
  });

  it("binds voice identity to credential revision and persona, reuses across models, and retires changed prompts", async () => {
    const [credential] =
      await testSql`SELECT credential_revision FROM saved_provider_configs WHERE saved_config_id = ${googleCredentialId}`;
    const identity = {
      persona_id: refs.personaId,
      saved_config_id: googleCredentialId,
      user_saved_config_id: null,
      credential_revision: credential.credential_revision,
      transport: "google" as const,
      project: "",
      location: "",
      prompt_hash: "a".repeat(64),
    };
    const [first, concurrent] = await Promise.all([
      saveSpeechVoiceBinding(identity, "voice_first", null),
      saveSpeechVoiceBinding(identity, "voice_concurrent", null),
    ]);
    expect(first.speech_voice_binding_id).toBe(concurrent.speech_voice_binding_id);
    const personalBinding = await saveSpeechVoiceBinding(
      { ...identity, saved_config_id: null, user_saved_config_id: personalCredentialId, credential_revision: 1 },
      "voice_personal",
      null,
    );
    expect(personalBinding.voice_id).not.toBe(first.voice_id);
    const [foreign] = await testSql`
      INSERT INTO saved_provider_configs (server_id, provider, api_key)
      SELECT ${foreignServerId}, 'google', api_key FROM saved_provider_configs WHERE saved_config_id = ${googleCredentialId}
      RETURNING saved_config_id
    `;
    await expect(
      saveSpeechVoiceBinding({ ...identity, saved_config_id: foreign.saved_config_id }, "voice_foreign", null),
    ).rejects.toThrow();
    await expect(
      saveSpeechVoiceBinding(
        { ...identity, credential_revision: identity.credential_revision + 1 },
        "voice_stale",
        null,
      ),
    ).rejects.toThrow();
    await testSql`UPDATE persona_voice_configs SET voice_source_priority = 'clone' WHERE persona_id = ${refs.personaId}`;
    expect((await loadSpeechVoiceBinding(identity))?.voice_id).toBe(first.voice_id);
    await testSql`UPDATE persona_voice_configs SET speech_voice_design_prompt = 'New voice' WHERE persona_id = ${refs.personaId}`;
    expect(await loadSpeechVoiceBinding(identity)).toBeNull();
    expect(
      (await loadPendingSpeechVoiceDeletions(googleCredentialId, "server")).some(
        (row) => row.voice_id === first.voice_id,
      ),
    ).toBe(true);
    await saveSpeechVoiceBinding({ ...identity, prompt_hash: "b".repeat(64) }, "voice_revised", null);
    const [alter] = await testSql`
      INSERT INTO personas (server_id, persona_nickname, is_alter)
      VALUES (${refs.serverId}, 'Juno', true) RETURNING persona_id
    `;
    const alterBinding = await saveSpeechVoiceBinding(
      { ...identity, persona_id: alter.persona_id },
      "voice_alter",
      null,
    );
    await testSql`DELETE FROM personas WHERE persona_id = ${alter.persona_id}`;
    expect(
      (await loadPendingSpeechVoiceDeletions(googleCredentialId, "server")).find(
        (row) => row.speech_voice_binding_id === alterBinding.speech_voice_binding_id,
      )?.persona_id,
    ).toBeNull();
    await testSql`UPDATE saved_provider_configs SET api_key = api_key WHERE saved_config_id = ${googleCredentialId}`;
    expect(
      (
        await testSql`SELECT credential_revision FROM saved_provider_configs WHERE saved_config_id = ${googleCredentialId}`
      )[0].credential_revision,
    ).toBe(identity.credential_revision);
    const nextKey = await encryptApiKey("test-server-google-replaced");
    await testSql`UPDATE saved_provider_configs SET api_key = ${nextKey.encrypted} WHERE saved_config_id = ${googleCredentialId}`;
    expect(
      (
        await testSql`SELECT credential_revision FROM saved_provider_configs WHERE saved_config_id = ${googleCredentialId}`
      )[0].credential_revision,
    ).toBe(identity.credential_revision + 1);
    expect(await loadSpeechVoiceBinding({ ...identity, prompt_hash: "b".repeat(64) })).toBeNull();
    await testSql`DELETE FROM saved_provider_configs WHERE saved_config_id = ${googleCredentialId}`;
    expect(await loadHostedSpeechSelection(refs.serverId, "design")).toBeNull();
  });
});
