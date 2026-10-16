import type { ConditioningType } from "@/types/db/schema";

const REWARD_ACTION_KEYS = ["headpat", "hug", "kiss", "tickle", "feed"] as const;
const PUNISH_ACTION_KEYS = ["spank", "pinch", "bite", "squeeze", "bonk"] as const;

type RewardActionKey = (typeof REWARD_ACTION_KEYS)[number];
type PunishActionKey = (typeof PUNISH_ACTION_KEYS)[number];
export type ConditioningActionKey = RewardActionKey | PunishActionKey;
export const CONDITIONING_ACTION_LOCALE_KEYS: Record<
  ConditioningActionKey,
  {
    description: string;
    persona_description: string;
    reason_description: string;
    embed_title: string;
    embed_description: string;
    history_label: string;
    history_label_plural: string;
  }
> = {
  headpat: {
    description: "commands.reward.headpat.description",
    persona_description: "commands.reward.headpat.persona_description",
    reason_description: "commands.reward.headpat.reason_description",
    embed_title: "commands.reward.headpat.embed_title",
    embed_description: "commands.reward.headpat.embed_description",
    history_label: "commands.reward.headpat.history_label",
    history_label_plural: "commands.reward.headpat.history_label_plural",
  },
  hug: {
    description: "commands.reward.hug.description",
    persona_description: "commands.reward.hug.persona_description",
    reason_description: "commands.reward.hug.reason_description",
    embed_title: "commands.reward.hug.embed_title",
    embed_description: "commands.reward.hug.embed_description",
    history_label: "commands.reward.hug.history_label",
    history_label_plural: "commands.reward.hug.history_label_plural",
  },
  kiss: {
    description: "commands.reward.kiss.description",
    persona_description: "commands.reward.kiss.persona_description",
    reason_description: "commands.reward.kiss.reason_description",
    embed_title: "commands.reward.kiss.embed_title",
    embed_description: "commands.reward.kiss.embed_description",
    history_label: "commands.reward.kiss.history_label",
    history_label_plural: "commands.reward.kiss.history_label_plural",
  },
  tickle: {
    description: "commands.reward.tickle.description",
    persona_description: "commands.reward.tickle.persona_description",
    reason_description: "commands.reward.tickle.reason_description",
    embed_title: "commands.reward.tickle.embed_title",
    embed_description: "commands.reward.tickle.embed_description",
    history_label: "commands.reward.tickle.history_label",
    history_label_plural: "commands.reward.tickle.history_label_plural",
  },
  feed: {
    description: "commands.reward.feed.description",
    persona_description: "commands.reward.feed.persona_description",
    reason_description: "commands.reward.feed.reason_description",
    embed_title: "commands.reward.feed.embed_title",
    embed_description: "commands.reward.feed.embed_description",
    history_label: "commands.reward.feed.history_label",
    history_label_plural: "commands.reward.feed.history_label_plural",
  },
  spank: {
    description: "commands.punish.spank.description",
    persona_description: "commands.punish.spank.persona_description",
    reason_description: "commands.punish.spank.reason_description",
    embed_title: "commands.punish.spank.embed_title",
    embed_description: "commands.punish.spank.embed_description",
    history_label: "commands.punish.spank.history_label",
    history_label_plural: "commands.punish.spank.history_label_plural",
  },
  pinch: {
    description: "commands.punish.pinch.description",
    persona_description: "commands.punish.pinch.persona_description",
    reason_description: "commands.punish.pinch.reason_description",
    embed_title: "commands.punish.pinch.embed_title",
    embed_description: "commands.punish.pinch.embed_description",
    history_label: "commands.punish.pinch.history_label",
    history_label_plural: "commands.punish.pinch.history_label_plural",
  },
  bite: {
    description: "commands.punish.bite.description",
    persona_description: "commands.punish.bite.persona_description",
    reason_description: "commands.punish.bite.reason_description",
    embed_title: "commands.punish.bite.embed_title",
    embed_description: "commands.punish.bite.embed_description",
    history_label: "commands.punish.bite.history_label",
    history_label_plural: "commands.punish.bite.history_label_plural",
  },
  squeeze: {
    description: "commands.punish.squeeze.description",
    persona_description: "commands.punish.squeeze.persona_description",
    reason_description: "commands.punish.squeeze.reason_description",
    embed_title: "commands.punish.squeeze.embed_title",
    embed_description: "commands.punish.squeeze.embed_description",
    history_label: "commands.punish.squeeze.history_label",
    history_label_plural: "commands.punish.squeeze.history_label_plural",
  },
  bonk: {
    description: "commands.punish.bonk.description",
    persona_description: "commands.punish.bonk.persona_description",
    reason_description: "commands.punish.bonk.reason_description",
    embed_title: "commands.punish.bonk.embed_title",
    embed_description: "commands.punish.bonk.embed_description",
    history_label: "commands.punish.bonk.history_label",
    history_label_plural: "commands.punish.bonk.history_label_plural",
  },
};

export const CONDITIONING_MARKER_LOCALE_KEYS: Record<ConditioningType, string> = {
  reward: "commands.conditioning.shared.marker_reward",
  punish: "commands.conditioning.shared.marker_punish",
};

export const CONDITIONING_FOOTER_LOCALE_KEYS: Record<ConditioningType, string> = {
  reward: "commands.conditioning.shared.reward_footer",
  punish: "commands.conditioning.shared.punish_footer",
};

const CONTEXT_PAST_PARTICIPLES: Record<ConditioningType, Record<ConditioningActionKey, string>> = {
  reward: {
    headpat: "headpatted",
    hug: "hugged",
    kiss: "kissed",
    tickle: "tickled",
    feed: "fed",
    spank: "spanked",
    pinch: "pinched",
    bite: "bitten",
    squeeze: "squeezed",
    bonk: "bonked",
  },
  punish: {
    headpat: "headpatted",
    hug: "hugged",
    kiss: "kissed",
    tickle: "tickled",
    feed: "fed",
    spank: "spanked",
    pinch: "pinched",
    bite: "bitten",
    squeeze: "squeezed",
    bonk: "bonked",
  },
};

/** Reasons are shown in the conditioning panel, so they are capped rather than free-form. */
export const CONDITIONING_REASON_MAX_LENGTH = 250;
export const CONDITIONING_CONTEXT_MAX_GROUPS_PER_TYPE = 10;

export function normalizeConditioningReason(reason: string | null | undefined): string {
  return (reason ?? "").trim().replace(/\s+/g, " ");
}

export function normalizeConditioningReasonKey(reason: string | null | undefined): string {
  return normalizeConditioningReason(reason).toLowerCase();
}

export function getConditioningContextPastParticiple(
  type: ConditioningType,
  actionKey: ConditioningActionKey | string,
): string {
  const actionMap = CONTEXT_PAST_PARTICIPLES[type];
  return actionMap[actionKey as ConditioningActionKey] ?? actionKey;
}
