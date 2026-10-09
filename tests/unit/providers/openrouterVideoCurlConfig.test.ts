import { afterEach, describe, expect, it } from "bun:test";
import { buildCurlRequestConfig } from "@/providers/openrouter/openrouterVideoGeneration";

describe("OpenRouter video curl request config", () => {
  let server: ReturnType<typeof Bun.serve> | undefined;

  afterEach(() => {
    server?.stop(true);
    server = undefined;
  });

  it("delivers headers and body through stdin byte-exact, with nothing secret in argv", async () => {
    let received: { headers: Record<string, string>; body: string } | undefined;
    server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: async (request) => {
        received = { headers: Object.fromEntries(request.headers.entries()), body: await request.text() };
        return new Response("ok");
      },
    });
    const bearer = "Bearer synthetic-curl-canary";
    const oddHeader = String.raw`quote " backslash \ colon : tab	end`;
    const body = JSON.stringify({ prompt: 'line "one"\nline \\two\\ \t日本語', image: "@not-a-file" });
    // The production call adds `--proto =https`; this loopback fixture is plain HTTP, so the
    // round trip omits only that flag and keeps every other way the config reaches curl.
    const argv = ["curl", "-s", "-S", "-X", "POST", "-K", "-", "-H", "Expect:", `http://127.0.0.1:${server.port}/v`];

    const proc = Bun.spawn(argv, { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    proc.stdin.write(
      buildCurlRequestConfig(
        { Authorization: bearer, "X-Synthetic": oddHeader, "Content-Type": "application/json" },
        body,
      ),
    );
    proc.stdin.end();
    const [exitCode, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);

    expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
    expect(received?.headers.authorization).toBe(bearer);
    expect(received?.headers["x-synthetic"]).toBe(oddHeader);
    expect(received?.body).toBe(body);
    expect(argv.join(" ")).not.toContain("synthetic-curl-canary");
  });
});
