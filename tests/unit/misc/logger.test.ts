import { describe, expect, spyOn, test } from "bun:test";
import { errorLogRepository } from "@/utils/db/repositories/ErrorLogRepository";
import {
  buildLogStreams,
  buildMetricPayload,
  LOG_REDACTION_PATHS,
  log,
  resolveLogLevel,
  sanitizeLogPayload,
} from "@/utils/misc/logger";
import pino from "pino";
import { useEnvSandbox } from "../../helpers/env";

useEnvSandbox(["LOG_MAX_STRING_LENGTH"]);

/**
 * Minimal in-memory sink implementing pino's DestinationStream contract.
 * Collects newline-delimited records for assertion.
 */
class MemorySink implements pino.DestinationStream {
  readonly lines: string[] = [];

  write(chunk: string): void {
    // Pino writes one newline-terminated JSON record per call
    this.lines.push(...chunk.split("\n").filter((line) => line.length > 0));
  }
}

/**
 * Mirrors the production logger construction from logger.ts:
 * JSON mode (no transport), level "error", same custom levels, multistream output, and the
 * metric child logger that pins its own level.
 */
const createProductionLikeLogger = (streams: pino.StreamEntry[]) => {
  const logger = pino(
    {
      level: "error",
      customLevels: { success: 35, section: 31, metric: 25, rateLimit: 55 },
      redact: { paths: LOG_REDACTION_PATHS, censor: "[REDACTED]" },
    },
    pino.multistream(streams),
  );
  return { logger, metricLogger: logger.child({}, { level: "metric" }) };
};

describe("buildLogStreams", () => {
  test("returns undefined when no log file is configured", () => {
    // Preserves pino's default single-stream stdout construction
    expect(buildLogStreams(undefined)).toBeUndefined();
  });

  test("creates the file sink at the configured path alongside stdout", () => {
    const createdPaths: string[] = [];
    const stdoutSink = new MemorySink();

    const streams = buildLogStreams("/app/logs/tomoribot.jsonl", stdoutSink, (dest) => {
      createdPaths.push(dest);
      return new MemorySink();
    });

    expect(streams).toHaveLength(2);
    expect(streams?.[0]?.stream).toBe(stdoutSink);
    expect(createdPaths).toEqual(["/app/logs/tomoribot.jsonl"]);
  });

  test("production logger writes identical JSONL to stdout and file sinks", () => {
    const stdoutSink = new MemorySink();
    const fileSink = new MemorySink();
    const streams = buildLogStreams("/app/logs/tomoribot.jsonl", stdoutSink, () => fileSink);
    if (!streams) throw new Error("Expected stream entries when a file path is configured");

    const { logger, metricLogger } = createProductionLikeLogger(streams);

    // Error record with nested err/context shapes, as produced by log.error()
    logger.error({ err: { name: "TypeError", message: "boom" }, context: { commandName: "chat" } }, "Chat turn failed");
    // The metric level sits below info, so only the child's pinned level lets it through
    // biome-ignore lint/suspicious/noExplicitAny: Custom Pino level added at runtime
    (metricLogger as any).metric({ metric: "cache_sizes" }, "metric:cache_sizes");
    // Below the production "error" level, so must be filtered from BOTH sinks
    logger.info("hidden in production");
    logger.warn("hidden in production");

    // Both sinks received byte-identical newline-delimited records
    expect(stdoutSink.lines).toEqual(fileSink.lines);
    expect(stdoutSink.lines).toHaveLength(2);

    // Every nonempty line is one valid JSON object with the expected fields
    const [errorRecord, metricRecord] = stdoutSink.lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(errorRecord?.level).toBe(50);
    expect(errorRecord?.msg).toBe("Chat turn failed");
    expect((errorRecord?.err as Record<string, unknown> | undefined)?.message).toBe("boom");
    expect((errorRecord?.context as Record<string, unknown> | undefined)?.commandName).toBe("chat");
    // A severity range query must never count a sample as a problem
    expect(metricRecord?.level).toBeLessThan(30);
    expect(metricRecord?.msg).toBe("metric:cache_sizes");
  });

  test("representative credentials never reach stdout or the JSONL sink", () => {
    const stdoutSink = new MemorySink();
    const fileSink = new MemorySink();
    const streams = buildLogStreams("/app/logs/tomoribot.jsonl", stdoutSink, () => fileSink);
    if (!streams) throw new Error("Expected stream entries when a file path is configured");

    const { logger } = createProductionLikeLogger(streams);
    const secrets = ["super-secret-password", "provider-api-token", "discord-webhook-token", "signed-query-value"];

    logger.error(
      sanitizeLogPayload({
        password: secrets[0],
        context: {
          apiKey: secrets[1],
          webhookUrl: `https://discord.com/api/webhooks/123/${secrets[2]}`,
          requestUrl: `https://example.com/file?X-Amz-Signature=${secrets[3]}`,
          headers: { authorization: `Bearer ${secrets[1]}`, cookie: `session=${secrets[0]}` },
        },
        err: {
          message: `Database failed at postgresql://tomori:${secrets[0]}@db.example.com/tomori`,
        },
      }),
      "Sanitized failure",
    );

    expect(stdoutSink.lines).toEqual(fileSink.lines);
    const serialized = stdoutSink.lines.join("\n");
    for (const secret of secrets) expect(serialized).not.toContain(secret);
    expect(serialized).toContain("[REDACTED]");
  });

  test("long strings are preserved without truncation when LOG_MAX_STRING_LENGTH is unset", () => {
    delete process.env.LOG_MAX_STRING_LENGTH;
    const longPrompt = `User prompt: ${"a".repeat(50_000)}`;
    const sanitized = sanitizeLogPayload(longPrompt) as string;
    expect(sanitized).toBe(longPrompt);
    expect(sanitized).not.toContain("[TRUNCATED");
  });

  test("base64 data URIs are collapsed regardless of string length cap", () => {
    const base64DataUri = `data:image/png;base64,${"A".repeat(500)}`;
    const sanitized = sanitizeLogPayload(`Avatar payload: ${base64DataUri}`) as string;
    expect(sanitized).toContain("data:image/png;base64,...[BASE64 TRUNCATED]");
    expect(sanitized).not.toContain("A".repeat(100));
  });

  test("long strings are capped when LOG_MAX_STRING_LENGTH is explicitly configured", () => {
    process.env.LOG_MAX_STRING_LENGTH = "4096";
    const secret = "straddling-password";
    // The password starts just before the 4096-character cap and ends past it.
    const prefix = "x".repeat(4096 - 30);
    const sanitized = sanitizeLogPayload(
      `${prefix} postgresql://tomori:${secret}@db.example.com/tomori ${"y".repeat(100_000)}`,
    ) as string;

    expect(sanitized).not.toContain(secret);
    expect(sanitized).not.toContain("straddling");
    expect(sanitized).toContain("[TRUNCATED");
    expect(sanitized.length).toBeLessThan(4200);
  });

  test("strings under the cap are only redacted, never truncated", () => {
    const value = `short ${"z".repeat(1000)}`;
    expect(sanitizeLogPayload(value)).toBe(value);
  });

  test("provider API keys and key-value assignments are redacted in strings", () => {
    const rawKeys = [
      "sk-proj-1234567890abcdef1234567890",
      "sk-ant-api03-abcdef123456789012345",
      "AIzaSyA1234567890123456789012345678901",
      "nvapi-1234567890abcdef1234567890",
    ];

    for (const key of rawKeys) {
      const sanitized = sanitizeLogPayload(`Upstream error with token ${key} in request`) as string;
      expect(sanitized).not.toContain(key);
      expect(sanitized).toContain("[REDACTED]");
    }

    const keyValueString = sanitizeLogPayload(
      'Failed with api_key: "temp-secret-key-123" and secret=mySecret456',
    ) as string;
    expect(keyValueString).not.toContain("temp-secret-key-123");
    expect(keyValueString).not.toContain("mySecret456");
    expect(keyValueString).toContain("[REDACTED]");

    const jsonString = sanitizeLogPayload(
      JSON.stringify({ apiKey: "secret-key-123", api_key: "secret-456" }),
    ) as string;
    expect(jsonString).not.toContain("secret-key-123");
    expect(jsonString).not.toContain("secret-456");
    expect(jsonString).toBe('{"apiKey":"[REDACTED]","api_key":"[REDACTED]"}');

    const escapedJson = sanitizeLogPayload('{"error":"{\\"apiKey\\":\\"escaped-secret\\"}"}') as string;
    expect(escapedJson).not.toContain("escaped-secret");
    expect(escapedJson).toContain("[REDACTED]");
  });

  test("structured metadata objects have sensitive fields and nested keys redacted", () => {
    const sensitivePayload = {
      command: "persona generate",
      apiKey: "super-secret-key",
      details: {
        api_key: "nested-secret-key",
        normalField: "safe-value",
      },
    };

    const sanitized = sanitizeLogPayload(sensitivePayload) as Record<string, unknown>;
    expect(sanitized.apiKey).toBe("[REDACTED]");
    expect((sanitized.details as Record<string, unknown>).api_key).toBe("[REDACTED]");
    expect((sanitized.details as Record<string, unknown>).normalField).toBe("safe-value");
  });

  test("truncated colored strings preserve ANSI reset sequence", () => {
    process.env.LOG_MAX_STRING_LENGTH = "4096";
    const longColoredText = `\x1b[33m${"x".repeat(5000)}\x1b[0m`;
    const sanitized = sanitizeLogPayload(longColoredText) as string;
    expect(sanitized).toContain("[TRUNCATED");
    expect(sanitized.endsWith("\x1b[0m")).toBe(true);
  });

  test("metric payloads redact free-text credentials while numeric fields keep their type", () => {
    const syntheticKey = "sk-proj-SYNTHETICmetricCANARY0123456789";
    const payload = buildMetricPayload("panel_failure_detail", {
      reason: "custom_endpoint_unreachable",
      detail: `HTTP 401 from https://admin:hunter2-canary@endpoint.example/v1 with Bearer ${syntheticKey}`,
      apiKey: "plain-canary-value",
      duration_ms: 42,
      rss_mb: 12.5,
    });
    const serialized = JSON.stringify(payload);

    expect(payload.metric).toBe("panel_failure_detail");
    expect(payload.reason).toBe("custom_endpoint_unreachable");
    expect(payload.duration_ms).toBe(42);
    expect(payload.rss_mb).toBe(12.5);
    expect(payload.apiKey).toBe("[REDACTED]");
    for (const canary of [syntheticKey, "hunter2-canary", "plain-canary-value"]) {
      expect(serialized).not.toContain(canary);
    }
  });

  test("the custom level methods are registered on the live logger", () => {
    // `log` exposes success, section, metric, and rateLimit through one typed cast over the pino
    // instance. A name pino was never given would throw instead of logging, so calling each one is
    // the regression guard for that boundary. Output routing is covered by buildLogStreams above.
    expect(() => log.section("section probe")).not.toThrow();
    expect(() => log.success("success probe")).not.toThrow();
    expect(() => log.metric("metric_probe", { value: 7 })).not.toThrow();
    expect(() => log.rateLimit("rate limit probe", { bucket: "messages" })).not.toThrow();
    expect(() => log.rateLimit("rate limit probe without metadata")).not.toThrow();
  });
});

describe("resolveLogLevel", () => {
  test("defaults to error in production and info elsewhere", () => {
    expect(resolveLogLevel(undefined, true)).toBe("error");
    expect(resolveLogLevel(undefined, false)).toBe("info");
  });

  test("lets a hoster raise production verbosity to warn", () => {
    expect(resolveLogLevel(" WARN ", true)).toBe("warn");
  });

  test("falls back to the default for an unknown value so a typo cannot silence errors", () => {
    expect(resolveLogLevel("verbose", true)).toBe("error");
    expect(resolveLogLevel("", false)).toBe("info");
  });
});

describe("log.error persistence", () => {
  test("persist: false skips the error_logs insert", async () => {
    const insertSpy = spyOn(errorLogRepository, "insertErrorLog");
    try {
      await log.error("pool probe", new Error("pool retired"), undefined, { persist: false });
      expect(insertSpy).not.toHaveBeenCalled();
    } finally {
      insertSpy.mockRestore();
    }
  });
});
