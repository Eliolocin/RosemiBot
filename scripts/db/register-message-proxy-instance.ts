import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { canonicalMessageProxyOrigin, type MessageProxyInstanceContext } from "@/utils/messageProxy/instances";
import { fetchMessage } from "@/utils/messageProxy/services/pluralkit/api";
import { fetchPluralBuddyMessage } from "@/utils/messageProxy/services/pluralbuddy/api";
import { validatePluralBuddyDiscovery } from "@/utils/messageProxy/services/pluralbuddy/oauthBootstrap";
import { getPluralBuddyAccessToken } from "@/utils/messageProxy/services/pluralbuddy/oauthTokens";
import { keyManager } from "@/utils/security/keyManager";
import { validateRemoteUrl } from "@/utils/security/remoteUrlSecurity";
import { fetchUserRemoteUrl } from "@/utils/security/userRemoteFetch";

config();
const { sql } = await import("@/utils/db/client");

type InstanceRow = {
  instance_id: string;
  service_id: "pluralkit" | "pluralbuddy";
  origin: string;
  display_name: string;
  bot_user_id: string | null;
  enabled: boolean;
  removed_at: Date | null;
};

const SNOWFLAKE = /^\d{17,20}$/;
const usage =
  "Usage: bun scripts/db/register-message-proxy-instance.ts register <pluralkit|pluralbuddy> <https-origin> <display-name> <bot-user-id> | inspect [instance-id] | set-bot <instance-id> <bot-user-id> | enable <instance-id> <bot-written-repost-id> <sender-discord-id> | disable <instance-id> | remove <instance-id>";

async function validateOrigin(origin: string): Promise<void> {
  if (canonicalMessageProxyOrigin(origin) !== origin)
    throw new Error("Instance origin must be a canonical HTTPS origin.");
  const validation = await validateRemoteUrl(origin, { strict: true });
  if (!validation.valid) throw new Error(`Origin refused: ${validation.failureCode}.`);
}

async function checkDiscovery(instance: MessageProxyInstanceContext): Promise<void> {
  if (instance.serviceId === "pluralbuddy") {
    await validatePluralBuddyDiscovery(instance);
    return;
  }
  const response = await fetchUserRemoteUrl(
    `${instance.origin}/v2/messages/000000000000000000`,
    {
      headers: { "User-Agent": "TomoriBot" },
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
    },
    { strict: true },
  );
  await response.body?.cancel();
  if (response.status !== 404)
    throw new Error(`PluralKit discovery returned status ${response.status}; expected 404 for an unknown message.`);
}

async function loadInstance(instanceId: string): Promise<InstanceRow> {
  const [instance] = await sql<InstanceRow[]>`
    SELECT instance_id, service_id, origin, display_name, bot_user_id, enabled, removed_at
    FROM message_proxy_instances WHERE instance_id = ${instanceId}
  `;
  if (!instance || instance.removed_at) throw new Error("Instance not found or already removed.");
  if (instanceId.endsWith(":official")) throw new Error("Official instances cannot be changed by this script.");
  return instance;
}

try {
  const [action, ...args] = process.argv.slice(2);
  switch (action) {
    case "register": {
      const [serviceId, originInput, displayName, botUserId] = args;
      const origin = originInput ? canonicalMessageProxyOrigin(originInput) : null;
      if (
        args.length !== 4 ||
        (serviceId !== "pluralkit" && serviceId !== "pluralbuddy") ||
        !origin ||
        (originInput !== origin && originInput !== `${origin}/`) ||
        !displayName?.trim() ||
        displayName.length > 100 ||
        !SNOWFLAKE.test(botUserId ?? "")
      ) {
        throw new Error(usage);
      }
      await validateOrigin(origin);
      const [existing] = await sql<{ instance_id: string; removed_at: Date | null }[]>`
        SELECT instance_id, removed_at FROM message_proxy_instances WHERE origin = ${origin}
      `;
      if (existing) {
        throw new Error(
          existing.removed_at
            ? `This origin belongs to removed instance ${existing.instance_id} and cannot be registered again.`
            : `This origin is already registered as ${existing.instance_id}. Inspect or update that instance.`,
        );
      }
      await checkDiscovery({ serviceId, instanceId: `${serviceId}:pending`, origin, botUserId });
      const instanceId = `${serviceId}:${randomUUID()}`;
      await sql`
        INSERT INTO message_proxy_instances (instance_id, service_id, origin, display_name, bot_user_id, enabled)
        VALUES (${instanceId}, ${serviceId}, ${origin}, ${displayName.trim()}, ${botUserId}, false)
      `;
      console.log(
        `Registered disabled ${serviceId} instance ${instanceId} at ${origin}. Verify a bot-written repost before enabling.`,
      );
      break;
    }
    case "inspect": {
      if (args.length > 1) throw new Error(usage);
      const rows =
        args.length === 1
          ? await sql<
              InstanceRow[]
            >`SELECT instance_id, service_id, origin, display_name, bot_user_id, enabled, removed_at FROM message_proxy_instances WHERE instance_id = ${args[0]}`
          : await sql<
              InstanceRow[]
            >`SELECT instance_id, service_id, origin, display_name, bot_user_id, enabled, removed_at FROM message_proxy_instances ORDER BY service_id, display_name`;
      for (const row of rows)
        console.log(
          `${row.instance_id} | ${row.display_name} | ${row.origin} | bot ${row.bot_user_id ?? "unknown"} | ${row.removed_at ? "removed" : row.enabled ? "enabled" : "disabled"}`,
        );
      break;
    }
    case "set-bot": {
      const [instanceId, botUserId] = args;
      if (args.length !== 2 || !instanceId || !SNOWFLAKE.test(botUserId ?? "")) throw new Error(usage);
      const row = await loadInstance(instanceId);
      await sql`UPDATE message_proxy_instances SET bot_user_id = ${botUserId} WHERE instance_id = ${row.instance_id}`;
      console.log(`Updated bot user ID for ${row.instance_id}.`);
      break;
    }
    case "enable": {
      const [instanceId, repostId, senderId] = args;
      if (args.length !== 3 || !instanceId || !SNOWFLAKE.test(repostId ?? "") || !SNOWFLAKE.test(senderId ?? ""))
        throw new Error(usage);
      const row = await loadInstance(instanceId);
      if (!row.bot_user_id) throw new Error("Instance bot user ID is not configured. Run set-bot before enabling it.");
      await validateOrigin(row.origin);
      const instance: MessageProxyInstanceContext = {
        serviceId: row.service_id,
        instanceId,
        origin: row.origin,
        botUserId: row.bot_user_id,
      };
      await checkDiscovery(instance);
      if (row.service_id === "pluralbuddy") {
        keyManager.initialize();
        if (!(await getPluralBuddyAccessToken(instance))) {
          throw new Error(
            "PluralBuddy authorization is unavailable for this instance. Complete its OAuth setup first.",
          );
        }
      }
      const attestedSender =
        row.service_id === "pluralkit"
          ? (await fetchMessage(instance, repostId))?.sender
          : (await fetchPluralBuddyMessage(instance, repostId))?.systemId;
      if (attestedSender !== senderId)
        throw new Error("The sample repost did not resolve to the expected sender. The instance remains disabled.");
      await sql`UPDATE message_proxy_instances SET enabled = true WHERE instance_id = ${instanceId} AND removed_at IS NULL`;
      console.log(`Enabled ${instanceId}. The change takes effect on the next lookup.`);
      break;
    }
    case "disable": {
      if (args.length !== 1) throw new Error(usage);
      const row = await loadInstance(args[0]);
      await sql`UPDATE message_proxy_instances SET enabled = false WHERE instance_id = ${row.instance_id}`;
      console.log(`Disabled ${row.instance_id}. Existing identities remain available.`);
      break;
    }
    case "remove": {
      if (args.length !== 1) throw new Error(usage);
      const row = await loadInstance(args[0]);
      await sql.begin(async (tx) => {
        await tx`UPDATE message_proxy_instances SET enabled = false, removed_at = CURRENT_TIMESTAMP WHERE instance_id = ${row.instance_id}`;
        await tx`DELETE FROM pluralbuddy_oauth_connections WHERE instance_id = ${row.instance_id}`;
      });
      console.log(
        `Removed ${row.instance_id} from selection and deleted its OAuth connection. Existing identities remain available.`,
      );
      break;
    }
    default:
      throw new Error(usage);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Instance operation failed.");
  process.exitCode = 1;
} finally {
  await sql.close();
}
