import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  resolveDesktopPairingUrl,
  resolveHostedPairingUrl,
  withPublicUrlEndpoint,
} from "./pairingUrls";
import { isQrShareableEndpoint, selectQrEndpointOption } from "./ConnectionsSettings.logic";

describe("settings pairing URL helpers", () => {
  it("makes the public URL the default shareable QR endpoint even with loopback binding", () => {
    const loopbackEndpoints = withPublicUrlEndpoint([], "http://localhost:3773");
    const endpoints = withPublicUrlEndpoint(loopbackEndpoints, "https://t3.example.com:8443");
    const options = endpoints.map((endpoint) => ({
      id: endpoint.id,
      preferenceKey: endpoint.id,
      qrShareable: isQrShareableEndpoint(endpoint),
      url: resolveDesktopPairingUrl(endpoint.httpBaseUrl, "PAIRCODE"),
    }));
    expect(selectQrEndpointOption(options, null, null)?.url).toBe(
      "https://t3.example.com:8443/pair#token=PAIRCODE",
    );
    expect(endpoints.find((endpoint) => endpoint.isDefault)?.httpBaseUrl).toBe(
      "https://t3.example.com:8443/",
    );
    expect(endpoints[0]?.wsBaseUrl).toBe("wss://t3.example.com:8443/");
    expect(options[1]?.qrShareable).toBe(false);
    expect(withPublicUrlEndpoint(loopbackEndpoints, undefined)).toBe(loopbackEndpoints);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses direct backend pairing URLs for HTTP endpoints", () => {
    expect(resolveHostedPairingUrl("http://192.168.1.44:3773", "PAIRCODE")).toBeNull();
    expect(resolveDesktopPairingUrl("http://192.168.1.44:3773", "PAIRCODE")).toBe(
      "http://192.168.1.44:3773/pair#token=PAIRCODE",
    );
  });

  it("uses hosted pairing URLs for HTTPS endpoints", () => {
    vi.stubEnv("VITE_HOSTED_APP_URL", "https://preview.t3.codes");

    expect(resolveHostedPairingUrl("https://host.tailnet.example.ts.net:3773", "PAIRCODE")).toBe(
      "https://preview.t3.codes/pair?host=https%3A%2F%2Fhost.tailnet.example.ts.net%3A3773#token=PAIRCODE",
    );
  });
});
