import type { ToolNoticeKey } from "@/constants/toolNotices";
import { localizer } from "@/utils/text/localizer";
import type { SearchCategory } from "./types";

const CATEGORY_NOTICE_KEYS: Record<SearchCategory, ToolNoticeKey> = {
  text: "web_search",
  image: "image_search",
  video: "video_search",
  news: "news_search",
  papers: "web_search",
  code: "web_search",
  files: "web_search",
  music: "web_search",
};

const CATEGORY_LABEL_KEYS: Record<SearchCategory, string> = {
  text: "tools.search.category_labels.text",
  image: "tools.search.category_labels.image",
  video: "tools.search.category_labels.video",
  news: "tools.search.category_labels.news",
  papers: "tools.search.category_labels.papers",
  code: "tools.search.category_labels.code",
  files: "tools.search.category_labels.files",
  music: "tools.search.category_labels.music",
};

export function getSearchCategoryLabel(locale: string, category: SearchCategory): string {
  return localizer(locale, CATEGORY_LABEL_KEYS[category]);
}

export function getSearchNoticeKey(category: SearchCategory): ToolNoticeKey {
  return CATEGORY_NOTICE_KEYS[category];
}

export function getSearchNoticeTitleVars(
  locale: string,
  category: SearchCategory,
  query: string,
): Record<string, string> {
  return {
    category: getSearchCategoryLabel(locale, category),
    query,
  };
}
