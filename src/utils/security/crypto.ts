import { log } from "../misc/logger";
import { sql } from "@/utils/db/client";
import { lazyRotateEncryptedRow } from "./encryptedColumns";
import { keyManager } from "./keyManager";
import type { ErrorContext } from "@/types/db/schema";
/**
 * Encrypts an API key before storing it in the database using pgcrypto's PGP symmetric encryption.
 *
 * @param apiKey - The raw API key to encrypt
 */
export const encryptApiKey = async (apiKey: string): Promise<{ encrypted: Buffer; version: number }> => {
  if (!apiKey) {
    log.warn("Empty API key provided for encryption");
    return {
      encrypted: Buffer.from(""),
      version: keyManager.getCurrentVersion(),
    };
  }

  try {
    const currentKey = keyManager.getCurrentKey();
    const currentVersion = keyManager.getCurrentVersion();

    // Use PostgreSQL's pgp_sym_encrypt function with armor option to encrypt the API key
    // Note: The bytea output is directly compatible with Buffer
    const [result] = await sql`
      SELECT pgp_sym_encrypt(
        ${apiKey.trim()},
        ${currentKey},
        'compress-algo=1, cipher-algo=aes256'
      ) AS encrypted_key
    `;

    if (!result?.encrypted_key) {
      throw new Error("Encryption failed");
    }

    log.success(`API key encrypted successfully with version ${currentVersion}`);

    return {
      encrypted: result.encrypted_key,
      version: currentVersion,
    };
  } catch (error) {
    log.error("Failed to encrypt API key", error);
    throw new Error("API key encryption failed");
  }
};

/**
 * Decrypts an API key retrieved from the database using pgcrypto's PGP symmetric decryption.
 *
 * @param keyVersion - The version of the key used to encrypt (defaults to 1 for backward compatibility)
 */
export const decryptApiKey = async (
  encryptedKey: Buffer,
  keyVersion: number = 1,
  failureContext?: ErrorContext,
): Promise<string> => {
  if (!encryptedKey || encryptedKey.length === 0) {
    log.warn("Empty encrypted key provided for decryption");
    return "";
  }

  try {
    const key = keyManager.getKey(keyVersion);

    // Use PostgreSQL's pgp_sym_decrypt function to decrypt the API key
    // No need for typecasting to bytea since encryptedKey is already a Buffer
    const [result] = await sql`
      SELECT pgp_sym_decrypt(${encryptedKey}, ${key}) AS decrypted_key
    `;

    if (!result?.decrypted_key) {
      throw new Error("Decryption failed");
    }

    return result.decrypted_key.toString();
  } catch (error) {
    if (failureContext) {
      await log.error("Credential decryption failed", new Error("Credential decryption failed"), failureContext);
    } else
      log.error(
        `Failed to decrypt API key with version ${keyVersion}. ` +
          `Available versions: ${keyManager.getAvailableVersions().join(", ")}. ` +
          `Run 'bun run audit-keys' to diagnose.`,
        error,
      );
    throw new Error("API key decryption failed");
  }
};

/**
 * Store an encrypted optional API key in the database
 * @param serviceName - Name of the service (e.g., 'brave-search', 'duckduckgo-search')
 * @param apiKey - The raw API key to encrypt and store
 */
export const storeOptApiKey = async (serverId: number, serviceName: string, apiKey: string): Promise<boolean> => {
  if (!apiKey || !serviceName || !serverId) {
    log.warn("Missing required parameters for optional API key storage");
    return false;
  }

  try {
    log.info(`Storing encrypted optional API key for server ${serverId}, service: ${serviceName}`);

    // Encrypt the API key using the current key version
    const { encrypted, version } = await encryptApiKey(apiKey);

    await sql`
			INSERT INTO opt_api_keys (server_id, service_name, api_key, key_version)
			VALUES (${serverId}, ${serviceName}, ${encrypted}, ${version})
			ON CONFLICT (server_id, service_name)
			DO UPDATE SET
				api_key = EXCLUDED.api_key,
				key_version = EXCLUDED.key_version,
				updated_at = CURRENT_TIMESTAMP
		`;

    log.success(`Optional API key stored with version ${version} for ${serviceName} on server ${serverId}`);
    return true;
  } catch (error) {
    log.error(`Failed to store optional API key for ${serviceName}`, error as Error);
    return false;
  }
};

/**
 * Retrieve and decrypt an optional API key from the database
 * Automatically performs lazy rotation if the key is encrypted with an old version
 *
 */
export const getOptApiKey = async (serverId: number, serviceName: string): Promise<string | null> => {
  if (!serviceName || !serverId) {
    log.warn("Missing required parameters for optional API key retrieval");
    return null;
  }

  try {
    log.info(`Retrieving optional API key for server ${serverId}, service: ${serviceName}`);

    const [result] = await sql`
			SELECT opt_api_key_id, api_key, key_version
			FROM opt_api_keys
			WHERE server_id = ${serverId} AND service_name = ${serviceName}
		`;

    if (!result?.api_key) {
      log.info(`No optional API key found for ${serviceName} on server ${serverId}`);
      return null;
    }

    // Default to V1 for backward compatibility (NULL values from before versioning)
    const decryptedKey = await decryptApiKey(result.api_key, result.key_version || 1);
    await lazyRotateEncryptedRow(sql, "opt_api_keys", {
      id: result.opt_api_key_id,
      ciphertext: result.api_key,
      key_version: result.key_version,
    });

    return decryptedKey;
  } catch (error) {
    log.error(`Failed to retrieve optional API key for ${serviceName}`, error as Error);
    return null;
  }
};

/**
 * Delete an optional API key from the database
 */
export const deleteOptApiKey = async (serverId: number, serviceName: string): Promise<boolean> => {
  if (!serviceName || !serverId) {
    log.warn("Missing required parameters for optional API key deletion");
    return false;
  }

  try {
    log.info(`Deleting optional API key for server ${serverId}, service: ${serviceName}`);

    await sql`
			DELETE FROM opt_api_keys
			WHERE server_id = ${serverId} AND service_name = ${serviceName}
		`;

    log.success(`Optional API key deleted successfully for ${serviceName} on server ${serverId}`);
    return true;
  } catch (error) {
    log.error(`Failed to delete optional API key for ${serviceName}`, error as Error);
    return false;
  }
};

/**
 * Check if an optional API key exists for a server
 */
export const hasOptApiKey = async (serverId: number, serviceName: string): Promise<boolean> => {
  if (!serviceName || !serverId) {
    return false;
  }

  try {
    const [result] = await sql`
			SELECT 1
			FROM opt_api_keys
			WHERE server_id = ${serverId} AND service_name = ${serviceName}
		`;

    return !!result;
  } catch (error) {
    log.error(`Failed to check optional API key existence for ${serviceName}`, error as Error);
    return false;
  }
};
