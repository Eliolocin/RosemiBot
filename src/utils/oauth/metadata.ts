import { z } from "zod";
import { fetchOAuthJson } from "@/utils/oauth/oauthFetch";

const metadataSchema = z.object({
  issuer: z.string().url(),
  authorization_endpoint: z.string().url(),
  token_endpoint: z.string().url(),
  response_types_supported: z.array(z.string()),
  grant_types_supported: z.array(z.string()),
  code_challenge_methods_supported: z.array(z.string()),
  token_endpoint_auth_methods_supported: z.array(z.string()),
  authorization_response_iss_parameter_supported: z.literal(true),
});

export async function discoverOAuthMetadata(options: {
  discoveryUrl: string;
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
}): Promise<{ issuer: string; authorizationEndpoint: string; tokenEndpoint: string }> {
  const origin = new URL(options.issuer).origin;
  const { response, data } = await fetchOAuthJson(options.discoveryUrl, {}, { allowedOrigins: [origin] });
  const parsed = metadataSchema.safeParse(data);
  if (
    !response.ok ||
    !parsed.success ||
    parsed.data.issuer !== options.issuer ||
    parsed.data.authorization_endpoint !== options.authorizationEndpoint ||
    parsed.data.token_endpoint !== options.tokenEndpoint ||
    new URL(parsed.data.authorization_endpoint).origin !== origin ||
    new URL(parsed.data.token_endpoint).origin !== origin ||
    !parsed.data.response_types_supported.includes("code") ||
    !parsed.data.grant_types_supported.includes("authorization_code") ||
    !parsed.data.grant_types_supported.includes("refresh_token") ||
    !parsed.data.code_challenge_methods_supported.includes("S256") ||
    !parsed.data.token_endpoint_auth_methods_supported.includes("client_secret_basic")
  )
    throw new Error("OAuth discovery does not match the selected issuer or required flow.");
  return {
    issuer: options.issuer,
    authorizationEndpoint: options.authorizationEndpoint,
    tokenEndpoint: options.tokenEndpoint,
  };
}
