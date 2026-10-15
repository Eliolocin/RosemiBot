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
import { createSpeechWav } from "../../helpers/speechAudio";
import { DB_TESTS_AVAILABLE, setupTestDb, testSql } from "./setup/testDb";
import { cleanupFixtures, insertFixtures, type FixtureRefs } from "./setup/fixtures";

describe.skipIf(!DB_TESTS_AVAILABLE)("Hosted speech synthesis lifecycle and fallback", () => {
  let refs: FixtureRefs;
  let googleId: number;
  let liteId: number;
  let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;
  let created: number;
  let synthesisStatuses: number[];
  let deleteFails: boolean;
  let creationExpiry: string;
  let malformedSynthesis: boolean;
  let onCreate: (() => Promise<void>) | undefined;
  let onSynthesize: (() => Promise<void>) | undefined;
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const wav = createSpeechWav();
  const serverScope = () => ({ kind: "server" as const, ownerId: refs.serverId });
  const personalScope = () => ({ kind: "personal" as const, ownerId: refs.userId });

  beforeAll(async () => {
    await setupTestDb();
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
          const url = String(input);
          requests.push({ url, init: init ?? {} });
          if (init?.method === "DELETE") return new Response(null, { status: deleteFails ? 500 : 204 });
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
            return Response.json(
              { usage: { total_input_tokens: 3 }, error: { message: "synthetic upstream content" } },
              { status },
            );
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
    synthesisStatuses = [429];
    const result = await synthesizeVoiceMessage({ ...(await request(true)), routing: routing() });
    expect(result.success).toBe(true);
    expect(result.usedServerFallback).toBe(true);
    expect(result.attempts?.map((attempt) => attempt.owner.kind)).toEqual(["personal", "server"]);
    expect(result.attempts?.[0].operations[0].usage?.total_input_tokens).toBe(11);
    expect(result.attempts?.[0].operations[1].usage?.total_input_tokens).toBe(3);
    expect(syntheses().map(({ init }) => new Headers(init.headers).get("x-goog-api-key"))).toEqual([
      "synthetic-personal-google",
      "synthetic-server-google",
    ]);
    expect(syntheses()).toHaveLength(2);
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
