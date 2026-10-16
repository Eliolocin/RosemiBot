import { buildHelpPageReference } from "@/utils/discord/helpCatalog";
import { commandRegistry } from "@/utils/discord/commandRegistry";
import { DOCS_PATHS, type DocsPath } from "@/utils/discord/docsLinks";

export const HELP_PROVIDER_IDS = [
  "google",
  "openrouter",
  "deepseek",
  "novelai",
  "nvidia",
  "zai",
  "vertexexpress",
  "vertex",
  "custom",
  "brave",
  "elevenlabs",
] as const;
export type HelpProviderId = (typeof HELP_PROVIDER_IDS)[number];

/**
 * The setup picker's subset, in picker order: every entry here answers a chat message, which is what
 * the reader is choosing when a setup step asks them for an AI provider.
 */
export const HELP_TEXT_PROVIDER_IDS = [
  "google",
  "openrouter",
  "deepseek",
  "novelai",
  "nvidia",
  "zai",
  "vertexexpress",
  "vertex",
  "custom",
] as const;

/**
 * The two guides left out of the setup picker. `buildProviderGuideModal` is reached only through
 * that picker, so a guide in neither list is unreachable in the client; these get their own picker
 * on the same screen instead of being dropped from the panel.
 */
export const HELP_OPTIONAL_PROVIDER_IDS = ["brave", "elevenlabs"] as const;

type HelpVariables = Record<string, string | number | boolean>;

export interface ProviderGuideDefinition {
  id: HelpProviderId;
  labelKey: string;
  pickerDescriptionKey: string;
  titleKey: string;
  descriptionKey: string;
  sections: ReadonlyArray<{ titleKey: string; bodyKey: string }>;
  footerKey?: string;
  docsPath: DocsPath;
}

const PROVIDER_GUIDES: readonly ProviderGuideDefinition[] = [
  {
    id: "google",
    labelKey: "commands.help.api-key.provider_choice_google",
    pickerDescriptionKey: "commands.help.api-key.provider_description_google",
    titleKey: "commands.help.api-key.google_title",
    descriptionKey: "commands.help.api-key.google_description",
    sections: [
      {
        titleKey: "commands.help.api-key.google_getting_key_title",
        bodyKey: "commands.help.api-key.google_getting_key_description",
      },
    ],
    footerKey: "commands.help.api-key.google_footer",
    docsPath: DOCS_PATHS.API_KEYS,
  },
  {
    id: "openrouter",
    labelKey: "commands.help.api-key.provider_choice_openrouter",
    pickerDescriptionKey: "commands.help.api-key.provider_description_openrouter",
    titleKey: "commands.help.api-key.openrouter_title",
    descriptionKey: "commands.help.api-key.openrouter_description",
    sections: [
      {
        titleKey: "commands.help.api-key.openrouter_getting_key_title",
        bodyKey: "commands.help.api-key.openrouter_getting_key_description",
      },
      {
        titleKey: "commands.help.api-key.openrouter_important_title",
        bodyKey: "commands.help.api-key.openrouter_important_description",
      },
    ],
    footerKey: "commands.help.api-key.openrouter_footer",
    docsPath: DOCS_PATHS.API_KEYS,
  },
  {
    id: "deepseek",
    labelKey: "commands.help.api-key.provider_choice_deepseek",
    pickerDescriptionKey: "commands.help.api-key.provider_description_deepseek",
    titleKey: "commands.help.api-key.deepseek_title",
    descriptionKey: "commands.help.api-key.deepseek_description",
    sections: [
      {
        titleKey: "commands.help.api-key.deepseek_getting_key_title",
        bodyKey: "commands.help.api-key.deepseek_getting_key_description",
      },
    ],
    footerKey: "commands.help.api-key.deepseek_footer",
    docsPath: DOCS_PATHS.API_KEYS,
  },
  {
    id: "novelai",
    labelKey: "commands.help.api-key.provider_choice_novelai",
    pickerDescriptionKey: "commands.help.api-key.provider_description_novelai",
    titleKey: "commands.help.api-key.novelai_title",
    descriptionKey: "commands.help.api-key.novelai_description",
    sections: [
      {
        titleKey: "commands.help.api-key.novelai_getting_key_title",
        bodyKey: "commands.help.api-key.novelai_getting_key_description",
      },
    ],
    footerKey: "commands.help.api-key.novelai_footer",
    docsPath: DOCS_PATHS.API_KEYS,
  },
  {
    id: "nvidia",
    labelKey: "commands.help.api-key.provider_choice_nvidia",
    pickerDescriptionKey: "commands.help.api-key.provider_description_nvidia",
    titleKey: "commands.help.api-key.nvidia_title",
    descriptionKey: "commands.help.api-key.nvidia_description",
    sections: [
      {
        titleKey: "commands.help.api-key.nvidia_getting_key_title",
        bodyKey: "commands.help.api-key.nvidia_getting_key_description",
      },
      {
        titleKey: "commands.help.api-key.nvidia_important_title",
        bodyKey: "commands.help.api-key.nvidia_important_description",
      },
    ],
    footerKey: "commands.help.api-key.nvidia_footer",
    docsPath: DOCS_PATHS.API_KEYS,
  },
  {
    id: "zai",
    labelKey: "commands.help.api-key.provider_choice_zai",
    pickerDescriptionKey: "commands.help.api-key.provider_description_zai",
    titleKey: "commands.help.api-key.zai_title",
    descriptionKey: "commands.help.api-key.zai_description",
    sections: [
      {
        titleKey: "commands.help.api-key.zai_getting_key_title",
        bodyKey: "commands.help.api-key.zai_getting_key_description",
      },
      {
        titleKey: "commands.help.api-key.zai_important_title",
        bodyKey: "commands.help.api-key.zai_important_description",
      },
    ],
    footerKey: "commands.help.api-key.zai_footer",
    docsPath: DOCS_PATHS.API_KEYS,
  },
  {
    id: "vertexexpress",
    labelKey: "commands.help.api-key.provider_choice_vertexexpress",
    pickerDescriptionKey: "commands.help.api-key.provider_description_vertexexpress",
    titleKey: "commands.help.api-key.vertexexpress_title",
    descriptionKey: "commands.help.api-key.vertexexpress_description",
    sections: [
      {
        titleKey: "commands.help.api-key.vertexexpress_getting_key_title",
        bodyKey: "commands.help.api-key.vertexexpress_getting_key_description",
      },
      {
        titleKey: "commands.help.api-key.vertexexpress_important_title",
        bodyKey: "commands.help.api-key.vertexexpress_important_description",
      },
    ],
    footerKey: "commands.help.api-key.vertexexpress_footer",
    docsPath: DOCS_PATHS.API_KEYS,
  },
  {
    id: "vertex",
    labelKey: "commands.help.api-key.provider_choice_vertex",
    pickerDescriptionKey: "commands.help.api-key.provider_description_vertex",
    titleKey: "commands.help.api-key.vertex_title",
    descriptionKey: "commands.help.api-key.vertex_description",
    sections: [
      {
        titleKey: "commands.help.api-key.vertex_getting_key_title",
        bodyKey: "commands.help.api-key.vertex_getting_key_description",
      },
      {
        titleKey: "commands.help.api-key.vertex_important_title",
        bodyKey: "commands.help.api-key.vertex_important_description",
      },
    ],
    footerKey: "commands.help.api-key.vertex_footer",
    docsPath: DOCS_PATHS.API_KEYS,
  },
  {
    id: "custom",
    labelKey: "commands.help.api-key.provider_choice_custom",
    pickerDescriptionKey: "commands.help.api-key.provider_description_custom",
    titleKey: "commands.help.api-key.custom_title",
    descriptionKey: "commands.help.api-key.custom_description",
    sections: [],
    docsPath: DOCS_PATHS.CUSTOM_ENDPOINTS,
  },
  {
    id: "brave",
    labelKey: "commands.help.api-key.provider_choice_brave",
    pickerDescriptionKey: "commands.help.api-key.provider_description_brave",
    titleKey: "commands.help.api-key.brave_title",
    descriptionKey: "commands.help.api-key.brave_description",
    sections: [
      {
        titleKey: "commands.help.api-key.brave_getting_key_title",
        bodyKey: "commands.help.api-key.brave_getting_key_description",
      },
      {
        titleKey: "commands.help.api-key.brave_important_title",
        bodyKey: "commands.help.api-key.brave_important_description",
      },
    ],
    footerKey: "commands.help.api-key.brave_footer",
    docsPath: DOCS_PATHS.API_KEYS,
  },
  {
    id: "elevenlabs",
    labelKey: "commands.help.api-key.provider_choice_elevenlabs",
    pickerDescriptionKey: "commands.help.api-key.provider_description_elevenlabs",
    titleKey: "commands.help.elevenlabs.title",
    descriptionKey: "commands.help.elevenlabs.description",
    sections: [
      {
        titleKey: "commands.help.elevenlabs.getting_key_title",
        bodyKey: "commands.help.elevenlabs.getting_key_description",
      },
      {
        titleKey: "commands.help.elevenlabs.free_voices_title",
        bodyKey: "commands.help.elevenlabs.free_voices_description",
      },
      {
        titleKey: "commands.help.elevenlabs.choosing_voice_title",
        bodyKey: "commands.help.elevenlabs.choosing_voice_description",
      },
      {
        titleKey: "commands.help.elevenlabs.important_notes_title",
        bodyKey: "commands.help.elevenlabs.important_notes_description",
      },
    ],
    footerKey: "commands.help.elevenlabs.footer",
    docsPath: DOCS_PATHS.TTS,
  },
] as const;

export function isHelpProviderId(value: string): value is HelpProviderId {
  return (HELP_PROVIDER_IDS as readonly string[]).includes(value);
}

export function getProviderGuide(providerId: HelpProviderId): ProviderGuideDefinition {
  const guide = PROVIDER_GUIDES.find((candidate) => candidate.id === providerId);
  if (!guide) {
    throw new Error(`Missing help provider guide: ${providerId}`);
  }
  return guide;
}

export function getProviderGuideVariables(locale: string): HelpVariables {
  return {
    configBraveapiSet: commandRegistry.getCommandMention("providers"),
    configSetup: commandRegistry.getCommandMention("setup"),
    configApikeySet: commandRegistry.getCommandMention("providers"),
    configModel: commandRegistry.getCommandMention("config"),
    configModelEmbedding: commandRegistry.getCommandMention("config"),
    configModelImage: commandRegistry.getCommandMention("config"),
    configCustomModelsAdd: commandRegistry.getCommandMention("providers"),
    personalCustomModelsAdd: commandRegistry.getCommandMention("personal", "providers"),
    helpCustomModels: buildHelpPageReference(locale, "commands.help.dashboard.pages.custom_endpoints"),
    supportServer: commandRegistry.getCommandMention("support", "discord"),
    configSpeechElevenlabs: commandRegistry.getCommandMention("providers"),
    configSpeechVoiceAssign: commandRegistry.getCommandMention("config"),
    configSpeechTranscripts: commandRegistry.getCommandMention("config"),
  };
}
