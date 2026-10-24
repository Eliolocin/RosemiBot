import { afterEach, describe, expect, it, mock } from "bun:test";
import type { Client } from "discord.js";
import { resolveAllowedChannels } from "@/modules/natural-nudges/runtime/channels";
import { resetSendFailureCacheForTesting } from "@/utils/discord/stream/sendFailureCache";

const DELETED_CHANNEL = "1382235263668846612";

function clientWithFetch(fetch: (id: string) => Promise<unknown>): Client {
  return { channels: { cache: new Map(), fetch } } as unknown as Client;
}

afterEach(() => {
  resetSendFailureCacheForTesting();
});

describe("resolveAllowedChannels", () => {
  it("stops fetching a deleted channel on later ticks", async () => {
    const fetch = mock(() => Promise.reject(Object.assign(new Error("Unknown Channel"), { code: 10003 })));
    const client = clientWithFetch(fetch);

    expect(await resolveAllowedChannels(client, [DELETED_CHANNEL])).toEqual([]);
    expect(await resolveAllowedChannels(client, [DELETED_CHANNEL])).toEqual([]);

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("retries a channel whose fetch failed transiently", async () => {
    const fetch = mock(() => Promise.reject(Object.assign(new Error("Rate limited"), { status: 429 })));
    const client = clientWithFetch(fetch);

    await resolveAllowedChannels(client, [DELETED_CHANNEL]);
    await resolveAllowedChannels(client, [DELETED_CHANNEL]);

    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
