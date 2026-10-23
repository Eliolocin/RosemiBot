import type { StructuredContextItem } from "@/types/misc/context";
import type { ChatIncoming } from "@/utils/chat/types";

type WelcomeClaim = { by: "member"; messageId: string } | { by: "welcome"; anchorMessageId: string };

interface PendingWelcome {
  contextItem: StructuredContextItem;
  claim: WelcomeClaim | null;
}

/**
 * A greeting the welcome flow is preparing, which the greeted member's own trigger can take over so
 * the member gets one reply that both greets and answers them instead of two racing turns.
 */
export interface WelcomeHandoff {
  /** Whether the member's own turn already took the greeting. */
  isTakenByMember(): boolean;
  /**
   * Reserves the greeting for the standalone welcome turn.
   * @param anchorMessageId - Message the welcome turn replies to; the member's own turn for it is dropped
   * @returns false when the member's turn already took the greeting
   */
  claimForWelcome(anchorMessageId: string): boolean;
  release(): void;
}

const pendingWelcomes = new Map<string, PendingWelcome>();

function handoffKey(channelId: string, userDiscId: string): string {
  return `${channelId}:${userDiscId}`;
}

/**
 * Opens a handoff window for a member whose welcome is being prepared in a channel.
 *
 * @param contextItem - Welcome context the member's own turn carries if it takes the greeting
 */
export function openWelcomeHandoff(
  channelId: string,
  userDiscId: string,
  contextItem: StructuredContextItem,
): WelcomeHandoff {
  const key = handoffKey(channelId, userDiscId);
  const pending: PendingWelcome = { contextItem, claim: null };
  pendingWelcomes.set(key, pending);

  return {
    isTakenByMember: () => pending.claim?.by === "member",
    claimForWelcome: (anchorMessageId) => {
      if (pending.claim) return false;
      pending.claim = { by: "welcome", anchorMessageId };
      return true;
    },
    release: () => {
      if (pendingWelcomes.get(key) === pending) pendingWelcomes.delete(key);
    },
  };
}

/**
 * Call only once the turn is certain to run or queue, because taking the greeting cancels the
 * standalone welcome.
 *
 * @param userDiscId - Resolved trigger user, so a verified proxy repost counts as its sender
 * @returns false when the welcome turn is already replying to this exact message, so this turn must not run
 */
export function applyWelcomeHandoff(incoming: ChatIncoming, userDiscId: string): boolean {
  if (incoming.isManuallyTriggered || incoming.isPersonaJob || incoming.isStopResponse) return true;

  const { message } = incoming;
  const pending = pendingWelcomes.get(handoffKey(message.channelId, userDiscId));
  if (!pending) return true;

  if (!pending.claim) {
    pending.claim = { by: "member", messageId: message.id };
    incoming.injectedContextItems = [...(incoming.injectedContextItems ?? []), pending.contextItem];
    return true;
  }

  return !(pending.claim.by === "welcome" && pending.claim.anchorMessageId === message.id);
}
