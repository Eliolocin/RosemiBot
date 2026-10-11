import { describe, expect, it, mock } from "bun:test";
import { MessageFlags, type ButtonInteraction, type Message } from "discord.js";
import {
  attachTextDisplayModalCollector,
  buildTextDisplayModal,
  buildTextDisplayModalButton,
} from "@/utils/discord/textDisplayModal";
import { initializeLocalizer } from "@/utils/text/localizer";
import { localizedCopy } from "../../helpers/localeCases";

describe("text display modal", () => {
  it("preserves text exactly in one large display component", () => {
    const content = "First line\n\n- [Policy](https://example.com/policy)";
    const modal = buildTextDisplayModal({ customId: "legal_text", title: "Privacy Policy", content }).toJSON();

    expect(modal.title).toBe("Privacy Policy");
    expect(modal.components).toHaveLength(1);
    expect(modal.components[0]).toMatchObject({ type: 10, content });
  });

  it("splits long copy without dropping or changing characters", () => {
    const content = "a".repeat(4_001);
    const modal = buildTextDisplayModal({ customId: "long_text", title: "Long text", content }).toJSON();
    const reconstructed = modal.components
      .map((component) => ("content" in component ? component.content : ""))
      .join("");

    expect(modal.components).toHaveLength(2);
    expect(reconstructed).toBe(content);
  });

  it("builds a simple secondary trigger button", () => {
    const row = buildTextDisplayModalButton("tips", "What You Can Do").toJSON();

    expect(row.components[0]).toMatchObject({
      custom_id: "tips",
      label: "What You Can Do",
      style: 2,
      type: 2,
    });
  });

  it("answers a viewer the access gate rejects with an ephemeral notice instead of the modal", async () => {
    await initializeLocalizer();
    let collect: ((interaction: ButtonInteraction) => Promise<void>) | undefined;
    const message = {
      createMessageComponentCollector: () => ({
        on(event: string, listener: (interaction: ButtonInteraction) => Promise<void>) {
          if (event === "collect") collect = listener;
        },
      }),
    } as unknown as Message;
    attachTextDisplayModalCollector({
      message,
      customId: "detail",
      title: "Detail",
      content: "raw",
      timeoutMs: 1_000,
      logLabel: "Detail",
      access: { canOpen: () => false, deniedKey: "genai.error_detail.manage_server_only" },
    });
    const reply = mock(async (_payload: unknown) => undefined);
    const showModal = mock(async () => undefined);

    await collect?.({ locale: "en-US", reply, showModal } as unknown as ButtonInteraction);

    expect(showModal).not.toHaveBeenCalled();
    expect(reply.mock.calls[0]?.[0]).toEqual({
      content: localizedCopy("en-US", "genai.error_detail.manage_server_only"),
      flags: MessageFlags.Ephemeral,
    });
  });
});
