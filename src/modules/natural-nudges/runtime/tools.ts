import type { TomoriState } from "@/types/db/schema";
import { getAvailableToolsWithMCP, type ToolStateForContext } from "@/tools/toolRegistry";
import { log } from "@/utils/misc/logger";
import { normalizeProviderName } from "@/utils/provider/providerInfoRegistry";

/** Built-in tools this persona's turn would be offered, which is what tool prerequisites test. */
export async function loadAvailableToolNames(persona: TomoriState): Promise<Set<string>> {
  if (!persona.llm.has_tools) return new Set();
  const state: ToolStateForContext = {
    server_id: persona.server_id.toString(),
    activePersonaHasElevenlabsVoice: Boolean(
      persona.speech_voice_sample_id || persona.speech_voice_design_prompt?.trim() || persona.speech_voice_id?.trim(),
    ),
    activePersonaVoiceDesignPrompt: persona.speech_voice_design_prompt?.trim() || null,
    activePersonaVoiceSampleId: persona.speech_voice_sample_id,
    activePersonaVoiceId: persona.speech_voice_id,
    activePersonaVoiceSourcePriority: persona.voice_source_priority,
    diffusion_model_id: persona.config.diffusion_model_id,
    nai_diffusion_model_id: persona.config.nai_diffusion_model_id,
    video_model_id: persona.config.video_model_id,
    llm: {
      llm_codename: persona.llm.llm_codename,
      has_tools: persona.llm.has_tools,
      sees_images: persona.llm.sees_images,
      sees_videos: persona.llm.sees_videos,
      sees_youtube: persona.llm.sees_youtube,
      supports_structoutput: persona.llm.supports_structoutput,
    },
    config: {
      sticker_usage_enabled: persona.config.sticker_usage_enabled,
      web_search_enabled: persona.config.web_search_enabled,
      self_teaching_enabled: persona.config.self_teaching_enabled,
      manage_message_enabled: persona.config.manage_message_enabled,
      imagegen_enabled: persona.config.imagegen_enabled,
      videogen_enabled: persona.config.videogen_enabled,
      voice_message_enabled: persona.config.voice_message_enabled,
      user_blocking_enabled: persona.config.user_blocking_enabled,
      user_info_updates_enabled: persona.config.user_info_updates_enabled,
      thread_creation_enabled: persona.config.thread_creation_enabled,
      danbooru_enabled: persona.config.danbooru_enabled,
    },
  };
  try {
    const { builtInTools } = await getAvailableToolsWithMCP(normalizeProviderName(persona.llm.llm_provider), state);
    return new Set(builtInTools.map((tool) => tool.name));
  } catch (error) {
    log.warn("Natural Nudges: could not resolve tool availability", error, { personaId: persona.persona_id });
    return new Set();
  }
}
