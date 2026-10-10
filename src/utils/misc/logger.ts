import type { ErrorContext } from "@/types/db/schema";
import { buildErrorLogPayload, errorLogRepository } from "@/utils/db/repositories/ErrorLogRepository";
import { resolveErrorContext } from "@/utils/misc/errorContextStore";
import pino from "pino";

/**
 * Whether `log.error` also persists a structured row to the `error_logs` table.
 *
 * Read per call rather than captured at module load so tests and a running process can flip it
 * without a restart. Defaults on: the structured table is what makes errors queryable from
 * Grafana, and the write is cheap (roughly 1.6 kB per row, a few hundred rows on a normal day).
 * The storm case is handled by the repository's circuit breaker, not by this flag.
 */
function isErrorDbLoggingEnabled(): boolean {
  const raw = process.env.ERROR_DB_LOGGING_ENABLED;
  if (raw === undefined) return true;
  return ["true", "1", "yes", "on"].includes(raw.trim().toLowerCase());
}

/**
 * Standard color scheme for both console logs and Discord embeds
 */
export enum ColorCode {
  INFO = "#3498DB", // Cyan color
  SUCCESS = "#2ECC71", // Green color
  MEMORY_UPDATE = "#25d4da", // Aqua color
  WARN = "#F1C40F", // Yellow color
  ERROR = "#E74C3C", // Red color
  SECTION = "#E066FF", // Purple color
  AFFECTION = "#ff10cb", // Pink color
  RATE_LIMIT = "#FFA500", // Orange color
}

/**
 * Determines if non-essential logs should be shown based on environment
 * TEST_PRODUCTION mode: Show all logs even when RUN_ENV=production
 */
const isProduction = process.env.RUN_ENV === "production";
const isTestProduction = process.env.TEST_PRODUCTION === "true";
const shouldHideLogs = isProduction && !isTestProduction;

/**
 * Check if pino-pretty is available (it's a devDependency, absent in production Docker builds).
 * Wrapping in try/catch avoids crashing when the package isn't installed.
 */
const hasPinoPretty = (() => {
  try {
    require.resolve("pino-pretty/package.json");
    return true;
  } catch {
    return false;
  }
})();

/**
 * Whether the development pino-pretty transport is active.
 * Production (or a build without pino-pretty) falls back to raw JSON output.
 */
const usePrettyTransport = !shouldHideLogs && hasPinoPretty;

const LOG_LEVEL_NAMES = ["trace", "debug", "info", "warn", "error", "fatal"] as const;

/**
 * Resolves `LOG_LEVEL`, defaulting to `error` in production and `info` elsewhere.
 *
 * Production defaults to `error` because `warn` is developer trace, too noisy for a hoster's
 * dashboards. A hoster diagnosing a user's report raises it to `warn` for the session instead of
 * call sites promoting trace detail to `metric` or `error` to survive the filter. An unknown value
 * falls back to the default so a typo cannot silence errors.
 */
export function resolveLogLevel(raw: string | undefined, hideLogs: boolean): string {
  const requested = raw?.trim().toLowerCase();
  if (requested && (LOG_LEVEL_NAMES as readonly string[]).includes(requested)) return requested;
  return hideLogs ? "error" : "info";
}

/**
 * Optional JSONL log file for host-side ingestion (e.g. Azure Monitor Agent
 * tailing a bind-mounted file). Only used in JSON output mode: the
 * development pino-pretty transport ignores it. See `.env.optional.example`.
 */
const logFilePath = process.env.TOMORI_LOG_FILE?.trim() || undefined;

const REDACTED = "[REDACTED]";
const SENSITIVE_LOG_KEYS = [
  "authorization",
  "proxyAuthorization",
  "cookie",
  "setCookie",
  "password",
  "passwd",
  "token",
  "accessToken",
  "refreshToken",
  "apiKey",
  "clientSecret",
  "databaseUrl",
  "postgresUrl",
  "webhookUrl",
  "signedUrl",
] as const;

/** Defense-in-depth redaction for direct structured Pino fields. */
export const LOG_REDACTION_PATHS = SENSITIVE_LOG_KEYS.flatMap((key) => [
  key,
  `*.${key}`,
  `*.*.${key}`,
  `*.*.*.${key}`,
  `*.*.*.*.${key}`,
]);

/**
 * Builds pino multistream entries that duplicate every JSON record to stdout
 * (preserved for Docker diagnostics) and an append-only JSONL file.
 *
 * Exported for tests: injecting in-memory streams lets tests verify that both
 * sinks receive identical newline-delimited JSON without touching the filesystem.
 *
 * @param filePath - Destination JSONL file path; `undefined` disables file output.
 * @param stdoutStream - Stream receiving the primary output (default `process.stdout`).
 * @param createFileStream - Factory for the file sink (default `pino.destination` in synchronous append mode so no lines are lost on a crash).
 * @returns Stream entries for `pino.multistream()`, or `undefined` when no file is configured.
 */
export const buildLogStreams = (
  filePath: string | undefined,
  stdoutStream: pino.DestinationStream = process.stdout,
  createFileStream: (dest: string) => pino.DestinationStream = (dest) =>
    pino.destination({ dest, append: true, mkdir: true, sync: true }),
): pino.StreamEntry[] | undefined => {
  if (!filePath) return undefined;

  // "trace" lets every record through each sink; level filtering stays on the
  //    logger itself so both outputs always carry identical lines
  return [
    { stream: stdoutStream, level: "trace" },
    { stream: createFileStream(filePath), level: "trace" },
  ];
};

/**
 * Multistream entries for JSON mode. `undefined` when pretty-printing is active
 * or no log file is configured (pino then defaults to stdout only). Pino forbids
 * combining `transport` with an explicit stream, so the pretty transport and the
 * multistream are mutually exclusive by construction.
 */
const jsonStreams = usePrettyTransport ? undefined : buildLogStreams(logFilePath);

/**
 * Pino logger instance with custom levels and formatting
 */
const pinoLogger = pino(
  {
    level: resolveLogLevel(process.env.LOG_LEVEL, shouldHideLogs),
    customLevels: {
      success: 35, // Between info (30) and warn (40)
      section: 31, // Just above info (30)
      // Below info so a severity range query (`level >= 40`) never counts a sample as a problem.
      // `metricLogger` pins its own level, which is what keeps metrics emitted at any LOG_LEVEL.
      metric: 25,
      rateLimit: 55, // Between error (50) and fatal (60)
    },
    redact: {
      paths: LOG_REDACTION_PATHS,
      censor: REDACTED,
    },
    transport: usePrettyTransport
      ? {
          target: "pino-pretty",
          options: {
            colorize: false,
            translateTime: "HH:MM:ss",
            ignore: "pid,hostname",
            customLevels:
              "trace:10,debug:20,metric:25,info:30,section:31,success:35,warn:40,error:50,rateLimit:55,fatal:60",
          },
        }
      : undefined,
  },
  jsonStreams ? pino.multistream(jsonStreams) : undefined,
);

/**
 * The custom level methods `customLevels` above registers. Pino attaches them to the logger
 * instance at runtime, so the base `Logger` type does not declare them. One cast names the whole
 * boundary here instead of an `any` at every call site, and the signatures stay enforced.
 */
interface CustomLevelLogger extends pino.Logger {
  success(message: string): void;
  section(message: string): void;
  metric(payload: Record<string, unknown>, message: string): void;
  rateLimit(payload: Record<string, unknown>, message: string): void;
}

// biome-ignore lint/suspicious/noExplicitAny: Pino adds the custom level methods at runtime
const customLevels = pinoLogger as any as CustomLevelLogger;

const metricLogger = customLevels.child({}, { level: "metric" }) as CustomLevelLogger;

/**
 * ANSI color codes for terminal output
 */
const colors = {
  reset: "\x1b[0m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
  brightYellow: "\x1b[93m",
};

const isCloneSafeLogValue = (value: unknown): boolean =>
  value === null || ["string", "number", "boolean", "undefined"].includes(typeof value);

function normalizeSensitiveKey(key: string): string {
  return key.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

const SENSITIVE_NORMALIZED_KEYS = new Set(SENSITIVE_LOG_KEYS.map(normalizeSensitiveKey));

// Base64 data URIs can reach over 100 KB (e.g. avatar uploads) and split Docker json-file
// driver log lines past 16 KB. Collapsing base64 payloads keeps logs intact while avoiding
// blunt truncation of normal prompts, memories, or stack traces.
// LOG_MAX_STRING_LENGTH is optional; when unset, text strings are never truncated.
function getLogMaxStringLength(): number | undefined {
  const envVal = process.env.LOG_MAX_STRING_LENGTH;
  if (!envVal) return undefined;
  const parsed = Number.parseInt(envVal, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

// Redaction runs this far past the cap before the tail is dropped, so a credential straddling the cut
// is matched whole; cutting first could leave a password that lost its trailing `@` unredacted.
const REDACTION_OVERLAP_CHARS = 512;

function sanitizeLogString(value: string): string {
  const maxStringLength = getLogMaxStringLength();
  if (!maxStringLength || value.length <= maxStringLength) {
    return redactLogString(value);
  }
  const redactedHead = redactLogString(value.slice(0, maxStringLength + REDACTION_OVERLAP_CHARS));
  const truncatedSuffix = `...[TRUNCATED ${value.length - maxStringLength} chars]`;
  const truncatedText = `${redactedHead.slice(0, maxStringLength)}${truncatedSuffix}`;
  return value.includes("\x1b[") ? `${truncatedText}${colors.reset}` : truncatedText;
}

function redactLogString(value: string): string {
  return value
    .replace(/(data:[a-z0-9/._\\+-]+;base64,)[A-Za-z0-9+/=]{80,}/gi, `$1...[BASE64 TRUNCATED]`)
    .replace(/((?:https?|postgres(?:ql)?):\/\/[^:\s/@]+:)[^@\s/]+@/gi, `$1${REDACTED}@`)
    .replace(/\b(Bearer|Basic)\s+[^\s,;]+/gi, `$1 ${REDACTED}`)
    .replace(
      /([?&](?:access_token|refresh_token|token|api[_-]?key|key|signature|sig|x-amz-signature)=)[^&#\s]+/gi,
      `$1${REDACTED}`,
    )
    .replace(
      /((?:\\?["'])?(?:api[_-]?key|apikey|token|secret|authorization|password|passwd|client[_-]?secret)(?:\\?["'])?\s*[:=]\s*(?:\\?["'])?)[^\s,"'\\]+/gi,
      `$1${REDACTED}`,
    )
    .replace(/\b(sk-(?:proj-|ant-|or-)?(?:live-)?[a-zA-Z0-9_-]{20,})\b/gi, REDACTED)
    .replace(/\b(AIza[0-9A-Za-z\-_]{30,40})\b/g, REDACTED)
    .replace(/\b(nvapi-[a-zA-Z0-9_-]{20,})\b/gi, REDACTED)
    .replace(/(https:\/\/(?:canary\.)?discord(?:app)?\.com\/api\/webhooks\/[^/\s]+\/)[^/?\s]+/gi, `$1${REDACTED}`);
}

/**
 * Recursively removes structured credentials and common credential-bearing URL
 * forms before a value reaches either stdout or the JSONL sink.
 */
export function sanitizeLogPayload(value: unknown, depth = 0, truncateStrings = true): unknown {
  if (depth > 8) return "[TRUNCATED]";
  if (typeof value === "string") return truncateStrings ? sanitizeLogString(value) : redactLogString(value);
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((entry) => sanitizeLogPayload(entry, depth + 1, truncateStrings));

  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    output[key] = SENSITIVE_NORMALIZED_KEYS.has(normalizeSensitiveKey(key))
      ? REDACTED
      : sanitizeLogPayload(entry, depth + 1, truncateStrings);
  }
  return output;
}

/**
 * Metric fields reach the production sinks at every log level, so string fields get the same
 * redaction as every other record. Numbers pass through unchanged, which keeps metric queries typed.
 */
export function buildMetricPayload(name: string, fields: Record<string, number | string>): Record<string, unknown> {
  return sanitizeLogPayload({ metric: name, ...fields }) as Record<string, unknown>;
}

const toLoggableError = (err: unknown): Record<string, unknown> => {
  if (err instanceof Error) {
    const safeExtraFields = Object.fromEntries(Object.entries(err).filter(([, value]) => isCloneSafeLogValue(value)));

    return sanitizeLogPayload({
      ...safeExtraFields,
      name: err.name,
      message: err.message,
      stack: err.stack,
    }) as Record<string, unknown>;
  }
  if (typeof err === "object" && err !== null) return sanitizeLogPayload(err) as Record<string, unknown>;
  return { message: sanitizeLogString(String(err)) };
};

/**
 * Logging utility for formatted info, success, error, warning, and section messages.
 * Uses Pino for structured logging with custom levels and pretty printing in development.
 */
export const log = {
  /**
   * Logs informational messages (hidden at the production default level).
   */
  info: (msg: string) => {
    const sanitizedMsg = sanitizeLogString(msg);
    pinoLogger.info(shouldHideLogs ? sanitizedMsg : `${colors.cyan}${sanitizedMsg}${colors.reset}`);
  },

  /**
   * Logs success messages (hidden at the production default level).
   */
  success: (msg: string) => {
    const sanitizedMsg = sanitizeLogString(msg);
    customLevels.success(shouldHideLogs ? `✓ ${sanitizedMsg}` : `${colors.green}✓ ${sanitizedMsg}${colors.reset}`);
  },

  /**
   * Logs developer trace: causes, free text, and stack details that explain an outcome to someone
   * running their own instance. Hidden at the production default level; a hoster opts in with
   * `LOG_LEVEL=warn`.
   * @param err - Optional error object to include.
   */
  warn: (msg: string, err?: unknown, context?: ErrorContext) => {
    const sanitizedPlainMsg = sanitizeLogString(msg);
    const coloredMsg = shouldHideLogs ? sanitizedPlainMsg : `${colors.yellow}${sanitizedPlainMsg}${colors.reset}`;
    const resolvedContext = resolveErrorContext(context);
    const sanitizedContext = sanitizeLogPayload(resolvedContext);
    const sanitizedError = err ? toLoggableError(err) : undefined;
    if (sanitizedError) {
      pinoLogger.warn({ err: sanitizedError, context: sanitizedContext }, coloredMsg);
    } else {
      pinoLogger.warn({ context: sanitizedContext }, coloredMsg);
    }
  },

  /**
   * Logs Discord API rate limit events.
   * Always shown in production for monitoring purposes.
   * @param metadata - Optional metadata object with rate limit details.
   */
  rateLimit: (msg: string, metadata?: Record<string, unknown>) => {
    const sanitizedMsg = sanitizeLogString(msg);
    const coloredMsg = shouldHideLogs ? sanitizedMsg : `${colors.brightYellow}${sanitizedMsg}${colors.reset}`;
    if (metadata) {
      customLevels.rateLimit({ metadata: sanitizeLogPayload(metadata) }, coloredMsg);
    } else {
      customLevels.rateLimit({}, coloredMsg);
    }
  },

  /**
   * Logs a sample that statistics are extracted from, emitted at every log level.
   *
   * Fields are numbers and string dimensions drawn from a fixed set (codes, reason keys, provider
   * names), so a query can group and count on them. Free text such as an error message or a
   * localized heading belongs in `log.warn`: it gives every record its own value and cannot be
   * aggregated. A sample sits below `info` in severity, so it never reads as a problem.
   *
   * @param name - Short metric name (used as the `metric` field for filtering).
   */
  metric: (name: string, fields: Record<string, number | string>) => {
    metricLogger.metric(buildMetricPayload(name, fields), `metric:${name}`);
  },

  /**
   * Logs a failure the hoster must act on, and persists it to `error_logs`. Expected refusals
   * (bad input, an unreachable user endpoint) are not errors: count them with `log.metric` and
   * explain them with `log.warn`.
   * @param err - The actual Error object or unknown error data (optional).
   * @param context - Optional context containing IDs and metadata for DB logging.
   * @param options.persist - `false` when the failure is the database path itself, where an
   *   `error_logs` insert would queue on the pool that just failed.
   */
  error: async (msg: string, err?: unknown, context?: ErrorContext, options?: { persist?: boolean }): Promise<void> => {
    const sanitizedPlainMsg = sanitizeLogString(msg);
    const coloredMsg = shouldHideLogs ? sanitizedPlainMsg : `${colors.red}${sanitizedPlainMsg}${colors.reset}`;
    const resolvedContext = resolveErrorContext(context);
    const sanitizedContext = sanitizeLogPayload(resolvedContext) as ErrorContext | undefined;
    const sanitizedError = err ? toLoggableError(err) : undefined;

    if (sanitizedError) {
      pinoLogger.error({ err: sanitizedError, context: sanitizedContext }, coloredMsg);
    } else {
      pinoLogger.error({ context: sanitizedContext }, coloredMsg);
    }

    if (options?.persist === false || !isErrorDbLoggingEnabled()) {
      return;
    }

    const dbPayload = buildErrorLogPayload(sanitizedPlainMsg, sanitizedError, sanitizedContext);

    // insertErrorLog never throws and reports a skip separately from a failure. Neither is
    // logged here: the record above already reached the durable host file, and emitting a
    // second error line per failed insert is what turns a database outage into a log storm.
    try {
      await errorLogRepository.insertErrorLog(dbPayload);
    } catch (dbError) {
      pinoLogger.error({ err: toLoggableError(dbError) }, "Failed to persist the sanitized error record");
    }
  },

  /**
   * Logs section dividers for grouping related logs (hidden in production).
   */
  section: (msg: string) => {
    if (!shouldHideLogs) {
      const sanitizedMsg = sanitizeLogString(msg);
      const coloredMsg = shouldHideLogs
        ? `\n=== ${sanitizedMsg} ===`
        : `${colors.magenta}\n=== ${sanitizedMsg} ===${colors.reset}`;
      customLevels.section(coloredMsg);
    }
  },
};
