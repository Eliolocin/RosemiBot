const OPENROUTER_APP_REFERER = "https://tomoribot.app";
const OPENROUTER_APP_TITLE = "TomoriBot";
const OPENROUTER_APP_CATEGORIES = "roleplay,personal-agent";
const ATTRIBUTION_ENABLED_ENV = "OPENROUTER_APP_ATTRIBUTION_ENABLED";

function isOpenRouterAttributionEnabled(): boolean {
  const rawValue = process.env[ATTRIBUTION_ENABLED_ENV]?.trim().toLowerCase();
  return rawValue !== "false" && rawValue !== "0" && rawValue !== "no" && rawValue !== "off";
}

export function buildOpenRouterAttributionHeaders(): Record<string, string> {
  if (!isOpenRouterAttributionEnabled()) {
    return {};
  }

  return {
    "HTTP-Referer": OPENROUTER_APP_REFERER,
    "X-OpenRouter-Title": OPENROUTER_APP_TITLE,
    "X-OpenRouter-Categories": OPENROUTER_APP_CATEGORIES,
  };
}
