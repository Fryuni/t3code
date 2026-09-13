import type { AdvertisedEndpoint } from "@t3tools/contracts";
import { isLoopbackHostname } from "../../environments/primary/target";
import { buildHostedPairingUrl } from "../../hostedPairing";
import { setPairingTokenOnUrl } from "../../pairingUrl";

const PRIVATE_IPV4_PATTERN = /^(?:10\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/;

/**
 * A reverse proxy usually sits on the same network as the server, so an
 * advertised origin is only Internet-routable once private addresses and mDNS
 * names are ruled out. Calling those "public" makes the share hint promise
 * "Reachable from anywhere" for an endpoint that never leaves the LAN.
 */
function classifyPublicUrlReachability(hostname: string): AdvertisedEndpoint["reachability"] {
  const host = hostname
    .trim()
    .toLowerCase()
    .replace(/^\[(.*)\]$/, "$1");
  if (isLoopbackHostname(hostname) || host.startsWith("127.")) {
    return "loopback";
  }
  if (host.includes(":")) {
    // IPv6 unique-local (fc00::/7) and link-local (fe80::/10).
    return /^(?:f[cd]|fe[89ab])/.test(host) ? "lan" : "public";
  }
  if (PRIVATE_IPV4_PATTERN.test(host) || host === "local" || host.endsWith(".local")) {
    return "lan";
  }
  return "public";
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
