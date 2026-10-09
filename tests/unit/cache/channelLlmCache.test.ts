import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { LlmRow } from "@/types/db/schema";
import { createLlmRow } from "../../helpers/fixtures";
import { clearChannelLlmCache, getCachedChannelLlm, invalidateChannelLlmCache } from "@/utils/cache/channelLlmCache";
import { llmOverrideRepo } from "@/utils/db/repositories";

const SERVER_ID = 1;
const PARENT_ID = "parent-channel";
const THREAD_ID = "thread-channel";

const parentModel = createLlmRow({ llm_id: 10, llm_codename: "parent-model" });
const threadModel = createLlmRow({ llm_id: 20, llm_codename: "thread-model" });

let overrides: Map<string, LlmRow>;
let repoSpy: ReturnType<typeof spyOn<typeof llmOverrideRepo, "getChannelLlmOverride">>;

beforeEach(() => {
  overrides = new Map();
  repoSpy = spyOn(llmOverrideRepo, "getChannelLlmOverride").mockImplementation(
    async (_serverId: number, channelDiscId: string) => overrides.get(channelDiscId) ?? null,
  );
});

afterEach(() => {
  repoSpy.mockRestore();
  clearChannelLlmCache();
});

describe("getCachedChannelLlm thread inheritance", () => {
  test("a thread without its own override inherits the parent's", async () => {
    overrides.set(PARENT_ID, parentModel);

    expect(await getCachedChannelLlm(SERVER_ID, THREAD_ID, PARENT_ID)).toBe(parentModel);
  });

  test("a thread's own override shadows the parent's", async () => {
    overrides.set(PARENT_ID, parentModel);
    overrides.set(THREAD_ID, threadModel);

    expect(await getCachedChannelLlm(SERVER_ID, THREAD_ID, PARENT_ID)).toBe(threadModel);
  });

  test("no override on either level resolves to null", async () => {
    expect(await getCachedChannelLlm(SERVER_ID, THREAD_ID, PARENT_ID)).toBeNull();
  });

  test("without a parent id the parent's override is never consulted", async () => {
    overrides.set(PARENT_ID, parentModel);

    expect(await getCachedChannelLlm(SERVER_ID, THREAD_ID)).toBeNull();
    expect(await getCachedChannelLlm(SERVER_ID, THREAD_ID, null)).toBeNull();
  });

  test("invalidating only the parent is enough for threads to see the new value", async () => {
    // Warm both entries: the thread caches a negative result, the parent caches its model.
    overrides.set(PARENT_ID, parentModel);
    expect(await getCachedChannelLlm(SERVER_ID, THREAD_ID, PARENT_ID)).toBe(parentModel);

    const replacement = createLlmRow({ llm_id: 11, llm_codename: "replacement-model" });
    overrides.set(PARENT_ID, replacement);
    invalidateChannelLlmCache(SERVER_ID, PARENT_ID);

    expect(await getCachedChannelLlm(SERVER_ID, THREAD_ID, PARENT_ID)).toBe(replacement);

    overrides.delete(PARENT_ID);
    invalidateChannelLlmCache(SERVER_ID, PARENT_ID);

    expect(await getCachedChannelLlm(SERVER_ID, THREAD_ID, PARENT_ID)).toBeNull();
  });
});
