import { AsyncLocalStorage } from "node:async_hooks";
import { type RateLimitData, RateLimitError } from "discord.js";

/**
 * Deferrable webhook avatar edits.
 *
 * A data-URI avatar cannot travel per message, so it is applied by editing the shared webhook,
 * and Discord rate-limits that edit tightly. discord.js parks a rate-limited request until the
 * bucket resets and cannot cancel it once queued, so a timeout around the send would leave the
 * edit to land later under some unrelated message. Rejecting before discord.js queues anything is
 * the only way to give the caller a choice.
 *
 * Kept free of repository imports because the Discord client is configured from this module.
 */

/**
 * The longest rate-limit wait accepted for a deferrable webhook avatar edit before the caller is
 * told to fall back instead. Not a request timeout: it sits above a normal bucket refill (about a
 * second) and far below the minute-long resets that a burst of avatar edits earns.
 */
export const WEBHOOK_AVATAR_PATCH_MAX_WAIT_MS = 5_000;

// Bucket routes for editing the webhook itself, with and without the token. Message edits
// (`/webhooks/:id/:token/messages/:id`) share the prefix and must keep waiting.
const WEBHOOK_EDIT_BUCKET_ROUTES = new Set(["/webhooks/:id", "/webhooks/:id/:token"]);

// `rejectOnRateLimit` is one client-wide option, so this scope is what keeps every request outside
// a deferrable avatar edit (other webhook edits included) on the default wait-it-out behaviour.
const deferrableAvatarEditScope = new AsyncLocalStorage<true>();

/**
 * Thrown in place of waiting when a deferrable avatar edit hit a long rate limit. Nothing was
 * queued or sent, so the webhook still shows its previous avatar.
 */
export class WebhookAvatarEditDeferredError extends Error {
  constructor(
    readonly webhookId: string,
    readonly timeToResetMs: number,
  ) {
    super(`Webhook ${webhookId} avatar edit deferred: rate limited for ${timeToResetMs}ms`);
    this.name = "WebhookAvatarEditDeferredError";
  }
}

/**
 * Client `rest.rejectOnRateLimit` predicate: rejects only a webhook edit issued inside
 * {@link runDeferrableWebhookAvatarEdit} whose wait exceeds {@link WEBHOOK_AVATAR_PATCH_MAX_WAIT_MS}.
 *
 * Takes the larger of `timeToReset` and `retryAfter` because a 429 reports the bucket reset in one
 * and Discord's `Retry-After` in the other; a response without bucket headers leaves
 * `timeToReset` near zero even though discord.js will still sleep for `retryAfter`.
 */
export function shouldRejectWebhookRateLimit(data: RateLimitData): boolean {
  return (
    deferrableAvatarEditScope.getStore() === true &&
    data.method.toUpperCase() === "PATCH" &&
    WEBHOOK_EDIT_BUCKET_ROUTES.has(data.route) &&
    Math.max(data.timeToReset, data.retryAfter) > WEBHOOK_AVATAR_PATCH_MAX_WAIT_MS
  );
}

/**
 * Runs a webhook avatar edit that may be rejected instead of waiting out a long rate limit.
 *
 * @throws {WebhookAvatarEditDeferredError} When the edit was rejected for a long rate limit
 */
export async function runDeferrableWebhookAvatarEdit<T>(webhookId: string, edit: () => Promise<T>): Promise<T> {
  try {
    return await deferrableAvatarEditScope.run(true, edit);
  } catch (error) {
    if (error instanceof RateLimitError) {
      throw new WebhookAvatarEditDeferredError(webhookId, Math.max(error.timeToReset, error.retryAfter));
    }
    throw error;
  }
}
