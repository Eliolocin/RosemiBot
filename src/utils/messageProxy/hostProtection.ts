import { PrivacyLevel } from "@/types/db/schema";
import { getCachedBlacklistStatus, getCachedPrivacyLevel } from "@/utils/cache/userCache";
import { isMessageProxyIdentityUserId } from "@/utils/messageProxy/identityUserId";
import { messageProxyRepository } from "@/utils/db/repositories/MessageProxyRepository";

export type MessageProxyHostProtection =
  | {
      protected: true;
      isMessageProxyIdentity: true;
      reason: "host_unresolved";
      hostUserDiscId: null;
    }
  | {
      protected: false;
      isMessageProxyIdentity: boolean;
    }
  | {
      protected: true;
      isMessageProxyIdentity: true;
      reason: "host_full_privacy" | "host_blacklisted";
      hostUserDiscId: string;
    };

/**
 * The identity's own synthetic row is checked by normal memory code; this helper
 * adds the authorization side of the message-proxy identity split.
 */
export async function getMessageProxyHostProtection(
  targetUserDiscId: string,
  serverDiscId: string | null | undefined,
): Promise<MessageProxyHostProtection> {
  if (!isMessageProxyIdentityUserId(targetUserDiscId)) {
    return { protected: false, isMessageProxyIdentity: false };
  }

  const identityContext = await messageProxyRepository.getIdentityContextByUserDiscId(targetUserDiscId);
  const hostUserDiscIds = identityContext?.hostUserDiscIds;
  // An absent host link cannot authorize writes to the synthetic identity.
  if (!hostUserDiscIds?.length) {
    return { protected: true, isMessageProxyIdentity: true, reason: "host_unresolved", hostUserDiscId: null };
  }
  for (const hostUserDiscId of hostUserDiscIds) {
    if ((await getCachedPrivacyLevel(hostUserDiscId)) === PrivacyLevel.FULL) {
      return {
        protected: true,
        isMessageProxyIdentity: true,
        reason: "host_full_privacy",
        hostUserDiscId,
      };
    }
  }

  if (serverDiscId) {
    for (const hostUserDiscId of hostUserDiscIds) {
      if (await getCachedBlacklistStatus(serverDiscId, hostUserDiscId)) {
        return {
          protected: true,
          isMessageProxyIdentity: true,
          reason: "host_blacklisted",
          hostUserDiscId,
        };
      }
    }
  }

  return { protected: false, isMessageProxyIdentity: true };
}
