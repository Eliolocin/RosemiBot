import { z } from "zod";
import { buildInteractionRouteId, type ParsedInteractionRoute } from "@/utils/discord/interactions/routeRegistry";
import { parseLocale } from "@/utils/discord/panelRouteTokens";

export const SUBSCRIPTION_NAMESPACE = "subscription";
export const SUBSCRIPTION_VERSION = "v1";
export const SPONSOR_CURRENT_SERVER_VALUE = "sponsor-current";
const subscriptionOriginSchema = z.enum(["account", "server", "sponsor", "personal", "setup"]);
export type SubscriptionOrigin = z.infer<typeof subscriptionOriginSchema>;
const actionSchema = z.enum([
  "onboard",
  "overview",
  "usage",
  "models",
  "servers",
  "server-select",
  "breakdown",
  "servers-page",
  "usage-page",
  "models-page",
  "link",
  "continue",
  "refresh",
  "activate",
  "setup",
  "back",
  "remove",
  "confirm",
]);
export type SubscriptionAction = z.infer<typeof actionSchema>;
export interface SubscriptionRoute {
  action: SubscriptionAction;
  locale: string;
  owner: string;
  origin: SubscriptionOrigin;
  selection: number;
  page: number;
}

export function buildSubscriptionRouteId(route: SubscriptionRoute): string {
  return buildInteractionRouteId(
    SUBSCRIPTION_NAMESPACE,
    SUBSCRIPTION_VERSION,
    route.action,
    route.locale,
    route.owner,
    route.origin,
    String(route.selection),
    String(route.page),
  );
}

export function parseSubscriptionRoute(parsed: ParsedInteractionRoute): SubscriptionRoute | null {
  if (
    parsed.namespace !== SUBSCRIPTION_NAMESPACE ||
    parsed.version !== SUBSCRIPTION_VERSION ||
    parsed.segments.length !== 6
  )
    return null;
  const [rawAction, rawLocale, owner, rawOrigin, rawSelection, rawPage] = parsed.segments;
  const action = actionSchema.safeParse(rawAction);
  const origin = subscriptionOriginSchema.safeParse(rawOrigin);
  const locale = rawLocale && parseLocale(rawLocale);
  if (!action.success || !origin.success || !locale || !owner || !/^\d{17,20}$/.test(owner)) return null;
  if (!rawSelection || !rawPage || !/^\d+$/.test(rawSelection) || !/^\d+$/.test(rawPage)) return null;
  const selection = Number(rawSelection);
  const page = Number(rawPage);
  if (!Number.isSafeInteger(selection) || !Number.isSafeInteger(page)) return null;
  return { action: action.data, origin: origin.data, locale, owner, selection, page };
}
