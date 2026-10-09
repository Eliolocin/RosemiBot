import { beforeAll, describe, expect, it } from "bun:test";
import { AttachmentBuilder, type ModalSubmitInteraction } from "discord.js";
import { replyInfoEmbed } from "@/utils/discord/ui/interactionCore";
import { initializeLocalizer } from "@/utils/text/localizer";

describe("replyInfoEmbed attachments", () => {
  beforeAll(async () => {
    await initializeLocalizer();
  });

  it("uploads a recovery file with a deferred modal error reply", async () => {
    const file = new AttachmentBuilder(Buffer.from("prompt"), { name: "image_generation_input.txt" });
    let payload: unknown;
    const interaction = {
      id: "1",
      deferred: true,
      replied: false,
      guild: { id: "2" },
      user: { id: "3" },
      editReply: async (options: unknown) => {
        payload = options;
        return {};
      },
    } as unknown as ModalSubmitInteraction;

    await replyInfoEmbed(interaction, "en-US", {
      titleKey: "commands.generate.image.error_generation_failed_title",
      descriptionKey: "commands.generate.image.error_generation_failed_description",
      descriptionVars: { error: "test" },
      footerKey: "commands.generate.image.recovery_file_footer",
      files: [file],
    });

    expect(payload).toMatchObject({ files: [file] });
  });
});
