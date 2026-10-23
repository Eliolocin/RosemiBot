import type {
  ProviderApiFamily,
  ProviderFeatureImplementation,
  ProviderFeatureName,
  ProviderInfo,
} from "@/types/provider/interfaces";
import { getCustomProviderDisplayName, isCustomProvider } from "@/utils/provider/customProviderUtils";
import { providerOptionDisplayName } from "@/utils/provider/providerOptionRegistry";
import * as path from "node:path";
import { Glob } from "bun";

type ProviderInfoModule = Record<string, unknown>;

function isProviderInfo(value: unknown): value is ProviderInfo {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<ProviderInfo>;
  return (
    typeof candidate.name === "string" &&
    typeof candidate.displayName === "string" &&
    Array.isArray(candidate.supportedModels) &&
    typeof candidate.featureSupport === "object" &&
    Array.isArray(candidate.supportedParams)
  );
}

async function discoverProviderInfos(): Promise<readonly ProviderInfo[]> {
  const providersPath = path.join(import.meta.dir, "../../providers");
  const glob = new Glob("*/providerInfo.ts");
  const providerInfos: ProviderInfo[] = [];

  for await (const providerInfoPath of glob.scan({ cwd: providersPath, onlyFiles: true })) {
    const providerName = providerInfoPath.split(/[\\/]/)[0];
    const module = (await import(`../../providers/${providerName}/providerInfo`)) as ProviderInfoModule;
    const providerInfo = Object.values(module).find(isProviderInfo);
    if (!providerInfo) {
      throw new Error(`No ProviderInfo export found in ${providerInfoPath}`);
    }
    providerInfos.push(providerInfo);
  }

  return providerInfos.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

const providerInfos = await discoverProviderInfos();

const providerAddChoiceDescriptionKeys: Readonly<Record<string, string>> = {
  anthropic: "commands.provider.add.provider_choice_descriptions.anthropic",
  deepseek: "commands.provider.add.provider_choice_descriptions.deepseek",
  google: "commands.provider.add.provider_choice_descriptions.google",
  novelai: "commands.provider.add.provider_choice_descriptions.novelai",
  nvidia: "commands.provider.add.provider_choice_descriptions.nvidia",
  openrouter: "commands.provider.add.provider_choice_descriptions.openrouter",
  vertex: "commands.provider.add.provider_choice_descriptions.vertex",
  vertexexpress: "commands.provider.add.provider_choice_descriptions.vertexexpress",
  zai: "commands.provider.add.provider_choice_descriptions.zai",
  zaicoding: "commands.provider.add.provider_choice_descriptions.zaicoding",
};

const providerInfoByCanonicalName = new Map<string, ProviderInfo>(
  providerInfos.map((info) => [info.name.toLowerCase(), info]),
);

const providerAliasToCanonicalName = new Map<string, string>();

for (const info of providerInfos) {
  providerAliasToCanonicalName.set(info.name.toLowerCase(), info.name);
  for (const alias of info.aliases ?? []) {
    providerAliasToCanonicalName.set(alias.toLowerCase(), info.name);
  }
}

const providerFeatureImplementations: Partial<
  Record<ProviderFeatureName, Partial<Record<string, ProviderFeatureImplementation>>>
> = {};

for (const info of providerInfos) {
  const canonicalName = info.name.toLowerCase();
  for (const [featureName, implementation] of Object.entries(info.featureImplementations ?? {}) as Array<
    [ProviderFeatureName, ProviderFeatureImplementation]
  >) {
    providerFeatureImplementations[featureName] ??= {};
    providerFeatureImplementations[featureName][canonicalName] = implementation;
  }
}

export function normalizeProviderName(providerName: string): string {
  const normalizedName = providerName.toLowerCase().trim();
  if (isCustomProvider(normalizedName)) {
    return "custom";
  }
  return providerAliasToCanonicalName.get(normalizedName) ?? normalizedName;
}

export function getStaticProviderInfo(providerName: string): ProviderInfo | null {
  const canonicalName = normalizeProviderName(providerName);
  return providerInfoByCanonicalName.get(canonicalName) ?? null;
}

export function getProviderDisplayName(providerName: string, locale = "en-US"): string {
  const optionName = providerOptionDisplayName(providerName, locale);
  if (optionName) return optionName;
  if (isCustomProvider(providerName)) {
    return getCustomProviderDisplayName(providerName);
  }
  return getStaticProviderInfo(providerName)?.displayName ?? providerName;
}

export function providerSupportsFeature(providerName: string, featureName: ProviderFeatureName): boolean {
  if (isCustomProvider(providerName)) {
    if (
      featureName === "imageGeneration" ||
      featureName === "videoGeneration" ||
      featureName === "embeddings" ||
      featureName === "liveTokenCounting"
    ) {
      return featureName !== "liveTokenCounting";
    }
  }
  const featureValue = getStaticProviderInfo(providerName)?.featureSupport[featureName];
  if (typeof featureValue === "string") {
    return featureValue !== "none";
  }
  return featureValue ?? false;
}

export function providerUsesApiFamily(providerName: string, apiFamily: ProviderApiFamily): boolean {
  return getStaticProviderInfo(providerName)?.apiFamily === apiFamily;
}

export function resolveProviderFeatureImplementation(
  providerName: string,
  featureName: ProviderFeatureName,
): ProviderFeatureImplementation | null {
  const canonicalName = normalizeProviderName(providerName);
  return providerFeatureImplementations[featureName]?.[canonicalName] ?? null;
}

export function supportsImageCapability(providerName: string): boolean {
  return getStaticProviderInfo(providerName)?.featureSupport.imageGeneration !== "none";
}

export function supportsVideoCapability(providerName: string): boolean {
  return getStaticProviderInfo(providerName)?.featureSupport.videoGeneration !== "none";
}

export function supportsEmbeddingCapability(providerName: string): boolean {
  return getStaticProviderInfo(providerName)?.featureSupport.embeddings === true;
}

export function supportsVisionCapability(providerName: string): boolean {
  return getStaticProviderInfo(providerName)?.supportsImages === true;
}

/**
 * Returns all providers as Discord slash-command choice objects.
 */
export function getAllProviderChoices(): Array<{ name: string; value: string }> {
  return providerInfos.map((info) => ({ name: info.displayName, value: info.name.toLowerCase() }));
}

/**
 * Returns the shared provider-picker description key, when one is available.
 */
export function getProviderAddChoiceDescriptionKey(providerName: string): string | undefined {
  return providerAddChoiceDescriptionKeys[normalizeProviderName(providerName)];
}
