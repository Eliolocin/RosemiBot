import { createHash } from "node:crypto";
import { buildInteractionRouteId, type ParsedInteractionRoute } from "@/utils/discord/interactions/routeRegistry";
import { parseLocale } from "@/utils/discord/panelRouteTokens";
import { parseNonNegativeInt, parseNonce } from "@/utils/discord/panelRouteCodec";

export const EXPRESSIONS_ROUTE_NAMESPACE = "expr";
export const EXPRESSIONS_ROUTE_VERSION = "v1";
export const EXPRESSION_CATEGORIES = ["emojis", "stickers", "customs"] as const;
export type ExpressionCategory = (typeof EXPRESSION_CATEGORIES)[number];

const ACTIONS = [
  "view",
  "select",
  "edit",
  "save",
  "clear",
  "delete",
  "confirm",
  "add-persona",
  "remove-persona",
  "allow",
  "deny",
  "persona-page",
  "page",
] as const;
type ExpressionAction = (typeof ACTIONS)[number];
const TOKENS = ["v", "s", "e", "w", "c", "d", "x", "a", "r", "y", "n", "p", "g"] as const;
const CATEGORY_TOKENS = ["e", "s", "c"] as const;

export interface ExpressionsPanelRoute {
  action: ExpressionAction;
  locale: string;
  category: ExpressionCategory;
  page: number;
  entityId: string;
  fp: string;
  personaPage: number;
  nonce: string;
}

export function buildExpressionsRouteSegments(route: ExpressionsPanelRoute): string[] {
  return [
    TOKENS[ACTIONS.indexOf(route.action)],
    route.locale,
    CATEGORY_TOKENS[EXPRESSION_CATEGORIES.indexOf(route.category)],
    String(route.page),
    route.entityId,
    route.fp,
    String(route.personaPage),
    route.nonce,
  ];
}

export function buildExpressionsRouteId(route: ExpressionsPanelRoute): string {
  return buildInteractionRouteId(
    EXPRESSIONS_ROUTE_NAMESPACE,
    EXPRESSIONS_ROUTE_VERSION,
    ...buildExpressionsRouteSegments(route),
  );
}

export function parseExpressionsPanelRoute(parsed: ParsedInteractionRoute): ExpressionsPanelRoute | null {
  if (
    parsed.namespace !== EXPRESSIONS_ROUTE_NAMESPACE ||
    parsed.version !== EXPRESSIONS_ROUTE_VERSION ||
    parsed.segments.length !== 8
  )
    return null;
  const [token, rawLocale, categoryToken, rawPage, entityId, fp, rawPersonaPage, rawNonce] = parsed.segments;
  const action = ACTIONS[(TOKENS as readonly string[]).indexOf(token)];
  const category = EXPRESSION_CATEGORIES[(CATEGORY_TOKENS as readonly string[]).indexOf(categoryToken)];
  const locale = parseLocale(rawLocale);
  const page = parseNonNegativeInt(rawPage);
  const personaPage = parseNonNegativeInt(rawPersonaPage);
  const nonce = rawNonce === "none" ? "none" : parseNonce(rawNonce);
  if (
    !action ||
    !category ||
    !locale ||
    page === null ||
    personaPage === null ||
    !nonce ||
    !entityId ||
    !/^(none|[0-9]{1,20}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/u.test(entityId) ||
    !/^(none|[A-Za-z0-9_-]{8})$/u.test(fp)
  )
    return null;
  return { action, locale, category, page, entityId, fp, personaPage, nonce };
}

export function expressionPanelFingerprint(
  serverId: number,
  actorId: string,
  entityId: string,
  revision: string | number,
): string {
  return createHash("sha256")
    .update(JSON.stringify([serverId, actorId, entityId, revision]))
    .digest("base64url")
    .slice(0, 8);
}

export function expressionFieldId(
  nonce: string,
  field: "name" | "description" | "emotion" | "link" | "file" | "persona",
): string {
  return `expr_${field}_${nonce}`;
}
