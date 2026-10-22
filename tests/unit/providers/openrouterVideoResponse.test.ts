import { describe, expect, it, mock, spyOn } from "bun:test";
import { supporterSpendGuard } from "@/modules/supporter-billing/runtime/spendGuard";
import {
  downloadOpenRouterVideo,
  fetchOpenRouterVideoApi,
  generateOpenRouterNativeVideo,
  openRouterVideoJobSchema,
} from "@/providers/openrouter/openrouterVideoGeneration";
import { stubGlobalFetch } from "../../helpers/fetchStub";
import { findOpenRouterLimitError } from "@/providers/openrouter/openrouterLimit";

/** Answers each external-helper request in order, through a real child process like the helper itself. */
function spawnReplies(replies: Array<{ status: number; body: unknown }>) {
  const originalSpawn = Bun.spawn;
  return spyOn(Bun, "spawn").mockImplementation(() => {
    const reply = replies.shift();
    if (!reply) throw new Error("Unexpected external request");
    const body = JSON.stringify(reply.body);
    const output =
      process.platform === "win32"
        ? JSON.stringify({ status: reply.status, bodyBase64: Buffer.from(body).toString("base64"), location: "" })
        : `HTTP/1.1 ${reply.status} Fixture
Content-Type: application/json

${body}`;
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
}

describe("OpenRouter video response boundaries", () => {
  it("releases failed video estimates and preserves any reported charge", async () => {
    const fetchStub = stubGlobalFetch(() => Response.json({ data: [{ id: "test/failed-video-model" }] }));
    const release = mock((_retainEstimate?: boolean) => {});
    const reportCost = mock((_cost: number | null | undefined) => {});
    const begin = spyOn(supporterSpendGuard, "begin").mockResolvedValue({ release, reportCost });
    try {
      for (const status of ["failed", "cancelled", "expired"]) {
        const spawn = spawnReplies([
          { status: 200, body: { id: "fixture-job", status: "pending", polling_url: "/api/v1/videos/fixture-job" } },
          { status: 200, body: { id: "fixture-job", status, usage: { cost: 0.25 } } },
        ]);
        try {
          await expect(
            generateOpenRouterNativeVideo({
              apiKey: "fixture-key",
              model: "test/failed-video-model",
              prompt: "Fixture video",
            }),
          ).rejects.toThrow();
          expect(release).toHaveBeenLastCalledWith(false);
          expect(reportCost).toHaveBeenLastCalledWith(0.25);
        } finally {
          spawn.mockRestore();
        }
      }
      for (const body of [{ status: "pending" }, { id: "fixture-job", status: "pending" }]) {
        const spawn = spawnReplies([{ status: 200, body }]);
        try {
          await expect(
            generateOpenRouterNativeVideo({
              apiKey: "fixture-key",
              model: "test/failed-video-model",
              prompt: "Fixture video",
            }),
          ).rejects.toThrow();
          expect(release).toHaveBeenLastCalledWith(false);
        } finally {
          spawn.mockRestore();
        }
      }
      expect(release).toHaveBeenCalledTimes(5);
    } finally {
      begin.mockRestore();
      fetchStub.mockRestore();
    }
  });

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

  it("keeps the member key limit on a rejected submission without exposing the key", async () => {
    const apiKey = "fixture-private-credential";
    const fetchStub = stubGlobalFetch(() => Response.json({ data: [{ id: "test/limited-video-model" }] }));
    const spawn = spawnReplies([
      {
        status: 403,
        body: {
          error: { code: 403, message: "Key limit exceeded", metadata: { limit_source: "openrouter_key_limit" } },
        },
      },
    ]);
    try {
      const failure = await generateOpenRouterNativeVideo({
        apiKey,
        model: "test/limited-video-model",
        prompt: "Fixture video",
      }).catch((error: unknown) => error);
      expect(findOpenRouterLimitError(failure)).toMatchObject({ limitSource: "openrouter_key_limit", status: 403 });
      expect(String(failure)).not.toContain(apiKey);
    } finally {
      spawn.mockRestore();
      fetchStub.mockRestore();
    }
  });

  it("reports a completed job's cost with its job id even when the download fails", async () => {
    const fetchStub = stubGlobalFetch(() => Response.json({ data: [{ id: "test/billed-video-model" }] }));
    const spawn = spawnReplies([
      { status: 200, body: { id: "fixture-job", status: "pending", polling_url: "/api/v1/videos/fixture-job" } },
      { status: 200, body: { id: "fixture-job", status: "completed", usage: { cost: 0.25 } } },
      { status: 500, body: { error: { message: "storage unavailable" } } },
    ]);
    try {
      expect(
        await generateOpenRouterNativeVideo({
          apiKey: "fixture-key",
          model: "test/billed-video-model",
          prompt: "Fixture video",
        }),
      ).toEqual({ videoData: null, mimeType: null, costUsd: 0.25, providerRequestId: "fixture-job" });
    } finally {
      spawn.mockRestore();
      fetchStub.mockRestore();
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
