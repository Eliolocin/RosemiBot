import { type Guild, GuildFeature, type GuildMember, GuildMemberFlags } from "discord.js";
import { log } from "@/utils/misc/logger";
import { WELCOME_DELAY_MS, waitForWelcomeDelay } from "@/events/guildMemberAdd/helpers/welcomeDelay";

/**
 * Upper bound on how long a waiting greeting is kept. Discord never says a member abandoned
 * onboarding, so without a bound a member who joins and goes idle would pin a waiter forever. An
 * expired waiter is dropped, never greeted, because greeting someone still sitting in onboarding
 * is the failure this gate exists to prevent.
 */
const WELCOME_GATE_MAX_WAIT_MS = 60 * 60 * 1000;

/** `open`: the member can see channels. `ended`: they left or rejoined. `expired`: bound reached. */
type WelcomeGateOutcome = "open" | "ended" | "expired";

/** `member` is the freshest state seen, so a greeting does not use a name or avatar from join time. */
export interface WelcomeGateResult {
  outcome: WelcomeGateOutcome;
  member: GuildMember;
}

export interface WelcomeGateOptions {
  maxWaitMs?: number;
  /** Extra wait applied when onboarding could not be read; overridable for tests. */
  fallbackDelayMs?: number;
}

interface PendingWelcome {
  /** Freshest member state seen, because a gateway update can land before the onboarding lookup returns. */
  latest: GuildMember;
  isOpen: ((member: GuildMember) => boolean) | null;
  finish: (outcome: WelcomeGateOutcome) => void;
}

const pendingWelcomes = new Map<string, PendingWelcome>();

/** Guilds already reported as unreadable, because the same failure would otherwise log on every join. */
const unreadableOnboardingGuilds = new Set<string>();

function gateKey(guildId: string, userId: string): string {
  return `${guildId}:${userId}`;
}

/**
 * Whether a member has cleared every access gate the guild put in front of them.
 *
 * Membership Screening surfaces as `pending`. Onboarding has no equivalent live field, so its
 * completion is the CompletedOnboarding member flag, and it only applies when the guild has
 * Onboarding enabled (otherwise the flag never appears).
 *
 * @param member - Freshest known state of the member
 * @param onboardingEnabled - Whether the guild requires onboarding
 */
export function isWelcomeGateOpen(member: GuildMember, onboardingEnabled: boolean): boolean {
  if (member.pending) return false;
  return !onboardingEnabled || member.flags.has(GuildMemberFlags.CompletedOnboarding);
}

/**
 * Reads whether the guild has Onboarding enabled.
 *
 * `null` means the answer could not be read. It is not cached and not treated as "disabled",
 * because guessing "disabled" would greet members who are still inside onboarding.
 */
async function fetchOnboardingEnabled(guild: Guild): Promise<boolean | null> {
  // Onboarding requires Community, so a non-Community guild cannot have it and the lookup is skipped.
  if (!guild.features.includes(GuildFeature.Community)) return false;

  try {
    return (await guild.fetchOnboarding()).enabled;
  } catch (error) {
    if (!unreadableOnboardingGuilds.has(guild.id)) {
      unreadableOnboardingGuilds.add(guild.id);
      // log.warn is dropped under RUN_ENV=production, and this degrades every onboarding guild.
      log.error(`Could not read onboarding config for guild ${guild.id}; falling back to a timed welcome`, error);
    }
    return null;
  }
}

/**
 * Resolves once a newly joined member can actually see the server, so a greeting is not sent
 * while they are still answering Membership Screening or Onboarding.
 *
 * Servers without either gate resolve immediately. If Onboarding cannot be read, the pre-gate
 * behavior applies: wait out `WELCOME_DELAY_MS` after any screening clears.
 *
 * @param member - The member from `guildMemberAdd`
 * @param options - Wait bounds; overridable for tests
 * @returns The outcome plus the freshest member state seen while waiting
 */
export async function waitForWelcomeGate(
  member: GuildMember,
  options: WelcomeGateOptions = {},
): Promise<WelcomeGateResult> {
  const { maxWaitMs = WELCOME_GATE_MAX_WAIT_MS, fallbackDelayMs = WELCOME_DELAY_MS } = options;
  const key = gateKey(member.guild.id, member.id);
  // A stale waiter under the same key belongs to a membership that has already ended.
  pendingWelcomes.get(key)?.finish("ended");

  let resolveOutcome: (outcome: WelcomeGateOutcome) => void = () => {};
  const outcome = new Promise<WelcomeGateOutcome>((resolve) => {
    resolveOutcome = resolve;
  });

  let settled = false;
  let expiry: ReturnType<typeof setTimeout> | undefined;

  const pending: PendingWelcome = {
    latest: member,
    isOpen: null,
    finish: (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(expiry);
      if (pendingWelcomes.get(key) === pending) pendingWelcomes.delete(key);
      resolveOutcome(result);
    },
  };

  expiry = setTimeout(() => pending.finish("expired"), maxWaitMs);
  expiry.unref();

  // Registered before the onboarding lookup so an update or departure during the REST call is not lost.
  pendingWelcomes.set(key, pending);

  const onboardingEnabled = await fetchOnboardingEnabled(member.guild);
  pending.isOpen = (current) => isWelcomeGateOpen(current, onboardingEnabled === true);
  if (pending.isOpen(pending.latest)) pending.finish("open");

  const result = await outcome;
  if (result === "open" && onboardingEnabled === null) {
    await waitForWelcomeDelay(fallbackDelayMs);
  }
  return { outcome: result, member: pending.latest };
}

/**
 * Feeds a `guildMemberUpdate` into any greeting waiting on that member.
 *
 * @param member - The updated member (new state)
 */
export function notifyWelcomeGateMemberUpdate(member: GuildMember): void {
  const pending = pendingWelcomes.get(gateKey(member.guild.id, member.id));
  if (!pending) return;

  pending.latest = member;
  if (pending.isOpen?.(member)) pending.finish("open");
}

/**
 * Cancels the greeting waiting on a member who left, so no message is sent for someone who is gone.
 *
 * @param guildId - Guild the member left
 * @param userId - The departing user
 */
export function notifyWelcomeGateMemberRemove(guildId: string, userId: string): void {
  pendingWelcomes.get(gateKey(guildId, userId))?.finish("ended");
}
