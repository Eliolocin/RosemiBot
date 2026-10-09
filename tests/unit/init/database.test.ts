import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { measurePresetArtPhase } from "@/init/database";
import { log } from "@/utils/misc/logger";

const savedRunEnv = process.env.RUN_ENV;

let metricSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  delete process.env.RUN_ENV;
  metricSpy = spyOn(log, "metric").mockImplementation(() => {});
});

afterEach(() => {
  metricSpy.mockRestore();
  if (savedRunEnv === undefined) delete process.env.RUN_ENV;
  else process.env.RUN_ENV = savedRunEnv;
});

describe("measurePresetArtPhase", () => {
  it("does not emit preset_art_phase metric in non-production environments", async () => {
    process.env.RUN_ENV = "development";

    const result = await measurePresetArtPhase("fanout", async () => "value");

    expect(result).toBe("value");
    expect(metricSpy).not.toHaveBeenCalled();
  });

  it("does not emit preset_art_phase metric when RUN_ENV is unset", async () => {
    delete process.env.RUN_ENV;

    const result = await measurePresetArtPhase("total", async () => "ok");

    expect(result).toBe("ok");
    expect(metricSpy).not.toHaveBeenCalled();
  });

  it("emits started and completed phase markers in production environments", async () => {
    process.env.RUN_ENV = "production";

    const result = await measurePresetArtPhase("fanout", async () => "done");

    expect(result).toBe("done");
    expect(metricSpy).toHaveBeenCalledTimes(2);
    expect(metricSpy).toHaveBeenNthCalledWith(
      1,
      "preset_art_phase",
      expect.objectContaining({
        phase: "fanout",
        status: "started",
        rss_mb: expect.any(Number),
        heap_used_mb: expect.any(Number),
      }),
    );
    expect(metricSpy).toHaveBeenNthCalledWith(
      2,
      "preset_art_phase",
      expect.objectContaining({
        phase: "fanout",
        status: "completed",
        duration_ms: expect.any(Number),
        rss_mb: expect.any(Number),
        heap_used_mb: expect.any(Number),
      }),
    );
  });

  it("emits failed phase marker when action throws in production", async () => {
    process.env.RUN_ENV = "production";

    await expect(
      measurePresetArtPhase("sprites", async () => {
        throw new Error("seed failed");
      }),
    ).rejects.toThrow("seed failed");

    expect(metricSpy).toHaveBeenCalledTimes(2);
    expect(metricSpy).toHaveBeenNthCalledWith(
      1,
      "preset_art_phase",
      expect.objectContaining({ phase: "sprites", status: "started" }),
    );
    expect(metricSpy).toHaveBeenNthCalledWith(
      2,
      "preset_art_phase",
      expect.objectContaining({
        phase: "sprites",
        status: "failed",
        duration_ms: expect.any(Number),
      }),
    );
  });
});
