import { resetRepository } from "@/utils/db/repositories/ResetRepository";
import path from "node:path";
import { seedModelsFromCatalog } from "@/db/seed/catalog/modelSeed";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  llmProviderRepo,
  personaRepository,
  configRepository,
  exportRepository,
  importRepository,
} from "@/utils/db/repositories";
import { loadActiveEndpoint, setSpeechEndpointSelection } from "@/utils/db/repositories/SpeechRepository";
import { resolveVoiceSourceCandidates } from "@/utils/speech/voiceSourceResolution";
import { DB_TESTS_AVAILABLE, executeTestSqlFile, setupTestDb, testSql } from "./setup/testDb";

describe.skipIf(!DB_TESTS_AVAILABLE)("Server speech source selections", () => {
  let serverId: number;
  let otherServerId: number;
  let personaId: number;
  const serverDiscId = "_speech_source_selections";
  const otherDiscId = "_speech_source_selections_other";
  const migration = path.join(process.cwd(), "src/db/migrations/101_speech_source_selections.sql");
  const downgrade = path.join(process.cwd(), "src/db/migrations/101_speech_source_selections.down.sql");
  const hostedMigration = path.join(process.cwd(), "src/db/migrations/102_hosted_speech_models.sql");
  const hostedDowngrade = path.join(process.cwd(), "src/db/migrations/102_hosted_speech_models.down.sql");
  const designMigration = path.join(process.cwd(), "src/db/migrations/109_openrouter_design_speech_models.sql");
  const decisionMigration = path.join(process.cwd(), "src/db/migrations/098_decision_models.sql");

  beforeAll(async () => {
    await setupTestDb();
    await testSql`DELETE FROM servers WHERE server_disc_id IN (${serverDiscId}, ${otherDiscId})`;
    const [server] = await testSql`INSERT INTO servers (server_disc_id) VALUES (${serverDiscId}) RETURNING server_id`;
    const [other] = await testSql`INSERT INTO servers (server_disc_id) VALUES (${otherDiscId}) RETURNING server_id`;
    serverId = server.server_id;
    otherServerId = other.server_id;
    const [persona] = await testSql`
      INSERT INTO personas (server_id, persona_nickname, is_alter)
      VALUES (${serverId}, 'Mirri', false) RETURNING persona_id
    `;
    personaId = persona.persona_id;
  });

  afterAll(async () => {
    await testSql`DELETE FROM servers WHERE server_disc_id IN (${serverDiscId}, ${otherDiscId})`;
  });

  async function endpoint(label: string, mode: "clone" | "voice-design" | "auto", owner = serverId) {
    const row = await llmProviderRepo.upsertCustomEndpoint({
      serverId: owner,
      label,
      capability: "speech",
      apiStyle: "tts-clone",
      endpointUrl: "http://127.0.0.1:9000",
      requiresAuth: false,
      extraConfig: { voice_mode: mode },
    });
    if (!row?.custom_endpoint_id) throw new Error("Endpoint fixture failed");
    return row;
  }

  async function selections() {
    return {
      design: await loadActiveEndpoint(serverId, "design"),
      clone: await loadActiveEndpoint(serverId, "clone"),
    };
  }

  it("routes Design-only and Clone-only personas concurrently and respects priority with both sources", async () => {
    const design = await endpoint("Design", "voice-design");
    const clone = await endpoint("Clone", "clone");
    expect(await setSpeechEndpointSelection(serverId, design.custom_endpoint_id ?? null)).toBe(true);
    expect(await setSpeechEndpointSelection(serverId, clone.custom_endpoint_id ?? null)).toBe(true);
    const targets = await selections();
    expect(targets.design?.custom_endpoint_id).toBe(design.custom_endpoint_id);
    expect(targets.clone?.custom_endpoint_id).toBe(clone.custom_endpoint_id);
    for (const priority of ["design", "clone"] as const) {
      const persona = {
        speech_voice_design_prompt: "Warm voice",
        speech_voice_sample_id: 12,
        voice_source_priority: priority,
      };
      expect(resolveVoiceSourceCandidates({ targets, persona })[0]?.shape).toBe(priority);
    }
    expect(
      resolveVoiceSourceCandidates({ targets, persona: { speech_voice_design_prompt: "Warm voice" } })[0]?.shape,
    ).toBe("design");
    expect(resolveVoiceSourceCandidates({ targets, persona: { speech_voice_sample_id: 12 } })[0]?.shape).toBe("clone");
  });

  it("activates both slots for Auto and clears one slot without touching the other", async () => {
    const auto = await endpoint("Auto", "auto");
    expect(
      await llmProviderRepo.setActiveCustomEndpoint({
        serverId,
        capability: "speech",
        customEndpointId: auto.custom_endpoint_id ?? 0,
      }),
    ).toBe(true);
    let targets = await selections();
    expect(targets.design?.custom_endpoint_id).toBe(auto.custom_endpoint_id);
    expect(targets.clone?.custom_endpoint_id).toBe(auto.custom_endpoint_id);
    expect(await setSpeechEndpointSelection(serverId, null, "design")).toBe(true);
    targets = await selections();
    expect(targets.design).toBeNull();
    expect(targets.clone?.custom_endpoint_id).toBe(auto.custom_endpoint_id);
    const clone = await endpoint("New Clone", "clone");
    await setSpeechEndpointSelection(serverId, auto.custom_endpoint_id ?? null);
    await setSpeechEndpointSelection(serverId, clone.custom_endpoint_id ?? null);
    targets = await selections();
    expect(targets.design?.custom_endpoint_id).toBe(auto.custom_endpoint_id);
    expect(targets.clone?.custom_endpoint_id).toBe(clone.custom_endpoint_id);
  });

  it("rejects foreign ownership and unsupported modes without changing either selection", async () => {
    const foreign = await endpoint("Foreign", "auto", otherServerId);
    const clone = await endpoint("Ineligible Design", "clone");
    const before = await selections();
    expect(await setSpeechEndpointSelection(serverId, foreign.custom_endpoint_id ?? null)).toBe(false);
    expect(await setSpeechEndpointSelection(serverId, clone.custom_endpoint_id ?? null, "design")).toBe(false);
    expect(await selections()).toEqual(before);
    await expect(
      testSql`
      UPDATE server_speech_configs SET speech_design_endpoint_id = ${foreign.custom_endpoint_id}
      WHERE server_id = ${serverId}
    `.execute(),
    ).rejects.toThrow();
    expect(await selections()).toEqual(before);
  });

  it("clears only unsupported slots after mode edits, then clears references on endpoint and provider deletion", async () => {
    const auto = await endpoint("Editable", "auto");
    await setSpeechEndpointSelection(serverId, auto.custom_endpoint_id ?? null);
    await llmProviderRepo.upsertCustomEndpoint({
      serverId,
      label: auto.label,
      capability: "speech",
      apiStyle: "tts-clone",
      customEndpointId: auto.custom_endpoint_id,
      endpointUrl: auto.endpoint_url,
      requiresAuth: false,
      extraConfig: { voice_mode: "clone" },
    });
    let targets = await selections();
    expect(targets.design).toBeNull();
    expect(targets.clone?.custom_endpoint_id).toBe(auto.custom_endpoint_id);
    await llmProviderRepo.deleteCustomEndpointById(auto.custom_endpoint_id ?? 0, { serverId, serverDiscId });
    expect((await selections()).clone).toBeNull();
    const provider = await endpoint("Deletable", "auto");
    await setSpeechEndpointSelection(serverId, provider.custom_endpoint_id ?? null);
    await llmProviderRepo.deleteServerCustomEndpointConnectionGroup(serverId, [provider.connection_id]);
    targets = await selections();
    expect(targets.design).toBeNull();
    expect(targets.clone).toBeNull();
  });

  it("hydrates both selections and persona priority through repository projections", async () => {
    const auto = await endpoint("Projection", "auto");
    await setSpeechEndpointSelection(serverId, auto.custom_endpoint_id ?? null);
    expect(
      await personaRepository.setVoiceConfig(personaId, {
        speech_voice_sample_id: null,
        speech_voice_id: null,
        speech_voice_name: null,
        speech_voice_design_prompt: "Warm voice",
        voice_source_priority: "clone",
      }),
    ).toBe(true);
    const state = await personaRepository.loadState(serverDiscId);
    expect(state?.config.speech_design_endpoint_id).toBe(auto.custom_endpoint_id);
    expect(state?.config.speech_clone_endpoint_id).toBe(auto.custom_endpoint_id);
    expect(state?.voice_source_priority).toBe("clone");
    const exported = await configRepository.toExportShape(serverDiscId);
    expect(exported?.speech?.speech_design_endpoint_id).toBe(auto.custom_endpoint_id);
    expect(exported?.speech?.speech_clone_endpoint_id).toBe(auto.custom_endpoint_id);
  });

  it("preserves both selections during configuration reset and restores them from configuration export", async () => {
    const design = await endpoint("Preserved Design", "voice-design");
    const clone = await endpoint("Preserved Clone", "clone");
    await setSpeechEndpointSelection(serverId, design.custom_endpoint_id ?? null);
    await setSpeechEndpointSelection(serverId, clone.custom_endpoint_id ?? null);
    const exported = await configRepository.toExportShape(serverDiscId);
    if (!exported) throw new Error("Missing exported configuration");
    await resetRepository.resetServerConfiguration(serverId);
    expect((await selections()).design?.custom_endpoint_id).toBe(design.custom_endpoint_id);
    expect((await selections()).clone?.custom_endpoint_id).toBe(clone.custom_endpoint_id);
    await setSpeechEndpointSelection(serverId, null, "design");
    await setSpeechEndpointSelection(serverId, null, "clone");
    expect(await configRepository.fromExportShape(serverDiscId, exported)).toBe(true);
    const workspaceExport = await exportRepository.exportWorkspaceConfig(serverDiscId);
    const workspaceData = workspaceExport.data;
    if (!workspaceExport.success || !workspaceData || workspaceData.type !== "workspace_config") {
      throw new Error("Missing workspace configuration export");
    }
    await setSpeechEndpointSelection(serverId, null, "clone");
    const restored = await importRepository.importWorkspaceConfig(serverDiscId, workspaceData);
    expect(restored.success).toBe(true);
    const foreign = await endpoint("Foreign import", "auto", otherServerId);
    const rejected = await importRepository.importWorkspaceConfig(serverDiscId, {
      speech: { speech_design_endpoint_id: foreign.custom_endpoint_id ?? null, speech_clone_endpoint_id: null },
    });
    expect(rejected.success).toBe(false);
    expect((await selections()).design?.custom_endpoint_id).toBe(design.custom_endpoint_id);
    expect((await selections()).clone?.custom_endpoint_id).toBe(clone.custom_endpoint_id);
  });

  it("backfills only the legacy winner's eligible slots and leaves unrelated inactive endpoints unused", async () => {
    const candidates = [
      await endpoint("Backfill Clone", "clone"),
      await endpoint("Backfill Design", "voice-design"),
      await endpoint("Backfill Auto", "auto"),
      await llmProviderRepo.upsertCustomEndpoint({
        serverId,
        label: "Backfill ElevenLabs",
        capability: "speech",
        apiStyle: "elevenlabs",
        endpointUrl: "https://api.elevenlabs.io",
        requiresAuth: true,
        isDefault: false,
      }),
    ];
    const inactive = await endpoint("Inactive Auto", "auto");
    for (const [index, selected] of candidates.entries()) {
      if (!selected?.custom_endpoint_id) throw new Error("Missing endpoint fixture");
      await testSql`
        UPDATE custom_endpoints ce SET is_default = ce.custom_endpoint_id = ${selected.custom_endpoint_id}
        FROM custom_endpoint_connections cec
        WHERE cec.connection_id = ce.connection_id AND cec.server_id = ${serverId}
      `;
      await executeTestSqlFile(migration);
      const targets = await selections();
      expect(targets.design?.custom_endpoint_id ?? null).toBe(
        index === 1 || index === 2 ? selected.custom_endpoint_id : null,
      );
      expect(targets.clone?.custom_endpoint_id ?? null).toBe(
        index === 0 || index === 2 || index === 3 ? selected.custom_endpoint_id : null,
      );
      expect(targets.design?.custom_endpoint_id).not.toBe(inactive.custom_endpoint_id);
      expect(targets.clone?.custom_endpoint_id).not.toBe(inactive.custom_endpoint_id);
    }
  });

  it("refuses a lossy downgrade and restores legacy selections after Decision migration replay", async () => {
    const transcription = await llmProviderRepo.upsertCustomEndpoint({
      serverId,
      label: "Preserved transcription",
      capability: "transcription",
      apiStyle: "openai-compatible-transcription",
      endpointUrl: "http://127.0.0.1:9002",
      requiresAuth: false,
      isDefault: true,
    });
    if (!transcription?.custom_endpoint_id) throw new Error("Missing transcription fixture");
    const speechSettings = {
      voice_transcript_chat_mode: false,
      chatterbox_turbo_enabled: false,
      chatterbox_cfg_weight: 0.25,
      chatterbox_exaggeration: 0.75,
    };
    expect(await configRepository.updateSpeechConfig(serverId, speechSettings)).toBe(true);
    const design = await endpoint("Migration Design", "voice-design");
    const clone = await endpoint("Migration Clone", "clone");
    const auto = await endpoint("Migration Auto", "auto");
    await setSpeechEndpointSelection(serverId, design.custom_endpoint_id ?? null);
    await setSpeechEndpointSelection(serverId, clone.custom_endpoint_id ?? null);
    await executeTestSqlFile(decisionMigration);
    await executeTestSqlFile(hostedDowngrade);
    try {
      await expect(executeTestSqlFile(downgrade)).rejects.toThrow();
      expect((await selections()).design?.custom_endpoint_id).toBe(design.custom_endpoint_id);
      await testSql`UPDATE persona_voice_configs SET voice_source_priority = 'design' WHERE persona_id = ${personaId}`;
      await testSql`
        UPDATE server_speech_configs SET speech_design_endpoint_id = ${auto.custom_endpoint_id},
          speech_clone_endpoint_id = ${auto.custom_endpoint_id} WHERE server_id = ${serverId}
      `;
      await executeTestSqlFile(downgrade);
      await testSql`
        UPDATE custom_endpoints SET is_default = true, updated_at = '2020-01-01'
        WHERE custom_endpoint_id IN (${auto.custom_endpoint_id}, ${clone.custom_endpoint_id})
      `;
      const [sample] = await testSql`
        INSERT INTO voice_samples (server_id, name, file_path, duration_ms)
        VALUES (${serverId}, 'Test sample', 'test.wav', 1000) RETURNING sample_id
      `;
      await testSql`
        UPDATE persona_voice_configs SET speech_voice_sample_id = ${sample.sample_id}, speech_voice_name = 'Test sample'
        WHERE persona_id = ${personaId}
      `;
    } finally {
      await executeTestSqlFile(migration);
      await executeTestSqlFile(hostedMigration);
      await executeTestSqlFile(designMigration);
      await seedModelsFromCatalog(testSql);
    }
    expect((await selections()).design?.custom_endpoint_id).toBe(auto.custom_endpoint_id);
    expect((await selections()).clone?.custom_endpoint_id).toBe(auto.custom_endpoint_id);
    expect((await loadActiveEndpoint(serverId, "transcription"))?.custom_endpoint_id).toBe(
      transcription.custom_endpoint_id,
    );
    const [settings] = await testSql`
      SELECT voice_transcript_chat_mode, chatterbox_turbo_enabled, chatterbox_cfg_weight, chatterbox_exaggeration
      FROM server_speech_configs WHERE server_id = ${serverId}
    `;
    expect(settings).toEqual(speechSettings);
    const [voice] =
      await testSql`SELECT voice_source_priority FROM persona_voice_configs WHERE persona_id = ${personaId}`;
    expect(voice.voice_source_priority).toBe("clone");
    await executeTestSqlFile(migration);
    expect((await selections()).clone?.custom_endpoint_id).toBe(auto.custom_endpoint_id);
    await setSpeechEndpointSelection(serverId, null, "design");
    await testSql`UPDATE persona_voice_configs SET voice_source_priority = 'design' WHERE persona_id = ${personaId}`;
    await executeTestSqlFile(migration);
    expect((await selections()).design).toBeNull();
    expect((await selections()).clone?.custom_endpoint_id).toBe(auto.custom_endpoint_id);
    const [preserved] =
      await testSql`SELECT voice_source_priority FROM persona_voice_configs WHERE persona_id = ${personaId}`;
    expect(preserved.voice_source_priority).toBe("design");
    await expect(
      testSql`
      UPDATE server_speech_configs SET speech_clone_model_id = (
        SELECT speech_model_id FROM speech_models WHERE provider = 'openrouter' AND voice_mode = 'clone' AND is_default
      ) WHERE server_id = ${serverId}
    `.execute(),
    ).rejects.toThrow();
  });
});
