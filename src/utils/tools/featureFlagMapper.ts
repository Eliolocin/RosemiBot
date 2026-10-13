/**
 * Maps server config columns to the feature flags that tools declare through `requiresFeatureFlag`.
 */
export function configToFeatureFlags(config: {
  sticker_usage_enabled: boolean;
  web_search_enabled: boolean;
  self_teaching_enabled: boolean;
  manage_message_enabled: boolean;
  imagegen_enabled: boolean;
  videogen_enabled: boolean;
  voice_message_enabled: boolean;
  user_blocking_enabled: boolean;
  user_info_updates_enabled: boolean;
  thread_creation_enabled: boolean;
}): Record<string, boolean> {
  return {
    sticker_usage: config.sticker_usage_enabled,
    web_search: config.web_search_enabled,
    self_teaching: config.self_teaching_enabled,
    manage_message: config.manage_message_enabled,
    image_gen: config.imagegen_enabled,
    video_gen: config.videogen_enabled,
    voice_message: config.voice_message_enabled,
    user_blocking: config.user_blocking_enabled,
    user_info_updates: config.user_info_updates_enabled,
    thread_creation: config.thread_creation_enabled,
  };
}
