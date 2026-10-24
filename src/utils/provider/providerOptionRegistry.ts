import type {
  ActionRowData,
  ButtonComponentData,
  ChatInputCommandInteraction,
  ComponentInContainerData,
} from "discord.js";
import type { FallbackModelRef, TomoriState } from "@/types/db/schema";
import type { PanelReceipt } from "@/types/discord/panel";
import type { ProviderPanelCapability, ProviderPanelEntry } from "@/types/discord/providerPanel";
import type { SetupDraftRecord } from "@/types/discord/setupWizard";
import type { GlobalRoutableInteraction } from "@/utils/discord/interactions/routeRegistry";
import type { ProviderUsageContext } from "@/utils/provider/providerUsage";
import type { VoiceSourceMode } from "@/utils/speech/voiceSourceCapabilities";
import { localizer } from "@/utils/text/localizer";

export type ProviderOptionCapability =
  | "text"
  | "vision"
  | "embedding"
  | "image"
  | "video"
  | "decision"
  | "reviewer"
  | "nudge-planner"
  | "nudge-checker"
  | "speech-design"
  | "speech-clone";

export interface ProviderOptionScope {
  kind: "server" | "personal";
  ownerId: number;
  discordId?: string;
  state?: TomoriState | null;
}

interface ProviderOptionAvailability {
  eligible: boolean;
  reasonKey?: string;
}

/** @public Release-only `src/modules/supporter-billing/discord/providerOption.ts` imports this. */
export interface ProviderOptionStoredSelection {
  /** Handed back to this option's own panel callbacks, so the registry stays unaware of its shape. */
  data?: unknown;
  savedAt: Date | null;
}

interface ProviderOptionCopy {
  labelKey: string;
  entryDescriptionKeys: { server: string; personal: string; owned?: string };
  addActionLabelKey: string;
  addActionDescriptionKeys: { server: string; personal: string };
  removeImpactKey: string;
  modelDescriptionKey?: string;
}

/** @public Release-only `src/modules/supporter-billing/discord/providerOption.ts` imports this. */
export interface ProviderOptionEntryContext {
  locale: string;
  scope: ProviderOptionScope;
  entry: ProviderPanelEntry;
  data?: unknown;
  canManageServer: boolean;
}

/** @public Release-only `src/modules/supporter-billing/discord/providerOption.ts` imports this. */
export interface ProviderOptionActionContext {
  locale: string;
  interaction: GlobalRoutableInteraction;
  entryId?: string;
  loadSelection(): Promise<{ scope: ProviderOptionScope; entry?: ProviderPanelEntry } | null>;
  canManageServer: boolean;
}

/** @public Release-only `src/modules/supporter-billing/discord/providerOption.ts` imports this. */
export interface ProviderOptionSetupContext {
  locale: string;
  draft: SetupDraftRecord;
  /** Present when a live interaction triggered the render; absent during commit revalidation. */
  interaction?: GlobalRoutableInteraction | ChatInputCommandInteraction;
  /** Routes a control back to `handleAction`; the route has no sub-action segment, so add one before a second control. */
  actionRouteId?: string;
}

interface ProviderOptionSetupCommitContext extends ProviderOptionSetupContext {
  serverId: number;
  workspaceKey: string;
}

/** @public Release-only `src/modules/supporter-billing/discord/providerOption.ts` imports this. */
export interface ProviderOptionReadiness {
  ready: boolean;
  reasonKey?: string;
}

interface ProviderOptionSetup {
  optionLabelKey: string;
  optionDescriptionKey: string;
  summaryKey: string;
  receiptDescriptionKey: string;
  available?(input: { context: "guild" | "dm" }): boolean;
  ready?(context: ProviderOptionSetupContext): Promise<ProviderOptionReadiness>;
  components?(context: ProviderOptionSetupContext): Promise<readonly ComponentInContainerData[]>;
  committed?(context: ProviderOptionSetupCommitContext): Promise<void>;
  handleAction?(
    context: ProviderOptionSetupContext & { interaction: GlobalRoutableInteraction },
  ): Promise<PanelReceipt | undefined>;
}

/** @public Release-only `src/modules/supporter-billing/discord/providerOption.ts` imports this. */
export type ProviderOptionRemovalStatus = "removed" | "active" | "not-found" | "write-failed";

export interface ProviderOptionSpeechSelectionInput {
  scope: ProviderOptionScope;
  modelId: number;
  mode?: VoiceSourceMode;
  register?: boolean;
  replacedModelId?: number;
}

/** @public Natural Nudges and `providerFeatureExecutors.ts` import this on the subscription launch branch. */
export interface ProviderOptionServerCredentials {
  apiKey: string;
  usageContext?: ProviderUsageContext;
  /** The saved provider row whose settings the call mirrors; absent means the persona's own settings. */
  savedProvider?: string;
}

export interface ProviderOptionDefinition {
  value: string;
  catalogProvider: string;
  capabilities: readonly ProviderOptionCapability[];
  copy: ProviderOptionCopy;
  availability(scope: ProviderOptionScope): ProviderOptionAvailability | Promise<ProviderOptionAvailability>;
  selection: {
    load(scope: ProviderOptionScope): Promise<ProviderOptionStoredSelection | null>;
    ensure(scope: ProviderOptionScope): Promise<boolean>;
    claim(scope: ProviderOptionScope, capability: ProviderOptionCapability): Promise<boolean>;
    setSpeech?(input: ProviderOptionSpeechSelectionInput): Promise<boolean>;
    release?(scope: ProviderOptionScope, capability: ProviderOptionCapability): Promise<boolean>;
    remove(scope: ProviderOptionScope): Promise<ProviderOptionRemovalStatus>;
    /** Synchronous ownership check for surfaces that render from an already-loaded state. */
    owns?(scope: ProviderOptionScope, capability: ProviderOptionCapability): boolean;
    validateModel?(input: {
      scope: ProviderOptionScope;
      capability: ProviderPanelCapability;
      modelCodename: string;
    }): Promise<boolean>;
    /** Pays for a server-pinned structured call in a slot this option owns; throws `ProviderRequestDeniedError` to refuse. */
    resolveServerCredentials?(input: {
      scope: ProviderOptionScope;
      capability: ProviderOptionCapability;
      modelId: number;
    }): Promise<ProviderOptionServerCredentials | null>;
  };
  panel?: {
    entryComponents?(context: ProviderOptionEntryContext): readonly ComponentInContainerData[];
    entryActions?(context: ProviderOptionEntryContext): ActionRowData<ButtonComponentData> | null;
    entryOwned?(context: ProviderOptionEntryContext): boolean;
    handleAction?(action: "select" | "edit", context: ProviderOptionActionContext): Promise<boolean>;
  };
  setup?: ProviderOptionSetup;
}

type ProviderOptionFallbackRefOwner = (ref: FallbackModelRef) => string | null;

let options: readonly ProviderOptionDefinition[] = [];
let fallbackRefOwner: ProviderOptionFallbackRefOwner | undefined;

export function registerProviderOption(option: ProviderOptionDefinition): () => void {
  options = [...options, option];
  return () => {
    options = options.filter((candidate) => candidate !== option);
  };
}

export function getProviderOptions(): readonly ProviderOptionDefinition[] {
  return options;
}

export function findProviderOption(value: string | null | undefined): ProviderOptionDefinition | undefined {
  if (!value) return undefined;
  const normalized = value.toLowerCase();
  return options.find((option) => option.value === normalized);
}

/** @public Release-only `src/modules/supporter-billing/discord/providerOption.ts` registers its fallback owner through this. */
export function registerProviderOptionFallbackRefOwner(owner: ProviderOptionFallbackRefOwner): () => void {
  const previous = fallbackRefOwner;
  fallbackRefOwner = owner;
  return () => {
    if (fallbackRefOwner === owner) fallbackRefOwner = previous;
  };
}

export function providerOptionFallbackRefServes(ref: FallbackModelRef, provider: string): boolean {
  const owner = fallbackRefOwner?.(ref) ?? null;
  const option = findProviderOption(provider);
  if (option) return owner === option.value;
  return owner === null || owner === provider;
}

export function providerOptionActionValue(option: ProviderOptionDefinition): string {
  return `option:${option.value}`;
}

export function providerOptionActionOption(value: string): ProviderOptionDefinition | undefined {
  return value.startsWith("option:") ? findProviderOption(value.slice("option:".length)) : undefined;
}

function providerOptionSupportsCapability(
  option: ProviderOptionDefinition,
  capability: ProviderOptionCapability,
): boolean {
  return option.capabilities.includes(capability);
}

export function providerOptionOffersPanelCapability(
  option: ProviderOptionDefinition,
  capability: ProviderPanelCapability,
): boolean {
  if (capability === "speech") {
    return (
      providerOptionSupportsCapability(option, "speech-design") ||
      providerOptionSupportsCapability(option, "speech-clone")
    );
  }
  if (capability === "transcription") return false;
  return providerOptionSupportsCapability(option, capability);
}

export function providerOptionCapabilityForPanel(capability: ProviderPanelCapability): ProviderOptionCapability | null {
  switch (capability) {
    case "text":
    case "image":
    case "embedding":
    case "video":
    case "decision":
      return capability;
    default:
      return null;
  }
}

export type ProviderOptionModelViewCapability =
  | "text"
  | "vision"
  | "embedding"
  | "decision"
  | "image"
  | "nai-image"
  | "video"
  | "tts-design"
  | "tts-clone";

const MODEL_VIEW_CAPABILITY: Record<
  Exclude<ProviderOptionModelViewCapability, "nai-image">,
  ProviderOptionCapability
> = {
  text: "text",
  vision: "vision",
  embedding: "embedding",
  decision: "decision",
  image: "image",
  video: "video",
  "tts-design": "speech-design",
  "tts-clone": "speech-clone",
};

export function providerOptionCapabilityForModelView(
  capability: ProviderOptionModelViewCapability,
): ProviderOptionCapability | null {
  return capability === "nai-image" ? null : MODEL_VIEW_CAPABILITY[capability];
}

export function providerOptionOffersModelViewCapability(
  option: ProviderOptionDefinition,
  capability: ProviderOptionModelViewCapability,
): boolean {
  const canonical = providerOptionCapabilityForModelView(capability);
  return canonical !== null && providerOptionSupportsCapability(option, canonical);
}

export type ProviderOptionPersonalCapability =
  | "text"
  | "embedding"
  | "image"
  | "image_nai"
  | "video"
  | "vision"
  | "speech_design"
  | "speech_clone";

const PERSONAL_CAPABILITY: Record<Exclude<ProviderOptionPersonalCapability, "image_nai">, ProviderOptionCapability> = {
  text: "text",
  embedding: "embedding",
  image: "image",
  video: "video",
  vision: "vision",
  speech_design: "speech-design",
  speech_clone: "speech-clone",
};

export function providerOptionCapabilityForPersonal(
  capability: ProviderOptionPersonalCapability,
): ProviderOptionCapability | null {
  return capability === "image_nai" ? null : PERSONAL_CAPABILITY[capability];
}

export function providerOptionOffersPersonalCapability(
  option: ProviderOptionDefinition,
  capability: ProviderOptionPersonalCapability,
): boolean {
  const canonical = providerOptionCapabilityForPersonal(capability);
  return canonical !== null && providerOptionSupportsCapability(option, canonical);
}

export function findProviderOptionByActiveProvider(
  provider: string,
  scope: ProviderOptionScope,
  capability: ProviderOptionCapability,
): ProviderOptionDefinition | undefined {
  return options.find(
    (option) => option.catalogProvider === provider && (option.selection.owns?.(scope, capability) ?? false),
  );
}

export function providerOptionDisplayName(provider: string, locale: string): string | null {
  const option = findProviderOption(provider);
  return option ? localizer(locale, option.copy.labelKey) : null;
}

export function providerOptionModelDescription(locale: string, provider: string): string | undefined {
  const key = findProviderOption(provider)?.copy.modelDescriptionKey;
  return key ? localizer(locale, key) : undefined;
}

export async function claimProviderModelSelection(input: {
  scope: ProviderOptionScope;
  provider: string;
  capability: ProviderOptionCapability;
}): Promise<boolean> {
  const previousOwner = options.find((option) => option.selection.owns?.(input.scope, input.capability));
  const option = findProviderOption(input.provider);
  if (option) return option.selection.claim(input.scope, input.capability);
  if (previousOwner) {
    return previousOwner.selection.release?.(input.scope, input.capability) ?? true;
  }
  return true;
}

export async function writeProviderSpeechSelection(
  input: ProviderOptionSpeechSelectionInput & { provider: string },
  writeBuiltIn: () => Promise<boolean>,
): Promise<boolean> {
  const option = findProviderOption(input.provider);
  return option ? (option.selection.setSpeech?.(input) ?? false) : writeBuiltIn();
}

export async function applyProviderModelSelection(
  input: Parameters<typeof claimProviderModelSelection>[0] & { write: () => Promise<boolean>; onWritten?: () => void },
): Promise<boolean> {
  if (!(await input.write())) return false;
  try {
    return await claimProviderModelSelection(input);
  } finally {
    input.onWritten?.();
  }
}

export async function clearProviderModelSelection(input: {
  scope: ProviderOptionScope;
  capability: ProviderOptionCapability;
}): Promise<boolean> {
  let cleared = true;
  for (const option of options) {
    if (!option.selection.owns?.(input.scope, input.capability)) continue;
    if (!option.selection.release) continue;
    cleared = (await option.selection.release(input.scope, input.capability)) && cleared;
  }
  return cleared;
}
