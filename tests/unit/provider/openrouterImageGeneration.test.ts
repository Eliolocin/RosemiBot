import { afterEach, describe, expect, it } from "bun:test";
import {
  generateOpenRouterImage,
  usesChatCompletionsImageGeneration,
  OPENROUTER_IMAGE_RESPONSE_MAX_BYTES,
} from "@/providers/openrouter/openrouterImageGeneration";
import { stubGlobalFetch } from "../../helpers/fetchStub";
import { ResponseSizeError } from "@/utils/security/boundedResponse";

interface CapturedCall {
  url: string;
  body: Record<string, unknown>;
}

function stubFetch(payload: unknown, captured: CapturedCall[], status = 200) {
  return stubGlobalFetch(async (input, init) => {
    captured.push({ url: String(input), body: JSON.parse(String(init?.body ?? "{}")) });
    return new Response(JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  });
}

const restore: Array<{ mockRestore: () => void }> = [];
afterEach(() => {
  for (const spy of restore.splice(0)) spy.mockRestore();
});

describe("OpenRouter image generation routing", () => {
  it("sends dedicated image models to the images endpoint, not chat completions", () => {
    // Chat completions answers these with a 404 naming the images endpoint, or an opaque 500.
    expect(usesChatCompletionsImageGeneration("bytedance-seed/seedream-5-0-pro")).toBe(false);
    expect(usesChatCompletionsImageGeneration("qwen/qwen-image-3")).toBe(false);
    expect(usesChatCompletionsImageGeneration("black-forest-labs/flux-1-dev")).toBe(false);
    expect(usesChatCompletionsImageGeneration("google/gemini-2.5-flash-image")).toBe(true);
  });

  it("posts an image model to /api/v1/images and decodes b64_json", async () => {
    const captured: CapturedCall[] = [];
    const spy = stubFetch({ data: [{ b64_json: "QUJD", media_type: "image/webp" }] }, captured);
    restore.push(spy);

    const result = await generateOpenRouterImage({
      apiKey: "key",
      modelCodename: "qwen/qwen-image-3",
      prompt: "a red cube",
      aspectRatio: "2:3",
      referenceImages: [{ mimeType: "image/png", data: "Zm9v" }],
    });

    expect(captured[0]?.url).toBe("https://openrouter.ai/api/v1/images");
    expect(captured[0]?.body).toMatchObject({
      model: "qwen/qwen-image-3",
      prompt: "a red cube",
      aspect_ratio: "2:3",
      input_references: [{ type: "image_url", image_url: { url: "data:image/png;base64,Zm9v" } }],
    });
    // The chat-only fields must not leak onto this endpoint.
    expect(captured[0]?.body).not.toHaveProperty("messages");
    expect(captured[0]?.body).not.toHaveProperty("modalities");
    expect(result).toEqual({ imageData: "QUJD", mimeType: "image/webp" });
  });

  it("keeps Gemini models on chat completions with both modalities", async () => {
    const captured: CapturedCall[] = [];
    const spy = stubFetch(
      { choices: [{ message: { images: [{ image_url: { url: "data:image/png;base64,QUJD" } }] } }] },
      captured,
    );
    restore.push(spy);

    const result = await generateOpenRouterImage({
      apiKey: "key",
      modelCodename: "google/gemini-2.5-flash-image",
      prompt: "a red cube",
      aspectRatio: "1:1",
    });

    expect(captured[0]?.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(captured[0]?.body).toMatchObject({ modalities: ["image", "text"] });
    expect(result).toEqual({ imageData: "QUJD", mimeType: "image/png" });
  });

  it("preserves validated cost on both transports without rejecting images for malformed optional usage", async () => {
    for (const modelCodename of ["test/image-model", "google/gemini-3.1-flash-image"]) {
      for (const cost of [0, 0.25, -1, "invalid", null]) {
        restore.push(
          stubGlobalFetch(() =>
            Response.json({
              data: [{ b64_json: "QUJD", media_type: "image/png" }],
              choices: [{ message: { images: [{ image_url: { url: "data:image/png;base64,QUJD" } }] } }],
              usage: { cost },
            }),
          ),
        );
        const result = await generateOpenRouterImage({
          apiKey: "fixture-key",
          modelCodename,
          prompt: "fixture",
          aspectRatio: "1:1",
        });
        expect(result.imageData).toBe("QUJD");
        expect(result.costUsd).toBe(typeof cost === "number" && cost >= 0 ? cost : undefined);
      }
    }
  });

  it("cancels oversized success and error responses on both image transports", async () => {
    for (const modelCodename of ["test/image-model", "google/gemini-3.1-flash-image"]) {
      for (const status of [200, 401]) {
        let cancelled = false;
        const limit = status === 200 ? OPENROUTER_IMAGE_RESPONSE_MAX_BYTES : 1024 * 1024;
        let remainingBytes = limit + 3 * 1024 * 1024;
        const chunk = new Uint8Array(1024 * 1024);
        const body = new ReadableStream<Uint8Array>({
          pull(controller) {
            if (remainingBytes <= 0) return controller.close();
            const next = chunk.subarray(0, Math.min(remainingBytes, chunk.length));
            remainingBytes -= next.byteLength;
            controller.enqueue(next);
          },
          cancel() {
            cancelled = true;
          },
        });
        const signal = new AbortController().signal;
        restore.push(
          stubGlobalFetch((_url, init) => {
            expect(init?.signal).toBe(signal);
            return new Response(body, { status });
          }),
        );
        await expect(
          generateOpenRouterImage({
            apiKey: "fixture-key",
            modelCodename,
            prompt: "Fixture image",
            aspectRatio: "1:1",
            abortSignal: signal,
          }),
        ).rejects.toBeInstanceOf(ResponseSizeError);
        expect(cancelled).toBe(true);
      }
    }
  });

  it("requests Nano Banana 2.1 at 1K while preserving reference images", async () => {
    const captured: CapturedCall[] = [];
    restore.push(
      stubFetch(
        { choices: [{ message: { images: [{ image_url: { url: "data:image/png;base64,QUJD" } }] } }] },
        captured,
      ),
    );
    await generateOpenRouterImage({
      apiKey: "fixture-key",
      modelCodename: "google/gemini-nano-banana-2.1",
      prompt: "Draw a moon",
      aspectRatio: "1:1",
      referenceImages: [{ mimeType: "image/png", data: "QUJD" }],
    });
    expect(captured[0]?.body).toMatchObject({
      image_config: { aspect_ratio: "1:1", image_size: "1K" },
    });
    expect(captured[0]?.body.messages).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "Draw a moon" },
          { type: "image_url", image_url: { url: "data:image/png;base64,QUJD" } },
        ],
      },
    ]);
  });

  it("rejects malformed provider image fields before media delivery", async () => {
    for (const [modelCodename, payload] of [
      ["test/image-model", { data: [{ b64_json: { private: true } }] }],
      ["google/gemini-3.1-flash-image", { choices: [{ message: { images: [{ image_url: { url: 42 } }] } }] }],
    ] as const) {
      restore.push(stubGlobalFetch(() => Response.json(payload)));
      await expect(
        generateOpenRouterImage({ apiKey: "fixture-key", modelCodename, prompt: "x", aspectRatio: "1:1" }),
      ).rejects.toThrow();
    }
  });

  it("surfaces the provider's own error message on failure", async () => {
    const captured: CapturedCall[] = [];
    const spy = stubFetch(
      { error: { message: "qwen/qwen-image-3 is an image generation model", code: 404 } },
      captured,
      404,
    );
    restore.push(spy);

    await expect(
      generateOpenRouterImage({
        apiKey: "key",
        modelCodename: "qwen/qwen-image-3",
        prompt: "x",
        aspectRatio: "1:1",
      }),
    ).rejects.toThrow("is an image generation model");
  });

  it("preserves validated provider reasons and redacts decoded credentials on both image transports", async () => {
    const apiKey = "fixture-credential-without-a-recognizable-prefix";
    const providerReason = "PROVIDER_REJECTION_CANARY";
    for (const modelCodename of ["test/image-model", "google/gemini-3.1-flash-image"]) {
      for (const payload of [
        { error: `${providerReason} ${apiKey}` },
        { error: { message: `${providerReason} ${apiKey}` } },
        { message: `${providerReason} ${apiKey}` },
      ]) {
        restore.push(
          stubGlobalFetch(
            async () =>
              new Response(JSON.stringify(payload).replaceAll("-", "\\u002d"), {
                status: 401,
                headers: { "Content-Type": "application/json" },
              }),
          ),
        );
        let failure: unknown;
        try {
          await generateOpenRouterImage({ apiKey, modelCodename, prompt: "Fixture image", aspectRatio: "1:1" });
        } catch (error) {
          failure = error;
        }
        expect(failure).toBeInstanceOf(Error);
        expect((failure as Error).message).toContain(providerReason);
        expect((failure as Error).message).not.toContain(apiKey);
      }
    }
  });

  it("formats status-only failures without trailing status whitespace", async () => {
    for (const modelCodename of ["test/image-model", "google/gemini-3.1-flash-image"]) {
      restore.push(stubGlobalFetch(() => new Response("{}", { status: 401, statusText: "" })));
      let failure: unknown;
      try {
        await generateOpenRouterImage({ apiKey: "fixture-key", modelCodename, prompt: "x", aspectRatio: "1:1" });
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toContain("(401)");
    }
  });

  it("omits malformed error bodies containing encoded credentials", async () => {
    const apiKey = "fixture-private-credential";
    const encodedKey = apiKey.replaceAll("-", "\\u002d");
    restore.push(
      stubGlobalFetch(() => new Response(`{"error":{"message":42},"credential":"${encodedKey}"}`, { status: 401 })),
    );
    let failure: unknown;
    try {
      await generateOpenRouterImage({ apiKey, modelCodename: "test/image-model", prompt: "x", aspectRatio: "1:1" });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect(String(failure)).not.toContain(encodedKey);
    expect(String(failure)).not.toContain(apiKey);
  });
});
