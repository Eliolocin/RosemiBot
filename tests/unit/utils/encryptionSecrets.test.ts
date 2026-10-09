import { afterEach, describe, expect, it, spyOn } from "bun:test";
import {
  type GetSecretValueCommand,
  type GetSecretValueCommandOutput,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSecrets } from "@/init/secrets";
import { log } from "@/utils/misc/logger";
import { isGeneratedLengthKey, keyManager, MIN_GENERATED_KEY_LENGTH } from "@/utils/security/keyManager";

const initialEnv = { ...process.env };
const directories: string[] = [];
const secrets = {
  DISCORD_TOKEN: "synthetic_discord_token",
  POSTGRES_HOST: "localhost",
  POSTGRES_PORT: "5432",
  POSTGRES_USER: "synthetic",
  POSTGRES_PASSWORD: "synthetic_password",
  POSTGRES_DB: "synthetic",
  CRYPTO_SECRET_V2: "synthetic_v2",
  CRYPTO_SECRET_V4: "synthetic_v4",
  CRYPTO_SECRET_CURRENT: "2",
};

afterEach(() => {
  for (const name of Object.keys(process.env)) if (!(name in initialEnv)) delete process.env[name];
  Object.assign(process.env, initialEnv);
  if (Object.keys(initialEnv).some((name) => /^CRYPTO_SECRET(?:_V[1-9]\d*)?$/.test(name))) keyManager.initialize();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("Encryption secret initialization", () => {
  it("loads arbitrary development versions, legacy V1, and explicit selection", async () => {
    Object.assign(process.env, secrets, {
      RUN_ENV: "development",
      CRYPTO_SECRET: "synthetic_legacy",
      CRYPTO_SECRET_V9: "synthetic_v9",
    });
    await loadSecrets("development");
    expect(keyManager.getAvailableVersions()).toEqual([1, 2, 4, 9]);
    expect(keyManager.getCurrentVersion()).toBe(2);
    expect(keyManager.getKey(1)).toBe("synthetic_legacy");
  });

  it("replaces ambient versions with authoritative mounted and AWS sources, including current selection", async () => {
    const directory = mkdtempSync(join(tmpdir(), "tomoribot-secrets-"));
    directories.push(directory);
    const path = join(directory, "secrets.json");
    writeFileSync(path, JSON.stringify({ ...secrets, CRYPTO_SECRET_CURRENT: 2 }));
    Object.assign(process.env, {
      RUN_ENV: "production",
      TEST_PRODUCTION: "false",
      SECRET_FILE: path,
      CRYPTO_SECRET_V9: "synthetic_ambient",
      CRYPTO_SECRET_CURRENT: "9",
    });
    await loadSecrets("production");
    expect(keyManager.getAvailableVersions()).toEqual([2, 4]);
    expect(keyManager.getCurrentVersion()).toBe(2);
    expect(process.env.CRYPTO_SECRET_V9).toBeUndefined();
    expect(process.env.CRYPTO_SECRET).toBeUndefined();
    delete process.env.SECRET_FILE;
    delete process.env.GCP_SECRET_FILE;
    Object.assign(process.env, { CRYPTO_SECRET_V9: "synthetic_ambient" });
    const sender: { send(command: GetSecretValueCommand): Promise<GetSecretValueCommandOutput> } =
      SecretsManagerClient.prototype;
    const send = spyOn(sender, "send").mockResolvedValue({
      SecretString: JSON.stringify({ ...secrets, CRYPTO_SECRET_CURRENT: 2 }),
      $metadata: {},
    });
    try {
      await loadSecrets("production");
      expect(keyManager.getAvailableVersions()).toEqual([2, 4]);
      expect(keyManager.getCurrentVersion()).toBe(2);
      expect(process.env.CRYPTO_SECRET_V9).toBeUndefined();
    } finally {
      send.mockRestore();
    }
  });

  it("warns about keys too short to be generated without naming their values, and still loads them", () => {
    for (const name of Object.keys(process.env)) if (name.startsWith("CRYPTO_SECRET")) delete process.env[name];
    Object.assign(process.env, {
      CRYPTO_SECRET_V1: "short_legacy_secret",
      CRYPTO_SECRET_V2: "g".repeat(MIN_GENERATED_KEY_LENGTH),
    });
    const warn = spyOn(log, "warn").mockImplementation(() => undefined);
    try {
      keyManager.initialize();
      const warnings = warn.mock.calls.map(([message]) => String(message));
      expect(warnings.filter((message) => message.includes("shorter than"))).toHaveLength(1);
      expect(warnings.some((message) => message.includes("V1") && !message.includes("V2"))).toBe(true);
      expect(warnings.some((message) => message.includes("short_legacy_secret"))).toBe(false);
      expect(keyManager.getKey(1)).toBe("short_legacy_secret");
      expect(isGeneratedLengthKey(keyManager.getCurrentKey())).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });

  it("rejects invalid or unavailable current selection and clears obsolete manager keys on reinitialization", () => {
    for (const name of Object.keys(process.env)) if (name.startsWith("CRYPTO_SECRET")) delete process.env[name];
    Object.assign(process.env, secrets);
    keyManager.initialize();
    delete process.env.CRYPTO_SECRET_V2;
    delete process.env.CRYPTO_SECRET_CURRENT;
    keyManager.initialize();
    expect(keyManager.getAvailableVersions()).toEqual([4]);
    expect(keyManager.getCurrentVersion()).toBe(4);
    for (const current of ["2junk", "0", "-1", "1.5", "9007199254740992", "2"]) {
      Object.assign(process.env, { CRYPTO_SECRET_CURRENT: current });
      expect(() => keyManager.initialize()).toThrow();
      expect(() => keyManager.getCurrentKey()).toThrow();
    }
  });

  it("refuses malformed mounted secret values without echoing their contents", async () => {
    const directory = mkdtempSync(join(tmpdir(), "tomoribot-secrets-"));
    directories.push(directory);
    const path = join(directory, "secrets.json");
    Object.assign(process.env, { RUN_ENV: "production", TEST_PRODUCTION: "false", SECRET_FILE: path });
    for (const value of [
      "{synthetic_secret_invalid_json",
      JSON.stringify({ ...secrets, CRYPTO_SECRET_V4: 42 }),
      ...[0, -1, 2.5, 9007199254740992, true].map((current) =>
        JSON.stringify({ ...secrets, CRYPTO_SECRET_CURRENT: current }),
      ),
    ]) {
      writeFileSync(path, value);
      await expect(loadSecrets("production")).rejects.toThrow();
    }
  });
});
