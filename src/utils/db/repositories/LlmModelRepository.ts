import {
  decisionModelSchema,
  type DecisionModelRow,
  diffusionModelSchema,
  embeddingModelSchema,
  llmSchema,
  videoGenerationModelSchema,
  type DiffusionModelRow,
  type EmbeddingModelRow,
  type LlmRow,
  type CustomEndpointCapability,
  type VideoGenerationModelRow,
} from "@/types/db/schema";
import { getCachedLLM } from "@/utils/cache/llmCache";
import { sql, withTransientDbRetry } from "@/utils/db/client";
import { buildIntegerParameterList } from "@/utils/db/parameterBinding";
import { log } from "@/utils/misc/logger";
import { isCustomProvider } from "@/utils/provider/customProviderUtils";
import type { ImageEndpointSupports } from "@/utils/provider/customImageEndpointSupport";
import type { DecisionModelOption } from "@/types/provider/featureInterfaces";

/** Canonical scope for OpenRouter model visibility filtering. */
export type OpenRouterModelScope = { kind: "server"; ownerId: number } | { kind: "personal"; ownerId: number };

const PROVIDER_NAME_PATTERN = /^[a-zA-Z0-9:_-]+$/;

function normalizeProviderName(providerName: string): string | null {
  const trimmed = providerName.trim();
  if (!trimmed || !PROVIDER_NAME_PATTERN.test(trimmed)) {
    return null;
  }
  return trimmed.toLowerCase();
}

// The driver passes a JS array as plain toString() output, which PostgreSQL rejects
// ("Array value must start with {"), so array parameters are formatted explicitly.
function toPgTextArrayLiteral(values: string[]): string {
  if (values.length === 0) return "{}";
  return `{${values.map((v) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")}}`;
}

function toPgNumericArrayLiteral(values: number[]): string {
  if (values.length === 0) return "{}";
  return `{${values.join(",")}}`;
}

/**
 * LlmModelRepository: global model catalog for all LLM modalities.
 *
 * Owns text, embedding, image, video, and decision catalogs, including scoped registrations.
 * Catalog rows are not exportable per-server state.
 */
class LlmModelRepository {
  async loadDecisionModelOptions(scope: OpenRouterModelScope): Promise<DecisionModelOption[]> {
    const serverId = scope.kind === "server" ? scope.ownerId : null;
    const userId = scope.kind === "personal" ? scope.ownerId : null;
    const rows = await withTransientDbRetry(
      () => sql<
        Array<DecisionModelRow & { scoped_model_registration_id: number | null; custom_endpoint_id: number | null }>
      >`
      SELECT model.*, registration.scoped_model_registration_id, endpoint.custom_endpoint_id
      FROM decision_models model
      LEFT JOIN scoped_model_registrations registration
        ON registration.decision_model_id = model.decision_model_id
        AND registration.server_id IS NOT DISTINCT FROM ${serverId}::int
        AND registration.user_id IS NOT DISTINCT FROM ${userId}::int
      LEFT JOIN custom_endpoint_connections connection
        ON model.provider = 'custom:' || connection.connection_id AND connection.capability = 'decision'
        AND connection.server_id IS NOT DISTINCT FROM ${serverId}::int
        AND connection.user_id IS NOT DISTINCT FROM ${userId}::int
      LEFT JOIN custom_endpoints endpoint
        ON endpoint.connection_id = connection.connection_id AND endpoint.model_ref_id = model.decision_model_id
      WHERE model.is_deprecated = false
        AND (
          (model.provider = 'openrouter' AND (model.is_scoped_registration = false OR registration.scoped_model_registration_id IS NOT NULL))
          OR endpoint.custom_endpoint_id IS NOT NULL
        )
        AND (
          EXISTS (SELECT 1 FROM saved_provider_configs saved WHERE saved.server_id = ${serverId} AND saved.provider = model.provider)
          OR EXISTS (SELECT 1 FROM user_saved_provider_configs saved WHERE saved.user_id = ${userId} AND saved.provider = model.provider)
        )
      ORDER BY model.provider, model.decision_model_id
    `,
      "load owned decision model options",
    );
    return rows.map((row) => ({
      model: decisionModelSchema.parse(row),
      reference: {
        provider: row.provider,
        modelId: row.decision_model_id,
        registrationId:
          row.is_scoped_registration && row.provider === "openrouter" ? row.scoped_model_registration_id : null,
        customEndpointId: row.custom_endpoint_id ?? null,
      },
    }));
  }
  async loadAvailableDecisionModels(
    provider: string,
    includeDeprecated = false,
    scope?: OpenRouterModelScope,
  ): Promise<DecisionModelRow[]> {
    const serverId = scope?.kind === "server" ? scope.ownerId : null;
    const userId = scope?.kind === "personal" ? scope.ownerId : null;
    const rows = await withTransientDbRetry(
      () => sql`
      SELECT model.* FROM decision_models model
      WHERE model.provider = ${provider.toLowerCase()}
        AND (${includeDeprecated} OR model.is_deprecated = false)
        AND (
          model.is_scoped_registration = false
          OR EXISTS (
            SELECT 1 FROM scoped_model_registrations registration
            WHERE registration.decision_model_id = model.decision_model_id
              AND registration.server_id IS NOT DISTINCT FROM ${serverId}::int
              AND registration.user_id IS NOT DISTINCT FROM ${userId}::int
          )
          OR EXISTS (
            SELECT 1 FROM custom_endpoints endpoint
            JOIN custom_endpoint_connections connection USING (connection_id)
            WHERE endpoint.model_ref_id = model.decision_model_id
              AND connection.capability = 'decision'
              AND model.provider = 'custom:' || connection.connection_id
              AND connection.server_id IS NOT DISTINCT FROM ${serverId}::int
              AND connection.user_id IS NOT DISTINCT FROM ${userId}::int
          )
        )
      ORDER BY model.is_scoped_registration, model.decision_model_id
    `,
      "load available decision models",
    );
    return decisionModelSchema.array().parse(rows);
  }

  async loadDecisionModelByProviderAndCodename(provider: string, codename: string): Promise<DecisionModelRow | null> {
    const rows = await sql`SELECT * FROM decision_models WHERE provider = ${provider} AND codename = ${codename}`;
    return rows.length ? decisionModelSchema.parse(rows[0]) : null;
  }

  async upsertDecisionModel(params: {
    provider: string;
    codename: string;
    inputTokenLimit: number;
    seesImages?: boolean;
    inputPricePerMillion?: number | null;
    outputPricePerMillion?: number | null;
  }): Promise<number> {
    const validated = decisionModelSchema.omit({ decision_model_id: true }).parse({
      provider: params.provider,
      codename: params.codename,
      input_token_limit: params.inputTokenLimit,
      sees_images: params.seesImages ?? false,
      supported_primitives: ["predicate"],
      input_price_per_million: params.inputPricePerMillion,
      output_price_per_million: params.outputPricePerMillion,
    });
    const [row] = await sql<Array<{ decision_model_id: number }>>`
      INSERT INTO decision_models (
        provider, codename, input_token_limit, sees_images, input_price_per_million,
        output_price_per_million, is_scoped_registration
      ) VALUES (
        ${validated.provider}, ${validated.codename}, ${validated.input_token_limit}, ${validated.sees_images},
        ${validated.input_price_per_million ?? null}, ${validated.output_price_per_million ?? null}, true
      ) ON CONFLICT (provider, codename) DO UPDATE SET
        input_token_limit = EXCLUDED.input_token_limit, sees_images = EXCLUDED.sees_images,
        input_price_per_million = EXCLUDED.input_price_per_million,
        output_price_per_million = EXCLUDED.output_price_per_million,
        is_deprecated = false, updated_at = CURRENT_TIMESTAMP
      RETURNING decision_model_id
    `;
    return row.decision_model_id;
  }

  async deleteOrphanedDecisionModel(modelId: number): Promise<void> {
    await sql`
      DELETE FROM decision_models model WHERE decision_model_id = ${modelId}
        AND is_scoped_registration = true
        AND NOT EXISTS (SELECT 1 FROM scoped_model_registrations WHERE decision_model_id = ${modelId})
        AND NOT EXISTS (
          SELECT 1 FROM custom_endpoints endpoint
          JOIN custom_endpoint_connections connection USING (connection_id)
          WHERE connection.capability = 'decision' AND endpoint.model_ref_id = ${modelId}
        )
    `;
  }
  /**
   * Returns all non-deprecated LLMs, or all LLMs when includeDeprecated is true.
   *
   * @param includeDeprecated - Include deprecated models in results
   */
  async loadAvailableLlms(includeDeprecated = false): Promise<LlmRow[] | null> {
    try {
      const rows = await withTransientDbRetry(
        async () =>
          includeDeprecated
            ? await sql`SELECT * FROM llms ORDER BY llm_id ASC`
            : await sql`SELECT * FROM llms WHERE is_deprecated = false ORDER BY llm_id ASC`,
        "load available LLMs",
      );

      if (!rows || rows.length === 0) {
        log.warn("No LLM models found in the database.");
        return null;
      }

      const parsed = llmSchema.array().safeParse(rows);
      if (!parsed.success) {
        log.error("Failed to validate LLM data from database:", parsed.error.flatten());
        return null;
      }

      return parsed.data;
    } catch (error) {
      log.error("Error loading available LLMs from database:", error);
      return null;
    }
  }

  /**
   * Returns LLMs by their internal IDs, preserving input order.
   *
   * @param ids - Array of internal LLM IDs
   */
  async getLlmsByIds(ids: number[]): Promise<LlmRow[]> {
    if (ids.length === 0) return [];

    try {
      const { values, placeholders } = buildIntegerParameterList(ids);
      const rows = await withTransientDbRetry(
        () => sql.unsafe(`SELECT * FROM llms WHERE llm_id IN (${placeholders})`, values),
        "load LLMs by IDs",
      );

      const rowMap = new Map<number, LlmRow>();
      for (const row of rows) {
        const parsed = llmSchema.safeParse(row);
        if (parsed.success && parsed.data.llm_id !== undefined) {
          rowMap.set(parsed.data.llm_id, parsed.data);
        } else if (!parsed.success) {
          log.warn(`Invalid LLM row for id ${row.llm_id}:`, parsed.error.flatten());
        }
      }

      return ids.flatMap((id) => {
        const llm = rowMap.get(id);
        return llm ? [llm] : [];
      });
    } catch (error) {
      log.error(`Error loading LLMs by ids [${ids.join(", ")}]:`, error);
      return [];
    }
  }

  /**
   * Returns a single LLM by its internal ID, cache-first.
   *
   * @param llmId - Internal LLM ID
   */
  async loadById(llmId: number): Promise<LlmRow | null> {
    if (!Number.isInteger(llmId) || llmId <= 0) {
      log.error(`Invalid llm_id: ${llmId}`);
      return null;
    }

    const cached = getCachedLLM(llmId);
    if (cached) return cached as LlmRow;

    try {
      const rows = await withTransientDbRetry(
        () => sql`SELECT * FROM llms WHERE llm_id = ${llmId} LIMIT 1`,
        "load LLM by ID",
      );
      if (!rows.length) {
        log.warn(`No LLM found for llm_id ${llmId}`);
        return null;
      }

      const parsed = llmSchema.safeParse(rows[0]);
      if (!parsed.success) {
        log.error(`Failed to validate model data for llm_id ${llmId}:`, parsed.error.flatten());
        return null;
      }

      return parsed.data;
    } catch (error) {
      log.error(`Error loading LLM for llm_id ${llmId}:`, error);
      return null;
    }
  }

  /**
   * Compatibility alias for loadById.
   *
   * @param llmId - Internal LLM ID
   */
  async loadLlmById(llmId: number): Promise<LlmRow | null> {
    return this.loadById(llmId);
  }

  /**
   * Returns the LLM matching a provider + codename pair, or null if not found.
   *
   * @param provider - Provider name (e.g. "google", "openrouter")
   * @param codename - Model codename (e.g. "gemini-2.0-flash")
   */
  async loadByProviderAndCodename(provider: string, codename: string): Promise<LlmRow | null> {
    const normalizedProvider = provider.trim().toLowerCase();
    const normalizedCodename = codename.trim();
    if (!normalizedProvider || !normalizedCodename) return null;

    try {
      const rows = await withTransientDbRetry(
        () => sql`
        SELECT * FROM llms
        WHERE llm_provider = ${normalizedProvider}
          AND llm_codename = ${normalizedCodename}
        LIMIT 1
      `,
        "load LLM by provider and codename",
      );
      if (!rows.length) return null;

      const parsed = llmSchema.safeParse(rows[0]);
      if (!parsed.success) {
        log.error(
          `Failed to validate model data for ${normalizedProvider}/${normalizedCodename}:`,
          parsed.error.flatten(),
        );
        return null;
      }

      return parsed.data;
    } catch (error) {
      log.error(`Error loading LLM for ${normalizedProvider}/${normalizedCodename}:`, error);
      return null;
    }
  }

  /**
   * Returns available LLMs for a provider. For the openrouter provider with a scope,
   * delegates to LlmProviderRepository to filter by registration.
   *
   * @param includeDeprecated - Include deprecated models
   * @param scope             - Optional OpenRouter scope filter
   */
  async loadAvailableModelsForProvider(
    providerName: string,
    includeDeprecated = false,
    scope?: OpenRouterModelScope,
  ): Promise<LlmRow[] | null> {
    const normalized = normalizeProviderName(providerName);
    if (!normalized) {
      log.error(`Invalid provider name format: ${providerName}`);
      return null;
    }

    try {
      if (scope && !isCustomProvider(normalized)) {
        const { llmProviderRepo } = await import("./LlmProviderRepository");
        return llmProviderRepo.loadScopedOpenRouterModels(scope, includeDeprecated, normalized);
      }

      const rows = includeDeprecated
        ? await sql`
            SELECT * FROM llms
            WHERE llm_provider = ${normalized}
              AND COALESCE(is_scoped_registration, false) = false
            ORDER BY llm_id ASC
          `
        : await sql`
            SELECT * FROM llms
            WHERE llm_provider = ${normalized}
              AND is_deprecated = false
              AND COALESCE(is_scoped_registration, false) = false
            ORDER BY llm_id ASC
          `;

      if (!rows || rows.length === 0) {
        log.warn(`No available models found for provider: ${normalized}`);
        return null;
      }

      const parsed = llmSchema.array().safeParse(rows);
      if (!parsed.success) {
        log.error(`Failed to validate model data for provider ${normalized}:`, parsed.error.flatten());
        return null;
      }

      log.info(`Found ${parsed.data.length} available models for ${normalized}`);
      return parsed.data;
    } catch (error) {
      log.error(`Error loading available models for provider ${normalized}:`, error);
      return null;
    }
  }

  /**
   * Returns the default LLM for a provider (is_default=true, or first available as fallback).
   *
   */
  async loadDefaultModel(providerName: string): Promise<LlmRow | null> {
    const normalized = normalizeProviderName(providerName);
    if (!normalized) {
      log.error(`Invalid provider name format: ${providerName}`);
      return null;
    }

    try {
      const rows = await sql`
        SELECT *, CASE WHEN is_default = true THEN 1 ELSE 2 END as priority
        FROM llms
        WHERE llm_provider = ${normalized} AND is_deprecated = false
        ORDER BY priority ASC, llm_id ASC
        LIMIT 1
      `;

      if (!rows || rows.length === 0) {
        log.error(`No available models found for provider: ${normalized}`);
        return null;
      }

      const parsed = llmSchema.safeParse(rows[0]);
      if (!parsed.success) {
        log.error(`Failed to validate model data for provider ${normalized}:`, parsed.error.flatten());
        return null;
      }

      if (rows[0].is_default === true) {
        log.info(`Found default model for ${normalized}: ${parsed.data.llm_codename}`);
      } else {
        log.warn(`No default model found for ${normalized}, using fallback: ${parsed.data.llm_codename}`);
      }

      return parsed.data;
    } catch (error) {
      log.error(`Error loading default model for provider ${normalized}:`, error);
      return null;
    }
  }

  /**
   * Returns the highest-capability (smartest) LLM for a provider.
   *
   * @param includeDeprecated - Include deprecated models
   */
  async loadSmartestModel(providerName: string, includeDeprecated = false): Promise<LlmRow | null> {
    const normalized = normalizeProviderName(providerName);
    if (!normalized) {
      log.error(`Invalid provider name format: ${providerName}`);
      return null;
    }

    try {
      const rows = includeDeprecated
        ? await sql`
            SELECT * FROM llms
            WHERE llm_provider = ${normalized} AND is_smartest = true
            ORDER BY llm_id ASC LIMIT 1
          `
        : await sql`
            SELECT * FROM llms
            WHERE llm_provider = ${normalized} AND is_smartest = true AND is_deprecated = false
            ORDER BY llm_id ASC LIMIT 1
          `;

      if (!rows || rows.length === 0) {
        log.warn(`No smartest model found for provider: ${normalized}`);
        return null;
      }

      const parsed = llmSchema.safeParse(rows[0]);
      if (!parsed.success) {
        log.error(`Failed to validate smartest model data for provider ${normalized}:`, parsed.error.flatten());
        return null;
      }

      log.info(`Found smartest model for ${normalized}: ${parsed.data.llm_codename}`);
      return parsed.data;
    } catch (error) {
      log.error(`Error loading smartest model for provider ${normalized}:`, error);
      return null;
    }
  }

  /**
   * Returns the default vision-capable LLM for a provider.
   *
   */
  async loadDefaultVisionModel(providerName: string): Promise<LlmRow | null> {
    const normalized = normalizeProviderName(providerName);
    if (!normalized) {
      log.error(`Invalid provider name format: ${providerName}`);
      return null;
    }

    try {
      const rows = await sql`
        SELECT *, CASE WHEN is_default = true THEN 1 ELSE 2 END as priority
        FROM llms
        WHERE llm_provider = ${normalized}
          AND sees_images = true
          AND is_deprecated = false
        ORDER BY priority ASC, llm_id ASC
        LIMIT 1
      `;

      if (!rows || rows.length === 0) {
        log.warn(`No available vision models found for provider: ${normalized}`);
        return null;
      }

      const parsed = llmSchema.safeParse(rows[0]);
      if (!parsed.success) {
        log.error(`Failed to validate default vision model for provider ${normalized}:`, parsed.error.flatten());
        return null;
      }

      return parsed.data;
    } catch (error) {
      log.error(`Error loading default vision model for provider ${normalized}:`, error);
      return null;
    }
  }

  /**
   * Returns all distinct provider names that have at least one non-deprecated model.
   *
   * @param includeDeprecated - Include providers only present on deprecated models
   */
  async loadUniqueProviders(includeDeprecated = false): Promise<string[] | null> {
    try {
      const rows = includeDeprecated
        ? await sql`SELECT DISTINCT llm_provider FROM llms ORDER BY llm_provider ASC`
        : await sql`SELECT DISTINCT llm_provider FROM llms WHERE is_deprecated = false ORDER BY llm_provider ASC`;

      if (!rows || rows.length === 0) {
        log.warn("No LLM providers with available models found in the database.");
        return null;
      }

      const providerMap = new Map<string, string>();
      for (const row of rows) {
        const provider = row.llm_provider as string;
        const lowerKey = provider.toLowerCase();
        if (!providerMap.has(lowerKey)) {
          providerMap.set(lowerKey, provider);
        }
      }

      const providers = Array.from(providerMap.values()).sort();
      log.info(`Found ${providers.length} unique LLM providers: ${providers.join(", ")}`);
      return providers;
    } catch (error) {
      log.error("Error loading unique LLM providers from database:", error);
      return null;
    }
  }

  /**
   * Returns the set of provider names (lowercased) that have at least one
   * non-deprecated free model, so callers can badge those providers in UI.
   */
  async loadProvidersWithFreeModels(): Promise<Set<string>> {
    try {
      const rows = await sql`
        SELECT DISTINCT llm_provider FROM llms
        WHERE is_free = true AND is_deprecated = false
      `;
      return new Set(rows.map((row: { llm_provider: string }) => row.llm_provider.toLowerCase()));
    } catch (error) {
      log.error("Error loading providers with free models:", error);
      return new Set();
    }
  }

  /**
   * Returns available embedding models for a provider and delegates owner filtering for shared providers.
   *
   * @param includeDeprecated - Include deprecated models
   * @param scope             - Optional owner scope filter
   */
  async loadAvailableEmbeddingModels(
    providerName: string,
    includeDeprecated = false,
    scope?: OpenRouterModelScope,
  ): Promise<EmbeddingModelRow[] | null> {
    const normalized = normalizeProviderName(providerName);
    if (!normalized) {
      log.error(`Invalid provider name format: ${providerName}`);
      return null;
    }

    try {
      if (scope && !isCustomProvider(normalized)) {
        const { llmProviderRepo } = await import("./LlmProviderRepository");
        return llmProviderRepo.loadScopedOpenRouterEmbeddingModels(scope, includeDeprecated, normalized);
      }

      const rows = includeDeprecated
        ? await sql`
            SELECT * FROM embedding_models
            WHERE provider = ${normalized}
              AND COALESCE(is_scoped_registration, false) = false
            ORDER BY embedding_model_id ASC
          `
        : await sql`
            SELECT * FROM embedding_models
            WHERE provider = ${normalized}
              AND is_deprecated = false
              AND COALESCE(is_scoped_registration, false) = false
            ORDER BY embedding_model_id ASC
          `;

      if (!rows || rows.length === 0) {
        log.warn(`No available embedding models found for provider: ${normalized}`);
        return null;
      }

      const parsed = embeddingModelSchema.array().safeParse(rows);
      if (!parsed.success) {
        log.error(`Failed to validate embedding model data for provider ${normalized}:`, parsed.error.flatten());
        return null;
      }

      log.info(`Found ${parsed.data.length} embedding models for ${normalized}`);
      return parsed.data;
    } catch (error) {
      log.error(`Error loading embedding models for provider ${normalized}:`, error);
      return null;
    }
  }

  /**
   * Returns the default embedding model for a provider.
   *
   */
  async loadDefaultEmbeddingModel(providerName: string): Promise<EmbeddingModelRow | null> {
    const normalized = normalizeProviderName(providerName);
    if (!normalized) {
      log.error(`Invalid provider name format: ${providerName}`);
      return null;
    }

    try {
      const rows = await sql`
        SELECT *, CASE WHEN is_default = true THEN 1 ELSE 2 END as priority
        FROM embedding_models
        WHERE provider = ${normalized} AND is_deprecated = false
        ORDER BY priority ASC, embedding_model_id ASC
        LIMIT 1
      `;

      if (!rows || rows.length === 0) {
        log.warn(`No available embedding models found for provider: ${normalized}`);
        return null;
      }

      const parsed = embeddingModelSchema.safeParse(rows[0]);
      if (!parsed.success) {
        log.error(`Failed to validate embedding model data for provider ${normalized}:`, parsed.error.flatten());
        return null;
      }

      if (rows[0].is_default === true) {
        log.info(`Found default embedding model for ${normalized}: ${parsed.data.codename}`);
      } else {
        log.warn(`No default embedding model found for ${normalized}, using fallback: ${parsed.data.codename}`);
      }

      return parsed.data;
    } catch (error) {
      log.error(`Error loading default embedding model for provider ${normalized}:`, error);
      return null;
    }
  }

  /**
   * Returns an embedding model by its internal ID.
   *
   * @param embeddingModelId - Internal embedding model ID
   */
  async loadEmbeddingModelById(embeddingModelId: number): Promise<EmbeddingModelRow | null> {
    try {
      const rows = await sql`
        SELECT * FROM embedding_models
        WHERE embedding_model_id = ${embeddingModelId}
        LIMIT 1
      `;

      if (!rows || rows.length === 0) {
        log.warn(`No embedding model found with ID: ${embeddingModelId}`);
        return null;
      }

      const parsed = embeddingModelSchema.safeParse(rows[0]);
      if (!parsed.success) {
        log.error(`Failed to validate embedding model data for ID ${embeddingModelId}:`, parsed.error.flatten());
        return null;
      }

      return parsed.data;
    } catch (error) {
      log.error(`Error loading embedding model ${embeddingModelId}:`, error);
      return null;
    }
  }

  /**
   * Returns an embedding model by provider + codename, or null if not found.
   *
   */
  async loadEmbeddingModelByProviderAndCodename(provider: string, codename: string): Promise<EmbeddingModelRow | null> {
    const normalizedProvider = provider.trim().toLowerCase();
    const normalizedCodename = codename.trim();
    if (!normalizedProvider || !normalizedCodename) return null;

    try {
      const rows = await sql`
        SELECT * FROM embedding_models
        WHERE provider = ${normalizedProvider}
          AND codename = ${normalizedCodename}
        LIMIT 1
      `;
      if (!rows.length) return null;

      const parsed = embeddingModelSchema.safeParse(rows[0]);
      if (!parsed.success) {
        log.error(
          `Failed to validate embedding model data for ${normalizedProvider}/${normalizedCodename}:`,
          parsed.error.flatten(),
        );
        return null;
      }

      return parsed.data;
    } catch (error) {
      log.error(`Error loading embedding model for ${normalizedProvider}/${normalizedCodename}:`, error);
      return null;
    }
  }

  /**
   * Returns available image diffusion models for a provider. Delegates scoped
   * OpenRouter filtering to LlmProviderRepository.
   *
   * @param includeDeprecated - Include deprecated models
   * @param scope             - Optional OpenRouter scope filter
   */
  async loadAvailableDiffusionModels(
    providerName: string,
    includeDeprecated = false,
    scope?: OpenRouterModelScope,
  ): Promise<DiffusionModelRow[] | null> {
    const normalized = normalizeProviderName(providerName);
    if (!normalized) {
      log.error(`Invalid provider name format: ${providerName}`);
      return null;
    }

    try {
      if (scope && !isCustomProvider(normalized)) {
        const { llmProviderRepo } = await import("./LlmProviderRepository");
        return llmProviderRepo.loadScopedOpenRouterDiffusionModels(scope, includeDeprecated, normalized);
      }

      const rows = includeDeprecated
        ? await sql`
            SELECT * FROM image_diffusion_models
            WHERE provider = ${normalized}
              AND COALESCE(is_scoped_registration, false) = false
            ORDER BY diffusion_model_id ASC
          `
        : await sql`
            SELECT * FROM image_diffusion_models
            WHERE provider = ${normalized}
              AND is_deprecated = false
              AND COALESCE(is_scoped_registration, false) = false
            ORDER BY diffusion_model_id ASC
          `;

      if (!rows || rows.length === 0) {
        log.warn(`No available diffusion models found for provider: ${normalized}`);
        return null;
      }

      const parsed = diffusionModelSchema.array().safeParse(rows);
      if (!parsed.success) {
        log.error(`Failed to validate diffusion model data for provider ${normalized}:`, parsed.error.flatten());
        return null;
      }

      log.info(`Found ${parsed.data.length} diffusion models for ${normalized}`);
      return parsed.data;
    } catch (error) {
      log.error(`Error loading diffusion models for provider ${normalized}:`, error);
      return null;
    }
  }

  /**
   * Returns the default image diffusion model for a provider.
   *
   */
  async loadDefaultDiffusionModel(providerName: string): Promise<DiffusionModelRow | null> {
    const normalized = normalizeProviderName(providerName);
    if (!normalized) {
      log.error(`Invalid provider name format: ${providerName}`);
      return null;
    }

    try {
      const rows = await sql`
        SELECT *, CASE WHEN is_default = true THEN 1 ELSE 2 END as priority
        FROM image_diffusion_models
        WHERE provider = ${normalized} AND is_deprecated = false
        ORDER BY priority ASC, diffusion_model_id ASC
        LIMIT 1
      `;

      if (!rows || rows.length === 0) {
        log.warn(`No available diffusion models found for provider: ${normalized}`);
        return null;
      }

      const parsed = diffusionModelSchema.safeParse(rows[0]);
      if (!parsed.success) {
        log.error(`Failed to validate default diffusion model for provider ${normalized}:`, parsed.error.flatten());
        return null;
      }

      return parsed.data;
    } catch (error) {
      log.error(`Error loading default diffusion model for provider ${normalized}:`, error);
      return null;
    }
  }

  /**
   * Returns a diffusion model by provider + codename, or null if not found.
   *
   */
  async loadDiffusionModelByProviderAndCodename(provider: string, codename: string): Promise<DiffusionModelRow | null> {
    const normalizedProvider = provider.trim().toLowerCase();
    const normalizedCodename = codename.trim();
    if (!normalizedProvider || !normalizedCodename) return null;

    try {
      const rows = await sql`
        SELECT * FROM image_diffusion_models
        WHERE provider = ${normalizedProvider}
          AND codename = ${normalizedCodename}
        LIMIT 1
      `;
      if (!rows.length) return null;

      const parsed = diffusionModelSchema.safeParse(rows[0]);
      if (!parsed.success) {
        log.error(
          `Failed to validate diffusion model data for ${normalizedProvider}/${normalizedCodename}:`,
          parsed.error.flatten(),
        );
        return null;
      }

      return parsed.data;
    } catch (error) {
      log.error(`Error loading diffusion model for ${normalizedProvider}/${normalizedCodename}:`, error);
      return null;
    }
  }

  /**
   * Returns available video generation models for a provider. Delegates scoped
   * OpenRouter filtering to LlmProviderRepository.
   *
   * @param includeDeprecated - Include deprecated models
   * @param scope             - Optional OpenRouter scope filter
   */
  async loadAvailableVideoGenerationModels(
    providerName: string,
    includeDeprecated = false,
    scope?: OpenRouterModelScope,
  ): Promise<VideoGenerationModelRow[] | null> {
    const normalized = normalizeProviderName(providerName);
    if (!normalized) {
      log.error(`Invalid provider name format: ${providerName}`);
      return null;
    }

    try {
      if (scope && !isCustomProvider(normalized)) {
        const { llmProviderRepo } = await import("./LlmProviderRepository");
        return llmProviderRepo.loadScopedOpenRouterVideoGenerationModels(scope, includeDeprecated, normalized);
      }

      const rows = includeDeprecated
        ? await sql`
            SELECT * FROM video_generation_models
            WHERE provider = ${normalized}
              AND COALESCE(is_scoped_registration, false) = false
            ORDER BY video_model_id ASC
          `
        : await sql`
            SELECT * FROM video_generation_models
            WHERE provider = ${normalized}
              AND is_deprecated = false
              AND COALESCE(is_scoped_registration, false) = false
            ORDER BY video_model_id ASC
          `;

      if (!rows || rows.length === 0) {
        log.warn(`No available video generation models found for provider: ${normalized}`);
        return null;
      }

      const parsed = videoGenerationModelSchema.array().safeParse(rows);
      if (!parsed.success) {
        log.error(`Failed to validate video generation model data for provider ${normalized}:`, parsed.error.flatten());
        return null;
      }

      log.info(`Found ${parsed.data.length} video generation models for ${normalized}`);
      return parsed.data;
    } catch (error) {
      log.error(`Error loading video generation models for provider ${normalized}:`, error);
      return null;
    }
  }

  /**
   * Returns the default video generation model for a provider.
   *
   */
  async loadDefaultVideoGenerationModel(providerName: string): Promise<VideoGenerationModelRow | null> {
    const normalized = normalizeProviderName(providerName);
    if (!normalized) {
      log.error(`Invalid provider name format: ${providerName}`);
      return null;
    }

    try {
      const rows = await sql`
        SELECT *, CASE WHEN is_default = true THEN 1 ELSE 2 END as priority
        FROM video_generation_models
        WHERE provider = ${normalized} AND is_deprecated = false
        ORDER BY priority ASC, video_model_id ASC
        LIMIT 1
      `;

      if (!rows || rows.length === 0) {
        log.warn(`No available video generation models found for provider: ${normalized}`);
        return null;
      }

      const parsed = videoGenerationModelSchema.safeParse(rows[0]);
      if (!parsed.success) {
        log.error(
          `Failed to validate default video generation model for provider ${normalized}:`,
          parsed.error.flatten(),
        );
        return null;
      }

      return parsed.data;
    } catch (error) {
      log.error(`Error loading default video generation model for provider ${normalized}:`, error);
      return null;
    }
  }

  /**
   * Returns a video generation model by provider + codename, or null if not found.
   *
   */
  async loadVideoGenerationModelByProviderAndCodename(
    provider: string,
    codename: string,
  ): Promise<VideoGenerationModelRow | null> {
    const normalizedProvider = provider.trim().toLowerCase();
    const normalizedCodename = codename.trim();
    if (!normalizedProvider || !normalizedCodename) return null;

    try {
      const rows = await sql`
        SELECT * FROM video_generation_models
        WHERE provider = ${normalizedProvider}
          AND codename = ${normalizedCodename}
        LIMIT 1
      `;
      if (!rows.length) return null;

      const parsed = videoGenerationModelSchema.safeParse(rows[0]);
      if (!parsed.success) {
        log.error(
          `Failed to validate video generation model data for ${normalizedProvider}/${normalizedCodename}:`,
          parsed.error.flatten(),
        );
        return null;
      }

      return parsed.data;
    } catch (error) {
      log.error(`Error loading video generation model for ${normalizedProvider}/${normalizedCodename}:`, error);
      return null;
    }
  }

  /**
   * Returns a diffusion model by its internal ID, or null if not found.
   *
   * @param diffusionModelId - Internal diffusion model DB ID
   */
  async loadDiffusionModelById(diffusionModelId: number): Promise<DiffusionModelRow | null> {
    if (!Number.isInteger(diffusionModelId) || diffusionModelId <= 0) {
      log.error(`Invalid diffusion_model_id: ${diffusionModelId}`);
      return null;
    }

    try {
      const rows = await withTransientDbRetry(
        () => sql`SELECT * FROM image_diffusion_models WHERE diffusion_model_id = ${diffusionModelId} LIMIT 1`,
        `load diffusion model ${diffusionModelId}`,
      );
      if (!rows.length) {
        log.warn(`No diffusion model found for diffusion_model_id ${diffusionModelId}`);
        return null;
      }

      const parsed = diffusionModelSchema.safeParse(rows[0]);
      if (!parsed.success) {
        log.error(`Failed to validate diffusion model data for id ${diffusionModelId}:`, parsed.error.flatten());
        return null;
      }

      return parsed.data;
    } catch (error) {
      log.error(`Error loading diffusion model for diffusion_model_id ${diffusionModelId}:`, error);
      return null;
    }
  }

  /**
   * Returns a video generation model by its internal ID, or null if not found.
   *
   * @param videoModelId - Internal video model DB ID
   */
  async loadVideoGenerationModelById(videoModelId: number): Promise<VideoGenerationModelRow | null> {
    if (!Number.isInteger(videoModelId) || videoModelId <= 0) {
      log.error(`Invalid video_model_id: ${videoModelId}`);
      return null;
    }

    try {
      const rows = await sql`SELECT * FROM video_generation_models WHERE video_model_id = ${videoModelId} LIMIT 1`;
      if (!rows.length) {
        log.warn(`No video model found for video_model_id ${videoModelId}`);
        return null;
      }

      const parsed = videoGenerationModelSchema.safeParse(rows[0]);
      if (!parsed.success) {
        log.error(`Failed to validate video model data for id ${videoModelId}:`, parsed.error.flatten());
        return null;
      }

      return parsed.data;
    } catch (error) {
      log.error(`Error loading video model for video_model_id ${videoModelId}:`, error);
      return null;
    }
  }

  /**
   * Upserts a workspace-scoped model under a shared provider name.
   * Catalog-backed callers supply verified flags while providers without a catalog use
   * manager-declared flags. OpenRouter callers also persist catalog pricing because SQL-only
   * stat surfaces cannot read the in-memory pricing cache.
   *
   * A missing rate does not overwrite a known one during re-registration.
   */
  async upsertScopedLlm(
    modelCodename: string,
    caps: {
      hasTools: boolean;
      seesImages: boolean;
      seesVideos: boolean;
      seesYoutube: boolean;
      supportsStructuredOutput: boolean;
      strictRoleAlternation?: boolean;
      supportsPrefixCompletion?: boolean;
      supportsAssistantPrefill?: boolean;
    },
    provider = "openrouter",
    pricing?: { inputPerMillion: number; outputPerMillion: number } | null,
  ): Promise<number | null> {
    const inputPrice = pricing?.inputPerMillion ?? null;
    const outputPrice = pricing?.outputPerMillion ?? null;

    try {
      const rows = await sql`
        INSERT INTO llms (
          llm_provider, llm_codename, is_scoped_registration, is_smartest,
          is_default, is_reasoning, is_deprecated, is_free, has_tools,
          sees_images, sees_videos, sees_youtube, is_uncensored,
          supports_structoutput, strict_role_alternation, supports_prefix_completion,
          supports_assistant_prefill, llm_description, descriptions,
          input_price_per_million, output_price_per_million
        ) VALUES (
          ${provider}, ${modelCodename}, true, false, false, false, false, false,
          ${caps.hasTools}, ${caps.seesImages}, ${caps.seesVideos}, ${caps.seesYoutube},
          false, ${caps.supportsStructuredOutput}, ${caps.strictRoleAlternation ?? false},
          ${caps.supportsPrefixCompletion ?? false}, ${caps.supportsAssistantPrefill ?? false}, ${modelCodename},
          ${{ "en-US": modelCodename }},
          ${inputPrice}, ${outputPrice}
        )
        ON CONFLICT (llm_provider, llm_codename) DO UPDATE SET
          is_scoped_registration  = true,
          is_deprecated           = false,
          has_tools               = EXCLUDED.has_tools,
          sees_images             = EXCLUDED.sees_images,
          sees_videos             = EXCLUDED.sees_videos,
          sees_youtube            = EXCLUDED.sees_youtube,
          supports_structoutput   = EXCLUDED.supports_structoutput,
          strict_role_alternation = EXCLUDED.strict_role_alternation,
          supports_prefix_completion = EXCLUDED.supports_prefix_completion,
          supports_assistant_prefill = EXCLUDED.supports_assistant_prefill,
          llm_description         = EXCLUDED.llm_description,
          descriptions            = COALESCE(llms.descriptions, EXCLUDED.descriptions),
          -- COALESCE, not EXCLUDED: a re-registration during an OpenRouter outage resolves no
          -- price, and overwriting a known rate with null would zero out historical cost rows.
          input_price_per_million  = COALESCE(EXCLUDED.input_price_per_million, llms.input_price_per_million),
          output_price_per_million = COALESCE(EXCLUDED.output_price_per_million, llms.output_price_per_million),
          updated_at              = CURRENT_TIMESTAMP
        RETURNING llm_id
      `;
      const id = Number(rows[0]?.llm_id);
      return Number.isInteger(id) ? id : null;
    } catch (error) {
      log.error(`LlmModelRepository.upsertScopedLlm: failed for ${modelCodename}`, error);
      return null;
    }
  }

  /**
   * Write live OpenRouter rates onto the matching llms rows, in one statement.
   *
   * OpenRouter models are not priced by the seed catalog (see METERED_FIRST_PARTY_PROVIDERS in
   * src/db/seed/catalog/modelSeed.ts): their rates move on OpenRouter's schedule, so the live
   * API is the source of truth. That leaves the DB columns null, and every cost figure computed
   * in SQL (StatRepository's estimated cost, per-persona and per-model breakdowns) silently
   * reports $0.00 for OpenRouter usage. Mirroring the live rates into the catalog closes that
   * gap without moving pricing authority off the API.
   *
   * Only rows whose stored rate actually differs are touched, so an unchanged catalog leaves
   * updated_at alone and the returned count reports real drift rather than row volume.
   *
   * @param prices - Live rates keyed by OpenRouter codename, USD per million tokens
   * @returns Number of rows whose stored rate changed, or null on failure
   */
  async syncOpenrouterPrices(
    prices: ReadonlyMap<string, { inputPerMillion: number; outputPerMillion: number }>,
  ): Promise<number | null> {
    if (prices.size === 0) {
      return 0;
    }

    const codenames: string[] = [];
    const inputPrices: number[] = [];
    const outputPrices: number[] = [];
    for (const [codename, price] of prices) {
      codenames.push(codename);
      inputPrices.push(price.inputPerMillion);
      outputPrices.push(price.outputPerMillion);
    }

    try {
      const rows = await sql`
        UPDATE llms l
        SET input_price_per_million  = v.input_price,
            output_price_per_million = v.output_price,
            updated_at               = CURRENT_TIMESTAMP
        FROM (
          SELECT * FROM unnest(
            ${toPgTextArrayLiteral(codenames)}::text[],
            ${toPgNumericArrayLiteral(inputPrices)}::numeric[],
            ${toPgNumericArrayLiteral(outputPrices)}::numeric[]
          ) AS t(codename, input_price, output_price)
        ) v
        WHERE l.llm_provider = 'openrouter'
          AND l.llm_codename = v.codename
          AND (
            l.input_price_per_million  IS DISTINCT FROM v.input_price
            OR l.output_price_per_million IS DISTINCT FROM v.output_price
          )
        RETURNING l.llm_id
      `;
      return rows.length;
    } catch (error) {
      log.error("LlmModelRepository.syncOpenrouterPrices: failed", error);
      return null;
    }
  }

  /**
   * @returns The upserted embedding_model_id, or null on failure
   */
  async upsertScopedEmbeddingModel(modelCodename: string, provider = "openrouter"): Promise<number | null> {
    const modelFamily = modelCodename.split("/").pop() ?? modelCodename;
    try {
      const rows = await sql`
        INSERT INTO embedding_models (
          provider, codename, model_family, is_scoped_registration,
          model_description, descriptions, is_default, is_deprecated
        ) VALUES (
          ${provider}, ${modelCodename}, ${modelFamily}, true,
          ${modelCodename}, ${{ "en-US": modelCodename }}, false, false
        )
        ON CONFLICT (provider, codename) DO UPDATE SET
          model_family            = EXCLUDED.model_family,
          is_scoped_registration  = true,
          model_description       = EXCLUDED.model_description,
          descriptions            = COALESCE(embedding_models.descriptions, EXCLUDED.descriptions),
          is_default              = false,
          is_deprecated           = false,
          updated_at              = CURRENT_TIMESTAMP
        RETURNING embedding_model_id
      `;
      const id = Number(rows[0]?.embedding_model_id);
      return Number.isInteger(id) ? id : null;
    } catch (error) {
      log.error(`LlmModelRepository.upsertScopedEmbeddingModel: failed for ${modelCodename}`, error);
      return null;
    }
  }

  /**
   * Upserts a scoped diffusion model under a shared provider name.
   *
   * @param modelCodename - OpenRouter model codename
   * @returns The upserted diffusion_model_id, or null on failure
   */
  async upsertScopedDiffusionModel(
    modelCodename: string,
    provider = "openrouter",
    supports?: ImageEndpointSupports,
  ): Promise<number | null> {
    try {
      const declared = supports ?? null;
      const rows = await sql`
        INSERT INTO image_diffusion_models (
          provider, codename, is_scoped_registration,
          model_description, descriptions, is_default, is_deprecated, is_free, is_uncensored,
          supports_txt2img, supports_img2img, supports_inpaint, supports_negative_prompt
        ) VALUES (
          ${provider}, ${modelCodename}, true,
          ${modelCodename}, ${{ "en-US": modelCodename }}, false, false, false, false,
          ${declared?.txt2img ?? null}, ${declared?.img2img ?? null},
          ${declared?.inpaint ?? null}, ${declared?.negative_prompt ?? null}
        )
        ON CONFLICT (provider, codename) DO UPDATE SET
          is_scoped_registration  = true,
          model_description       = EXCLUDED.model_description,
          descriptions            = COALESCE(image_diffusion_models.descriptions, EXCLUDED.descriptions),
          is_default              = false,
          is_deprecated           = false,
          is_free                 = EXCLUDED.is_free,
          is_uncensored           = EXCLUDED.is_uncensored,
          -- A caller that declares nothing must not erase an existing declaration.
          supports_txt2img        = COALESCE(EXCLUDED.supports_txt2img, image_diffusion_models.supports_txt2img),
          supports_img2img        = COALESCE(EXCLUDED.supports_img2img, image_diffusion_models.supports_img2img),
          supports_inpaint        = COALESCE(EXCLUDED.supports_inpaint, image_diffusion_models.supports_inpaint),
          supports_negative_prompt = COALESCE(
            EXCLUDED.supports_negative_prompt,
            image_diffusion_models.supports_negative_prompt
          ),
          updated_at              = CURRENT_TIMESTAMP
        RETURNING diffusion_model_id
      `;
      const id = Number(rows[0]?.diffusion_model_id);
      return Number.isInteger(id) ? id : null;
    } catch (error) {
      log.error(`LlmModelRepository.upsertScopedDiffusionModel: failed for ${modelCodename}`, error);
      return null;
    }
  }

  /**
   * Upserts a scoped video model under a shared provider name.
   *
   * @param modelCodename - OpenRouter model codename
   * @returns The upserted video_model_id, or null on failure
   */
  async upsertScopedVideoModel(modelCodename: string, provider = "openrouter"): Promise<number | null> {
    try {
      const rows = await sql`
        INSERT INTO video_generation_models (
          provider, codename, is_scoped_registration,
          model_description, descriptions, is_default, is_deprecated, is_free
        ) VALUES (
          ${provider}, ${modelCodename}, true,
          ${modelCodename}, ${{ "en-US": modelCodename }}, false, false, false
        )
        ON CONFLICT (provider, codename) DO UPDATE SET
          is_scoped_registration  = true,
          model_description       = EXCLUDED.model_description,
          descriptions            = COALESCE(video_generation_models.descriptions, EXCLUDED.descriptions),
          is_default              = false,
          is_deprecated           = false,
          is_free                 = EXCLUDED.is_free,
          updated_at              = CURRENT_TIMESTAMP
        RETURNING video_model_id
      `;
      const id = Number(rows[0]?.video_model_id);
      return Number.isInteger(id) ? id : null;
    } catch (error) {
      log.error(`LlmModelRepository.upsertScopedVideoModel: failed for ${modelCodename}`, error);
      return null;
    }
  }

  async upsertSyntheticCustomLlm(params: {
    provider: string;
    codename: string;
    displayName: string;
    hasTools: boolean;
    seesImages: boolean;
    seesVideos: boolean;
    supportsStructOutput: boolean;
    strictRoleAlternation: boolean;
    supportsPrefixCompletion: boolean;
    supportsAssistantPrefill: boolean;
    verbatimToolCalling: boolean;
  }): Promise<number | null> {
    try {
      const rows = await sql`
        INSERT INTO llms (
          llm_provider, llm_codename, has_tools, sees_images, sees_videos,
          sees_youtube, supports_structoutput, strict_role_alternation, supports_prefix_completion,
          supports_assistant_prefill, verbatim_tool_calling,
          is_smartest, is_default, is_reasoning, is_deprecated, is_free, is_uncensored,
          llm_description, descriptions
        ) VALUES (
          ${params.provider}, ${params.codename}, ${params.hasTools}, ${params.seesImages}, ${params.seesVideos},
          false, ${params.supportsStructOutput}, ${params.strictRoleAlternation}, ${params.supportsPrefixCompletion},
          ${params.supportsAssistantPrefill}, ${params.verbatimToolCalling},
          false, true, false, false, false, false,
          ${params.displayName}, ${{ "en-US": params.displayName }}
        )
        ON CONFLICT (llm_provider, llm_codename) DO UPDATE SET
          has_tools = EXCLUDED.has_tools,
          sees_images = EXCLUDED.sees_images,
          sees_videos = EXCLUDED.sees_videos,
          supports_structoutput = EXCLUDED.supports_structoutput,
          strict_role_alternation = EXCLUDED.strict_role_alternation,
          supports_prefix_completion = EXCLUDED.supports_prefix_completion,
          supports_assistant_prefill = EXCLUDED.supports_assistant_prefill,
          verbatim_tool_calling = EXCLUDED.verbatim_tool_calling,
          llm_description = EXCLUDED.llm_description,
          descriptions = jsonb_set(COALESCE(llms.descriptions, '{}'::jsonb), '{en-US}', to_jsonb(${params.displayName}::text)),
          updated_at = CURRENT_TIMESTAMP
        RETURNING llm_id
      `;
      const id = Number(rows[0]?.llm_id);
      return Number.isInteger(id) ? id : null;
    } catch (error) {
      log.error(`LlmModelRepository.upsertSyntheticCustomLlm: failed for ${params.provider}`, error);
      return null;
    }
  }

  /**
   * Removes a legacy `custom/{serverId}` llms row when a server switches away from the
   * custom provider.
   *
   * Deliberately has no write-side counterpart: the inline custom-provider setup flow that
   * created these rows was retired, so nothing can produce a new one. Existing rows still
   * exist in older databases, which is why the cleanup path stays.
   */
  async deleteLegacyCustomLlm(codename: string): Promise<boolean> {
    const result = await sql`
      DELETE FROM llms
      WHERE llm_codename = ${codename}
      RETURNING llm_id
    `;
    return result.length > 0;
  }

  async upsertSyntheticCustomEmbeddingModel(params: {
    provider: string;
    codename: string;
    displayName: string;
  }): Promise<number | null> {
    try {
      const rows = await sql`
        INSERT INTO embedding_models (
          provider, codename, model_family, model_description,
          descriptions, is_default, is_deprecated
        ) VALUES (
          ${params.provider}, ${params.codename}, ${params.provider},
          ${params.displayName}, ${{ "en-US": params.displayName }}, true, false
        )
        ON CONFLICT (provider, codename) DO UPDATE SET
          provider = EXCLUDED.provider,
          model_family = EXCLUDED.model_family,
          model_description = EXCLUDED.model_description,
          descriptions = jsonb_set(COALESCE(embedding_models.descriptions, '{}'::jsonb), '{en-US}', to_jsonb(${params.displayName}::text)),
          is_default = EXCLUDED.is_default,
          is_deprecated = EXCLUDED.is_deprecated,
          updated_at = CURRENT_TIMESTAMP
        RETURNING embedding_model_id
      `;
      const id = Number(rows[0]?.embedding_model_id);
      return Number.isInteger(id) ? id : null;
    } catch (error) {
      log.error(`LlmModelRepository.upsertSyntheticCustomEmbeddingModel: failed for ${params.provider}`, error);
      return null;
    }
  }

  async upsertSyntheticCustomDiffusionModel(params: {
    provider: string;
    codename: string;
    displayName: string;
  }): Promise<number | null> {
    try {
      const rows = await sql`
        INSERT INTO image_diffusion_models (
          provider, codename, model_description, descriptions,
          is_default, is_deprecated, is_free, is_uncensored
        ) VALUES (
          ${params.provider}, ${params.codename}, ${params.displayName},
          ${{ "en-US": params.displayName }},
          true, false, true, true
        )
        ON CONFLICT (provider, codename) DO UPDATE SET
          provider = EXCLUDED.provider,
          model_description = EXCLUDED.model_description,
          descriptions = jsonb_set(COALESCE(image_diffusion_models.descriptions, '{}'::jsonb), '{en-US}', to_jsonb(${params.displayName}::text)),
          is_default = EXCLUDED.is_default,
          is_deprecated = EXCLUDED.is_deprecated,
          is_free = EXCLUDED.is_free,
          is_uncensored = EXCLUDED.is_uncensored,
          updated_at = CURRENT_TIMESTAMP
        RETURNING diffusion_model_id
      `;
      const id = Number(rows[0]?.diffusion_model_id);
      return Number.isInteger(id) ? id : null;
    } catch (error) {
      log.error(`LlmModelRepository.upsertSyntheticCustomDiffusionModel: failed for ${params.provider}`, error);
      return null;
    }
  }

  async upsertSyntheticCustomVideoModel(params: {
    provider: string;
    codename: string;
    displayName: string;
  }): Promise<number | null> {
    try {
      const rows = await sql`
        INSERT INTO video_generation_models (
          provider, codename, model_description, descriptions,
          is_default, is_deprecated, is_free
        ) VALUES (
          ${params.provider}, ${params.codename}, ${params.displayName},
          ${{ "en-US": params.displayName }},
          true, false, true
        )
        ON CONFLICT (provider, codename) DO UPDATE SET
          provider = EXCLUDED.provider,
          model_description = EXCLUDED.model_description,
          descriptions = jsonb_set(COALESCE(video_generation_models.descriptions, '{}'::jsonb), '{en-US}', to_jsonb(${params.displayName}::text)),
          is_default = EXCLUDED.is_default,
          is_deprecated = EXCLUDED.is_deprecated,
          is_free = EXCLUDED.is_free,
          updated_at = CURRENT_TIMESTAMP
        RETURNING video_model_id
      `;
      const id = Number(rows[0]?.video_model_id);
      return Number.isInteger(id) ? id : null;
    } catch (error) {
      log.error(`LlmModelRepository.upsertSyntheticCustomVideoModel: failed for ${params.provider}`, error);
      return null;
    }
  }

  /**
   * Returns true when any config row (server_model_configs, persona_configs,
   * channel_llm_overrides, saved_provider_configs, user_saved_provider_configs)
   * still references the given LLM ID.
   *
   * @param llmId - Internal LLM ID
   */
  async isLlmStillReferenced(llmId: number): Promise<boolean> {
    const [row] = await sql<Array<{ in_use: boolean }>>`
      SELECT EXISTS (
        SELECT 1 FROM server_model_configs
        WHERE llm_id = ${llmId}
           OR vision_llm_id = ${llmId}
           OR COALESCE(fallback_llm_ids, '[]'::JSONB) @> jsonb_build_array(${llmId})
        UNION ALL
        SELECT 1 FROM server_chat_configs
        WHERE EXISTS (
              SELECT 1 FROM jsonb_array_elements(
                CASE WHEN jsonb_typeof(COALESCE(server_chat_configs.fallback_model_refs, '[]'::JSONB)) = 'array'
                  THEN COALESCE(server_chat_configs.fallback_model_refs, '[]'::JSONB)
                  ELSE '[]'::JSONB END
              ) AS ref
              WHERE ref ->> 'type' = 'llm' AND ref ->> 'id' = ${String(llmId)}
           )
        UNION ALL
        SELECT 1 FROM persona_configs WHERE llm_id = ${llmId}
        UNION ALL
        SELECT 1 FROM channel_llm_overrides WHERE llm_id = ${llmId}
        UNION ALL
        SELECT 1 FROM saved_provider_configs
        WHERE llm_id = ${llmId}
           OR vision_llm_id = ${llmId}
           OR EXISTS (
              SELECT 1 FROM jsonb_array_elements(
                CASE WHEN jsonb_typeof(COALESCE(saved_provider_configs.fallback_model_refs, '[]'::JSONB)) = 'array'
                  THEN COALESCE(saved_provider_configs.fallback_model_refs, '[]'::JSONB)
                  ELSE '[]'::JSONB END
              ) AS ref
              WHERE ref ->> 'type' = 'llm' AND ref ->> 'id' = ${String(llmId)}
           )
        UNION ALL
        SELECT 1 FROM user_saved_provider_configs
        WHERE llm_id = ${llmId}
           OR vision_llm_id = ${llmId}
           OR EXISTS (
              SELECT 1 FROM jsonb_array_elements(
                CASE WHEN jsonb_typeof(COALESCE(user_saved_provider_configs.fallback_model_refs, '[]'::JSONB)) = 'array'
                  THEN COALESCE(user_saved_provider_configs.fallback_model_refs, '[]'::JSONB)
                  ELSE '[]'::JSONB END
              ) AS ref
              WHERE ref ->> 'type' = 'llm' AND ref ->> 'id' = ${String(llmId)}
           )
      ) AS in_use
    `;
    return Boolean(row?.in_use);
  }

  /**
   * Returns true when any config row still references the given embedding model ID.
   *
   * @param embeddingModelId - Internal embedding model ID
   */
  async isEmbeddingModelStillReferenced(embeddingModelId: number): Promise<boolean> {
    const [row] = await sql<Array<{ in_use: boolean }>>`
      SELECT EXISTS (
        SELECT 1 FROM server_model_configs         WHERE embedding_model_id = ${embeddingModelId}
        UNION ALL
        SELECT 1 FROM saved_provider_configs WHERE embedding_model_id = ${embeddingModelId}
        UNION ALL
        SELECT 1 FROM user_saved_provider_configs WHERE embedding_model_id = ${embeddingModelId}
      ) AS in_use
    `;
    return Boolean(row?.in_use);
  }

  /**
   * Returns true when any config row still references the given diffusion model ID.
   *
   * @param diffusionModelId - Internal diffusion model ID
   */
  async isDiffusionModelStillReferenced(diffusionModelId: number): Promise<boolean> {
    const [row] = await sql<Array<{ in_use: boolean }>>`
      SELECT EXISTS (
        SELECT 1 FROM server_model_configs
        WHERE diffusion_model_id = ${diffusionModelId}
        UNION ALL
        SELECT 1 FROM server_novelai_imagegen_configs
        WHERE nai_diffusion_model_id = ${diffusionModelId}
        UNION ALL
        SELECT 1 FROM saved_provider_configs
        WHERE diffusion_model_id = ${diffusionModelId} OR nai_diffusion_model_id = ${diffusionModelId}
        UNION ALL
        SELECT 1 FROM user_saved_provider_configs
        WHERE diffusion_model_id = ${diffusionModelId} OR nai_diffusion_model_id = ${diffusionModelId}
      ) AS in_use
    `;
    return Boolean(row?.in_use);
  }

  /**
   * Returns true when any config row still references the given video model ID.
   *
   * @param videoModelId - Internal video model ID
   */
  async isVideoModelStillReferenced(videoModelId: number): Promise<boolean> {
    const [row] = await sql<Array<{ in_use: boolean }>>`
      SELECT EXISTS (
        SELECT 1 FROM server_model_configs              WHERE video_model_id = ${videoModelId}
        UNION ALL
        SELECT 1 FROM saved_provider_configs      WHERE video_model_id = ${videoModelId}
        UNION ALL
        SELECT 1 FROM user_saved_provider_configs WHERE video_model_id = ${videoModelId}
      ) AS in_use
    `;
    return Boolean(row?.in_use);
  }

  /** Zero means the catalog row can be deleted if also unreferenced. */
  async countLlmRegistrations(llmId: number): Promise<number> {
    const [row] = await sql<Array<{ count: string | number }>>`
      SELECT COUNT(*) AS count FROM scoped_model_registrations WHERE llm_id = ${llmId}
    `;
    return Number(row?.count ?? 0);
  }

  async countEmbeddingModelRegistrations(embeddingModelId: number): Promise<number> {
    const [row] = await sql<Array<{ count: string | number }>>`
      SELECT COUNT(*) AS count FROM scoped_model_registrations
      WHERE embedding_model_id = ${embeddingModelId}
    `;
    return Number(row?.count ?? 0);
  }

  async countDiffusionModelRegistrations(diffusionModelId: number): Promise<number> {
    const [row] = await sql<Array<{ count: string | number }>>`
      SELECT COUNT(*) AS count FROM scoped_model_registrations
      WHERE diffusion_model_id = ${diffusionModelId}
    `;
    return Number(row?.count ?? 0);
  }

  async countVideoModelRegistrations(videoModelId: number): Promise<number> {
    const [row] = await sql<Array<{ count: string | number }>>`
      SELECT COUNT(*) AS count FROM scoped_model_registrations
      WHERE video_model_id = ${videoModelId}
    `;
    return Number(row?.count ?? 0);
  }

  /**
   * Deletes an orphaned scoped LLM catalog row while preserving curated rows.
   *
   * @param llmId - Internal LLM ID
   */
  async deleteOrphanedLlm(llmId: number): Promise<void> {
    await sql`
      DELETE FROM llms
      WHERE llm_id = ${llmId}
        AND COALESCE(is_scoped_registration, false) = true
    `;
  }

  /**
   * Deletes an orphaned scoped embedding model catalog row.
   *
   * @param embeddingModelId - Internal embedding model ID
   */
  async deleteOrphanedEmbeddingModel(embeddingModelId: number): Promise<void> {
    await sql`
      DELETE FROM embedding_models
      WHERE embedding_model_id = ${embeddingModelId}
        AND COALESCE(is_scoped_registration, false) = true
    `;
  }

  /**
   * Deletes an orphaned scoped diffusion model catalog row.
   *
   * @param diffusionModelId - Internal diffusion model ID
   */
  async deleteOrphanedDiffusionModel(diffusionModelId: number): Promise<void> {
    await sql`
      DELETE FROM image_diffusion_models
      WHERE diffusion_model_id = ${diffusionModelId}
        AND COALESCE(is_scoped_registration, false) = true
    `;
  }

  /**
   * Deletes an orphaned scoped video model catalog row.
   *
   * @param videoModelId - Internal video model ID
   */
  async deleteOrphanedVideoModel(videoModelId: number): Promise<void> {
    await sql`
      DELETE FROM video_generation_models
      WHERE video_model_id = ${videoModelId}
        AND COALESCE(is_scoped_registration, false) = true
    `;
  }

  async deleteSyntheticCustomCapabilityModel(
    provider: string,
    codename: string,
    capability: CustomEndpointCapability,
  ): Promise<void> {
    switch (capability) {
      case "text":
        await sql`
          DELETE FROM llms
          WHERE llm_provider = ${provider}
            AND llm_codename = ${codename}
        `;
        return;
      case "embedding":
        await sql`
          DELETE FROM embedding_models
          WHERE provider = ${provider}
            AND codename = ${codename}
        `;
        return;
      case "image":
        await sql`
          DELETE FROM image_diffusion_models
          WHERE provider = ${provider}
            AND codename = ${codename}
        `;
        return;
      case "video":
        await sql`
          DELETE FROM video_generation_models
          WHERE provider = ${provider}
            AND codename = ${codename}
        `;
        return;
      case "speech":
      case "transcription":
        return;
    }
  }

  /**
   * Deletes a synthetic custom model row by its primary key in the capability-appropriate table.
   *
   * Preferred over the codename-based delete when removing one model among several under a label,
   * since the id is unambiguous regardless of how the codename was derived.
   *
   * @param modelRefId - Primary key in llms / embedding_models / image_diffusion_models / video_generation_models
   * @param capability - Selects the target table
   */
  async deleteSyntheticCustomCapabilityModelById(
    modelRefId: number,
    capability: CustomEndpointCapability,
  ): Promise<void> {
    switch (capability) {
      case "text":
        await sql`DELETE FROM llms WHERE llm_id = ${modelRefId}`;
        return;
      case "embedding":
        await sql`DELETE FROM embedding_models WHERE embedding_model_id = ${modelRefId}`;
        return;
      case "image":
        await sql`DELETE FROM image_diffusion_models WHERE diffusion_model_id = ${modelRefId}`;
        return;
      case "video":
        await sql`DELETE FROM video_generation_models WHERE video_model_id = ${modelRefId}`;
        return;
      case "speech":
      case "transcription":
        return;
    }
  }

  /**
   * Updates an existing synthetic custom model row in place by its primary key.
   *
   * Used on the edit path so a renamed model_name (which changes the derived codename) updates the
   * same row rather than orphaning it, so config rows reference the model by id, so the id is stable.
   *
   * @param params - modelRefId + capability select the row/table; remaining fields are the new values
   */
  async updateSyntheticCustomCapabilityModelById(params: {
    modelRefId: number;
    capability: CustomEndpointCapability;
    codename: string;
    displayName: string;
    hasTools: boolean;
    seesImages: boolean;
    seesVideos: boolean;
    supportsStructOutput: boolean;
    strictRoleAlternation: boolean;
    supportsPrefixCompletion: boolean;
    supportsAssistantPrefill: boolean;
    verbatimToolCalling: boolean;
    inputTokenLimit?: number | null;
  }): Promise<void> {
    switch (params.capability) {
      case "decision":
        await sql`
          UPDATE decision_models SET codename = ${params.codename},
            input_token_limit = ${params.inputTokenLimit ?? null}, updated_at = CURRENT_TIMESTAMP
          WHERE decision_model_id = ${params.modelRefId}
        `;
        return;
      case "text":
        await sql`
          UPDATE llms SET
            llm_codename = ${params.codename},
            has_tools = ${params.hasTools},
            sees_images = ${params.seesImages},
            sees_videos = ${params.seesVideos},
            supports_structoutput = ${params.supportsStructOutput},
            strict_role_alternation = ${params.strictRoleAlternation},
            supports_prefix_completion = ${params.supportsPrefixCompletion},
            supports_assistant_prefill = ${params.supportsAssistantPrefill},
            verbatim_tool_calling = ${params.verbatimToolCalling},
            llm_description = ${params.displayName},
            descriptions = jsonb_set(COALESCE(descriptions, '{}'::jsonb), '{en-US}', to_jsonb(${params.displayName}::text)),
            updated_at = CURRENT_TIMESTAMP
          WHERE llm_id = ${params.modelRefId}
        `;
        return;
      case "embedding":
        await sql`
          UPDATE embedding_models SET
            codename = ${params.codename},
            model_description = ${params.displayName},
            descriptions = jsonb_set(COALESCE(descriptions, '{}'::jsonb), '{en-US}', to_jsonb(${params.displayName}::text)),
            updated_at = CURRENT_TIMESTAMP
          WHERE embedding_model_id = ${params.modelRefId}
        `;
        return;
      case "image":
        await sql`
          UPDATE image_diffusion_models SET
            codename = ${params.codename},
            model_description = ${params.displayName},
            descriptions = jsonb_set(COALESCE(descriptions, '{}'::jsonb), '{en-US}', to_jsonb(${params.displayName}::text)),
            updated_at = CURRENT_TIMESTAMP
          WHERE diffusion_model_id = ${params.modelRefId}
        `;
        return;
      case "video":
        await sql`
          UPDATE video_generation_models SET
            codename = ${params.codename},
            model_description = ${params.displayName},
            descriptions = jsonb_set(COALESCE(descriptions, '{}'::jsonb), '{en-US}', to_jsonb(${params.displayName}::text)),
            updated_at = CURRENT_TIMESTAMP
          WHERE video_model_id = ${params.modelRefId}
        `;
        return;
      case "speech":
      case "transcription":
        return;
    }
  }

  /**
   * Deletes every synthetic model row owned by a custom provider across all capability tables.
   *
   * Used when tearing down a custom provider entirely, so a label+capability may now own several
   * synthetic models, so codename-by-codename deletion is insufficient.
   *
   * @param provider - Internal custom provider name (for example, "custom:123")
   */
  async deleteAllSyntheticModelsForProvider(provider: string): Promise<void> {
    await sql`DELETE FROM llms WHERE llm_provider = ${provider}`;
    await sql`DELETE FROM embedding_models WHERE provider = ${provider}`;
    await sql`DELETE FROM image_diffusion_models WHERE provider = ${provider}`;
    await sql`DELETE FROM video_generation_models WHERE provider = ${provider}`;
    await sql`DELETE FROM decision_models WHERE provider = ${provider}`;
  }
}

/** Singleton instance: import this in callers. */
export const llmModelRepo = new LlmModelRepository();
