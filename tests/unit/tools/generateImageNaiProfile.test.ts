import { describe, expect, it, mock } from "bun:test";
import { loadUserNaiProfileByDiscordId } from "@/tools/functionCalls/generateImageNaiTool";
import { PrivacyLevel, type UserRow } from "@/types/db/schema";

const USER_DISC_ID = "12345678901234567";

function createUserRow(): UserRow {
  return {
    user_id: 1,
    user_disc_id: USER_DISC_ID,
    user_nickname: "Profile User",
    language_pref: "en-US",
    registration_locale: null,
    privacy_level: PrivacyLevel.MINIMAL,
    personal_memories: [],
    physical_appearance_tags: ["silver hair", "green eyes"],
    nai_char_ref_url: "https://example.invalid/profile.png",
    impersonation_prompt: null,
    shortterm_cache_crossserver_opt_in: false,
    personal_dtm: "follow",
    personal_deliberate_tool_mode: "follow",
    personal_server_fallback_enabled: true,
    timezone_offset: null,
    message_proxy_service: null,
    message_proxy_instance_id: null,
  };
}

describe("NovelAI user profile loading", () => {
  it("uses the assembled UserRepository row", async () => {
    const loadUser = mock(async () => createUserRow());

    await expect(loadUserNaiProfileByDiscordId(USER_DISC_ID, { loadByDiscordId: loadUser })).resolves.toEqual({
      tags: ["silver hair", "green eyes"],
      refUrl: "https://example.invalid/profile.png",
    });
    expect(loadUser).toHaveBeenCalledWith(USER_DISC_ID);
  });

  it("returns null when the user does not exist", async () => {
    const loadUser = mock(async () => null);

    await expect(loadUserNaiProfileByDiscordId(USER_DISC_ID, { loadByDiscordId: loadUser })).resolves.toBeNull();
  });
});
