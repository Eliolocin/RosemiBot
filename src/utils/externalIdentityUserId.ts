import { isBridgeUserId } from "@/utils/bridges/bridgeUserId";
import { isMessageProxyIdentityUserId } from "@/utils/messageProxy/identityUserId";

/** Returns true when an identifier must never be sent to a Discord snowflake API. */
export function isExternalUserId(id: string): boolean {
  return isBridgeUserId(id) || isMessageProxyIdentityUserId(id);
}
