import { afterEach, describe, expect, it } from "bun:test";
import {
  downloadOpenRouterVideo,
  PWSH_HTTP_SCRIPT,
  readBoundedProcessOutput,
} from "@/providers/openrouter/openrouterVideoGeneration";
import { PROVIDER_VIDEO_DOWNLOAD_MAX_MB } from "@/providers/utils/providerVideoDownload";

describe("OpenRouter video download bounds", () => {
  let server: ReturnType<typeof Bun.serve> | undefined;

  afterEach(() => {
    server?.stop(true);
    server = undefined;
  });

  it("kills a helper process whose output passes the cap", async () => {
    const proc = Bun.spawn([process.execPath, "-e", "process.stdout.write(Buffer.alloc(16 * 1024 * 1024))"], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    await expect(readBoundedProcessOutput(proc, 1024 * 1024, { maxBodyBytes: 1024 * 1024 })).rejects.toThrow("exceeds");
    expect(await proc.exited).not.toBe(0);
  });

  it("kills a helper process when the request is cancelled", async () => {
    const proc = Bun.spawn([process.execPath, "-e", "setInterval(() => {}, 1000)"], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    const controller = new AbortController();
    const pending = readBoundedProcessOutput(proc, 1024, { maxBodyBytes: 1024, abortSignal: controller.signal });
    controller.abort();
    const result = await pending;
    expect(result.exitCode).not.toBe(0);
  });

  it("downloads a third-party video anonymously, refusing one past the size cap", async () => {
    const authorization: Array<string | null> = [];
    const oversized = PROVIDER_VIDEO_DOWNLOAD_MAX_MB * 1024 * 1024 + 1;
    server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (request) => {
        authorization.push(request.headers.get("authorization"));
        const path = new URL(request.url).pathname;
        if (path === "/missing.mp4") return new Response("gone", { status: 404 });
        if (path === "/huge.mp4") {
          const chunk = new Uint8Array(1024 * 1024);
          let sent = 0;
          return new Response(
            new ReadableStream({
              pull(controller) {
                if (sent >= oversized) return controller.close();
                sent += chunk.byteLength;
                controller.enqueue(chunk);
              },
            }),
          );
        }
        return new Response(Buffer.from("small-video"));
      },
    });
    const base = `http://127.0.0.1:${server.port}`;

    const small = await downloadOpenRouterVideo(`${base}/ok.mp4`, "sk-or-synthetic-canary", undefined);
    expect(small.videoData?.toString()).toBe("small-video");
    const huge = await downloadOpenRouterVideo(`${base}/huge.mp4`, "sk-or-synthetic-canary", undefined);
    expect(huge.videoData).toBeNull();
    const missing = await downloadOpenRouterVideo(`${base}/missing.mp4`, "sk-or-synthetic-canary", undefined);
    expect(missing.status).toBe(404);
    expect(authorization).toEqual([null, null, null]);
  });

  // The PowerShell helper only runs on Windows hosts, where OpenRouter's storage redirect must come
  // back as a Location for the anonymous download instead of failing the request.
  it.skipIf(process.platform !== "win32" || !Bun.which("pwsh"))(
    "returns a redirect's Location from the PowerShell helper and still fails a refused connection",
    async () => {
      server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch: () => new Response(null, { status: 302, headers: { Location: "https://cdn.example.test/video.mp4" } }),
      });
      const runHelper = async (url: string) => {
        const proc = Bun.spawn(["pwsh", "-NoProfile", "-NonInteractive", "-Command", PWSH_HTTP_SCRIPT], {
          stdin: "pipe",
          stdout: "pipe",
          stderr: "pipe",
        });
        proc.stdin.write(JSON.stringify({ url, method: "GET", headers: {} }));
        proc.stdin.end();
        const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
        return { stdout, exitCode };
      };

      const redirected = await runHelper(`http://127.0.0.1:${server.port}/content`);
      expect(redirected.exitCode).toBe(0);
      expect(JSON.parse(redirected.stdout)).toMatchObject({
        status: 302,
        location: "https://cdn.example.test/video.mp4",
      });
      expect((await runHelper("http://127.0.0.1:1/content")).exitCode).not.toBe(0);
    },
    30_000,
  );
});
