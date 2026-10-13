type MessageProxyInstanceId = string;

export type MessageProxyInstanceContext = Readonly<{
  serviceId: string;
  instanceId: MessageProxyInstanceId;
  origin: string;
  botUserId?: string | null;
}>;

export function canonicalMessageProxyOrigin(input: string): string | null {
  try {
    const url = new URL(input);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      url.hostname.endsWith(".")
    )
      return null;
    return url.origin;
  } catch {
    return null;
  }
}
