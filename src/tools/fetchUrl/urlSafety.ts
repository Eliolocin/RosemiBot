import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { isCloudMetadataAddress } from "@/utils/security/cloudMetadata";

const PRIVATE_NETWORK_ENV = "FETCH_URL_ALLOW_PRIVATE_NETWORK";

interface AddressClassification {
  blocked: boolean;
  reason: string;
}

interface ResolvedFetchAddress extends AddressClassification {
  address: string;
}

type FetchUrlSafetyFailureCode =
  | "INVALID_FORMAT"
  | "INVALID_PROTOCOL"
  | "DNS_RESOLUTION_FAILED"
  | "PRIVATE_NETWORK_BLOCKED";

export interface FetchUrlSafetyResult {
  allowed: boolean;
  failureCode?: FetchUrlSafetyFailureCode;
  error?: string;
  details?: string;
}

/**
 * Whether the current process is a production deployment.
 *
 * Mirrors the production signal in `remoteUrlSecurity.ts`
 * (`validateRemoteUrl`), which guards the same SSRF domain, so both
 * fetch guards stay in lockstep on a single environment variable.
 */
function isProductionRuntime(): boolean {
  return process.env.RUN_ENV === "production";
}

/**
 * Whether `fetch_url` may reach private/internal network addresses.
 *
 * - Outside production the SSRF blocklist auto-relaxes so local
 *    development can fetch localhost/private endpoints (and admit the
 *    Crawl4AI engine) with zero configuration.
 * - In production the blocklist stays enforced unless an operator
 *    explicitly opts in with `FETCH_URL_ALLOW_PRIVATE_NETWORK`, matching
 *    the production-gated model of `validateRemoteUrl`.
 *
 * @returns True when private-network fetch targets are permitted.
 */
export function isPrivateNetworkFetchAllowed(): boolean {
  // Development/local runtimes are trusted; skip the blocklist with no setup.
  if (!isProductionRuntime()) {
    return true;
  }

  const raw = process.env[PRIVATE_NETWORK_ENV]?.trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes" || raw === "on";
}

function normalizeHostname(hostname: string): string {
  const normalized = hostname.trim().toLowerCase().replace(/\.+$/, "");
  if (normalized.startsWith("[") && normalized.endsWith("]")) {
    return normalized.slice(1, -1);
  }

  return normalized;
}

function getMappedIpv4Address(address: string): string | null {
  const mapped = address.match(/^(?:::ffff:|0:0:0:0:0:ffff:)(.+)$/);
  if (!mapped) {
    return null;
  }

  const tail = mapped[1];
  if (tail && isIP(tail) === 4) {
    return tail;
  }

  const hexTail = tail?.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!hexTail) {
    return null;
  }

  const high = Number.parseInt(hexTail[1] ?? "", 16);
  const low = Number.parseInt(hexTail[2] ?? "", 16);
  if (Number.isNaN(high) || Number.isNaN(low)) {
    return null;
  }

  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}

function normalizeAddress(address: string): string {
  const normalized = address.trim().toLowerCase();
  const mappedIpv4 = getMappedIpv4Address(normalized);
  if (mappedIpv4) {
    return mappedIpv4;
  }

  return normalized;
}

function classifyIpv4Address(address: string): AddressClassification {
  const octets = address.split(".").map((part) => Number.parseInt(part, 10));
  if (octets.length !== 4 || octets.some((octet) => Number.isNaN(octet))) {
    return { blocked: true, reason: "not a valid IPv4 address" };
  }

  const [first, second, third] = octets;

  if (first === 10) return { blocked: true, reason: "a private IPv4 range" };
  if (first === 127) return { blocked: true, reason: "a loopback IPv4 address" };
  if (first === 0) return { blocked: true, reason: "a non-routable IPv4 address" };
  if (first === 172 && second >= 16 && second <= 31) return { blocked: true, reason: "a private IPv4 range" };
  if (first === 192 && second === 168) return { blocked: true, reason: "a private IPv4 range" };
  if (first === 169 && second === 254) return { blocked: true, reason: "a link-local IPv4 address" };
  if (first === 100 && second >= 64 && second <= 127) {
    return { blocked: true, reason: "a carrier-grade NAT IPv4 range" };
  }
  if (first === 198 && (second === 18 || second === 19)) {
    return { blocked: true, reason: "a benchmarking IPv4 range" };
  }
  if (first === 192 && second === 0 && (third === 0 || third === 2)) {
    return { blocked: true, reason: "a reserved IPv4 range" };
  }
  if (first === 198 && second === 51 && third === 100) {
    return { blocked: true, reason: "a documentation IPv4 range" };
  }
  if (first === 203 && second === 0 && third === 113) {
    return { blocked: true, reason: "a documentation IPv4 range" };
  }
  if (first >= 224) return { blocked: true, reason: "a multicast or reserved IPv4 range" };

  return { blocked: false, reason: "a public IPv4 address" };
}

function classifyIpv6Address(address: string): AddressClassification {
  if (address === "::") return { blocked: true, reason: "an unspecified IPv6 address" };
  if (address === "::1") return { blocked: true, reason: "a loopback IPv6 address" };
  if (/^f[cd]/.test(address)) return { blocked: true, reason: "a unique-local IPv6 range" };
  if (/^fe[89ab]/.test(address)) return { blocked: true, reason: "a link-local IPv6 range" };
  if (/^ff/.test(address)) return { blocked: true, reason: "a multicast IPv6 range" };
  if (/^2001:db8(?::|$)/.test(address)) return { blocked: true, reason: "a documentation IPv6 range" };

  return { blocked: false, reason: "a public IPv6 address" };
}

function classifyAddress(address: string): ResolvedFetchAddress {
  const normalized = normalizeAddress(address);
  const family = isIP(normalized);

  if (family === 4) {
    return { address: normalized, ...classifyIpv4Address(normalized) };
  }

  if (family === 6) {
    return { address: normalized, ...classifyIpv6Address(normalized) };
  }

  return { address: normalized, blocked: true, reason: "not a recognized IP address" };
}

async function resolveFetchAddresses(hostname: string): Promise<ResolvedFetchAddress[]> {
  const family = isIP(hostname);
  if (family === 4 || family === 6) {
    return [classifyAddress(hostname)];
  }

  const resolved = await lookup(hostname, { all: true, verbatim: true });
  const addresses = new Map<string, ResolvedFetchAddress>();
  for (const entry of resolved) {
    const classified = classifyAddress(entry.address);
    addresses.set(classified.address, classified);
  }

  return Array.from(addresses.values());
}

function buildBlockedFetchMessage(hostname: string, blocked: ResolvedFetchAddress, resolved: ResolvedFetchAddress[]) {
  const resolvedList = resolved.map((entry) => entry.address).join(", ");
  return (
    `The URL host '${hostname}' resolved to '${blocked.address}', which is ${blocked.reason}. ` +
    `TomoriBot blocks private/internal URL fetch targets in production unless ${PRIVATE_NETWORK_ENV}=true. ` +
    `Resolved addresses: ${resolvedList}.`
  );
}

export async function validateFetchUrlTarget(url: string): Promise<FetchUrlSafetyResult> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return {
      allowed: false,
      failureCode: "INVALID_FORMAT",
      error: "Invalid URL format.",
    };
  }

  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    return {
      allowed: false,
      failureCode: "INVALID_PROTOCOL",
      error: "URL must use HTTP or HTTPS protocol.",
    };
  }

  const hostname = normalizeHostname(parsedUrl.hostname);
  const allowPrivateNetwork = isPrivateNetworkFetchAllowed();

  // Resolution failures refuse even when the private-network guard is relaxed: the always-on
  // metadata denylist below cannot judge an address it never saw, and the Crawl4AI engine
  // dispatches out of process with no second gate.
  let resolvedAddresses: ResolvedFetchAddress[];
  try {
    resolvedAddresses = await resolveFetchAddresses(hostname);
  } catch (error) {
    return {
      allowed: false,
      failureCode: "DNS_RESOLUTION_FAILED",
      error: `Failed to resolve hostname '${hostname}': ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (resolvedAddresses.length === 0) {
    return {
      allowed: false,
      failureCode: "DNS_RESOLUTION_FAILED",
      error: `Failed to resolve hostname '${hostname}': no IP addresses found.`,
    };
  }

  // Always-on floor: cloud-metadata / link-local addresses are blocked
  //    unconditionally, so the private-network opt-in and dev auto-relax cannot
  //    reach them, since they are the primary SSRF credential-theft target.
  const metadataAddress = resolvedAddresses.find((entry) => isCloudMetadataAddress(entry.address));
  if (metadataAddress) {
    const resolvedList = resolvedAddresses.map((entry) => entry.address).join(", ");
    return {
      allowed: false,
      failureCode: "PRIVATE_NETWORK_BLOCKED",
      error:
        `The URL host '${hostname}' resolved to '${metadataAddress.address}', a cloud instance-metadata ` +
        `or link-local address that TomoriBot never fetches. Resolved addresses: ${resolvedList}.`,
      details: `Cloud-metadata and link-local addresses are always blocked and cannot be enabled via ${PRIVATE_NETWORK_ENV}.`,
    };
  }

  // Development or explicit production opt-in: skip the general blocklist.
  if (allowPrivateNetwork) {
    return { allowed: true };
  }

  const blockedAddress = resolvedAddresses.find((entry) => entry.blocked);
  if (blockedAddress) {
    const error = buildBlockedFetchMessage(hostname, blockedAddress, resolvedAddresses);
    return {
      allowed: false,
      failureCode: "PRIVATE_NETWORK_BLOCKED",
      error,
      details:
        `Set ${PRIVATE_NETWORK_ENV}=true only in a trusted self-hosted deployment if you intentionally want ` +
        "`fetch_url` to reach private network addresses.",
    };
  }

  return { allowed: true };
}
