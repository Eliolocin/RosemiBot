import { beforeAll, describe, expect, it } from "bun:test";
import { EmbedBuilder, type Embed, type Message } from "discord.js";
import {
  PROTOCOL_KEYS,
  buildProtocolLookup,
  classifyProtocolEmbed,
  classifyProtocolTitle,
} from "@/utils/discord/embedProtocol";
import { checkTargetEmbed } from "@/utils/discord/embedClassifier";
import { isRefreshMarkerEmbed, sliceMessagesAtResetMarker } from "@/utils/discord/embedDetection";
import { createStandardEmbed } from "@/utils/discord/embedHelper";
import { stripStatusCircle } from "@/utils/discord/ui/statusTitle";
import { buildConversationEmbed } from "@/utils/compaction/compact/rendering";
import { findReplyContextTargetInMessage } from "@/utils/chat/contextAnnotations";
import { ColorCode } from "@/utils/misc/logger";
import { getSupportedLocales, hasLocaleKey, initializeLocalizer, localizer } from "@/utils/text/localizer";
import { localizedCopy } from "../../helpers/localeCases";

beforeAll(async () => {
  await initializeLocalizer();
});

function message(embed?: EmbedBuilder): Pick<Message, "embeds"> {
  return { embeds: embed ? [embed.toJSON() as unknown as Embed] : [] };
}

/** Recreates an embed posted while the bot still wrote the footer token. */
function withLegacyToken(embed: EmbedBuilder, kind: string): EmbedBuilder {
  return embed.setFooter({ text: `[tomori:v1:${kind}]` });
}

describe("embed protocol", () => {
  it("recognizes historical localized titles without a marker", () => {
    const oldEmbed = new EmbedBuilder().setTitle(localizer("ja", "commands.refresh.title"));
    expect(classifyProtocolEmbed(oldEmbed.toJSON() as unknown as Embed)).toBe("reset");
  });

  it("prefers a legacy footer token over the title", () => {
    const embed = withLegacyToken(
      new EmbedBuilder().setTitle(localizer("en-US", "commands.refresh.title")),
      "compact_refresh",
    );
    expect(classifyProtocolTitle(embed.data.title)).toBe("reset");
    expect(checkTargetEmbed(embed.toJSON() as unknown as Embed)).toEqual({ isTarget: true, type: "compact_refresh" });
  });

  it("classifies every authored protocol title by its rendered text alone", () => {
    const misclassified: string[] = [];
    let checked = 0;
    for (const locale of getSupportedLocales()) {
      for (const entry of PROTOCOL_KEYS) {
        // Reply-context templates match embed fields, never titles.
        if (entry.kind === "reply_context" || !hasLocaleKey(locale, entry.key)) continue;
        const rendered = localizer(locale, entry.key).replace(/\{[a-zA-Z0-9_]+\}/g, "Mirri");
        const title = entry.match === "prefix" ? `${rendered} Mirri` : rendered;
        checked += 1;
        if (classifyProtocolTitle(title) !== entry.kind) misclassified.push(`${locale} ${entry.key}`);
      }
    }
    expect(checked).toBeGreaterThan(0);
    expect(misclassified).toEqual([]);
  });

  it("writes no footer token from the standard embed and compact writers", () => {
    const reset = createStandardEmbed("en-US", {
      titleKey: "commands.refresh.title",
      descriptionKey: "commands.refresh.response",
      footerKey: "commands.refresh.footer",
    });
    expect(reset.toJSON().footer?.text).not.toContain("[tomori:v1:");
    const compact = buildConversationEmbed("en-US", "Summary", true);
    expect(compact.toJSON().footer?.text ?? "").not.toContain("[tomori:v1:");
  });

  it("rejects two distinct keys with the same rendered value", () => {
    expect(() =>
      buildProtocolLookup(
        [
          { key: "first", kind: "reset" },
          { key: "second", kind: "compact_refresh" },
        ],
        ["en-US"],
        () => "Same title",
      ),
    ).toThrow("Protocol title collision");
  });

  it("rejects missing or renamed template placeholders at startup", () => {
    const entries = [{ key: "notice", kind: "memory_learning" as const, match: "template" as const }];
    for (const changed of ["Notice", "Notice {other}"]) {
      expect(() =>
        buildProtocolLookup(entries, ["en-US", "ja"], (locale) => (locale === "en-US" ? "Notice {name}" : changed)),
      ).toThrow("Protocol template placeholders differ");
    }
    expect(() =>
      buildProtocolLookup(entries, ["en-US", "ja"], (locale) =>
        locale === "en-US" ? "Notice {name} {item}" : "{item} を {name} に通知",
      ),
    ).not.toThrow();
    expect(() => buildProtocolLookup(entries, ["en-US"], () => "{name}")).toThrow(
      "Protocol title template has no literal anchor",
    );
  });

  it("classifies Japanese template notices without reply-context shadowing", () => {
    const examples = [
      ["genai.self_teach.server_memory_learned_title", { persona_nickname: "Mirri" }, "memory_learning"],
      ["reminders.task_set_title", { persona_nickname: "Mirri" }, "reminder_set"],
      ["tools.user_info_update.success_title", { target_user: "Juno" }, "user_info_update"],
      ["tools.user_block.unblock_success_title", { persona_name: "Mirri", user_name: "Juno" }, "user_moderation"],
    ] as const;
    for (const [key, variables, expected] of examples) {
      const title = localizer("ja", key, variables);
      expect(title).not.toContain("{");
      expect(classifyProtocolTitle(title)).toBe(expected);
      expect(checkTargetEmbed(new EmbedBuilder().setTitle(title).toJSON() as unknown as Embed)).toEqual({
        isTarget: true,
        type: expected,
      });
    }
  });

  it("accepts punctuation in a translated protocol title", () => {
    const result = buildProtocolLookup(
      [{ key: "commands.reward.hug.embed_title", kind: "reward" }],
      ["fr"],
      () => "Câlin.",
    );
    expect(result.exact.get("Câlin.")?.kind).toBe("reward");
  });

  it("slices old resets after the marker and new compact refreshes at it", () => {
    const oldReset = new EmbedBuilder().setTitle(localizer("en-US", "commands.refresh.title"));
    const newCompact = withLegacyToken(new EmbedBuilder().setTitle("Retitled summary"), "compact_refresh");
    expect(isRefreshMarkerEmbed(oldReset.toJSON() as unknown as Embed)).toBe(true);
    expect(isRefreshMarkerEmbed(newCompact.toJSON() as unknown as Embed)).toBe(true);
    expect(isRefreshMarkerEmbed(new EmbedBuilder().setTitle("Unrelated").toJSON() as unknown as Embed)).toBe(false);
    const older = message();
    const reset = message(oldReset);
    const newer = message();
    expect(sliceMessagesAtResetMarker([older, reset, newer])).toEqual({
      sliced: [newer],
      markerType: "reset",
      markerIndex: 1,
    });
    const compact = message(newCompact);
    expect(sliceMessagesAtResetMarker([older, reset, compact, newer])).toEqual({
      sliced: [compact, newer],
      markerType: "compact_refresh",
      markerIndex: 2,
    });
  });

  it("finds legacy and marked reply-context targets through the public reader", () => {
    const url = "https://discord.com/channels/1/2/3";
    const oldEmbed = new EmbedBuilder().setURL(url).setAuthor({
      name: localizer("ja", "genai.message_interaction.reply_context_author", { user: "Mirri" }),
    });
    expect(findReplyContextTargetInMessage(message(oldEmbed))).toEqual({ channelId: "2", messageId: "3" });

    const marked = withLegacyToken(
      new EmbedBuilder().setURL(url).setAuthor({ name: "Retitled reply" }),
      "reply_context",
    );
    expect(findReplyContextTargetInMessage(message(marked))).toEqual({ channelId: "2", messageId: "3" });
  });

  it("reads description-only reply-context embeds but not prose that quotes a message link", () => {
    const url = "https://discord.com/channels/1/2/3";
    const missed = getSupportedLocales().filter((locale) => {
      const description = localizer(locale, "genai.message_interaction.reply_context_description", {
        message_url: url,
      });
      return findReplyContextTargetInMessage(message(new EmbedBuilder().setDescription(description))) === null;
    });
    expect(missed).toEqual([]);
    const prose = new EmbedBuilder().setDescription(`Quoted from ${url} earlier`);
    expect(findReplyContextTargetInMessage(message(prose))).toBeNull();
  });

  it("classifies reminder delivery-failure notices as diagnostics in every authored locale", () => {
    for (const locale of ["en-US", "ja"]) {
      for (const titleKey of ["reminders.reminder_triggered_title", "reminders.task_triggered_title"]) {
        const embed = createStandardEmbed(locale, { titleKey, description: "Original content" });
        expect(embed.toJSON().footer?.text).toBeUndefined();
        expect(classifyProtocolTitle(localizer(locale, titleKey))).toBe("diagnostic");
        expect(checkTargetEmbed(embed.toJSON() as unknown as Embed).isTarget).toBe(false);
      }
    }
  });

  it("classifies a status title by its bare text, with or without the rendered circle", () => {
    for (const locale of ["en-US", "ja"]) {
      for (const titleKey of ["reminders.reminder_triggered_title", "reminders.task_triggered_title"]) {
        const bareTitle = stripStatusCircle(localizedCopy(locale, titleKey));
        // The WARN surface renders the circle the locale value no longer carries.
        const embed = createStandardEmbed(locale, {
          titleKey,
          description: "Original content",
          color: ColorCode.WARN,
        });
        expect(embed.toJSON().title).toBe(`🟡 ${bareTitle}`);
        expect(classifyProtocolTitle(embed.toJSON().title)).toBe("diagnostic");
        // An embed posted before the locale dropped its circle still classifies.
        expect(classifyProtocolTitle(`🟡 ${bareTitle}`)).toBe("diagnostic");
      }
    }
  });

  it("rejects two keys that differ only by a status circle", () => {
    expect(() =>
      buildProtocolLookup(
        [
          { key: "first", kind: "reset" },
          { key: "second", kind: "compact_refresh" },
        ],
        ["en-US"],
        (_locale, key) => (key === "first" ? "🔴 Same title" : "Same title"),
      ),
    ).toThrow("Protocol title collision");
  });
});
