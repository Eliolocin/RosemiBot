import { afterAll, describe, expect, it } from "bun:test";
import { crawl4aiCrawlWithCookies, crawl4aiMarkdown } from "@/tools/restAPIs/crawl4ai/crawl4aiService";
import type { Crawl4aiMarkdownRequest } from "@/tools/restAPIs/crawl4ai/types";
import { FETCH_LIMITS } from "@/utils/security/rateLimiter";

const MIB = 1024 * 1024;
const request: Crawl4aiMarkdownRequest = { url: "https://example.com/", f: "fit" };

let route: (path: string) => Response = () => new Response("unset", { status: 500 });
const crawler = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: (incoming) => route(new URL(incoming.url).pathname),
});
const config = { baseUrl: `http://127.0.0.1:${crawler.port}`, timeoutMs: 10_000 };

afterAll(() => {
  crawler.stop(true);
});

/** A chunked body with no content-length, counting how much the server had to produce. */
function endlessBody(totalBytes: number, counter: { produced: number }): ReadableStream<Uint8Array> {
  return new ReadableStream({
    pull(controller) {
      counter.produced += 256 * 1024;
      controller.enqueue(new Uint8Array(256 * 1024).fill(0x61));
      if (counter.produced >= totalBytes) controller.close();
    },
  });
}

describe("Crawl4AI response handling", () => {
  it("keeps native and crawler body limits effective with malformed deployment settings", async () => {
    const failures: string[] = [];
    for (const runEnv of ["production", "development"]) {
      for (const value of [
        undefined,
        "1",
        "",
        "invalid",
        "0",
        "-1",
        "0.5",
        "5junk",
        "Infinity",
        "1e309",
        "9007199254740992",
      ]) {
        const expectedLimit = value === "1" ? 1 : runEnv === "production" ? 5 : 50;
        // Fresh processes exercise module-load settings without changing another suite's imports.
        const script = `
          import { spyOn } from "bun:test";
          import * as policy from "./src/utils/security/remoteUrlSecurity";
          import { SafeHttpFetchEngine } from "./src/tools/fetchUrl/safeHttpFetchEngine";
          import { crawl4aiMarkdown } from "./src/tools/restAPIs/crawl4ai/crawl4aiService";
          import { FETCH_LIMITS } from "./src/utils/security/rateLimiter";
          import { createPersona } from "./tests/helpers/fixtures";
          spyOn(policy, "validateRemoteUrl").mockResolvedValue({
            valid: true, hostname: "example.org", resolvedAddresses: ["203.0.113.10"]
          });
          const total = (${expectedLimit} + 1) * 1024 * 1024;
          let produced = 0;
          const body = () => new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('{"url":"https://example.org/","filter":"fit","query":null,"cache":"0","success":true,"markdown":"'));
            },
            pull(controller) {
              if (produced >= total) {
                controller.enqueue(new TextEncoder().encode('"}'));
                controller.close();
              } else {
                produced += 64 * 1024;
                controller.enqueue(new Uint8Array(64 * 1024).fill(0x61));
              }
            }
          });
          spyOn(globalThis, "fetch").mockImplementation(async () => new Response(body(), {
            headers: { "content-type": "application/json" }
          }));
          let nativeRefused = false;
          try {
            await new SafeHttpFetchEngine().fetch("https://example.org/", {}, {
              tomoriState: createPersona(), abortSignal: AbortSignal.timeout(5000)
            });
          } catch { nativeRefused = true; }
          const nativeStopped = produced < total;
          produced = 0;
          const crawler = await crawl4aiMarkdown({url: "https://example.org/", f: "fit"}, {
            baseUrl: "http://127.0.0.1:11235", timeoutMs: 5000
          });
          console.log(JSON.stringify({
            limit: FETCH_LIMITS.MAX_FETCH_SIZE_MB,
            nativeRefused, nativeStopped,
            crawlerRefused: !crawler.success, crawlerStopped: produced < total
          }));
        `;
        const child = Bun.spawn([process.execPath, "--no-env-file", "--eval", script], {
          cwd: process.cwd(),
          env: { ...process.env, RUN_ENV: runEnv, MAX_FETCH_SIZE_MB: value, ERROR_DB_LOGGING_ENABLED: "false" },
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
          child.exited,
        ]);
        const result = JSON.parse(stdout.split("\n").find((line) => line.startsWith('{"limit":')) ?? "null");
        if (
          exitCode !== 0 ||
          result?.limit !== expectedLimit ||
          !result?.nativeRefused ||
          !result?.nativeStopped ||
          !result?.crawlerRefused ||
          !result?.crawlerStopped
        )
          failures.push(
            `${runEnv}/${JSON.stringify(value)}: ${JSON.stringify(result)} (exit ${exitCode}, stderr ${stderr.length} bytes)`,
          );
      }
    }
    expect(failures).toEqual([]);
  }, 60_000);

  it("accepts a well-formed /md response", async () => {
    route = () =>
      Response.json({ url: request.url, filter: "fit", query: null, cache: "0", markdown: "# Page", success: true });

    const result = await crawl4aiMarkdown(request, config);

    expect(result.success).toBe(true);
    expect(result.data?.markdown).toBe("# Page");
  });

  it("stops reading an oversized /md body that has no content-length", async () => {
    const counter = { produced: 0 };
    const totalBytes = (FETCH_LIMITS.MAX_FETCH_SIZE_MB + 16) * MIB;
    route = () => new Response(endlessBody(totalBytes, counter), { headers: { "content-type": "application/json" } });

    const result = await crawl4aiMarkdown(request, config);

    expect(result.success).toBe(false);
    expect(counter.produced).toBeLessThan(totalBytes);
  });

  it("refuses malformed JSON and unexpected shapes from either endpoint", async () => {
    const bodies = [
      () => new Response("{not json"),
      () => Response.json({ url: request.url, filter: "fit", markdown: 42, success: true }),
      () => Response.json({ url: request.url, filter: "unknown", markdown: "x", success: true }),
      () => Response.json(["not", "an", "object"]),
      () => Response.json({ success: true, results: "nope" }),
      () =>
        Response.json({ success: true, results: [{ url: request.url, success: true, markdown: { raw_markdown: 7 } }] }),
    ];
    const accepted: number[] = [];
    for (const [index, body] of bodies.entries()) {
      route = body;
      const viaMd = await crawl4aiMarkdown(request, config);
      const viaCrawl = await crawl4aiCrawlWithCookies(request, [{ name: "session", value: "fixture" }], config);
      if (viaMd.success || viaCrawl.success) accepted.push(index);
    }

    expect(accepted).toEqual([]);
  });

  it("bounds an oversized error body and still reports the status", async () => {
    const counter = { produced: 0 };
    route = () => new Response(endlessBody(64 * MIB, counter), { status: 500 });

    const result = await crawl4aiMarkdown(request, config);

    expect(result).toMatchObject({ success: false, statusCode: 500 });
    expect(counter.produced).toBeLessThan(64 * MIB);
  });
});
