import {
  CUSTOM_IDLE_NUDGE_KEY_PREFIX,
  PERSONA_AUTHORED_IDLE_NUDGE_ID_PATTERN,
  PERSONA_AUTHORED_IDLE_NUDGE_KEY_PREFIX,
  customIdleNudgeKey,
  NATURAL_NUDGE_CATEGORIES,
  personaAuthoredIdleNudgeKey,
  type NaturalNudgeCategory,
} from "@/modules/natural-nudges/db/types";
import { BUILTIN_IDLE_NUDGES } from "@/modules/natural-nudges/runtime/idleNudges";
import { buildInteractionRouteId, type ParsedInteractionRoute } from "@/utils/discord/interactions/routeRegistry";
import {
  buildRouteSegments,
  decodeRouteSegments,
  indexCodecsByWireToken,
  parseNonce,
  parseNonNegativeInt,
  parsePositiveId,
  type RouteCodec,
  type RouteFieldCodec,
} from "@/utils/discord/panelRouteCodec";
import { parseLocale } from "@/utils/discord/panelRouteTokens";

export const NUDGE_STUDIO_ROUTE_NAMESPACE = "nudge-studio";
export const NUDGE_STUDIO_ROUTE_VERSION = "v1";

export type NudgeStudioRoute =
  | { action: "view"; locale: string; category: NaturalNudgeCategory; page?: number }
  | { action: "select"; locale: string; category: NaturalNudgeCategory; page?: number }
  | { action: "add-submit"; locale: string; category: NaturalNudgeCategory; nonce: string; page?: number }
  | {
      action: "edit-submit";
      locale: string;
      category: NaturalNudgeCategory;
      id: number;
      nonce: string;
      page?: number;
    }
  | {
      action: "persona-edit-submit";
      locale: string;
      category: NaturalNudgeCategory;
      page: number;
      ownerId: number;
      idleNudgeId: string;
      fp: string;
      nonce: string;
    }
  | { action: "toggle-open"; locale: string; category: NaturalNudgeCategory; page: number }
  | {
      action: "toggle-submit";
      locale: string;
      category: NaturalNudgeCategory;
      key: string;
      page: number;
      nonce: string;
    }
  | {
      action: "persona-toggle-submit";
      locale: string;
      category: NaturalNudgeCategory;
      page: number;
      ownerId: number;
      idleNudgeId: string;
      nonce: string;
    }
  | { action: "remove-open"; locale: string; category: NaturalNudgeCategory; page?: number }
  | { action: "remove-submit"; locale: string; category: NaturalNudgeCategory; nonce: string; page?: number };

type NudgeStudioAction = NudgeStudioRoute["action"];

type RouteForAction<A extends NudgeStudioAction> = Extract<NudgeStudioRoute, { action: A }>;

const categoryField: RouteFieldCodec<"category", NaturalNudgeCategory> = {
  key: "category",
  encode: (value) => String(value),
  decode: (value) =>
    (NATURAL_NUDGE_CATEGORIES as readonly string[]).includes(value) ? (value as NaturalNudgeCategory) : null,
};

const idField: RouteFieldCodec<"id", number> = {
  key: "id",
  encode: (value) => String(value),
  decode: (value) => parsePositiveId(value),
};

const ownerIdField: RouteFieldCodec<"ownerId", number> = {
  key: "ownerId",
  encode: (value) => String(value),
  decode: (value) => parsePositiveId(value),
};

const idleNudgeIdField: RouteFieldCodec<"idleNudgeId", string> = {
  key: "idleNudgeId",
  encode: (value) => String(value),
  decode: (value) => (value && PERSONA_AUTHORED_IDLE_NUDGE_ID_PATTERN.test(value) ? value : null),
};

const fpField: RouteFieldCodec<"fp", string> = {
  key: "fp",
  encode: (value) => String(value),
  decode: (value) => (value && /^[A-Za-z0-9_-]{8}$/.test(value) ? value : null),
};

const CUSTOM_KEY_SEGMENT = /^custom\.(\d+)$/;
const PERSONA_KEY_SEGMENT = /^persona\.(\d+)\.([A-Za-z0-9_-]{1,24})$/;

/**
 * Route segments cannot hold `:`, so a custom key travels as `custom.<id>` and a persona key as
 * `persona.<owner>.<localId>`; no built-in category is named either prefix.
 */
const keyField: RouteFieldCodec<"key", string> = {
  key: "key",
  encode: (value) =>
    String(value)
      .replace(CUSTOM_IDLE_NUDGE_KEY_PREFIX, "custom.")
      .replace(PERSONA_AUTHORED_IDLE_NUDGE_KEY_PREFIX, "persona.")
      .replace(":", "."),
  decode: (value) => {
    const custom = CUSTOM_KEY_SEGMENT.exec(value);
    if (custom) {
      const id = parsePositiveId(custom[1]);
      return id === null ? null : customIdleNudgeKey(id);
    }
    const persona = PERSONA_KEY_SEGMENT.exec(value);
    if (persona) {
      const ownerId = parsePositiveId(persona[1]);
      return ownerId === null ? null : personaAuthoredIdleNudgeKey(ownerId, persona[2] as string);
    }
    return BUILTIN_IDLE_NUDGES.some((definition) => definition.key === value) ? value : null;
  },
};

const pageField: RouteFieldCodec<"page", number> = {
  key: "page",
  encode: (value) => String(value),
  decode: (value) => parseNonNegativeInt(value),
};

const nonceField: RouteFieldCodec<"nonce", string> = {
  key: "nonce",
  encode: (value) => String(value),
  decode: (value) => parseNonce(value),
};

const CODECS: { [A in NudgeStudioAction]: RouteCodec<RouteForAction<A>> } = {
  view: { wireToken: "view", fields: [categoryField, { ...pageField, optional: true }] },
  select: { wireToken: "select", fields: [categoryField, { ...pageField, optional: true }] },
  "add-submit": { wireToken: "add", fields: [categoryField, nonceField, { ...pageField, optional: true }] },
  "edit-submit": {
    wireToken: "edit",
    fields: [categoryField, idField, nonceField, { ...pageField, optional: true }],
  },
  "persona-edit-submit": {
    wireToken: "pe",
    fields: [categoryField, pageField, ownerIdField, idleNudgeIdField, fpField, nonceField],
  },
  "toggle-open": { wireToken: "toggle-open", fields: [categoryField, pageField] },
  "toggle-submit": { wireToken: "toggle", fields: [categoryField, keyField, pageField, nonceField] },
  "persona-toggle-submit": {
    wireToken: "pt",
    fields: [categoryField, pageField, ownerIdField, idleNudgeIdField, nonceField],
  },
  "remove-open": { wireToken: "remove-open", fields: [categoryField, { ...pageField, optional: true }] },
  "remove-submit": {
    wireToken: "remove",
    fields: [categoryField, nonceField, { ...pageField, optional: true }],
  },
};

const CODECS_BY_WIRE_TOKEN = indexCodecsByWireToken<NudgeStudioAction, NudgeStudioRoute>(CODECS);

export function buildNudgeStudioRouteId(route: NudgeStudioRoute): string {
  return buildInteractionRouteId(
    NUDGE_STUDIO_ROUTE_NAMESPACE,
    NUDGE_STUDIO_ROUTE_VERSION,
    ...buildNudgeStudioRouteSegments(route),
  );
}

/** Segments after the namespace and version, for `buildPaginationRow`, which adds those itself. */
export function buildNudgeStudioRouteSegments(route: NudgeStudioRoute): string[] {
  return buildRouteSegments(CODECS[route.action], route);
}

export function parseNudgeStudioRoute(route: ParsedInteractionRoute): NudgeStudioRoute | null {
  if (route.namespace !== NUDGE_STUDIO_ROUTE_NAMESPACE || route.version !== NUDGE_STUDIO_ROUTE_VERSION) return null;
  const [rawWireToken, rawLocale, ...tail] = route.segments;
  const locale = parseLocale(rawLocale);
  const entry = rawWireToken ? CODECS_BY_WIRE_TOKEN.get(rawWireToken) : undefined;
  if (!locale || !entry) return null;
  return decodeRouteSegments<NudgeStudioRoute>(entry.codec, entry.action, locale, tail);
}

export function nudgeStudioFieldId(
  field: "title" | "brief" | "agenda" | "needs" | "tools" | "checklist",
  nonce: string,
  group = 0,
): string {
  return group > 0 ? `nstudio_${field}_${group}_${nonce}` : `nstudio_${field}_${nonce}`;
}
