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

  it("classifies private proxy origins as LAN instead of Internet-public", () => {
    const reachabilityOf = (publicUrl: string) =>
      withPublicUrlEndpoint([], publicUrl)[0]?.reachability;

    expect(reachabilityOf("http://192.168.1.42:8080")).toBe("lan");
    expect(reachabilityOf("http://100.100.100.100:3773")).toBe("private-network");
    expect(reachabilityOf("http://100.64.0.1:3773")).toBe("private-network");
    expect(reachabilityOf("http://100.127.255.254:3773")).toBe("private-network");
    // Just outside the 100.64/10 tailnet block.
    expect(reachabilityOf("https://100.128.0.1")).toBe("public");
    expect(reachabilityOf("https://100.63.0.1")).toBe("public");
    expect(reachabilityOf("http://10.0.0.5:8080")).toBe("lan");
    expect(reachabilityOf("http://172.16.0.9:8080")).toBe("lan");
    expect(reachabilityOf("http://t3.home.local:8080")).toBe("lan");
    expect(reachabilityOf("http://[fd00::1]:8080")).toBe("lan");
    expect(reachabilityOf("http://127.0.0.2:8080")).toBe("loopback");
    expect(reachabilityOf("http://localhost:3773")).toBe("loopback");
    // 172.32 is outside the private 172.16/12 block.
    expect(reachabilityOf("https://172.32.0.1")).toBe("public");
    expect(reachabilityOf("https://t3.example.com")).toBe("public");
  });

  it("keeps private proxy endpoints shareable despite the LAN label", () => {
    const [endpoint] = withPublicUrlEndpoint([], "http://192.168.1.42:8080");
    expect(endpoint && isQrShareableEndpoint(endpoint)).toBe(true);
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
