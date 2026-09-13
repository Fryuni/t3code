import type { AdvertisedEndpoint } from "@t3tools/contracts";
import { isLoopbackHostname } from "../../environments/primary/target";
import { buildHostedPairingUrl } from "../../hostedPairing";
import { setPairingTokenOnUrl } from "../../pairingUrl";

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
      reachability: isLoopbackHostname(url.hostname) ? "loopback" : "public",
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
