import { naturalNudgeRepository } from "@/modules/natural-nudges/db/repositories";
import { statRepository } from "@/utils/db/repositories";

/**
 * Whether a failure stop still holds. It lifts on whichever path reads it first, idle nudges or
 * Active Nudges, once any turn has succeeded in the server since, proving the provider works again.
 */
export async function isFailureStopped(serverId: number, stoppedAt: Date | null): Promise<boolean> {
  if (!stoppedAt) return false;
  const lastTurnAt = await statRepository.getServerMetricLastAt({ serverId, metric: "text_generated" });
  if (!lastTurnAt || lastTurnAt <= stoppedAt) return true;
  await naturalNudgeRepository.clearFailures(serverId);
  return false;
}
