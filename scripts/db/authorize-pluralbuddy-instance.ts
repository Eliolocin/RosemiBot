import { config } from "dotenv";
import { ask, askSecret } from "../lib/prompt";

config({ quiet: true });

if (process.env.SECRET_FILE) {
  const raw: unknown = await Bun.file(process.env.SECRET_FILE).json();
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("SECRET_FILE must contain a JSON object.");
  }
  const secrets = raw as Record<string, unknown>;
  for (const [key, value] of Object.entries(secrets)) {
    if (
      (key.startsWith("POSTGRES_") ||
        key === "CRYPTO_SECRET" ||
        /^CRYPTO_SECRET_V\d+$/.test(key) ||
        key === "CRYPTO_SECRET_CURRENT") &&
      typeof value === "string"
    ) {
      process.env[key] = value;
    }
  }
}

const [instanceId, redirectInput, ...extra] = process.argv.slice(2);
if (!instanceId || !redirectInput || extra.length > 0) {
  throw new Error(
    "Usage: bun scripts/db/authorize-pluralbuddy-instance.ts <instance-id> <registered-loopback-redirect-uri>",
  );
}

const { sql } = await import("@/utils/db/client");
const { keyManager } = await import("@/utils/security/keyManager");
const { encryptApiKey } = await import("@/utils/security/crypto");
const { canonicalMessageProxyOrigin } = await import("@/utils/messageProxy/instances");
const { validateRemoteUrl } = await import("@/utils/security/remoteUrlSecurity");
const {
  createPluralBuddyOAuthSession,
  exchangePluralBuddyOAuthCode,
  parsePluralBuddyOAuthCallback,
  validatePluralBuddyRedirect,
} = await import("@/utils/messageProxy/services/pluralbuddy/oauthBootstrap");
const redirect = validatePluralBuddyRedirect(redirectInput);
if (redirect.toString() !== redirectInput) throw new Error("The redirect URI must exactly match the registered URI.");

type InstanceRow = { instance_id: string; service_id: string; origin: string };
let listener: ReturnType<typeof Bun.serve> | undefined;

try {
  keyManager.initialize();
  await sql`SELECT 1`;
  const [row] = await sql<InstanceRow[]>`
    SELECT instance_id, service_id, origin
    FROM message_proxy_instances
    WHERE instance_id = ${instanceId} AND service_id = 'pluralbuddy' AND removed_at IS NULL
    LIMIT 1
  `;
  if (!row || canonicalMessageProxyOrigin(row.origin) !== row.origin) {
    throw new Error("The PluralBuddy instance is missing or has an invalid origin.");
  }
  const validation = await validateRemoteUrl(row.origin, { strict: true });
  if (!validation.valid) throw new Error(`Instance origin failed URL validation: ${validation.failureCode}`);
  const instance = { serviceId: "pluralbuddy" as const, instanceId: row.instance_id, origin: row.origin };

  const clientId = await ask("OAuth client ID");
  if (!clientId || clientId.includes(":")) throw new Error("The OAuth client ID is invalid.");
  const clientSecret = await askSecret("OAuth client secret", { allowVisibleFallback: false });
  if (!clientSecret) throw new Error("The OAuth client secret is required.");
  const session = await createPluralBuddyOAuthSession(instance, clientId, redirectInput);

  let finishCallback: (code: string) => void = () => {};
  let failCallback: (error: Error) => void = () => {};
  const callback = new Promise<string>((resolve, reject) => {
    finishCallback = resolve;
    failCallback = reject;
  });
  let received = false;
  listener = Bun.serve({
    hostname: "127.0.0.1",
    port: Number(redirect.port),
    fetch(request) {
      const url = new URL(request.url);
      if (request.method !== "GET" || url.pathname !== redirect.pathname) {
        return new Response("Not found", { status: 404 });
      }
      if (received) return new Response("Callback already received", { status: 409 });
      received = true;
      try {
        const code = parsePluralBuddyOAuthCallback(url, redirectInput, session);
        finishCallback(code);
        return new Response("Authorization received. Return to the terminal.", { status: 200 });
      } catch (error) {
        failCallback(error instanceof Error ? error : new Error("OAuth callback failed."));
        return new Response("Authorization failed. Return to the terminal.", { status: 400 });
      }
    },
  });

  console.log(`Open this URL in the browser on this machine:\n${session.authorizeUrl}`);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const code = await Promise.race([
    callback,
    new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => reject(new Error("OAuth callback timed out.")), 180_000);
    }),
  ]).finally(() => clearTimeout(timeout));
  listener.stop();
  listener = undefined;

  const token = await exchangePluralBuddyOAuthCode(instance, clientId, clientSecret, redirectInput, session, code);
  const encryptedSecret = await encryptApiKey(clientSecret);
  const encryptedRefresh = await encryptApiKey(token.refresh_token);
  await sql`
    INSERT INTO pluralbuddy_oauth_connections (
      instance_id, origin, client_id, client_secret, client_secret_key_version,
      refresh_token, refresh_token_key_version
    ) VALUES (
      ${instance.instanceId}, ${instance.origin}, ${clientId}, ${encryptedSecret.encrypted}, ${encryptedSecret.version},
      ${encryptedRefresh.encrypted}, ${encryptedRefresh.version}
    )
    ON CONFLICT (instance_id) DO UPDATE SET
      origin = EXCLUDED.origin,
      client_id = EXCLUDED.client_id,
      client_secret = EXCLUDED.client_secret,
      client_secret_key_version = EXCLUDED.client_secret_key_version,
      refresh_token = EXCLUDED.refresh_token,
      refresh_token_key_version = EXCLUDED.refresh_token_key_version,
      access_token = NULL,
      access_token_key_version = NULL,
      access_expires_at = NULL,
      refresh_blocked_at = NULL,
      refresh_retry_after = NULL
  `;
  console.log(`Stored the encrypted OAuth connection for ${instance.instanceId}.`);
} catch (error) {
  const message = error instanceof Error ? error.message : "";
  const safeMessage = /^(OAuth |The |Instance origin |PluralBuddy authorization )/.test(message)
    ? message
    : "PluralBuddy authorization failed. Check database access and the instance configuration.";
  console.error(safeMessage);
  process.exitCode = 1;
} finally {
  listener?.stop();
  await sql.close();
}
