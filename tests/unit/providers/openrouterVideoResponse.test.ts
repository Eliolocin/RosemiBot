import { describe, expect, it, spyOn } from "bun:test";
import {
  downloadOpenRouterVideo,
  fetchOpenRouterVideoApi,
  generateOpenRouterNativeVideo,
  openRouterVideoJobSchema,
} from "@/providers/openrouter/openrouterVideoGeneration";
import { stubGlobalFetch } from "../../helpers/fetchStub";

describe("OpenRouter video response boundaries", () => {
  it("rejects malformed jobs and accepts documented terminal usage", () => {
    const job = { id: "fixture-job", status: "completed", usage: { cost: 0.25 } };
    expect(openRouterVideoJobSchema.parse(job)).toMatchObject(job);
    for (const invalid of [
      { ...job, id: "../other-job" },
      { ...job, id: 42 },
      { ...job, status: "unexpected" },
      { ...job, unsigned_urls: [42] },
      { ...job, usage: { cost: -1 } },
    ])
      expect(openRouterVideoJobSchema.safeParse(invalid).success).toBe(false);
  });

  it("refuses foreign API origins and redacts backend failures", async () => {
    const apiKey = "fixture-private-credential";
    const spawn = spyOn(Bun, "spawn").mockImplementation(() => {
      throw new Error(`Rejected ${apiKey}`);
    });
    try {
      await expect(fetchOpenRouterVideoApi("https://other.example/videos", { method: "POST" })).rejects.toThrow();
      expect(spawn).not.toHaveBeenCalled();
      let failure: unknown;
      try {
        await fetchOpenRouterVideoApi("https://openrouter.ai/api/v1/videos", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}` },
          body: "{}",
        });
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(Error);
      expect(String(failure)).not.toContain(apiKey);
    } finally {
      spawn.mockRestore();
    }
  });

  it("validates ordinary submission and polling and redacts decoded provider errors", async () => {
    const apiKey = "fixture-private-credential";
    const originalSpawn = Bun.spawn;
    const fetchStub = stubGlobalFetch(() => Response.json({ data: [{ id: "test/video-model" }] }));
    const replies = [
      { id: "fixture-job", status: "pending", polling_url: "/api/v1/videos/fixture-job" },
      { id: "fixture-job", status: "failed", error: `Rejected ${apiKey}` },
    ];
    const spawn = spyOn(Bun, "spawn").mockImplementation(() => {
      const body = JSON.stringify(replies.shift());
      const output =
        process.platform === "win32"
          ? JSON.stringify({ status: 200, bodyBase64: Buffer.from(body).toString("base64"), location: "" })
          : `HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n${body}`;
      return originalSpawn(
        [
          process.execPath,
          "-e",
          "process.stdin.resume();process.stdin.on('end',()=>process.stdout.write(process.argv[1]))",
          output,
        ],
        { stdin: "pipe", stdout: "pipe", stderr: "pipe" },
      );
    });
    try {
      let failure: unknown;
      try {
        await generateOpenRouterNativeVideo({ apiKey, model: "test/video-model", prompt: "Fixture video" });
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(Error);
      expect(String(failure)).not.toContain(apiKey);
      expect(replies).toHaveLength(0);
    } finally {
      spawn.mockRestore();
      fetchStub.mockRestore();
    }
  });

  it("refuses already-cancelled submission, polling and authenticated download before spawning", async () => {
    const apiKey = "fixture-private-credential";
    const controller = new AbortController();
    controller.abort(new Error(`Cancelled ${apiKey}`));
    const spawn = spyOn(Bun, "spawn").mockImplementation(() => {
      throw new Error("Unexpected submission");
    });
    const init = { headers: { Authorization: `Bearer ${apiKey}` }, signal: controller.signal };
    const requests = [
      () => fetchOpenRouterVideoApi("https://openrouter.ai/api/v1/videos", { ...init, method: "POST", body: "{}" }),
      () => fetchOpenRouterVideoApi("https://openrouter.ai/api/v1/videos/fixture-job", { ...init, method: "GET" }),
      () =>
        downloadOpenRouterVideo("https://openrouter.ai/api/v1/videos/fixture-job/content", apiKey, controller.signal),
    ];
    try {
      for (const request of requests) {
        let failure: unknown;
        try {
          await request();
        } catch (error) {
          failure = error;
        }
        expect(failure).toBeInstanceOf(Error);
        expect(String(failure)).not.toContain(apiKey);
        expect(spawn).not.toHaveBeenCalled();
      }
    } finally {
      spawn.mockRestore();
    }
  });

  it("honors cancellation after discovery before spawning a submission", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchStub = stubGlobalFetch(() => Response.json({ data: [{ id: "test/cancelled-video-model" }] }));
    const spawn = spyOn(Bun, "spawn").mockImplementation(() => {
      throw new Error("Unexpected submission");
    });
    try {
      await expect(
        generateOpenRouterNativeVideo({
          apiKey: "fixture-key",
          model: "test/cancelled-video-model",
          prompt: "x",
          abortSignal: controller.signal,
        }),
      ).rejects.toThrow();
      expect(spawn).not.toHaveBeenCalled();
    } finally {
      spawn.mockRestore();
      fetchStub.mockRestore();
    }
  });
});
