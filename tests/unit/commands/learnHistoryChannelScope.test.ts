import { describe, expect, it } from "bun:test";
import { ChannelType } from "discord.js";
import { buildExtractionPromptModal, readExtractionChannelIds } from "@/commands/learn/history";
import { isModalChannelSelectField } from "@/types/discord/modal";

const GENERAL = "111111111111111111";
const NEWS = "333333333333333333";

describe("/learn history channel scope", () => {
  it("offers an optional text and announcement channel select in every scope's prompt modal", () => {
    const channelFields = buildExtractionPromptModal("prompt", true).components.filter(isModalChannelSelectField);

    expect(channelFields).toHaveLength(1);
    expect(channelFields[0]).toMatchObject({
      channelTypes: [ChannelType.GuildText, ChannelType.GuildAnnouncement],
      minValues: 0,
      maxValues: 25,
      required: false,
    });
  });

  it("omits the channel select in a DM, which has no channels to pick", () => {
    expect(buildExtractionPromptModal("prompt", false).components.filter(isModalChannelSelectField)).toEqual([]);
  });

  it("returns the picked channels once each and drops values that are not channel IDs", () => {
    const customId = buildExtractionPromptModal("prompt", true).components.filter(isModalChannelSelectField)[0]
      ?.customId;
    if (!customId) throw new Error("channel field missing");

    expect(readExtractionChannelIds({ [customId]: [GENERAL, NEWS, GENERAL, "general"] })).toEqual([GENERAL, NEWS]);
  });

  it("treats an empty or missing pick as every channel", () => {
    expect(readExtractionChannelIds(undefined)).toEqual([]);
    expect(readExtractionChannelIds({})).toEqual([]);
  });
});
