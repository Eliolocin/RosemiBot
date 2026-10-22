export const OAUTH_CALLBACK_PATH = "/oauth/callback";

export function getOAuthPublicBaseUrl(env: Readonly<Record<string, string | undefined>> = process.env): string {
  const url = new URL(env.TOMORI_PUBLIC_BASE_URL?.trim() || "https://api.tomoribot.app");
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("TOMORI_PUBLIC_BASE_URL must be an HTTPS origin.");
  }
  return url.origin;
}
