import { beforeAll, describe, expect, test } from "bun:test";
import { ComponentType, MessageFlags, type TextDisplayComponentData } from "discord.js";
import { buildGeneratedImageComponentsV2Payload } from "@/utils/discord/generatedImageMessage";
import { initializeLocalizer } from "@/utils/text/localizer";
import { localizedCopy } from "../../helpers/localeCases";

describe("buildGeneratedImageComponentsV2Payload", () => {
  beforeAll(async () => {
    await initializeLocalizer();
  });

  test("builds a media gallery followed by localized timing subtext", () => {
    const payload = buildGeneratedImageComponentsV2Payload("generated_123.png", 4242, "en-US");

    expect(payload.flags).toBe(MessageFlags.IsComponentsV2);
    expect(payload.components).toEqual([
      {
        type: ComponentType.MediaGallery,
        items: [
          {
            media: {
              url: "attachment://generated_123.png",
            },
          },
        ],
      },
      {
        type: ComponentType.TextDisplay,
        content: `-# ${localizedCopy("en-US", "tools.image.generated_after_seconds_line", { seconds: "4.2" })}`,
      },
    ]);
  });

  test("appends a referenced-identities subtext line when avatars were used", () => {
    const payload = buildGeneratedImageComponentsV2Payload("generated_123.png", 4242, "en-US", ["Aphel", "Miku"]);

    const textComponent = payload.components.find(
      (component): component is TextDisplayComponentData & { content: string } =>
        "type" in component && component.type === ComponentType.TextDisplay && "content" in component,
    );
    if (!textComponent) throw new Error("Generated image payload is missing its timing text display");
    const lines = textComponent.content.split("\n");

    // Timing stays on the first line; referenced users render on their own line.
    expect(lines[0]).toContain(localizedCopy("en-US", "tools.image.generated_after_seconds_line", { seconds: "4.2" }));
    expect(lines[1]).toBe(
      `-# ${localizedCopy("en-US", "tools.image.referenced_identities_line", { names: "Aphel, Miku" })}`,
    );
  });

  test("points to the prompt attachment when metadata exceeds the upload limit", () => {
    const payload = buildGeneratedImageComponentsV2Payload("generated.jpg", 4242, "en-US", [], true);
    const textComponent = payload.components[2] as TextDisplayComponentData;

    expect(payload.components[1]).toEqual({
      type: ComponentType.File,
      file: { url: "attachment://image_prompt.txt" },
    });
    expect(textComponent.content).toContain(localizedCopy("en-US", "commands.generate.image.prompt_attached_footer"));
  });
});
