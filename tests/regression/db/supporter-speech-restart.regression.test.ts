import { beforeAll, describe, expect, it } from "bun:test";
import { initializeDatabase } from "@/utils/db/initializeDatabase";
import { loadHostedSpeechSelection, setHostedSpeechSelection } from "@/utils/db/repositories/SpeechRepository";
import { encryptApiKey } from "@/utils/security/crypto";
import { DB_TESTS_AVAILABLE, setupTestDb, testSql } from "./setup/testDb";

describe.skipIf(!DB_TESTS_AVAILABLE)("Subscription speech across repeated initialization", () => {
  beforeAll(async () => setupTestDb());

  it("keeps a keyless Subscription speech selection usable on the next boot", async () => {
    const [server] = await testSql<{ server_id: number }[]>`
      INSERT INTO servers (server_disc_id) VALUES ('_rt_review_reboot') RETURNING server_id
    `;
    try {
      await testSql`INSERT INTO server_model_configs (server_id) VALUES (${server.server_id})`;
      await testSql`INSERT INTO server_speech_configs (server_id) VALUES (${server.server_id})`;
      await testSql`INSERT INTO saved_provider_configs (server_id, provider) VALUES (${server.server_id}, 'supporter')`;
      const [model] = await testSql<{ speech_model_id: number }[]>`
        SELECT speech_model_id FROM speech_models
        WHERE provider = 'openrouter' AND voice_mode = 'clone' AND NOT is_deprecated
        ORDER BY is_default DESC, speech_model_id LIMIT 1
      `;
      if (!model) throw new Error("Missing seeded speech model");
      const scope = { kind: "server" as const, ownerId: server.server_id };
      expect(await setHostedSpeechSelection(scope, model.speech_model_id, "clone", false, undefined, "supporter")).toBe(
        true,
      );
      await initializeDatabase({ client: testSql, includeRag: false, maxRetries: 1 });
      expect(await loadHostedSpeechSelection(server.server_id, "clone", undefined, true)).toMatchObject({
        subscription: true,
        model: { speech_model_id: model.speech_model_id },
      });
      expect(await setHostedSpeechSelection(scope, model.speech_model_id, "clone", false, undefined, "supporter")).toBe(
        true,
      );
      const key = await encryptApiKey("synthetic-restart-byok");
      await testSql`INSERT INTO saved_provider_configs (server_id, provider, api_key, key_version)
        VALUES (${server.server_id}, 'openrouter', ${key.encrypted}, ${key.version})`;
      await initializeDatabase({ client: testSql, includeRag: false, maxRetries: 1 });
      const [ownership] = await testSql<{ subscription_capabilities: string[] }[]>`
        SELECT subscription_capabilities FROM server_model_configs WHERE server_id = ${server.server_id}
      `;
      expect(ownership.subscription_capabilities).toContain("speech_clone");
      await testSql`UPDATE saved_provider_configs SET api_key = NULL
        WHERE server_id = ${server.server_id} AND provider = 'openrouter'`;
      expect(await loadHostedSpeechSelection(server.server_id, "clone", undefined, true)).toMatchObject({
        subscription: true,
      });
      await testSql`DELETE FROM saved_provider_configs WHERE server_id = ${server.server_id} AND provider = 'openrouter'`;
      expect(await loadHostedSpeechSelection(server.server_id, "clone", undefined, true)).toMatchObject({
        subscription: true,
      });
      await testSql`DELETE FROM saved_provider_configs WHERE server_id = ${server.server_id} AND provider = 'supporter'`;
      expect(await loadHostedSpeechSelection(server.server_id, "clone", undefined, true)).toBeNull();
    } finally {
      await testSql`DELETE FROM servers WHERE server_id = ${server.server_id}`;
    }
  });
});
