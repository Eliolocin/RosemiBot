import { isIP } from "node:net";

/**
 * Cloud instance-metadata and link-local addresses that must NEVER be
 * reachable through any user-driven fetch, regardless of runtime environment
 * (`RUN_ENV`) or private-network opt-in (`FETCH_URL_ALLOW_PRIVATE_NETWORK`).
 *
 * These endpoints are the primary SSRF credential-theft target: the cloud
 * Instance Metadata Service (AWS/Azure/GCP all expose it at `169.254.169.254`)
 * hands out short-lived cloud credentials to anything that can reach it. There
 * is no legitimate `fetch_url`/custom-endpoint use case for them, so this
 * denylist is always enforced as a floor beneath every other network guard;
 * it cannot be relaxed by the development auto-relax or the operator opt-in.
 *
 * @param address - An already DNS-resolved IP address (IPv4 or IPv6 literal).
 *   Hostnames must be resolved by the caller first; this returns false for any
 *   non-IP input.
 * @returns True when the address is a cloud-metadata/link-local endpoint that
 *   must be blocked unconditionally.
 */
export function isCloudMetadataAddress(address: string): boolean {
  const normalized = address.trim().toLowerCase();
  const family = isIP(normalized);

  // IPv4 link-local (169.254.0.0/16): includes the 169.254.169.254 IMDS
  //    address used by AWS, Azure, and GCP (metadata.google.internal resolves
  //    here). The whole /16 is non-routable and has no fetch use case.
  //    Alibaba Cloud's metadata service is the single address 100.100.100.200;
  //    the rest of 100.64.0.0/10 is carrier-grade NAT that overlay networks such
  //    as Tailscale use legitimately, so only that address is blocked here.
  if (family === 4) {
    return normalized.startsWith("169.254.") || normalized === "100.100.100.200";
  }

  // IPv6 link-local (fe80::/10), the AWS IPv6 IMDS address (fd00:ec2::254), and
  //    GCP's metadata server address for IPv6-only VMs (fd20:ce::254).
  if (family === 6) {
    return /^fe[89ab]/.test(normalized) || normalized === "fd00:ec2::254" || normalized === "fd20:ce::254";
  }

  return false;
}
