import type { CustomEndpointRow, VoiceSampleRow, SpeechModelRow } from "@/types/db/schema";
import { speechModelSchema, speechVoiceBindingSchema, type SpeechVoiceBindingRow } from "@/types/db/schema";
import type { OpenRouterModelScope } from "@/utils/db/repositories/LlmModelRepository";
import { customEndpointSchema, voiceSampleSchema } from "@/types/db/schema";
import { invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCacheStore";
import { sql } from "@/utils/db/client";
import { log } from "@/utils/misc/logger";
import { deleteStoredVoiceSample } from "@/utils/storage/voiceSampleStorage";
import { supportsSpeechMode, type VoiceSourceMode } from "@/utils/speech/voiceSourceCapabilities";
import type {} from "./IRepository";
import { createHash } from "node:crypto";

/**
 * Raw credential row returned by loadEndpointCredentials.
 * Callers decrypt api_key using decryptApiKey(api_key, key_version).
 */
export type EndpointCredentialRow = {
  api_key: Buffer;
  key_version: number;
};

export interface HostedSpeechSelection {
  model: SpeechModelRow;
  owner: OpenRouterModelScope;
  credentialId: number;
  credentialRevision: number;
  apiKey: Buffer;
  keyVersion: number;
}

export async function loadHostedSpeechSelection(
  serverId: number,
  mode: VoiceSourceMode,
  userId?: number,
): Promise<HostedSpeechSelection | null> {
  const capability = mode === "design" ? "speech_design" : "speech_clone";
  if (userId !== undefined) {
    const [row] = await sql`
      SELECT m.*, c.user_saved_config_id AS credential_id, c.credential_revision, c.api_key, c.key_version
      FROM user_saved_provider_configs c JOIN speech_models m
        ON m.speech_model_id = CASE WHEN ${mode} = 'design' THEN c.speech_design_model_id ELSE c.speech_clone_model_id END
        AND m.provider = c.provider
      WHERE c.user_id = ${userId} AND ${capability} = ANY(c.enabled_capabilities)
        AND ${capability} = ANY(c.assigned_capabilities)
    `;
    if (row) {
      if (!row.api_key) return null;
      return {
        model: speechModelSchema.parse(row),
        owner: { kind: "personal", ownerId: userId },
        credentialId: row.credential_id,
        credentialRevision: row.credential_revision,
        apiKey: row.api_key,
        keyVersion: row.key_version,
      };
    }
  }
  const [row] = await sql`
    SELECT m.*, c.saved_config_id AS credential_id, c.credential_revision, c.api_key, c.key_version
    FROM server_speech_configs s JOIN speech_models m
      ON m.speech_model_id = CASE WHEN ${mode} = 'design' THEN s.speech_design_model_id ELSE s.speech_clone_model_id END
    JOIN saved_provider_configs c ON c.server_id = s.server_id AND c.provider = m.provider
    WHERE s.server_id = ${serverId}
  `;
  if (!row?.api_key) return null;
  return {
    model: speechModelSchema.parse(row),
    owner: { kind: "server", ownerId: serverId },
    credentialId: row.credential_id,
    credentialRevision: row.credential_revision,
    apiKey: row.api_key,
    keyVersion: row.key_version,
  };
}

export async function setHostedSpeechSelection(
  scope: OpenRouterModelScope,
  modelId: number | null,
  mode?: VoiceSourceMode,
  register = false,
  replacedModelId?: number,
): Promise<boolean> {
  try {
    const discordId = await sql.begin(async (tx) => {
      const [owner] =
        scope.kind === "server"
          ? await tx`SELECT server_disc_id AS discord_id FROM servers WHERE server_id = ${scope.ownerId} FOR UPDATE`
          : await tx`SELECT user_disc_id AS discord_id FROM users WHERE user_id = ${scope.ownerId} FOR UPDATE`;
      if (!owner) throw new Error("Speech owner missing");
      const [row] =
        modelId === null ? [] : await tx`SELECT * FROM speech_models WHERE speech_model_id = ${modelId} FOR UPDATE`;
      const model = row ? speechModelSchema.parse(row) : null;
      if (
        modelId !== null &&
        (!model || model.is_deprecated || (mode && model.voice_mode !== mode && model.voice_mode !== "auto"))
      ) {
        throw new Error("Ineligible speech model");
      }
      if (!model && !mode) throw new Error("Clearing speech requires a mode");
      const design = model ? model.voice_mode !== "clone" : mode === "design";
      const clone = model ? model.voice_mode !== "design" : mode === "clone";
      if (register && model) {
        await tx`
          INSERT INTO scoped_model_registrations (server_id, user_id, speech_model_id)
          VALUES (${scope.kind === "server" ? scope.ownerId : null}, ${scope.kind === "personal" ? scope.ownerId : null}, ${modelId})
          ON CONFLICT DO NOTHING
        `;
      }
      if (replacedModelId !== undefined && replacedModelId !== modelId) {
        const [replacedRow] = await tx`
          SELECT * FROM speech_models WHERE speech_model_id = ${replacedModelId} FOR UPDATE
        `;
        const replacedModel = replacedRow ? speechModelSchema.parse(replacedRow) : null;
        if (
          !model ||
          !replacedModel ||
          replacedModel.provider !== model.provider ||
          (!replacedModel.is_scoped_registration && replacedModel.is_deprecated)
        ) {
          throw new Error("Ineligible speech replacement");
        }
        const removed = await tx`
          DELETE FROM scoped_model_registrations WHERE speech_model_id = ${replacedModelId}
            AND ((${scope.kind} = 'server' AND server_id = ${scope.ownerId} AND user_id IS NULL)
              OR (${scope.kind} = 'personal' AND user_id = ${scope.ownerId} AND server_id IS NULL))
          RETURNING scoped_model_registration_id
        `;
        if (replacedModel.is_scoped_registration && removed.length === 0) {
          throw new Error("Speech registration no longer owned");
        }
      }
      if (scope.kind === "server") {
        await tx`INSERT INTO server_speech_configs (server_id) VALUES (${scope.ownerId}) ON CONFLICT DO NOTHING`;
        await tx`
          UPDATE server_speech_configs SET
            speech_design_model_id = CASE WHEN ${design} THEN ${modelId} ELSE speech_design_model_id END,
            speech_clone_model_id = CASE WHEN ${clone} THEN ${modelId} ELSE speech_clone_model_id END,
            speech_design_endpoint_id = CASE WHEN ${design} THEN NULL ELSE speech_design_endpoint_id END,
            speech_clone_endpoint_id = CASE WHEN ${clone} THEN NULL ELSE speech_clone_endpoint_id END
          WHERE server_id = ${scope.ownerId}
        `;
      } else {
        const modes = [...(design ? ["speech_design"] : []), ...(clone ? ["speech_clone"] : [])];
        for (const capability of modes) {
          await tx`
            UPDATE user_saved_provider_configs SET
              assigned_capabilities = array_remove(assigned_capabilities, ${capability}),
              enabled_capabilities = array_remove(enabled_capabilities, ${capability})
            WHERE user_id = ${scope.ownerId}
          `;
        }
        if (model) {
          const [credential] = await tx`
            SELECT user_saved_config_id FROM user_saved_provider_configs
            WHERE user_id = ${scope.ownerId} AND provider = ${model.provider} AND api_key IS NOT NULL FOR UPDATE
          `;
          if (!credential) throw new Error("Matching speech credentials missing");
          await tx`
            UPDATE user_saved_provider_configs SET
              speech_design_model_id = CASE WHEN ${design} THEN ${modelId} ELSE speech_design_model_id END,
              speech_clone_model_id = CASE WHEN ${clone} THEN ${modelId} ELSE speech_clone_model_id END,
              assigned_capabilities = assigned_capabilities || ${sql.array(modes, "text")},
              enabled_capabilities = enabled_capabilities || ${sql.array(modes, "text")}
            WHERE user_saved_config_id = ${credential.user_saved_config_id}
          `;
        } else {
          await tx`
            UPDATE user_saved_provider_configs SET
              speech_design_model_id = CASE WHEN ${design} THEN NULL ELSE speech_design_model_id END,
              speech_clone_model_id = CASE WHEN ${clone} THEN NULL ELSE speech_clone_model_id END
            WHERE user_id = ${scope.ownerId}
          `;
        }
      }
      return owner.discord_id as string;
    });
    invalidateTomoriStateCache(discordId);
    return true;
  } catch (error) {
    log.error("SpeechRepository.setHostedSpeechSelection failed", error, { metadata: { scope, modelId } });
    return false;
  }
}

export async function hasSpeechDesignSelection(scope: OpenRouterModelScope): Promise<boolean> {
  const rows =
    scope.kind === "server"
      ? await sql`
          SELECT 1 FROM server_speech_configs WHERE server_id = ${scope.ownerId}
            AND num_nonnulls(speech_design_model_id, speech_design_endpoint_id) > 0
        `
      : // Moving Design to another provider leaves the old row's model id behind, so ownership decides.
        await sql`
          SELECT 1 FROM user_saved_provider_configs WHERE user_id = ${scope.ownerId}
            AND speech_design_model_id IS NOT NULL AND 'speech_design' = ANY(assigned_capabilities)
        `;
  return rows.length > 0;
}

export async function deleteSpeechModelRegistration(scope: OpenRouterModelScope, modelId: number): Promise<void> {
  await sql`
    DELETE FROM scoped_model_registrations WHERE speech_model_id = ${modelId}
      AND ((${scope.kind} = 'server' AND server_id = ${scope.ownerId} AND user_id IS NULL)
        OR (${scope.kind} = 'personal' AND user_id = ${scope.ownerId} AND server_id IS NULL))
  `;
  const [owner] =
    scope.kind === "server"
      ? await sql`SELECT server_disc_id AS discord_id FROM servers WHERE server_id = ${scope.ownerId}`
      : await sql`SELECT user_disc_id AS discord_id FROM users WHERE user_id = ${scope.ownerId}`;
  if (owner) invalidateTomoriStateCache(owner.discord_id);
}

export type SpeechBindingIdentity = Pick<
  SpeechVoiceBindingRow,
  | "persona_id"
  | "saved_config_id"
  | "user_saved_config_id"
  | "credential_revision"
  | "transport"
  | "project"
  | "location"
  | "prompt_hash"
>;

export class SpeechBindingChangedError extends Error {}

export async function loadSpeechVoiceBinding(identity: SpeechBindingIdentity): Promise<SpeechVoiceBindingRow | null> {
  const [row] = await sql`
    SELECT * FROM speech_voice_bindings
    WHERE persona_id = ${identity.persona_id}
      AND saved_config_id IS NOT DISTINCT FROM ${identity.saved_config_id}
      AND user_saved_config_id IS NOT DISTINCT FROM ${identity.user_saved_config_id}
      AND credential_revision = ${identity.credential_revision} AND transport = ${identity.transport}
      AND project = ${identity.project} AND location = ${identity.location} AND prompt_hash = ${identity.prompt_hash}
      AND NOT pending_delete
  `;
  return row ? speechVoiceBindingSchema.parse(row) : null;
}

export async function saveSpeechVoiceBinding(
  identity: SpeechBindingIdentity,
  voiceId: string,
  expiresAt: Date | null,
): Promise<SpeechVoiceBindingRow> {
  return sql.begin(async (tx) => {
    if (identity.persona_id !== null) {
      const [persona] =
        await tx`SELECT speech_voice_design_prompt FROM persona_voice_configs WHERE persona_id = ${identity.persona_id} FOR UPDATE`;
      if (
        !persona ||
        createHash("sha256")
          .update(persona.speech_voice_design_prompt?.trim() ?? "")
          .digest("hex") !== identity.prompt_hash
      )
        throw new SpeechBindingChangedError("Speech prompt changed during creation");
    }
    const [row] = await tx`
    INSERT INTO speech_voice_bindings (
      persona_id, saved_config_id, user_saved_config_id, credential_revision, transport, project, location,
      prompt_hash, voice_id, expires_at
    ) VALUES (
      ${identity.persona_id}, ${identity.saved_config_id}, ${identity.user_saved_config_id}, ${identity.credential_revision},
      ${identity.transport}, ${identity.project}, ${identity.location}, ${identity.prompt_hash}, ${voiceId}, ${expiresAt}
    ) ON CONFLICT DO NOTHING RETURNING *
  `;
    if (row) return speechVoiceBindingSchema.parse(row);
    const retained = await loadSpeechVoiceBinding(identity);
    if (!retained) throw new Error("Speech binding disappeared during creation");
    return retained;
  });
}

export async function refreshSpeechVoiceBinding(bindingId: number, expiresAt: Date | null): Promise<void> {
  await sql`UPDATE speech_voice_bindings SET expires_at = ${expiresAt} WHERE speech_voice_binding_id = ${bindingId}`;
}

export async function savePendingSpeechVoiceDeletion(
  identity: SpeechBindingIdentity,
  voiceId: string,
): Promise<SpeechVoiceBindingRow> {
  const [row] = await sql`
    INSERT INTO speech_voice_bindings (persona_id, saved_config_id, user_saved_config_id, credential_revision, transport, project, location, prompt_hash, voice_id, pending_delete)
    VALUES (NULL, ${identity.saved_config_id}, ${identity.user_saved_config_id}, ${identity.credential_revision}, ${identity.transport}, ${identity.project}, ${identity.location}, ${identity.prompt_hash}, ${voiceId}, true)
    RETURNING *
  `;
  return speechVoiceBindingSchema.parse(row);
}

export async function loadSpeechCredentialForCleanup(
  scope: OpenRouterModelScope,
  provider: string,
): Promise<{ credentialId: number; credentialRevision: number; apiKey: Buffer; keyVersion: number } | null> {
  const [row] =
    scope.kind === "server"
      ? await sql`SELECT saved_config_id AS id, credential_revision, api_key, key_version FROM saved_provider_configs WHERE server_id = ${scope.ownerId} AND provider = ${provider}`
      : await sql`SELECT user_saved_config_id AS id, credential_revision, api_key, key_version FROM user_saved_provider_configs WHERE user_id = ${scope.ownerId} AND provider = ${provider}`;
  return row?.api_key
    ? {
        credentialId: row.id,
        credentialRevision: row.credential_revision,
        apiKey: row.api_key,
        keyVersion: row.key_version,
      }
    : null;
}

export async function retireSpeechCredentialBindings(
  credentialId: number,
  scope: OpenRouterModelScope["kind"],
): Promise<void> {
  await sql`UPDATE speech_voice_bindings SET pending_delete = true WHERE (${scope} = 'server' AND saved_config_id = ${credentialId}) OR (${scope} = 'personal' AND user_saved_config_id = ${credentialId})`;
}

export async function loadPersonaSpeechCredentialOwners(
  personaId: number,
): Promise<Array<OpenRouterModelScope & { provider: string }>> {
  return await sql`
    SELECT DISTINCT 'server' AS kind, c.server_id AS "ownerId", c.provider FROM speech_voice_bindings b JOIN saved_provider_configs c USING (saved_config_id) WHERE b.persona_id = ${personaId}
    UNION SELECT DISTINCT 'personal' AS kind, c.user_id AS "ownerId", c.provider FROM speech_voice_bindings b JOIN user_saved_provider_configs c USING (user_saved_config_id) WHERE b.persona_id = ${personaId}
  `;
}

export async function loadSpeechRoutingPolicy(
  serverId: number,
  userId: number,
): Promise<{ serverAllowed: boolean; fallbackEnabled: boolean }> {
  const [row] = await sql`
    SELECT NOT COALESCE(c.user_byok_mode, false) AS server_allowed, COALESCE(u.personal_server_fallback_enabled, true) AS fallback_enabled
    FROM servers s LEFT JOIN server_byok_configs c USING (server_id) LEFT JOIN user_personalization_configs u ON u.user_id = ${userId} WHERE s.server_id = ${serverId}
  `;
  return { serverAllowed: row?.server_allowed === true, fallbackEnabled: row?.fallback_enabled === true };
}

export async function markSpeechVoiceBindingForDeletion(bindingId: number): Promise<void> {
  await sql`UPDATE speech_voice_bindings SET pending_delete = true WHERE speech_voice_binding_id = ${bindingId}`;
}

export async function loadPendingSpeechVoiceDeletions(
  credentialId: number,
  scope: OpenRouterModelScope["kind"],
): Promise<SpeechVoiceBindingRow[]> {
  const rows = await sql`
    SELECT * FROM speech_voice_bindings WHERE pending_delete
      AND ((${scope} = 'server' AND saved_config_id = ${credentialId})
        OR (${scope} = 'personal' AND user_saved_config_id = ${credentialId}))
  `;
  return speechVoiceBindingSchema.array().parse(rows);
}

export async function deleteSpeechVoiceBinding(bindingId: number): Promise<void> {
  await sql`DELETE FROM speech_voice_bindings WHERE speech_voice_binding_id = ${bindingId}`;
}

export async function loadActiveEndpoint(
  serverId: number,
  capability: "transcription" | VoiceSourceMode,
): Promise<CustomEndpointRow | null> {
  try {
    const rows = await sql`
      SELECT
        ce.custom_endpoint_id,
        ce.connection_id,
        cec.server_id,
        cec.user_id,
        cec.label,
        cec.capability,
        cec.api_style,
        cec.endpoint_url,
        ce.model_name,
        ce.model_ref_id,
        ce.num_ctx,
        cec.requires_auth,
        ce.extra_config,
        ce.has_tools,
        ce.sees_images,
        ce.sees_videos,
        ce.supports_structoutput,
        ce.strict_role_alternation,
        ce.supports_prefix_completion,
        ce.supports_assistant_prefill,
        ce.is_default,
        ce.created_at,
        ce.updated_at
      FROM custom_endpoints ce
      JOIN custom_endpoint_connections cec ON ce.connection_id = cec.connection_id
      LEFT JOIN server_speech_configs ssc ON ssc.server_id = cec.server_id
      WHERE cec.server_id = ${serverId}
        AND cec.capability = ${capability === "transcription" ? "transcription" : "speech"}
        AND cec.user_id IS NULL
        AND (
          (${capability} = 'transcription' AND ce.is_default = true)
          OR (${capability} = 'design' AND ce.custom_endpoint_id = ssc.speech_design_endpoint_id)
          OR (${capability} = 'clone' AND ce.custom_endpoint_id = ssc.speech_clone_endpoint_id)
        )
      ORDER BY ce.updated_at DESC, ce.custom_endpoint_id DESC
      LIMIT 1
    `;
    if (!rows || rows.length === 0) return null;

    const parsed = customEndpointSchema.safeParse(rows[0]);
    if (!parsed.success) {
      log.warn(
        `SpeechRepository.loadActiveEndpoint: parse failed for ${capability} on server ${serverId}: ${parsed.error.message}`,
      );
      return null;
    }
    return parsed.data;
  } catch (error) {
    log.error(`SpeechRepository.loadActiveEndpoint: failed for server ${serverId}`, error);
    return null;
  }
}

export async function setSpeechEndpointSelection(
  serverId: number,
  endpointId: number | null,
  mode?: VoiceSourceMode,
): Promise<boolean> {
  try {
    const changed = await sql.begin(async (tx) => {
      const [server] = await tx`SELECT server_disc_id FROM servers WHERE server_id = ${serverId} FOR UPDATE`;
      if (!server) return null;
      let design = mode === "design";
      let clone = mode === "clone";
      if (endpointId !== null) {
        const [row] = await tx`
          SELECT cec.api_style, ce.extra_config
          FROM custom_endpoints ce
          JOIN custom_endpoint_connections cec USING (connection_id)
          WHERE ce.custom_endpoint_id = ${endpointId}
            AND cec.server_id = ${serverId} AND cec.user_id IS NULL AND cec.capability = 'speech'
          FOR UPDATE OF ce, cec
        `;
        const parsed = customEndpointSchema.pick({ api_style: true, extra_config: true }).safeParse(row);
        if (!parsed.success || (mode && !supportsSpeechMode(parsed.data, mode))) return null;
        design = supportsSpeechMode(parsed.data, "design");
        clone = supportsSpeechMode(parsed.data, "clone");
        if (!design && !clone) return null;
      } else if (!mode) {
        return null;
      }
      await tx`
        INSERT INTO server_speech_configs (server_id) VALUES (${serverId}) ON CONFLICT DO NOTHING
      `;
      await tx`
        UPDATE server_speech_configs
        SET speech_design_endpoint_id = CASE WHEN ${design} THEN ${endpointId} ELSE speech_design_endpoint_id END,
            speech_clone_endpoint_id = CASE WHEN ${clone} THEN ${endpointId} ELSE speech_clone_endpoint_id END,
            speech_design_model_id = CASE WHEN ${design} THEN NULL ELSE speech_design_model_id END,
            speech_clone_model_id = CASE WHEN ${clone} THEN NULL ELSE speech_clone_model_id END
        WHERE server_id = ${serverId}
      `;
      return server.server_disc_id as string;
    });
    if (changed) invalidateTomoriStateCache(changed);
    return changed !== null;
  } catch (error) {
    log.error("SpeechRepository.setSpeechEndpointSelection failed", error, { serverId });
    return false;
  }
}

/**
 * Load encrypted credentials for a provider (keyed by internal provider name).
 * Returns null when no credentials are stored.
 *
 * @param providerName - Internal provider name (for example, "custom:123")
 * @returns Raw encrypted credential row or null
 */
export async function loadEndpointCredentials(
  serverId: number,
  providerName: string,
): Promise<EndpointCredentialRow | null> {
  try {
    const [row] = await sql`
      SELECT api_key, key_version FROM saved_provider_configs
      WHERE server_id = ${serverId}
        AND provider = ${providerName}
      LIMIT 1
    `;
    if (!row?.api_key) return null;
    return { api_key: row.api_key as Buffer, key_version: (row.key_version as number) ?? 1 };
  } catch (error) {
    log.error(`SpeechRepository.loadEndpointCredentials: failed for server ${serverId}`, error);
    return null;
  }
}

/** Ordered by name. */
export async function loadVoiceSamples(serverId: number): Promise<VoiceSampleRow[]> {
  try {
    const rows = await sql`
      SELECT sample_id, name, file_path, ref_text, duration_ms, created_at
      FROM voice_samples
      WHERE server_id = ${serverId}
      ORDER BY name
    `;
    return rows as VoiceSampleRow[];
  } catch (error) {
    log.error(`SpeechRepository.loadVoiceSamples: failed for server ${serverId}`, error);
    return [];
  }
}

/**
 *
 * @returns Parsed VoiceSampleRow or null if not found
 */
export async function loadVoiceSampleById(sampleId: number): Promise<VoiceSampleRow | null> {
  try {
    const rows = await sql`
      SELECT * FROM voice_samples WHERE sample_id = ${sampleId} LIMIT 1
    `;
    if (!rows || rows.length === 0) return null;
    const parsed = voiceSampleSchema.safeParse(rows[0]);
    return parsed.success ? parsed.data : null;
  } catch (error) {
    log.error(`SpeechRepository.loadVoiceSampleById: failed for sample ${sampleId}`, error);
    return null;
  }
}

/**
 * Insert a placeholder voice sample row to reserve a sample_id before storage.
 * Callers must follow up with updateVoiceSamplePath once the file is stored.
 *
 * @param refText    - Optional reference transcript text
 * @param durationMs - Audio duration in milliseconds (0 if unknown)
 * @returns Inserted sample_id or null on failure
 */
export async function insertVoiceSample(
  serverId: number,
  name: string,
  refText: string | null,
  durationMs: number,
): Promise<number | null> {
  try {
    const [row] = await sql<[{ sample_id: number }]>`
      INSERT INTO voice_samples (server_id, name, file_path, ref_text, duration_ms)
      VALUES (${serverId}, ${name}, '', ${refText}, ${durationMs})
      RETURNING sample_id
    `;
    return row?.sample_id ?? null;
  } catch (error) {
    log.error(`SpeechRepository.insertVoiceSample: failed for server ${serverId}`, error);
    return null;
  }
}

/**
 * Update the file_path on a voice sample row after successful storage.
 *
 * @param filePath - Storage reference (S3 URL or local path)
 */
export async function updateVoiceSamplePath(sampleId: number, filePath: string): Promise<void> {
  await sql`UPDATE voice_samples SET file_path = ${filePath} WHERE sample_id = ${sampleId}`;
}

export async function deleteVoiceSample(sampleId: number): Promise<void> {
  await sql`DELETE FROM voice_samples WHERE sample_id = ${sampleId}`;
}

/**
 * Count how many persona rows currently reference a voice sample.
 * Used to display a warning before deletion.
 *
 * @returns Reference count (0 when not referenced)
 */
export async function countPersonaVoiceSampleRefs(serverId: number, sampleId: number): Promise<number> {
  try {
    const [row] = await sql<[{ count: string }]>`
      SELECT COUNT(*) AS count
      FROM persona_voice_configs pvc
      JOIN personas p ON p.persona_id = pvc.persona_id
      WHERE p.server_id = ${serverId}
        AND pvc.speech_voice_sample_id = ${sampleId}
    `;
    return Number(row?.count ?? 0);
  } catch (error) {
    log.error(`SpeechRepository.countPersonaVoiceSampleRefs: failed for sample ${sampleId}`, error);
    return 0;
  }
}

/**
 * Clear the voice sample assignment from all persona rows that reference the given sample.
 * Called before deletion so no persona is left pointing to a deleted sample.
 *
 */
async function clearPersonaVoiceSampleRefs(serverId: number, sampleId: number): Promise<void> {
  // speech_voice_name must clear with the sample id: every provider reads it as the active voice
  // name, so leaving it set makes a persona report a voice that no longer exists. The surviving
  // design prompt is the only remaining name source, and a surviving speech_voice_id is
  // deliberately left nameless rather than inheriting the deleted sample's name.
  // The regex tests for any non-whitespace character, which is what the JS `.trim()` truthiness
  // check in the voice-assign clear ladder resolves to, and it leaves a NULL prompt NULL.
  await sql`
    UPDATE persona_voice_configs pvc
    SET speech_voice_sample_id = NULL,
        speech_voice_name = CASE
          WHEN pvc.speech_voice_design_prompt ~ '[^[:space:]]' THEN 'VoiceDesign'
          ELSE NULL
        END
    FROM personas p
    WHERE p.persona_id = pvc.persona_id
      AND p.server_id = ${serverId}
      AND pvc.speech_voice_sample_id = ${sampleId}
  `;
}

/** Identifies the sample to retire and the workspace whose cached state references it. */
export interface VoiceSampleRemovalInput {
  serverId: number;
  /** Guild id, or the invoking user's id for a DM-backed workspace: the tomoriStateCache key. */
  serverDiscId: string;
  sampleId: number;
  filePath: string;
}

export interface VoiceSampleRemovalResult {
  storedFileRemoved: boolean;
}

/**
 * Collaborators of removeVoiceSample, injectable so a test can observe call ordering.
 * Bun cannot unregister `mock.module`, so mocking the sql client or the cache store would leak
 * into every other test sharing the lane process.
 */
export interface VoiceSampleRemovalDeps {
  clearRefs: typeof clearPersonaVoiceSampleRefs;
  deleteRow: typeof deleteVoiceSample;
  invalidateCache: typeof invalidateTomoriStateCache;
  deleteStoredFile: typeof deleteStoredVoiceSample;
}

const DEFAULT_REMOVAL_DEPS: VoiceSampleRemovalDeps = {
  clearRefs: clearPersonaVoiceSampleRefs,
  deleteRow: deleteVoiceSample,
  invalidateCache: invalidateTomoriStateCache,
  deleteStoredFile: deleteStoredVoiceSample,
};

/**
 * Retires a voice sample completely: clears every persona reference, deletes the row, invalidates
 * cached state, then removes the stored audio file.
 *
 * Cache invalidation runs after the row delete commits and before stored-file cleanup, so a cleanup
 * failure can never leave the deleted assignment being served from cache. Cleanup failure is
 * reported rather than thrown, because the row is already gone and a retry would find nothing.
 */
export async function removeVoiceSample(
  { serverId, serverDiscId, sampleId, filePath }: VoiceSampleRemovalInput,
  deps: VoiceSampleRemovalDeps = DEFAULT_REMOVAL_DEPS,
): Promise<VoiceSampleRemovalResult> {
  await deps.clearRefs(serverId, sampleId);
  await deps.deleteRow(sampleId);

  deps.invalidateCache(serverDiscId);

  try {
    await deps.deleteStoredFile(filePath);
    return { storedFileRemoved: true };
  } catch (error) {
    log.error(`SpeechRepository.removeVoiceSample: stored file cleanup failed for sample ${sampleId}`, error);
    return { storedFileRemoved: false };
  }
}
