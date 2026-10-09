import { describe, expect, it } from "bun:test";
import { parseAccumulatedToolArguments } from "@/providers/utils/toolCallArguments";
import { log } from "@/utils/misc/logger";

interface RecordedMetric {
  name: string;
  fields: Record<string, number | string>;
}

/** The truncation metric is the only durable evidence production keeps of it. */
function captureMetrics(): { metrics: RecordedMetric[]; restore(): void } {
  const metrics: RecordedMetric[] = [];
  const original = log.metric;
  log.metric = (name: string, fields: Record<string, number | string>) => {
    metrics.push({ name, fields });
  };
  return { metrics, restore: () => Object.assign(log, { metric: original }) };
}

describe("shared streamed tool-argument recovery", () => {
  it("decodes a well-formed payload without marking it truncated", () => {
    const result = parseAccumulatedToolArguments({
      adapterName: "TestAdapter",
      toolName: "lookup",
      rawArguments: '{"query":"birds"}',
    });

    expect(result.args).toEqual({ query: "birds" });
    expect(result.parsed).toBe(true);
    expect(result.truncated).toBe(false);
  });

  it("recovers the keys of a payload the endpoint cut short and reports one metric", () => {
    const { metrics, restore } = captureMetrics();
    try {
      const result = parseAccumulatedToolArguments({
        adapterName: "TestAdapter",
        toolName: "update_short_term_memory",
        rawArguments: '{"scene":"the roof"',
      });

      expect(result.args).toEqual({ scene: "the roof" });
      expect(result.parsed).toBe(false);
      expect(result.truncated).toBe(true);
      expect(metrics).toEqual([
        {
          name: "tool_arguments_truncated",
          fields: {
            adapter: "TestAdapter",
            tool_name: "update_short_term_memory",
            recovered_keys: 1,
            argument_chars: 19,
          },
        },
      ]);
    } finally {
      restore();
    }
  });

  it("keeps the empty-arguments fallback for a payload that cannot be repaired", () => {
    const { metrics, restore } = captureMetrics();
    try {
      const result = parseAccumulatedToolArguments({
        adapterName: "TestAdapter",
        toolName: "lookup",
        rawArguments: "not json at all",
      });

      expect(result.args).toEqual({});
      expect(result.truncated).toBe(false);
      expect(metrics).toEqual([]);
    } finally {
      restore();
    }
  });

  it("treats an absent payload as empty arguments rather than a truncation", () => {
    const result = parseAccumulatedToolArguments({
      adapterName: "TestAdapter",
      toolName: "lookup",
      rawArguments: "",
    });

    expect(result.args).toEqual({});
    expect(result.truncated).toBe(false);
  });
});
