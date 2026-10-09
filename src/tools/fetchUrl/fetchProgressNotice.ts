import type { ToolContext } from "@/types/tool/interfaces";
import { sendToolProgressNotice } from "@/utils/discord/toolProgressNotice";
import { ColorCode } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";

/**
 * Tracks consecutive fetch calls per channel to show pagination in notices.
 * Keyed by channel ID; stores the last-fetched URL and how many times
 * it has been fetched consecutively (page count).
 */
const fetchPageTracker = new Map<string, { url: string; page: number }>();
const FETCH_PAGE_TRACKER_MAX_SIZE = 500;

/** Evicts oldest entries when the tracker exceeds its size cap. */
function trimFetchPageTracker(): void {
  if (fetchPageTracker.size <= FETCH_PAGE_TRACKER_MAX_SIZE) return;
  // Map preserves insertion order, so the first entries are the oldest
  const excess = fetchPageTracker.size - FETCH_PAGE_TRACKER_MAX_SIZE;
  let i = 0;
  for (const key of fetchPageTracker.keys()) {
    if (i++ >= excess) break;
    fetchPageTracker.delete(key);
  }
}

/**
 * Shared by the built-in fetch_url tool and the guild MCP manager so that
 * custom fetch tools (url_fetcher server type) get the same UX.
 *
 * @param url        - The URL being fetched (used for display and dedup tracking)
 * @param label      - Log label for the caller (e.g. "FetchUrlTool", "GuildMcpManager")
 * @param startIndex - Character offset passed to the fetch server (shown when > 0)
 */
export async function sendFetchProgressNotice(
  context: ToolContext,
  url: string,
  label: string,
  startIndex?: number,
): Promise<void> {
  const channelId = context.channel.id;
  const tracked = fetchPageTracker.get(channelId);
  let page = 1;
  if (tracked && tracked.url === url) {
    page = tracked.page + 1;
  }
  fetchPageTracker.set(channelId, { url, page });
  trimFetchPageTracker();

  const baseDescription = localizer(context.locale, "tools.fetch.reading_description", {
    url: url || "the requested page",
  });
  const offsetLine =
    startIndex && startIndex > 0
      ? localizer(context.locale, "tools.fetch.reading_offset_line", {
          start_index: startIndex.toLocaleString(),
        })
      : "";
  const description = [baseDescription, offsetLine].filter((part) => part.length > 0).join("\n");

  await sendToolProgressNotice(
    context,
    "web_fetch",
    {
      titleKey: page > 1 ? "tools.fetch.reading_title_page" : "tools.fetch.fetch_url_title",
      titleVars: page > 1 ? { page: String(page) } : undefined,
      description,
      footerKey: "tools.fetch.reading_footer",
      color: ColorCode.INFO,
    },
    label,
  );
}
