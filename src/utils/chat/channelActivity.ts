import { channelLocks } from "@/utils/chat/channelQueue";
export function getUserActiveMessageCount(userDiscId: string): number {
  let count = 0;

  for (const lockEntry of channelLocks.values()) {
    if (lockEntry.isLocked && lockEntry.userDiscId === userDiscId && !lockEntry.currentIsPersonaJob) {
      count++;
    }

    count += lockEntry.messageQueue.filter((queuedMsg) => {
      const queuedUserDiscId = queuedMsg.textQuotaUserDiscId ?? queuedMsg.message.author.id;
      return queuedUserDiscId === userDiscId && !queuedMsg.isPersonaJob;
    }).length;
  }

  return count;
}

export function getServerActiveMessageCount(serverDiscId: string): number {
  let count = 0;

  for (const lockEntry of channelLocks.values()) {
    if (lockEntry.serverDiscId === serverDiscId) {
      if (lockEntry.isLocked) {
        count++;
      }

      count += lockEntry.messageQueue.length;
    }
  }

  return count;
}
