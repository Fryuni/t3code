import type { AdvertisedEndpoint } from "@t3tools/contracts";
import { createAdvertisedEndpoint } from "@t3tools/shared/advertisedEndpoint";
import {
  isLocalLoopbackHost,
  isPrivateNetworkHost,
  normalizeHostname,
} from "@t3tools/shared/hostClassification";
import { buildHostedPairingUrl } from "../../hostedPairing";
import { setPairingTokenOnUrl } from "../../pairingUrl";

// Tailscale assigns 100.64.0.0/10, which only resolves inside the tailnet.
const TAILSCALE_IPV4_PATTERN = /^100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./;

/**
 * A reverse proxy usually sits on the same network as the server, so an
 * advertised origin is only Internet-routable once private, tailnet, and mDNS
 * addresses are ruled out. Calling those "public" makes the share hint promise
 * "Reachable from anywhere" for an endpoint that never leaves the network.
 */
function classifyPublicUrlReachability(hostname: string): AdvertisedEndpoint["reachability"] {
  const host = normalizeHostname(hostname);
  // The `127.` prefix mirrors the server's isRemoteReachableHost, so a URL the
  // server treats as loopback for auth is never advertised as reachable here.
  if (isLocalLoopbackHost(host) || host.startsWith("127.")) {
    return "loopback";
  }
  if (TAILSCALE_IPV4_PATTERN.test(host) || host.endsWith(".ts.net")) {
    return "private-network";
  }
  return isPrivateNetworkHost(host) ? "lan" : "public";
}

/**
 * Puts the server's `--public-url` ahead of the other endpoints as the default
 * pairing target, since the operator declared it as the address clients use.
 */
export function withPublicUrlEndpoint(
  endpoints: ReadonlyArray<AdvertisedEndpoint>,
  publicUrl: string | undefined,
): ReadonlyArray<AdvertisedEndpoint> {
  if (!publicUrl) return endpoints;
  const url = new URL(publicUrl);
  return [
    createAdvertisedEndpoint({
      id: `server-public:${url.origin}`,
      label: "Public URL",
      provider: { id: "server-public", label: "Public URL", kind: "manual", isAddon: false },
      httpBaseUrl: publicUrl,
      reachability: classifyPublicUrlReachability(url.hostname),
      ...(url.protocol === "https:" ? ({ hostedHttpsCompatibility: "compatible" } as const) : {}),
      source: "server",
      isDefault: true,
    }),
    ...endpoints.map((endpoint) => ({ ...endpoint, isDefault: false })),
  ];
}

export function resolveDesktopPairingUrl(endpointUrl: string, credential: string): string {
  const url = new URL(endpointUrl);
  url.pathname = "/pair";
  return setPairingTokenOnUrl(url, credential).toString();
}

export function resolveHostedPairingUrl(endpointUrl: string, credential: string): string | null {
  const url = new URL(endpointUrl);
  if (url.protocol !== "https:") {
    return null;
  }

  return buildHostedPairingUrl({
    host: endpointUrl,
    token: credential,
  });
}
