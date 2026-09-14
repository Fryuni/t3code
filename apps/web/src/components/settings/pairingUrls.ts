import type { AdvertisedEndpoint } from "@t3tools/contracts";
import { isPrivateNetworkHost, normalizeHostname } from "@t3tools/shared/hostClassification";
import { isLoopbackHostname } from "../../environments/primary/target";
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
  const host = normalizeHostname(hostname.trim());
  if (isLoopbackHostname(host) || host.startsWith("127.")) {
    return "loopback";
  }
  if (TAILSCALE_IPV4_PATTERN.test(host) || host.endsWith(".ts.net")) {
    return "private-network";
  }
  return isPrivateNetworkHost(host) ? "lan" : "public";
}

export function withPublicUrlEndpoint(
  endpoints: ReadonlyArray<AdvertisedEndpoint>,
  publicUrl: string | undefined,
): ReadonlyArray<AdvertisedEndpoint> {
  if (!publicUrl) return endpoints;
  const url = new URL(publicUrl);
  const wsUrl = new URL(url);
  wsUrl.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return [
    {
      id: `server-public:${url.origin}`,
      label: "Public URL",
      provider: { id: "server-public", label: "Public URL", kind: "manual", isAddon: false },
      httpBaseUrl: url.toString(),
      wsBaseUrl: wsUrl.toString(),
      reachability: classifyPublicUrlReachability(url.hostname),
      compatibility: {
        hostedHttpsApp: url.protocol === "https:" ? "compatible" : "mixed-content-blocked",
        desktopApp: "compatible",
      },
      source: "server",
      status: "available",
      isDefault: true,
    },
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
