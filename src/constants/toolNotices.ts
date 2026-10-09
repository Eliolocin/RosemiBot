export const TOOL_NOTICE_KEYS = [
  "web_search",
  "image_search",
  "video_search",
  "news_search",
  "web_fetch",
  "document_reading",
  "image_generation",
  "video_generation",
  "image_editing",
  "image_analysis",
  "gif_processing",
  "youtube_processing",
  "mcp_tool_call",
  "respond_embed",
  "impersonation_notice",
  "fallback_model_usage",
  "memory_update",
  "task_update",
  "user_info_update",
] as const;

/** The one footer line every hideable notice shares, pointing at the toggle that hides it. */
export const NOTICE_CONFIG_HINT_KEY = "tools.tool_notice.configure_hint";

export type ToolNoticeKey = (typeof TOOL_NOTICE_KEYS)[number];

export const NOTICE_VERBOSITY_LEVELS = ["minimal", "verbose"] as const;

export type NoticeVerbosity = (typeof NOTICE_VERBOSITY_LEVELS)[number];

/**
 * Notices that keep their full card at every verbosity. The fallback notice reports a degraded
 * reply and the impersonation notice discloses who wrote one, so a bare title would drop the detail
 * these notices exist to show; the `/respond` card acknowledges a command rather than a tool call.
 */
export const VERBOSITY_EXEMPT_NOTICE_KEYS: ReadonlySet<ToolNoticeKey> = new Set<ToolNoticeKey>([
  "respond_embed",
  "impersonation_notice",
  "fallback_model_usage",
]);

export function isToolNoticeKey(value: string): value is ToolNoticeKey {
  return TOOL_NOTICE_KEYS.includes(value as ToolNoticeKey);
}

export interface ToolNoticeDefinition {
  key: ToolNoticeKey;
  labelKey: string;
  descriptionKey: string;
}

export const TOOL_NOTICE_DEFINITIONS: ToolNoticeDefinition[] = [
  {
    key: "web_search",
    labelKey: "commands.config.notice-embeds.visibility.notice_web_search_label",
    descriptionKey: "commands.config.notice-embeds.visibility.notice_web_search_description",
  },
  {
    key: "image_search",
    labelKey: "commands.config.notice-embeds.visibility.notice_image_search_label",
    descriptionKey: "commands.config.notice-embeds.visibility.notice_image_search_description",
  },
  {
    key: "video_search",
    labelKey: "commands.config.notice-embeds.visibility.notice_video_search_label",
    descriptionKey: "commands.config.notice-embeds.visibility.notice_video_search_description",
  },
  {
    key: "news_search",
    labelKey: "commands.config.notice-embeds.visibility.notice_news_search_label",
    descriptionKey: "commands.config.notice-embeds.visibility.notice_news_search_description",
  },
  {
    key: "web_fetch",
    labelKey: "commands.config.notice-embeds.visibility.notice_web_fetch_label",
    descriptionKey: "commands.config.notice-embeds.visibility.notice_web_fetch_description",
  },
  {
    key: "document_reading",
    labelKey: "commands.config.notice-embeds.visibility.notice_document_reading_label",
    descriptionKey: "commands.config.notice-embeds.visibility.notice_document_reading_description",
  },
  {
    key: "image_generation",
    labelKey: "commands.config.notice-embeds.visibility.notice_image_generation_label",
    descriptionKey: "commands.config.notice-embeds.visibility.notice_image_generation_description",
  },
  {
    key: "video_generation",
    labelKey: "commands.config.notice-embeds.visibility.notice_video_generation_label",
    descriptionKey: "commands.config.notice-embeds.visibility.notice_video_generation_description",
  },
  {
    key: "image_editing",
    labelKey: "commands.config.notice-embeds.visibility.notice_image_editing_label",
    descriptionKey: "commands.config.notice-embeds.visibility.notice_image_editing_description",
  },
  {
    key: "image_analysis",
    labelKey: "commands.config.notice-embeds.visibility.notice_image_analysis_label",
    descriptionKey: "commands.config.notice-embeds.visibility.notice_image_analysis_description",
  },
  {
    key: "gif_processing",
    labelKey: "commands.config.notice-embeds.visibility.notice_gif_processing_label",
    descriptionKey: "commands.config.notice-embeds.visibility.notice_gif_processing_description",
  },
  {
    key: "youtube_processing",
    labelKey: "commands.config.notice-embeds.visibility.notice_youtube_processing_label",
    descriptionKey: "commands.config.notice-embeds.visibility.notice_youtube_processing_description",
  },
  {
    key: "mcp_tool_call",
    labelKey: "commands.config.notice-embeds.visibility.notice_mcp_tool_call_label",
    descriptionKey: "commands.config.notice-embeds.visibility.notice_mcp_tool_call_description",
  },
  {
    key: "respond_embed",
    labelKey: "commands.config.notice-embeds.visibility.notice_respond_embed_label",
    descriptionKey: "commands.config.notice-embeds.visibility.notice_respond_embed_description",
  },
  {
    key: "impersonation_notice",
    labelKey: "commands.config.notice-embeds.visibility.notice_impersonation_notice_label",
    descriptionKey: "commands.config.notice-embeds.visibility.notice_impersonation_notice_description",
  },
  {
    key: "fallback_model_usage",
    labelKey: "commands.config.notice-embeds.visibility.notice_fallback_model_usage_label",
    descriptionKey: "commands.config.notice-embeds.visibility.notice_fallback_model_usage_description",
  },
  {
    key: "memory_update",
    labelKey: "commands.config.notice-embeds.visibility.notice_memory_update_label",
    descriptionKey: "commands.config.notice-embeds.visibility.notice_memory_update_description",
  },
  {
    key: "task_update",
    labelKey: "commands.config.notice-embeds.visibility.notice_task_update_label",
    descriptionKey: "commands.config.notice-embeds.visibility.notice_task_update_description",
  },
  {
    key: "user_info_update",
    labelKey: "commands.config.notice-embeds.visibility.notice_user_info_update_label",
    descriptionKey: "commands.config.notice-embeds.visibility.notice_user_info_update_description",
  },
];
