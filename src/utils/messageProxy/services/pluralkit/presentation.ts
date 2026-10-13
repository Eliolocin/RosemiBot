import type { ProxyServicePresentation } from "@/utils/messageProxy/types";

function formatPluralKitSystemLabel(
  context: Parameters<ProxyServicePresentation["identityMembershipLine"]>[0],
): string {
  const systemName = context.namespaceDisplayName?.trim();
  if (systemName) return `the "${systemName}" plural system`;
  const systemTag = context.namespaceTag?.trim();
  return systemTag ? `${systemTag} plural system` : "a plural system";
}

export const pluralKitPresentation: ProxyServicePresentation = {
  identityMembershipLine: (context) =>
    `- Member of ${formatPluralKitSystemLabel(context)}; its members share one presence here`,
  namespacePresentation: (context, accountLabels) => {
    const label = formatPluralKitSystemLabel(context);
    const capitalizedLabel = `${label.charAt(0).toUpperCase()}${label.slice(1)}`;
    const accounts = accountLabels.length > 0 ? ` (shared account: ${accountLabels.join("; ")})` : "";
    const description = context.namespaceDescription?.replace(/\s+/gu, " ").trim();
    return {
      sectionHeading: "Some of the people above are members of plural systems:",
      entry: `- ${capitalizedLabel}${accounts}${description ? `: ${description}` : ""}`,
    };
  },
};
