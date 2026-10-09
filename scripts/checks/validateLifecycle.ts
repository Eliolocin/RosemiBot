import type { SQL } from "bun";
import { config } from "dotenv";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { initializeDatabase } from "@/utils/db/initializeDatabase";
import { createScriptSqlClient } from "./lib/scriptSqlClient";

config({ quiet: true });

interface CountRow {
  count: number | string;
}

interface ExistsRow {
  exists: boolean;
}

interface TableNameRow {
  tablename: string;
}

interface SeedCheck {
  table: string;
  minimumRows: number;
}

const rootDir = process.cwd();
const validationRunId = `vl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const tempDatabaseName = `tomoribot_${validationRunId}`;
const validationRoot = join(rootDir, ".temp", "validate-lifecycle", validationRunId);
const backupRoot = join(validationRoot, "backups");
const envFilePath = join(validationRoot, ".env");
const keepArtifacts = process.env.TOMORI_VL_KEEP_ARTIFACTS === "true";

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log("Usage: bun run db:lifecycle");
  console.log("");
  console.log("Creates a disposable PostgreSQL database, runs schema/seed initialization,");
  console.log("smoke-tests DB maintenance scripts, runs nuke-db against the disposable DB,");
  console.log("then verifies the database can be initialized again from scratch.");
  console.log("");
  console.log("Required: POSTGRES_PASSWORD or DATABASE_URL/POSTGRES_URL.");
  process.exit(0);
}

const requiredTables = [
  "servers",
  "personas",

  "persona_configs",
  "llms",
  "image_diffusion_models",
  "video_generation_models",
  "embedding_models",
  "decision_models",
  "persona_presets",
  "system_prompt_presets",
  "users",
  "server_memories",
  "personal_memories",
  "saved_provider_configs",
  "user_saved_provider_configs",
  "custom_endpoint_connections",
  "custom_endpoints",
  "nai_presets",
  "st_presets",
  "st_preset_nodes",
] as const;

const seedChecks: SeedCheck[] = [
  { table: "llms", minimumRows: 1 },
  { table: "image_diffusion_models", minimumRows: 1 },
  { table: "video_generation_models", minimumRows: 1 },
  { table: "embedding_models", minimumRows: 1 },
  { table: "decision_models", minimumRows: 1 },
  { table: "persona_presets", minimumRows: 1 },
  { table: "system_prompt_presets", minimumRows: 1 },
  { table: "nai_presets", minimumRows: 1 },
];

const lifecycleCryptoSecret = process.env.CRYPTO_SECRET || "validation_crypto_secret";

/** A distinctive plaintext so a restore that returned seed defaults or a re-encrypted blob cannot match. */
const sentinelApiKey = "sk-lifecycle-sentinel-0123456789";
const sentinelServerDiscId = "lifecycle-server-1";
const sentinelUserDiscId = "lifecycle-user-1";

interface UserDataSnapshot {
  server: { server_disc_id: string };
  persona: { persona_nickname: string; attribute_list: string[]; persona_lineage_id: string };
  personaConfig: { trigger_words: string[]; persona_prompt: string | null };
  serverMemory: { content: string; tags: string[]; persona_lineage_id: string };
  personalMemory: { content: string; tags: string[]; persona_lineage_id: string };
  apiKey: { provider: string; key_version: number; plaintext: string };
  document: { document_name: string; text_content: string; chunk_content: string; embedding: string } | null;
}

function section(title: string): void {
  console.log(`\n=== ${title} ===`);
}

function getBaseDatabaseUrl(): URL {
  const explicitUrl = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (explicitUrl) {
    return new URL(explicitUrl);
  }

  const host = process.env.POSTGRES_HOST || "localhost";
  const port = process.env.POSTGRES_PORT || "5432";
  const user = process.env.POSTGRES_USER || "postgres";
  const password = process.env.POSTGRES_PASSWORD;
  const database = process.env.POSTGRES_DB || "tomodb";

  if (!password) {
    throw new Error("POSTGRES_PASSWORD, DATABASE_URL, or POSTGRES_URL is required for lifecycle validation.");
  }

  const url = new URL("postgresql://localhost");
  url.hostname = host;
  url.port = port;
  url.username = user;
  url.password = password;
  url.pathname = `/${database}`;
  return url;
}

function databaseUrlFor(baseUrl: URL, databaseName: string): string {
  const url = new URL(baseUrl.toString());
  url.pathname = `/${databaseName}`;
  return url.toString();
}

function requireSafeTarget(baseUrl: URL): void {
  if (process.env.TOMORI_VL_ALLOW_NONLOCAL_DB === "true") {
    return;
  }

  if (process.env.RUN_ENV === "production") {
    throw new Error("Refusing to run lifecycle validation with RUN_ENV=production.");
  }

  const host = baseUrl.hostname.toLowerCase();
  const allowedHosts = new Set(["localhost", "127.0.0.1", "::1", "postgres", "tomoribot-db", "host.docker.internal"]);
  if (!allowedHosts.has(host)) {
    throw new Error(
      `Refusing to create/drop validation database on non-local host "${host}". ` +
        "Set TOMORI_VL_ALLOW_NONLOCAL_DB=true only when you intentionally target a disposable database server.",
    );
  }
}

async function createValidationDatabase(adminSql: SQL): Promise<void> {
  await adminSql`DROP DATABASE IF EXISTS ${adminSql(tempDatabaseName)} WITH (FORCE)`;
  await adminSql`CREATE DATABASE ${adminSql(tempDatabaseName)}`;
}

async function dropValidationDatabase(adminSql: SQL): Promise<void> {
  await adminSql`
    SELECT pg_terminate_backend(pid)
    FROM pg_stat_activity
    WHERE datname = ${tempDatabaseName}
      AND pid <> pg_backend_pid()
  `;
  await adminSql`DROP DATABASE IF EXISTS ${adminSql(tempDatabaseName)} WITH (FORCE)`;
}

async function assertRequiredTablesExist(client: SQL): Promise<void> {
  const missingTables: string[] = [];

  for (const table of requiredTables) {
    const [row] = await client<ExistsRow[]>`
      SELECT to_regclass(${`public.${table}`}) IS NOT NULL AS exists
    `;
    if (!row?.exists) {
      missingTables.push(table);
    }
  }

  if (missingTables.length > 0) {
    throw new Error(`Fresh database is missing required table(s): ${missingTables.join(", ")}`);
  }
}

async function assertSeedDataExists(client: SQL): Promise<void> {
  for (const check of seedChecks) {
    const [row] = await client<CountRow[]>`SELECT COUNT(*) AS count FROM ${client(check.table)}`;
    const count = Number(row?.count ?? 0);
    if (count < check.minimumRows) {
      throw new Error(`${check.table} expected at least ${check.minimumRows} seeded row(s), found ${count}.`);
    }
  }
}

async function hasRagSchema(client: SQL): Promise<boolean> {
  const [row] = await client<ExistsRow[]>`SELECT to_regclass('public.documents') IS NOT NULL AS exists`;
  return Boolean(row?.exists);
}

/**
 * Inserts one representative row per user-owned domain so a restore has something to lose.
 * The credential is encrypted with pgcrypto directly because `encryptApiKey` is bound to the
 * app's global client, which points at the real database rather than the disposable one.
 */
async function seedUserData(client: SQL): Promise<void> {
  const [server] = await client<{ server_id: number }[]>`
    INSERT INTO servers (server_disc_id) VALUES (${sentinelServerDiscId}) RETURNING server_id
  `;
  const [user] = await client<{ user_id: number }[]>`
    INSERT INTO users (user_disc_id) VALUES (${sentinelUserDiscId}) RETURNING user_id
  `;
  const [persona] = await client<{ persona_id: number; persona_lineage_id: string }[]>`
    INSERT INTO personas (server_id, persona_nickname, attribute_list)
    VALUES (${server.server_id}, 'Lifecycle Persona', ARRAY['likes backups', 'distrusts restores']::TEXT[])
    RETURNING persona_id, persona_lineage_id::TEXT AS persona_lineage_id
  `;
  await client`
    INSERT INTO persona_configs (persona_id, trigger_words, persona_prompt)
    VALUES (${persona.persona_id}, ARRAY['lifecycle', 'restore']::TEXT[], 'Lifecycle prompt')
    ON CONFLICT (persona_id) DO UPDATE
    SET trigger_words = EXCLUDED.trigger_words, persona_prompt = EXCLUDED.persona_prompt
  `;
  await client`
    INSERT INTO server_memories (server_id, persona_id, persona_lineage_id, user_id, content, tags)
    VALUES (
      ${server.server_id}, ${persona.persona_id}, ${persona.persona_lineage_id}::BIGINT, ${user.user_id},
      'Server memory survives restore', ARRAY['server', 'lifecycle']::TEXT[]
    )
  `;
  await client`
    INSERT INTO personal_memories (user_id, persona_lineage_id, content, tags)
    VALUES (
      ${user.user_id}, ${persona.persona_lineage_id}::BIGINT,
      'Personal memory survives restore', ARRAY['personal', 'lifecycle']::TEXT[]
    )
  `;
  await client`
    INSERT INTO saved_provider_configs (server_id, provider, api_key, key_version)
    VALUES (
      ${server.server_id}, 'lifecycle-provider',
      pgp_sym_encrypt(${sentinelApiKey}::TEXT, ${lifecycleCryptoSecret}::TEXT, 'compress-algo=1, cipher-algo=aes256'),
      1
    )
  `;

  if (!(await hasRagSchema(client))) {
    return;
  }

  const [embeddingModel] = await client<{ embedding_model_id: number; embedding_family: string }[]>`
    SELECT embedding_model_id, model_family AS embedding_family
    FROM embedding_models
    ORDER BY embedding_model_id
    LIMIT 1
  `;
  const [document] = await client<{ document_id: number }[]>`
    INSERT INTO documents (server_id, persona_id, uploader_user_id, document_name, text_content)
    VALUES (
      ${server.server_id}, ${persona.persona_id}, ${user.user_id},
      'lifecycle-doc', 'Document text survives restore'
    )
    RETURNING document_id
  `;
  await client`
    INSERT INTO document_chunks (document_id, server_id, embedding_model_id, embedding_family, chunk_index, content, embedding)
    VALUES (
      ${document.document_id}, ${server.server_id}, ${embeddingModel.embedding_model_id},
      ${embeddingModel.embedding_family}, 0, 'Chunk text survives restore', '[0.25,0.5,0.75]'::VECTOR
    )
  `;
}

/** Reads the seeded rows back as plain values, throwing if any of them is missing. */
async function readUserData(client: SQL): Promise<UserDataSnapshot> {
  const [server] = await client<UserDataSnapshot["server"][]>`
    SELECT server_disc_id FROM servers WHERE server_disc_id = ${sentinelServerDiscId}
  `;
  const [persona] = await client<UserDataSnapshot["persona"][]>`
    SELECT p.persona_nickname, p.attribute_list, p.persona_lineage_id::TEXT AS persona_lineage_id
    FROM personas p JOIN servers s ON s.server_id = p.server_id
    WHERE s.server_disc_id = ${sentinelServerDiscId}
  `;
  const [personaConfig] = await client<UserDataSnapshot["personaConfig"][]>`
    SELECT pc.trigger_words, pc.persona_prompt
    FROM persona_configs pc
    JOIN personas p ON p.persona_id = pc.persona_id
    JOIN servers s ON s.server_id = p.server_id
    WHERE s.server_disc_id = ${sentinelServerDiscId}
  `;
  const [serverMemory] = await client<UserDataSnapshot["serverMemory"][]>`
    SELECT sm.content, sm.tags, sm.persona_lineage_id::TEXT AS persona_lineage_id
    FROM server_memories sm JOIN servers s ON s.server_id = sm.server_id
    WHERE s.server_disc_id = ${sentinelServerDiscId}
  `;
  const [personalMemory] = await client<UserDataSnapshot["personalMemory"][]>`
    SELECT pm.content, pm.tags, pm.persona_lineage_id::TEXT AS persona_lineage_id
    FROM personal_memories pm JOIN users u ON u.user_id = pm.user_id
    WHERE u.user_disc_id = ${sentinelUserDiscId}
  `;
  const [apiKey] = await client<UserDataSnapshot["apiKey"][]>`
    SELECT spc.provider, spc.key_version,
           pgp_sym_decrypt(spc.api_key, ${lifecycleCryptoSecret}::TEXT) AS plaintext
    FROM saved_provider_configs spc JOIN servers s ON s.server_id = spc.server_id
    WHERE s.server_disc_id = ${sentinelServerDiscId}
  `;

  let document: UserDataSnapshot["document"] = null;
  if (await hasRagSchema(client)) {
    [document] = await client<NonNullable<UserDataSnapshot["document"]>[]>`
      SELECT d.document_name, d.text_content, dc.content AS chunk_content, dc.embedding::TEXT AS embedding
      FROM documents d
      JOIN document_chunks dc ON dc.document_id = d.document_id
      JOIN servers s ON s.server_id = d.server_id
      WHERE s.server_disc_id = ${sentinelServerDiscId}
    `;
  }

  const rows = { server, persona, personaConfig, serverMemory, personalMemory, apiKey };
  for (const [name, row] of Object.entries(rows)) {
    if (!row) {
      throw new Error(`Seeded user data is missing its ${name} row.`);
    }
  }

  return { ...rows, document: document ?? null };
}

async function assertUserDataSurvivedRestore(client: SQL, before: UserDataSnapshot): Promise<void> {
  const after = await readUserData(client);

  if (before.document && !after.document) {
    throw new Error("Restore dropped the RAG document or its chunk.");
  }
  if (after.apiKey.plaintext !== sentinelApiKey) {
    throw new Error("Restored API credential did not decrypt to the original plaintext.");
  }

  const differing = (Object.keys(before) as (keyof UserDataSnapshot)[]).filter(
    (key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]),
  );
  if (differing.length > 0) {
    throw new Error(`User data changed across backup and restore: ${differing.join(", ")}.`);
  }
}

async function assertStartupFunctionsExist(client: SQL): Promise<void> {
  const [cleanupFunction] = await client<ExistsRow[]>`
    SELECT to_regprocedure('cleanup_expired_cooldowns()') IS NOT NULL AS exists
  `;

  if (!cleanupFunction?.exists) {
    throw new Error("Missing cleanup_expired_cooldowns() startup function.");
  }
}

async function assertNoPublicTablesRemain(client: SQL): Promise<void> {
  const tables = await client<TableNameRow[]>`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY tablename
  `;

  if (tables.length > 0) {
    throw new Error(`nuke-db left public table(s) behind: ${tables.map((row) => row.tablename).join(", ")}`);
  }
}

function writeValidationEnv(databaseUrl: string, baseUrl: URL): void {
  const postgresUser = decodeURIComponent(baseUrl.username || "postgres");
  const postgresPassword = decodeURIComponent(baseUrl.password || "");
  const postgresHost = baseUrl.hostname || "localhost";
  const postgresPort = baseUrl.port || "5432";
  writeFileSync(
    envFilePath,
    [
      `DATABASE_URL=${databaseUrl}`,
      `POSTGRES_HOST=${postgresHost}`,
      `POSTGRES_PORT=${postgresPort}`,
      `POSTGRES_USER=${postgresUser}`,
      `POSTGRES_PASSWORD=${postgresPassword}`,
      `POSTGRES_DB=${tempDatabaseName}`,
      `CRYPTO_SECRET=${lifecycleCryptoSecret}`,
      "RUN_ENV=development",
      "",
    ].join("\n"),
  );
}

function buildCommandEnv(databaseUrl: string, baseUrl: URL): Record<string, string | undefined> {
  return {
    ...process.env,
    DATABASE_URL: databaseUrl,
    POSTGRES_HOST: baseUrl.hostname || "localhost",
    POSTGRES_PORT: baseUrl.port || "5432",
    POSTGRES_USER: decodeURIComponent(baseUrl.username || "postgres"),
    POSTGRES_PASSWORD: decodeURIComponent(baseUrl.password || ""),
    POSTGRES_DB: tempDatabaseName,
    POSTGRES_MAINTENANCE_DB: process.env.POSTGRES_MAINTENANCE_DB || "postgres",
    CRYPTO_SECRET: lifecycleCryptoSecret,
    RUN_ENV: "development",
    TOMORI_BACKUP_DIR: backupRoot,
    TOMORI_ENV_FILE: envFilePath,
    TOMORI_NUKE_CONFIRM: "NUKE DATABASE",
    TOMORI_RESTORE_CONFIRM: "RESTORE",
  };
}

async function runCommand(name: string, command: string[], env: Record<string, string | undefined>): Promise<void> {
  console.log(`\n$ ${command.join(" ")}`);
  const subprocess = Bun.spawn(command, {
    cwd: rootDir,
    env,
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
  });

  const exitCode = await subprocess.exited;
  if (exitCode !== 0) {
    throw new Error(`${name} failed with exit code ${exitCode}.`);
  }
}

function assertBackupBundleCreated(): string {
  if (!existsSync(backupRoot)) {
    throw new Error(`Backup root was not created: ${backupRoot}`);
  }

  const bundleNames = readdirSync(backupRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("backup_"))
    .map((entry) => entry.name)
    .sort();

  if (bundleNames.length !== 1) {
    throw new Error(`Expected exactly one transfer backup bundle, found ${bundleNames.length}.`);
  }

  const bundleDir = join(backupRoot, bundleNames[0]);
  for (const filename of ["database.sql", "bundle_info.json"]) {
    const filePath = join(bundleDir, filename);
    if (!existsSync(filePath)) {
      throw new Error(`Backup bundle is missing ${filename}.`);
    }
  }
  // A bundle holding both the ciphertext dump and the master keys defeats credential encryption.
  if (existsSync(join(bundleDir, "config.env"))) {
    throw new Error("Backup bundle contains config.env; bundles must stay database-only.");
  }

  const manifest = JSON.parse(readFileSync(join(bundleDir, "bundle_info.json"), "utf-8")) as {
    contents?: string;
    files?: string[];
  };
  if (manifest.contents !== "database-only" || !manifest.files?.includes("database.sql")) {
    throw new Error("Backup manifest does not describe a database-only bundle listing database.sql.");
  }

  return bundleDir;
}

async function validateFreshInitialization(client: SQL): Promise<void> {
  await initializeDatabase({ client, maxRetries: 1, delayMs: 0 });
  await initializeDatabase({ client, maxRetries: 1, delayMs: 0 });
  await assertRequiredTablesExist(client);
  await assertSeedDataExists(client);
  await assertStartupFunctionsExist(client);
}

async function main(): Promise<void> {
  const baseUrl = getBaseDatabaseUrl();
  requireSafeTarget(baseUrl);

  mkdirSync(validationRoot, { recursive: true });

  const maintenanceDatabase = process.env.POSTGRES_MAINTENANCE_DB || "postgres";
  const adminUrl = databaseUrlFor(baseUrl, maintenanceDatabase);
  const validationUrl = databaseUrlFor(baseUrl, tempDatabaseName);
  const adminSql = createScriptSqlClient(adminUrl);
  let appSql: SQL | null = null;

  try {
    section("Creating Disposable Database");
    console.log(`Database: ${tempDatabaseName}`);
    await createValidationDatabase(adminSql);
    writeValidationEnv(validationUrl, baseUrl);

    section("Validating Fresh Initialization");
    appSql = createScriptSqlClient(validationUrl);
    await validateFreshInitialization(appSql);

    const commandEnv = buildCommandEnv(validationUrl, baseUrl);

    section("Seeding User Data");
    await seedUserData(appSql);
    const userDataBeforeBackup = await readUserData(appSql);
    if (!userDataBeforeBackup.document) {
      // CI's service image ships pgvector, so a missing RAG schema there means the vector path went unchecked.
      if (process.env.CI === "true") {
        throw new Error("CI must provide pgvector so the RAG document round trip is verified.");
      }
      console.log("pgvector is not installed here, so the RAG document round trip is skipped.");
    }

    section("Validating Maintenance Scripts");
    await runCommand("bun run backup", ["bun", "run", "backup"], commandEnv);
    const backupBundleDir = assertBackupBundleCreated();
    await runCommand("bun run backup:personas", ["bun", "run", "backup:personas"], commandEnv);
    await runCommand("bun run audit-keys", ["bun", "run", "audit-keys"], commandEnv);
    await runCommand("bun run rotate-keys --dry-run", ["bun", "run", "rotate-keys", "--dry-run"], commandEnv);

    section("Validating Nuke And Reinitialize");
    await appSql.close({ timeout: 1 });
    appSql = null;
    await runCommand("bun run nuke-db --yes", ["bun", "run", "nuke-db", "--yes"], commandEnv);
    appSql = createScriptSqlClient(validationUrl);
    await assertNoPublicTablesRemain(appSql);
    await appSql.close({ timeout: 1 });
    appSql = null;

    section("Validating Backup Restore");
    await runCommand(
      "bun run restore-backup --from",
      ["bun", "run", "restore-backup", "--from", backupBundleDir],
      commandEnv,
    );
    appSql = createScriptSqlClient(validationUrl);
    await assertRequiredTablesExist(appSql);
    await assertSeedDataExists(appSql);
    await assertUserDataSurvivedRestore(appSql, userDataBeforeBackup);
    await appSql.close({ timeout: 1 });
    appSql = null;

    section("Validating Fresh Reinitialize After Nuke");
    await runCommand("bun run nuke-db --yes", ["bun", "run", "nuke-db", "--yes"], commandEnv);
    appSql = createScriptSqlClient(validationUrl);
    await assertNoPublicTablesRemain(appSql);
    await validateFreshInitialization(appSql);

    section("Lifecycle Validation Passed");
  } finally {
    if (appSql) {
      await appSql.close({ timeout: 1 }).catch(() => undefined);
    }

    await dropValidationDatabase(adminSql).catch((error) => {
      console.warn(`Failed to drop validation database ${tempDatabaseName}:`, error);
    });
    await adminSql.close({ timeout: 1 }).catch(() => undefined);

    if (!keepArtifacts) {
      rmSync(validationRoot, { recursive: true, force: true });
    } else {
      console.log(`Kept validation artifacts at ${validationRoot}`);
    }
  }
}

if (import.meta.main) {
  await main();
}
