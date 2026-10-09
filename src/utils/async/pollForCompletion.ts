import { log } from "@/utils/misc/logger";

interface PollResult<T> {
  done: boolean;
  result?: T;
  error?: string;
}

/** Configuration for the polling loop */
export interface PollOptions<T> {
  /** Function called each iteration to check completion status */
  pollFn: () => Promise<PollResult<T>>;
  /** Milliseconds between poll attempts */
  intervalMs: number;
  /** Maximum number of poll attempts before timeout */
  maxAttempts: number;
  /** Optional callback invoked before each poll with the current attempt number */
  onPoll?: (attempt: number) => void;
  /** Label for log messages (e.g. "GoogleVideoGeneration") */
  logLabel?: string;
  /** Stops polling at the next wait or attempt boundary; the remote job itself is not cancelled. */
  abortSignal?: AbortSignal;
}

function waitForNextPoll(intervalMs: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, intervalMs);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Generic async polling utility for long-running operations.
 * Repeatedly calls pollFn at the specified interval until:
 *   1. pollFn returns { done: true, result } → resolves with result
 *   2. pollFn returns { done: true, error } → rejects with error
 *   3. maxAttempts is exceeded → rejects with timeout error
 *   4. abortSignal fires → rejects with a cancellation error
 *
 * @param options - Polling configuration
 * @throws Error if the operation fails or times out
 */
export async function pollForCompletion<T>(options: PollOptions<T>): Promise<T> {
  const { pollFn, intervalMs, maxAttempts, onPoll, logLabel, abortSignal } = options;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (attempt > 1) {
      await waitForNextPoll(intervalMs, abortSignal);
    }
    if (abortSignal?.aborted) {
      throw new Error(`${logLabel ?? "Poll"}: polling was cancelled`);
    }

    onPoll?.(attempt);

    const pollResult = await pollFn();

    if (pollResult.done) {
      if (pollResult.error) {
        throw new Error(pollResult.error);
      }
      if (pollResult.result === undefined) {
        throw new Error(`${logLabel ?? "Poll"}: operation completed but returned no result`);
      }
      return pollResult.result;
    }

    // Log progress periodically (every 5th attempt)
    if (attempt % 5 === 0) {
      log.info(`${logLabel ?? "Poll"}: still waiting (attempt ${attempt}/${maxAttempts})`);
    }
  }

  const totalWaitSec = Math.round((maxAttempts * intervalMs) / 1000);
  throw new Error(`${logLabel ?? "Poll"}: operation timed out after ${maxAttempts} attempts (~${totalWaitSec}s)`);
}
