import { describe, expect, spyOn, test } from "bun:test";
import { ToolRegistry } from "@/tools/toolRegistry";
import type { Tool } from "@/types/tool/interfaces";
import type { LlmRow, TomoriState } from "@/types/db/schema";
import type { StructuredContextItem } from "@/types/misc/context";
import { resolveMediaForModel } from "@/utils/text/context/mediaResolver";
import { createLlmRow, createPersona } from "../../helpers/fixtures";

// A blind OpenRouter model, so `resolveEffectiveMediaCapabilities` takes its base-capability path
// instead of consulting the live OpenRouter catalog.
function makeLlm(overrides: Partial<LlmRow>): LlmRow {
  return createLlmRow({
    llm_provider: "openrouter",
    llm_codename: "test-model",
    sees_images: false,
    sees_videos: false,
    ...overrides,
  });
}

function makeState(overrides: { seesImages?: boolean; seesVideos?: boolean; hasVisionTool?: boolean }): TomoriState {
  return createPersona({
    llm: makeLlm({
      sees_images: overrides.seesImages ?? false,
      sees_videos: overrides.seesVideos ?? false,
    }),
    vision_llm: overrides.hasVisionTool ? makeLlm({ llm_id: 2, sees_images: true }) : undefined,
    // `resolveMediaForModel` forwards these capability flags and model pointers to the prompt
    // macro resolver, and the guidance text below is asserted verbatim, so the fixture keeps its
    // all-off set rather than the shared defaults that enable most tool families.
    config: {
      diffusion_model_id: null,
      nai_diffusion_model_id: null,
      video_model_id: null,
      sticker_usage_enabled: false,
      web_search_enabled: false,
      self_teaching_enabled: false,
      manage_message_enabled: false,
      imagegen_enabled: false,
      videogen_enabled: false,
      voice_message_enabled: false,
      thread_creation_enabled: false,
    },
  });
}

function imageItem(overrides: Partial<StructuredContextItem> = {}): StructuredContextItem {
  return {
    role: "user",
    messageId: "111111111111111111",
    parts: [{ type: "text", text: "Alice: look\n[System: This image (Media ID: media_1) was sent by Alice]" }],
    mediaDescriptors: [
      {
        kind: "image",
        uri: "https://cdn.example/image.png",
        mimeType: "image/png",
        fallbackUri: "https://fallback.example/image.png",
        mediaId: "media_1",
        withinWindow: true,
        filename: "image.png",
      },
    ],
    ...overrides,
  };
}

function videoItem(overrides: Partial<StructuredContextItem> = {}): StructuredContextItem {
  return {
    role: "user",
    messageId: "222222222222222222",
    parts: [{ type: "text", text: "Alice: watch\n[System: This video (Media ID: media_2) was sent by Alice]" }],
    mediaDescriptors: [
      {
        kind: "video",
        uri: "https://cdn.example/video.mp4",
        mimeType: "video/mp4",
        mediaId: "media_2",
        withinWindow: true,
        filename: "video.mp4",
        isYouTubeLink: false,
      },
    ],
    ...overrides,
  };
}

describe("resolveMediaForModel", () => {
  test("materializes visible in-window images and removes descriptors", async () => {
    const base = [imageItem()];

    const resolved = await resolveMediaForModel(base, makeState({ seesImages: true }));

    expect(resolved).toHaveLength(1);
    expect(resolved[0].parts[0]).toEqual({
      type: "image",
      uri: "https://cdn.example/image.png",
      mimeType: "image/png",
      fallbackUri: "https://fallback.example/image.png",
    });
    expect(resolved[0].parts[1]).toEqual(base[0].parts[0]);
    expect(resolved[0].mediaDescriptors).toBeUndefined();
    expect(base[0].parts[0].type).toBe("text");
    expect(base[0].mediaDescriptors).toHaveLength(1);
  });

  test("materializes visible in-window videos", async () => {
    const resolved = await resolveMediaForModel([videoItem()], makeState({ seesVideos: true }));

    expect(resolved).toHaveLength(1);
    expect(resolved[0].parts[0]).toEqual({
      type: "video",
      uri: "https://cdn.example/video.mp4",
      mimeType: "video/mp4",
      isYouTubeLink: false,
    });
    expect(resolved[0].parts[1].type).toBe("text");
    expect(resolved[0].mediaDescriptors).toBeUndefined();
  });

  test("emits analyze_image guidance for blind in-window images when a vision tool is configured", async () => {
    const availability = spyOn(ToolRegistry, "getAvailableToolsWithMCP").mockResolvedValue({
      builtInTools: [{ name: "analyze_image" } as Tool],
      mcpFunctionNames: [],
      totalCount: 1,
    });
    try {
      const resolved = await resolveMediaForModel([imageItem()], makeState({ hasVisionTool: true }));
      expect(resolved[0].parts[0]).toEqual({
        type: "text",
        text: "[System: This message (ID: media_1) contains an image. Do not guess the image contents. Use the `analyze_image` tool with this media ID only if the user explicitly asks about the image or if unseen visual details are necessary to answer correctly. The media ID can also be used with tools that accept media references.]",
      });
      expect(resolved[0].parts[1].type).toBe("text");

      const scoped = await resolveMediaForModel([imageItem()], makeState({ hasVisionTool: true }), ["web_search"]);
      const scopedText = scoped[0].parts[0].type === "text" ? scoped[0].parts[0].text : "";
      expect(scopedText).not.toContain("analyze_image");
      expect(scopedText).toContain("media_1");
    } finally {
      availability.mockRestore();
    }
  });

  test("emits plain blind-model guidance when no vision tool is configured", async () => {
    const resolved = await resolveMediaForModel([imageItem()], makeState({}));

    expect(resolved[0].parts[0]).toEqual({
      type: "text",
      text: '[System: This message (ID: media_1) contains an image. Current model cannot see images, please do not describe or claim to see the image contents. If you need to see images, tell the user to setup `/model vision` or to use a different model with the "vision" capability. The media ID can still be used with tools that accept media references.]',
    });
  });

  test("emits plain blind-model guidance for blind in-window videos", async () => {
    const resolved = await resolveMediaForModel([videoItem()], makeState({}));

    expect(resolved[0].parts[0]).toEqual({
      type: "text",
      text: "[System: This message (ID: media_2) contains a video. Current model cannot see videos, please do not describe or claim to see the video contents. The media ID can still be used with tools that accept media references.]",
    });
    expect(resolved[0].parts[1].type).toBe("text");
  });

  test("points at the reply escape hatch for viewable out-of-window media", async () => {
    const base = [
      imageItem({
        parts: [{ type: "text", text: "Alice: old photo" }],
        mediaDescriptors: [
          {
            kind: "image",
            uri: "https://cdn.example/old.png",
            mimeType: "image/png",
            mediaId: "media_4",
            withinWindow: false,
            filename: "old.png",
          },
        ],
      }),
    ];

    const resolved = await resolveMediaForModel(base, makeState({ seesImages: true }));

    expect(resolved[0].parts[0]).toEqual({
      type: "text",
      text: "[System: This message (ID: media_4) contained 1 image, but it is outside the current media context window. Ask the user to reply to that message if you need to see it. The media ID can still be used with tools that accept media references.]",
    });
    expect(resolved[0].parts[1]).toEqual({ type: "text", text: "Alice: old photo" });
  });

  test("points at the reply escape hatch for viewable out-of-window videos", async () => {
    const base = [
      videoItem({
        parts: [{ type: "text", text: "Alice: old clip" }],
        mediaDescriptors: [
          {
            kind: "video",
            uri: "https://cdn.example/old.mp4",
            mimeType: "video/mp4",
            mediaId: "media_9",
            withinWindow: false,
            filename: "old.mp4",
          },
        ],
      }),
    ];

    const resolved = await resolveMediaForModel(base, makeState({ seesVideos: true }));

    expect(resolved[0].parts[0]).toEqual({
      type: "text",
      text: "[System: This message (ID: media_9) contained 1 video, but it is outside the current media context window. Ask the user to reply to that message if you need to see it. The media ID can still be used with tools that accept media references.]",
    });
    expect(resolved[0].parts[1]).toEqual({ type: "text", text: "Alice: old clip" });
  });

  test("keeps out-of-window blind image notices non-fetchable", async () => {
    const base = [
      imageItem({
        parts: [],
        mediaDescriptors: [
          {
            kind: "image",
            uri: "https://cdn.example/old.png",
            mimeType: "image/png",
            mediaId: "media_8",
            withinWindow: false,
            filename: "old.png",
          },
        ],
      }),
    ];

    const resolved = await resolveMediaForModel(base, makeState({}));

    expect(resolved[0].parts).toEqual([
      {
        type: "text",
        text: "[System: This message (ID: media_8) contained 1 image, but it is outside the current media context window and cannot be viewed by the current model. The media ID can still be used with tools that accept media references.]",
      },
    ]);
  });

  test("keeps out-of-window blind video notices non-fetchable", async () => {
    const base = [
      imageItem({
        parts: [],
        mediaDescriptors: [
          {
            kind: "video",
            uri: "https://cdn.example/old.mp4",
            mimeType: "video/mp4",
            mediaId: "media_9",
            withinWindow: false,
            filename: "old.mp4",
          },
        ],
      }),
    ];

    const resolved = await resolveMediaForModel(base, makeState({}));

    expect(resolved[0].parts).toEqual([
      {
        type: "text",
        text: "[System: This message (ID: media_9) contained 1 video, but it is outside the current media context window and cannot be viewed by the current model. The media ID can still be used with tools that accept media references.]",
      },
    ]);
  });

  test("uses GIF wording for blind in-window image notices", async () => {
    const resolved = await resolveMediaForModel(
      [
        imageItem({
          mediaDescriptors: [
            {
              kind: "image",
              uri: "https://cdn.example/loop.gif",
              mimeType: "image/gif",
              mediaId: "media_10",
              withinWindow: true,
              filename: "loop.gif",
            },
          ],
        }),
      ],
      makeState({}),
    );

    expect(resolved[0].parts[0]).toEqual({
      type: "text",
      text: '[System: This message (ID: media_10) contains a GIF. Current model cannot see images, please do not describe or claim to see the image contents. If you need to see images, tell the user to setup `/model vision` or to use a different model with the "vision" capability. The media ID can still be used with tools that accept media references.]',
    });
  });

  test("resolves multiple media descriptors in one message", async () => {
    const base = [
      imageItem({
        parts: [{ type: "text", text: "Alice: mixed media" }],
        mediaDescriptors: [
          {
            kind: "image",
            uri: "https://cdn.example/one.png",
            mimeType: "image/png",
            mediaId: "media_11",
            withinWindow: true,
            filename: "one.png",
          },
          {
            kind: "image",
            uri: "https://cdn.example/two.gif",
            mimeType: "image/gif",
            mediaId: "media_12",
            withinWindow: true,
            filename: "two.gif",
          },
          {
            kind: "video",
            uri: "https://cdn.example/clip.mp4",
            mimeType: "video/mp4",
            mediaId: "media_13",
            withinWindow: true,
            filename: "clip.mp4",
          },
        ],
      }),
    ];

    const resolved = await resolveMediaForModel(base, makeState({ seesImages: true }));

    expect(resolved[0].parts).toEqual([
      {
        type: "image",
        uri: "https://cdn.example/one.png",
        mimeType: "image/png",
      },
      {
        type: "image",
        uri: "https://cdn.example/two.gif",
        mimeType: "image/gif",
      },
      {
        type: "text",
        text: "[System: This message (ID: media_13) contains a video. Current model cannot see videos, please do not describe or claim to see the video contents. The media ID can still be used with tools that accept media references.]",
      },
      { type: "text", text: "Alice: mixed media" },
    ]);
  });

  test("splits blind model-authored media notices into a user-side item", async () => {
    const base = [
      imageItem({
        role: "model",
        parts: [{ type: "text", text: "Tomori: image attached" }],
      }),
    ];

    const resolved = await resolveMediaForModel(base, makeState({}));

    expect(resolved).toHaveLength(2);
    expect(resolved[0].role).toBe("user");
    expect(resolved[0].parts[0].type).toBe("text");
    expect(resolved[1].role).toBe("model");
    expect(resolved[1].parts).toEqual([{ type: "text", text: "Tomori: image attached" }]);
  });

  test("can resolve the same base differently for blind and vision attempts", async () => {
    const base = [imageItem()];

    const blindResolved = await resolveMediaForModel(base, makeState({}));
    const visionResolved = await resolveMediaForModel(base, makeState({ seesImages: true }));

    expect(blindResolved[0].parts[0].type).toBe("text");
    expect(visionResolved[0].parts[0].type).toBe("image");
    expect(base[0].parts[0].type).toBe("text");
    expect(base[0].mediaDescriptors).toHaveLength(1);
  });
});
