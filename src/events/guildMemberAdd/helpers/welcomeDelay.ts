/**
 * Fallback grace period for a greeting when the guild's Onboarding config cannot be read.
 * `guildMemberAdd` fires before the new member has finished Discord's onboarding, so with no
 * completion signal to wait on, a fixed delay is the only approximation left. Guilds whose config
 * is readable wait on `welcomeGate.ts` instead.
 */
export const WELCOME_DELAY_MS = 1 * 60 * 1000;

/**
 * Wait for the Welcome grace period without keeping shutdown alive.
 *
 * @param delayMs - Delay in milliseconds; zero returns immediately.
 */
export function waitForWelcomeDelay(delayMs = WELCOME_DELAY_MS): Promise<void> {
  if (delayMs <= 0) return Promise.resolve();

  return new Promise((resolve) => {
    setTimeout(resolve, delayMs).unref();
  });
}
