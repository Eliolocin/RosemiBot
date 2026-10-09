import { describe, expect, it, mock } from "bun:test";
import { resolveStatsServerId } from "@/utils/stats/statsServerContext";
import { initializeLocalizer } from "@/utils/text/localizer";
import { createRouteInteraction, type RouteInteraction } from "../../../helpers/routeInteraction";
import { localizedStatusTitle } from "@/utils/discord/ui/statusTitle";
import { ColorCode } from "@/utils/misc/logger";

const GUILD_ID = "guild-111111111111111111";
const LOCALE = "en-US";

await initializeLocalizer();

function makeInteraction(inGuild = true): RouteInteraction {
  return createRouteInteraction({ guildId: inGuild ? GUILD_ID : null });
}

describe("stats server id resolution", () => {
  it("keys the cached state lookup on the guild snowflake", async () => {
    const loadState = mock(async (serverDiscId: string) => {
      expect(serverDiscId).toBe(GUILD_ID);
      return { server_id: 42 };
    });

    const serverId = await resolveStatsServerId(makeInteraction() as never, LOCALE, loadState);

    expect(serverId).toBe(42);
    expect(loadState).toHaveBeenCalledTimes(1);
  });

  it("answers with the setup error and reports no server when the guild has no state", async () => {
    const interaction = makeInteraction();

    const serverId = await resolveStatsServerId(interaction as never, LOCALE, async () => null);

    expect(serverId).toBeNull();
    expect(interaction.calls).toHaveLength(1);
    expect(interaction.calls[0]?.method).toBe("reply");
    const payload = interaction.calls[0]?.args[0] as { embeds: Array<{ data: { title?: string } }> } | undefined;
    // Either title is the setup refusal: `replyInfoEmbed` swaps in the "currently updating"
    // variant when the database failed recently or the process is still in its startup grace
    // period, and that state is not this test's to control.
    expect<Array<string | undefined>>([
      localizedStatusTitle(LOCALE, "general.errors.tomori_not_setup_title", ColorCode.ERROR),
      localizedStatusTitle(LOCALE, "general.errors.tomori_updating_title", ColorCode.WARN),
    ]).toContain(payload?.embeds[0]?.data.title);
  });

  it("reports no server for a state that exists without an internal id", async () => {
    const interaction = makeInteraction();

    expect(await resolveStatsServerId(interaction as never, LOCALE, async () => ({}))).toBeNull();
  });

  it("returns null without reading or replying when the interaction has no guild", async () => {
    const loadState = mock(async () => ({ server_id: 42 }));
    const interaction = makeInteraction(false);

    expect(await resolveStatsServerId(interaction as never, LOCALE, loadState)).toBeNull();
    expect(loadState).not.toHaveBeenCalled();
    expect(interaction.calls).toEqual([]);
  });
});
