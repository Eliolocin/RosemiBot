import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { log } from "@/utils/misc/logger";

/**
 * Interface defining all secrets required for TomoriBot production deployment.
 *
 * Core Secrets:
 * - Discord bot authentication token
 * - PostgreSQL database connection parameters
 * - Encryption key for database-stored API keys
 *
 * Optional Secrets:
 * - CRYPTO_SECRET_V1, V2, etc. for key rotation support
 * - DISCORD_WEBHOOK_URL for logging webhooks
 * - AVATAR_GCS_BUCKET / VOICE_SAMPLE_GCS_* for GCP Cloud Storage (GCP deployments)
 * - AVATAR_S3_* / VOICE_SAMPLE_S3_* / CHARREF_S3_* for S3-compatible object storage
 * - S3_ENDPOINT and AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY for R2 or other S3-compatible backends
 */
export interface TomoriSecrets {
  DISCORD_TOKEN: string;
  POSTGRES_HOST: string;
  POSTGRES_PORT: string;
  POSTGRES_USER: string;
  POSTGRES_PASSWORD: string;
  POSTGRES_DB: string;
  CRYPTO_SECRET?: string;
  CRYPTO_SECRET_CURRENT?: string;
  CRYPTO_SECRET_V1?: string; // Optional: Key rotation support
  CRYPTO_SECRET_V2?: string; // Optional: Key rotation support
  CRYPTO_SECRET_V3?: string; // Optional: Key rotation support
  DISCORD_WEBHOOK_URL?: string; // Optional: Error logging webhook
  // GCP Cloud Storage (set when deployed to GCP; injected as env vars by Cloud Run terraform)
  AVATAR_GCS_BUCKET?: string;
  AVATAR_PUBLIC_BASE_URL?: string;
  VOICE_SAMPLE_GCS_BUCKET?: string;
  VOICE_SAMPLE_GCS_PREFIX?: string;
  VOICE_SAMPLE_PUBLIC_BASE_URL?: string;
  // AWS S3 storage (set when deployed to AWS)
  AWS_ACCESS_KEY_ID?: string;
  AWS_SECRET_ACCESS_KEY?: string;
  S3_ENDPOINT?: string;
  AVATAR_S3_BUCKET?: string;
  AVATAR_S3_REGION?: string;
  AVATAR_S3_PREFIX?: string;
  VOICE_SAMPLE_S3_BUCKET?: string;
  VOICE_SAMPLE_S3_REGION?: string;
  VOICE_SAMPLE_S3_PREFIX?: string;
  CHARREF_S3_BUCKET?: string;
  CHARREF_S3_REGION?: string;
  CHARREF_S3_PREFIX?: string;
  CHARREF_PUBLIC_BASE_URL?: string;
  MATRIX_HOMESERVER_URL?: string; // e.g., http://localhost:8448 or https://your-hs.example.com
  MATRIX_ACCESS_TOKEN?: string; // Appservice token (as_token) used to authenticate to the homeserver
  MATRIX_BOT_USER_ID?: string; // e.g., @tomoribot:yourdomain.com
  MATRIX_SERVER_NAME?: string; // Homeserver domain (e.g., localhost or yourdomain.com)
  MATRIX_HS_TOKEN?: string; // Homeserver token (hs_token): homeserver sends this to verify its identity
  MATRIX_APPSERVICE_PUBLIC_URL?: string; // Optional callback URL used in appservice registration for remote homeservers
  TOPGG_TOKEN?: string; // Optional: Top.gg API token for posting server stats
  CONTAINER_MEMORY_LIMIT_MB?: string; // Optional: Container memory limit in MB (default: 1024)
  [key: string]: string | undefined; // Allow dynamic CRYPTO_SECRET_V* keys
}

/**
 * Fetches application secrets from the appropriate backend based on environment.
 *
 * Resolution order:
 * 1. Development / test-production → process.env (dotenv)
 * 2. Production + SECRET_FILE set → mounted JSON secret file
 * 3. Production + GCP_SECRET_FILE set → mounted GCP Secret Manager volume file (JSON, legacy fallback)
 * 4. Production (fallback) → AWS Secrets Manager API call
 *
 * Mounted secret file path:
 * - Azure compose mounts the JSON secret at /run/secrets/tomoribot.json and sets SECRET_FILE to that path
 * - Cloud Run mounts the secret at /run/secrets/<secret_id> and sets GCP_SECRET_FILE to that path
 * - File content is identical JSON shape to the AWS secret string
 * - No SDK call needed: plain fs.readFileSync
 *
 * AWS Configuration:
 * - AWS_REGION environment variable (defaults to "us-east-1")
 * - AWS credentials from environment, IAM role, or ~/.aws/credentials
 *
 * Key Version Auto-Detection:
 * - Scans for CRYPTO_SECRET_V1, CRYPTO_SECRET_V2, CRYPTO_SECRET_V3, etc.
 * - Dynamically includes all found versions
 * - Integrates seamlessly with existing CryptoKeyManager
 *
 * Error Handling:
 * - Missing required fields → throws error with missing key list
 * - File read / JSON parse errors → descriptive error message
 * - AWS network/permission errors → descriptive error message
 *
 * @returns {Promise<TomoriSecrets>} Object containing all application secrets
 * @throws {Error} If required secrets are missing or the secret backend fails
 *
 * @example
 * // In src/index.ts
 * const secrets = await getAppSecrets();
 * process.env.DISCORD_TOKEN = secrets.DISCORD_TOKEN;
 * process.env.POSTGRES_HOST = secrets.POSTGRES_HOST;
 */
export async function getAppSecrets(): Promise<TomoriSecrets> {
  const runEnv = process.env.RUN_ENV || "development";
  const isProduction = runEnv === "production";
  const isTestProduction = process.env.TEST_PRODUCTION === "true";

  // Development mode OR test production mode: Use process.env (loaded via dotenv)
  // TEST_PRODUCTION allows testing production behavior locally without AWS
  if (!isProduction || isTestProduction) {
    log.info(`Loading secrets from .env (${isTestProduction ? "test production" : "development"} mode)`);

    const secrets: TomoriSecrets = {
      DISCORD_TOKEN: process.env.DISCORD_TOKEN || "",
      POSTGRES_HOST: process.env.POSTGRES_HOST || "",
      POSTGRES_PORT: process.env.POSTGRES_PORT || "",
      POSTGRES_USER: process.env.POSTGRES_USER || "",
      POSTGRES_PASSWORD: process.env.POSTGRES_PASSWORD || "",
      POSTGRES_DB: process.env.POSTGRES_DB || "",
      CRYPTO_SECRET: process.env.CRYPTO_SECRET || "",
    };

    // Auto-detect key versions (CRYPTO_SECRET_V1, V2, V3, etc.)
    for (const key of Object.keys(process.env)) {
      if ((/^CRYPTO_SECRET_V[1-9]\d*$/.test(key) || key === "CRYPTO_SECRET_CURRENT") && process.env[key]) {
        secrets[key] = process.env[key];
      }
    }

    // Optional fields: read from process.env matching the same keys as the JSON secret blob
    const optionalEnvFields: (keyof TomoriSecrets)[] = [
      "DISCORD_WEBHOOK_URL",
      "AVATAR_GCS_BUCKET",
      "AVATAR_PUBLIC_BASE_URL",
      "VOICE_SAMPLE_GCS_BUCKET",
      "VOICE_SAMPLE_GCS_PREFIX",
      "VOICE_SAMPLE_PUBLIC_BASE_URL",
      "AWS_ACCESS_KEY_ID",
      "AWS_SECRET_ACCESS_KEY",
      "S3_ENDPOINT",
      "AVATAR_S3_BUCKET",
      "AVATAR_S3_REGION",
      "AVATAR_S3_PREFIX",
      "VOICE_SAMPLE_S3_BUCKET",
      "VOICE_SAMPLE_S3_REGION",
      "VOICE_SAMPLE_S3_PREFIX",
      "CHARREF_S3_BUCKET",
      "CHARREF_S3_REGION",
      "CHARREF_S3_PREFIX",
      "CHARREF_PUBLIC_BASE_URL",
      "MATRIX_HOMESERVER_URL",
      "MATRIX_ACCESS_TOKEN",
      "MATRIX_BOT_USER_ID",
      "MATRIX_SERVER_NAME",
      "MATRIX_HS_TOKEN",
      "MATRIX_APPSERVICE_PUBLIC_URL",
      "TOPGG_TOKEN",
      "CONTAINER_MEMORY_LIMIT_MB",
    ];

    for (const field of optionalEnvFields) {
      if (process.env[field]) {
        secrets[field] = process.env[field];
      }
    }

    validateRequiredSecrets(secrets);

    return secrets;
  }

  // Production + mounted JSON secret file: SECRET_FILE is provider-neutral;
  // GCP_SECRET_FILE remains a fallback so the live Cloud Run deployment is unchanged.
  const secretFile = process.env.SECRET_FILE?.trim() || process.env.GCP_SECRET_FILE?.trim();
  if (secretFile) {
    log.info(`Reading secrets from mounted JSON secret file: ${secretFile}`);
    try {
      // Read and parse the JSON blob written by the platform secret mount
      const fileContent = await Bun.file(secretFile).text();
      if (!fileContent) {
        throw new Error(`Secret file "${secretFile}" is empty. Ensure the secret version is populated.`);
      }

      const rawSecrets = parseSecretObject(fileContent);

      const secrets: TomoriSecrets = {
        DISCORD_TOKEN: rawSecrets.DISCORD_TOKEN,
        POSTGRES_HOST: rawSecrets.POSTGRES_HOST,
        POSTGRES_PORT: rawSecrets.POSTGRES_PORT,
        POSTGRES_USER: rawSecrets.POSTGRES_USER,
        POSTGRES_PASSWORD: rawSecrets.POSTGRES_PASSWORD,
        POSTGRES_DB: rawSecrets.POSTGRES_DB,
        CRYPTO_SECRET: rawSecrets.CRYPTO_SECRET,
      };

      // Auto-detect key versions (CRYPTO_SECRET_V1, V2, V3, etc.)
      for (const key of Object.keys(rawSecrets)) {
        if (/^CRYPTO_SECRET_V[1-9]\d*$/.test(key) || key === "CRYPTO_SECRET_CURRENT") {
          secrets[key] = rawSecrets[key];
          log.info(`Detected key version: ${key}`);
        }
      }

      // Optional fields: same shape as AWS secret blob
      const optionalFields: (keyof TomoriSecrets)[] = [
        "DISCORD_WEBHOOK_URL",
        "AVATAR_GCS_BUCKET",
        "AVATAR_PUBLIC_BASE_URL",
        "VOICE_SAMPLE_GCS_BUCKET",
        "VOICE_SAMPLE_GCS_PREFIX",
        "VOICE_SAMPLE_PUBLIC_BASE_URL",
        "AWS_ACCESS_KEY_ID",
        "AWS_SECRET_ACCESS_KEY",
        "S3_ENDPOINT",
        "AVATAR_S3_BUCKET",
        "AVATAR_S3_REGION",
        "AVATAR_S3_PREFIX",
        "VOICE_SAMPLE_S3_BUCKET",
        "VOICE_SAMPLE_S3_REGION",
        "VOICE_SAMPLE_S3_PREFIX",
        "CHARREF_S3_BUCKET",
        "CHARREF_S3_REGION",
        "CHARREF_S3_PREFIX",
        "CHARREF_PUBLIC_BASE_URL",
        "MATRIX_HOMESERVER_URL",
        "MATRIX_ACCESS_TOKEN",
        "MATRIX_BOT_USER_ID",
        "MATRIX_SERVER_NAME",
        "MATRIX_HS_TOKEN",
        "MATRIX_APPSERVICE_PUBLIC_URL",
        "TOPGG_TOKEN",
        "CONTAINER_MEMORY_LIMIT_MB",
      ];

      for (const field of optionalFields) {
        if (rawSecrets[field]) {
          secrets[field] = rawSecrets[field];
        }
      }

      validateRequiredSecrets(secrets);

      log.info("Successfully loaded secrets from mounted JSON secret file");

      return secrets;
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(
          `Secret file "${secretFile}" contains invalid JSON. Re-populate the secret with a valid JSON object.`,
        );
      }

      log.error(
        "Failed to read secrets from mounted JSON secret file",
        error instanceof Error ? error : new Error(String(error)),
      );

      throw error;
    }
  }

  // Production mode: Fetch from AWS Secrets Manager
  const awsRegion = process.env.AWS_REGION || "us-east-1";
  log.info(`Fetching secrets from AWS Secrets Manager (production mode, region: ${awsRegion})`);

  try {
    const client = new SecretsManagerClient({ region: awsRegion });

    const command = new GetSecretValueCommand({
      SecretId: "tomoribot/production",
    });

    const response = await client.send(command);

    if (!response.SecretString) {
      throw new Error("AWS Secrets Manager returned empty SecretString. Ensure the secret contains a JSON object.");
    }

    const rawSecrets = parseSecretObject(response.SecretString);

    const secrets: TomoriSecrets = {
      DISCORD_TOKEN: rawSecrets.DISCORD_TOKEN,
      POSTGRES_HOST: rawSecrets.POSTGRES_HOST,
      POSTGRES_PORT: rawSecrets.POSTGRES_PORT,
      POSTGRES_USER: rawSecrets.POSTGRES_USER,
      POSTGRES_PASSWORD: rawSecrets.POSTGRES_PASSWORD,
      POSTGRES_DB: rawSecrets.POSTGRES_DB,
      CRYPTO_SECRET: rawSecrets.CRYPTO_SECRET,
    };

    // Auto-detect key versions (CRYPTO_SECRET_V1, V2, V3, etc.)
    // This allows for unlimited key rotation versions
    for (const key of Object.keys(rawSecrets)) {
      if (/^CRYPTO_SECRET_V[1-9]\d*$/.test(key) || key === "CRYPTO_SECRET_CURRENT") {
        secrets[key] = rawSecrets[key];
        log.info(`Detected key version: ${key}`);
      }
    }

    const optionalFields: (keyof TomoriSecrets)[] = [
      "DISCORD_WEBHOOK_URL",
      "AVATAR_GCS_BUCKET",
      "AVATAR_PUBLIC_BASE_URL",
      "VOICE_SAMPLE_GCS_BUCKET",
      "VOICE_SAMPLE_GCS_PREFIX",
      "VOICE_SAMPLE_PUBLIC_BASE_URL",
      "AWS_ACCESS_KEY_ID",
      "AWS_SECRET_ACCESS_KEY",
      "S3_ENDPOINT",
      "AVATAR_S3_BUCKET",
      "AVATAR_S3_REGION",
      "AVATAR_S3_PREFIX",
      "VOICE_SAMPLE_S3_BUCKET",
      "VOICE_SAMPLE_S3_REGION",
      "VOICE_SAMPLE_S3_PREFIX",
      "CHARREF_S3_BUCKET",
      "CHARREF_S3_REGION",
      "CHARREF_S3_PREFIX",
      "CHARREF_PUBLIC_BASE_URL",
      "MATRIX_HOMESERVER_URL",
      "MATRIX_ACCESS_TOKEN",
      "MATRIX_BOT_USER_ID",
      "MATRIX_SERVER_NAME",
      "MATRIX_HS_TOKEN",
      "MATRIX_APPSERVICE_PUBLIC_URL",
      "TOPGG_TOKEN",
      "CONTAINER_MEMORY_LIMIT_MB",
    ];

    for (const field of optionalFields) {
      if (rawSecrets[field]) {
        secrets[field] = rawSecrets[field];
      }
    }

    validateRequiredSecrets(secrets);

    log.info("Successfully loaded secrets from AWS Secrets Manager");

    return secrets;
  } catch (error) {
    // Enhance error message for common AWS errors
    if (error instanceof Error) {
      if (error.name === "ResourceNotFoundException") {
        throw new Error(
          `AWS Secrets Manager: Secret "tomoribot/production" not found in ${awsRegion}. ` +
            `Please create the secret in AWS Secrets Manager console.`,
        );
      }

      if (error.name === "AccessDeniedException") {
        throw new Error(
          `AWS Secrets Manager: Access denied to "tomoribot/production". ` +
            `Ensure your IAM user/role has secretsmanager:GetSecretValue permission.`,
        );
      }

      if (error.message.includes("getaddrinfo ENOTFOUND")) {
        throw new Error(
          `AWS Secrets Manager: Network error. ` +
            `Ensure your system has internet connectivity and can reach AWS services.`,
        );
      }
    }

    log.error(
      "Failed to fetch secrets from AWS Secrets Manager",
      error instanceof Error ? error : new Error(String(error)),
    );

    throw error;
  }
}

/**
 * Validates that all required secrets are present and non-empty.
 *
 * Required Fields:
 * - DISCORD_TOKEN (Discord bot authentication)
 * - POSTGRES_HOST (Database connection)
 * - POSTGRES_PORT (Database port)
 * - POSTGRES_USER (Database user)
 * - POSTGRES_PASSWORD (Database password)
 * - POSTGRES_DB (Database name)
 * - CRYPTO_SECRET or a versioned field (encryption key for database-stored credentials)
 *
 * @param {TomoriSecrets} secrets - Secrets object to validate
 * @throws {Error} If any required secret is missing or empty
 */
function validateRequiredSecrets(secrets: TomoriSecrets): void {
  const requiredFields: (keyof TomoriSecrets)[] = [
    "DISCORD_TOKEN",
    "POSTGRES_HOST",
    "POSTGRES_PORT",
    "POSTGRES_USER",
    "POSTGRES_PASSWORD",
    "POSTGRES_DB",
  ];

  const missingFields = requiredFields.filter((field) => !secrets[field] || secrets[field] === "");

  if (
    !secrets.CRYPTO_SECRET &&
    !Object.entries(secrets).some(
      ([name, value]) =>
        /^CRYPTO_SECRET_V[1-9]\d*$/.test(name) && Number.isSafeInteger(Number(name.slice(15))) && value,
    )
  ) {
    missingFields.push("CRYPTO_SECRET or CRYPTO_SECRET_V<version>");
  }

  if (missingFields.length > 0) {
    throw new Error(
      `Missing required secrets: ${missingFields.join(", ")}. ` +
        `Ensure all required fields are present in AWS Secrets Manager (production) or .env (development).`,
    );
  }
}

/** Scalar config values retain their environment form, but master keys must be strings. */
function parseSecretObject(content: string): Record<string, string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("Secret source contains invalid JSON.");
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed) ||
    Object.values(parsed).some((value) => !["string", "number", "boolean"].includes(typeof value))
  ) {
    throw new Error("Secret source must be a flat JSON object containing scalar values.");
  }
  const fields: Record<string, string> = {};
  for (const [name, value] of Object.entries(parsed)) {
    if ((name === "CRYPTO_SECRET" || name.startsWith("CRYPTO_SECRET_V")) && typeof value !== "string") {
      throw new Error("Encryption secret fields must contain string values.");
    }
    if (name === "CRYPTO_SECRET_CURRENT" && typeof value === "number" && (!Number.isSafeInteger(value) || value < 1)) {
      throw new Error("CRYPTO_SECRET_CURRENT must be a positive integer version.");
    }
    fields[name] = String(value);
  }
  return fields;
}
