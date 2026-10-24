import { describe, expect, it } from "bun:test";
import { readOpenRouterLimitError, OpenRouterLimitError } from "@/providers/openrouter/openrouterLimit";

describe("OpenRouter limit metadata", () => {
  it("extracts media minimum balances only from recognized limit responses", () => {
    const message = "This request requires at least $1.00 in balance for image or video output";
    for (const limitSource of ["openrouter_key_limit", "openrouter_credits"]) {
      const error = readOpenRouterLimitError(
        402,
        new Headers(),
        JSON.stringify({
          error: { message, metadata: { limit_source: limitSource } },
        }),
      );
      expect(error).toMatchObject({ limitSource, minimumBalanceUsd: 1 });
    }
    expect(readOpenRouterLimitError(402, new Headers(), JSON.stringify({ error: { message } }))).toBeNull();
    for (const amount of ["0", "-1", "NaN", "1e300", "9999999999999999999999999999999999999"]) {
      const error = readOpenRouterLimitError(
        402,
        new Headers(),
        JSON.stringify({
          error: {
            message: `This request requires at least $${amount} in balance for image or video output`,
            metadata: { limit_source: "openrouter_key_limit" },
          },
        }),
      );
      expect(error?.minimumBalanceUsd).toBeUndefined();
    }
  });

  it("classifies documented limits on either rejection status and preserves retry timing", () => {
    for (const status of [402, 403]) {
      for (const limitSource of ["openrouter_key_limit", "openrouter_in_flight_budget", "openrouter_credits"]) {
        const error = readOpenRouterLimitError(
          status,
          new Headers({ "Retry-After": "2" }),
          JSON.stringify({ error: { metadata: { limit_source: limitSource } } }),
        );
        expect(error).toBeInstanceOf(OpenRouterLimitError);
        expect(error).toMatchObject({ status, limitSource, retryAfterMs: 2_000 });
      }
    }
  });

  it("ignores other statuses, malformed payloads, and unrecognized sources", () => {
    for (const body of [
      "not-json",
      JSON.stringify({ error: { code: 402, message: "Fixture credits unavailable" } }),
      "null",
      "[]",
      "{}",
      JSON.stringify({ error: { metadata: { limit_source: "unknown" } } }),
    ]) {
      expect(readOpenRouterLimitError(403, new Headers(), body)).toBeNull();
    }
    expect(
      readOpenRouterLimitError(
        429,
        new Headers(),
        JSON.stringify({ error: { metadata: { limit_source: "openrouter_key_limit" } } }),
      ),
    ).toBeNull();
  });
});
