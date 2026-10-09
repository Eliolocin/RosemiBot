import { config } from "dotenv";
import { resolveEnvironment } from "@/types/config";
import { loadSecrets } from "@/init/secrets";
import { keyManager } from "@/utils/security/keyManager";

/** Scripts select the same mounted JSON, AWS, or development secrets as bot startup. */
export async function loadInitializedKeyManager(): Promise<typeof keyManager> {
  config({ path: process.env.TOMORI_ENV_FILE || ".env", quiet: true });
  await loadSecrets(resolveEnvironment());
  return keyManager;
}
