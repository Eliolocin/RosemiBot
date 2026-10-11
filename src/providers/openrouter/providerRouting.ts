export interface OpenrouterProviderRouting {
  require_parameters: boolean;
}

/**
 * OpenRouter otherwise routes to any endpoint for the model, including ones that silently drop tools
 * or `response_format`, so a request that depends on them fails fast instead of returning prose.
 */
export function buildOpenrouterProviderRouting(options: {
  requiresParameterSupport: boolean;
}): OpenrouterProviderRouting | undefined {
  if (!options.requiresParameterSupport) {
    return undefined;
  }

  return {
    require_parameters: true,
  };
}
