import { describe, expect, it } from "bun:test";
import type { StreamContext } from "@/types/stream/interfaces";
import { createDefaultStreamState } from "@/types/stream/types";
import { StreamUiUpdater } from "@/utils/discord/stream/uiUpdater";

const CHANNEL_ID = "1382235263668846612";
const TARGET_ID = "1382235263668846699";

async function sendAndCapture(mentionableUserIds: readonly string[] | undefined): Promise<unknown> {
  const sends: unknown[] = [];
  const updater = new StreamUiUpdater({
    hasStopRequest: () => false,
    requestStop: () => true,
    notifyStreamProgress: () => undefined,
  });
  const context = {
    channel: {
      id: CHANNEL_ID,
      send: async (payload: unknown) => {
        sends.push(payload);
        return {};
      },
    },
    client: { channels: { cache: new Map(), fetch: async () => null } },
    locale: "en-US",
    suppressUserErrors: false,
    tomoriState: { is_alter: false, config: {} },
    mentionableUserIds,
  } as unknown as StreamContext;
  await updater.sendSinglePayload(
    { content: `hey <@${TARGET_ID}> and <@&1382235263668846600>`, diagnosticReason: "length_split" },
    "hey",
    context,
    createDefaultStreamState(),
  );
  return (sends[0] as { allowedMentions?: unknown } | undefined)?.allowedMentions;
}

describe("stream mention restriction", () => {
  it("lets a restricted turn ping only its listed users, never roles or everyone", async () => {
    expect(await sendAndCapture([TARGET_ID])).toEqual({ users: [TARGET_ID], parse: [], repliedUser: false });
  });

  it("keeps the default mentions when no restriction is set", async () => {
    expect(await sendAndCapture(undefined)).toEqual({ repliedUser: false });
  });
});
