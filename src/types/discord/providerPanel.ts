import type { CustomEndpointApiStyle, CustomEndpointCapability, VramHandoffBackend } from "@/types/db/schema";
import type { PanelReadStatus } from "@/types/discord/panel";
import type { ImageEndpointSupports } from "@/utils/provider/customImageEndpointSupport";
import type { SpeechEndpointSettings } from "@/utils/provider/customSpeechEndpointSettings";

export type ProviderPanelCapability = CustomEndpointCapability;

export interface ProviderPanelModel {
  id: number;
  codeName: string;
  isWorkspaceActive: boolean;
  isWorkspaceFallback: boolean;
  isProviderFallback: boolean;
  isCustomRegistration: boolean;
  textSettings?: {
    numCtx: number | null;
    hasTools: boolean;
    seesImages: boolean;
    supportsStructOutput: boolean;
    strictRoleAlternation: boolean;
    supportsPrefixCompletion: boolean;
    supportsAssistantPrefill: boolean;
    verbatimToolCalling: boolean;
  };
  decisionSettings?: { inputTokenLimit: number };
  imageSettings?: ImageEndpointSupports;
  speechSettings?: SpeechEndpointSettings;
}

export interface ProviderPanelCapabilitySection {
  capability: ProviderPanelCapability;
  availability: "available" | "unavailable";
  models: ProviderPanelModel[];
  // Curated providers have no endpoint behind a capability, so this stays undefined for them. The
  // image modal reads it to decide whether inpainting is offerable at all.
  apiStyle?: CustomEndpointApiStyle;
}

interface ProviderPanelEntryBase {
  id: string;
  displayName: string;
  savedAt: Date | null;
}

interface CuratedProviderPanelEntry extends ProviderPanelEntryBase {
  kind: "provider";
  provider: string;
  rotationKeyCount: number;
  capabilities: ProviderPanelCapabilitySection[];
}

export interface EndpointProviderPanelEntry extends ProviderPanelEntryBase {
  kind: "endpoint";
  connectionIds: number[];
  isPreset: boolean;
  connectionDetails: Array<{
    connectionId: number;
    endpointUrl: string;
    apiStyle: CustomEndpointApiStyle;
    capability: CustomEndpointCapability;
    vramHandoff: VramHandoffBackend | null;
  }>;
  capabilities: ProviderPanelCapabilitySection[];
}

interface BraveProviderPanelEntry extends ProviderPanelEntryBase {
  kind: "brave";
}

export type ProviderPanelEntry = CuratedProviderPanelEntry | EndpointProviderPanelEntry | BraveProviderPanelEntry;

export interface ProviderPanelScopeData {
  readStatus: PanelReadStatus;
  entries: ProviderPanelEntry[];
  initialEntryId: string | null;
}
