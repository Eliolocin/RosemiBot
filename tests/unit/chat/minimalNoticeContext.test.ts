import { afterEach, beforeAll, describe, expect, it, spyOn } from "bun:test";
import type { ResolvedMinimalNoticeRefRow } from "@/types/db/schema";
import { processEmbedsFromMessage } from "@/utils/chat/contextEmbeds";
import { minimalNoticeRefRepository } from "@/utils/db/repositories/MinimalNoticeRefRepository";
import { resolveMinimalNoticeBodies } from "@/utils/discord/minimalNoticeBodies";
import { buildNoticeContainer } from "@/utils/discord/ui/statusComponents";
import { initializeLocalizer } from "@/utils/text/localizer";

const memoryNotice = (minimal: boolean) =>
  buildNoticeContainer({
    locale: "en-US",
    titleKey: "genai.self_teach.personal_memory_learned_title",
    titleVars: { persona_nickname: "Mirri", user_nickname: "Juno" },
    descriptionKey: "genai.self_teach.personal_memory_learned_description",
    descriptionVars: { user_nickname: "Juno", memory_content: "likes tea" },
    minimal,
  });

function resolvedRow(messageDiscId: string, content: string | null): ResolvedMinimalNoticeRefRow {
  return {
    message_disc_id: messageDiscId,
    ref_kind: "personal_memory",
    ref_id: 303,
    memory_content: content,
    memory_tags: [],
    reminder_purpose: null,
  };
}

function contextFor(components: readonly unknown[], minimalNoticeBody?: string): string {
  return processEmbedsFromMessage({
    embeds: [],
    components,
    minimalNoticeBody,
    content: "",
    imageAttachments: [],
    isTomoriAuthoredMessage: true,
    selfDebugEnabled: false,
    tomoriNickname: "Mirri",
  }).content;
}

describe("Minimal notice bodies in context", () => {
  beforeAll(async () => {
    await initializeLocalizer();
  });

  afterEach(() => {
    spyOn(minimalNoticeRefRepository, "resolveByMessageIds").mockRestore();
  });

  it("looks up only title-only notices and restores the live row as the notice body", async () => {
    const resolve = spyOn(minimalNoticeRefRepository, "resolveByMessageIds").mockResolvedValue(
      new Map([["minimal", resolvedRow("minimal", "{user} likes tea")]]),
    );
    const minimalComponents = memoryNotice(true);

    const bodies = await resolveMinimalNoticeBodies([
      { id: "minimal", components: minimalComponents },
      { id: "verbose", components: memoryNotice(false) },
      { id: "plain", components: [] },
    ]);

    expect(resolve).toHaveBeenCalledWith(["minimal"]);
    const body = bodies.get("minimal");
    expect(body).toContain("ID:303");
    expect(body).toContain("{user} likes tea");
    if (!body) return;

    const restored = contextFor(minimalComponents, body);
    expect(restored).toContain(body);
    expect(restored.length).toBeGreaterThan(contextFor(minimalComponents).length);
  });

  it("skips the query when the window holds no Minimal notice", async () => {
    const resolve = spyOn(minimalNoticeRefRepository, "resolveByMessageIds");

    await resolveMinimalNoticeBodies([{ id: "verbose", components: memoryNotice(false) }]);

    expect(resolve).not.toHaveBeenCalled();
  });

  it("leaves a notice title-only when its memory was deleted", async () => {
    spyOn(minimalNoticeRefRepository, "resolveByMessageIds").mockResolvedValue(
      new Map([["minimal", resolvedRow("minimal", null)]]),
    );

    const bodies = await resolveMinimalNoticeBodies([{ id: "minimal", components: memoryNotice(true) }]);

    expect(bodies.size).toBe(0);
  });
});
