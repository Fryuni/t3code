import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  resolveDesktopPairingUrl,
  resolveHostedPairingUrl,
  withPublicUrlEndpoint,
} from "./pairingUrls";
import { isQrShareableEndpoint } from "./ConnectionsSettings.logic";

describe("settings pairing URL helpers", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("makes the public URL the only default endpoint ahead of a loopback binding", () => {
    const loopbackEndpoints = withPublicUrlEndpoint([], "http://localhost:3773");
    const endpoints = withPublicUrlEndpoint(loopbackEndpoints, "https://t3.example.com:8443");
    const [publicEndpoint, loopbackEndpoint] = endpoints;

    expect(endpoints.filter((endpoint) => endpoint.isDefault)).toEqual([publicEndpoint]);
    expect(publicEndpoint?.httpBaseUrl).toBe("https://t3.example.com:8443/");
    expect(publicEndpoint?.wsBaseUrl).toBe("wss://t3.example.com:8443/");
    expect(publicEndpoint?.compatibility.hostedHttpsApp).toBe("compatible");
    expect(publicEndpoint && isQrShareableEndpoint(publicEndpoint)).toBe(true);
    expect(loopbackEndpoint?.isDefault).toBe(false);
    expect(loopbackEndpoint?.wsBaseUrl).toBe("ws://localhost:3773/");
    expect(loopbackEndpoint?.compatibility.hostedHttpsApp).toBe("mixed-content-blocked");
    expect(loopbackEndpoint && isQrShareableEndpoint(loopbackEndpoint)).toBe(false);
    expect(withPublicUrlEndpoint(loopbackEndpoints, undefined)).toBe(loopbackEndpoints);
  });

  it.each([
    ["http://192.168.1.42:8080", "lan"],
    ["http://100.100.100.100:3773", "private-network"],
    ["http://100.64.0.1:3773", "private-network"],
    ["http://100.127.255.254:3773", "private-network"],
    ["https://box.tailnet.ts.net", "private-network"],
    ["https://BOX.TAILNET.TS.NET.", "private-network"],
    ["https://box.tailnet.ts.net.example.com", "public"],
    // Just outside the 100.64/10 tailnet block.
    ["https://100.128.0.1", "public"],
    ["https://100.63.0.1", "public"],
    ["http://10.0.0.5:8080", "lan"],
    ["http://172.16.0.9:8080", "lan"],
    ["http://t3.home.local:8080", "lan"],
    ["https://devbox", "lan"],
    ["https://server.home.arpa", "lan"],
    ["http://[::ffff:192.168.1.42]:8080", "lan"],
    ["https://server.home.arpa.example.com", "public"],
    ["http://[fd00::1]:8080", "lan"],
    ["http://127.0.0.2:8080", "loopback"],
    // The server's auth check treats any `127.` host as loopback.
    ["https://127.0.0.1.nip.io", "loopback"],
    ["http://localhost:3773", "loopback"],
    // 172.32 is outside the private 172.16/12 block.
    ["https://172.32.0.1", "public"],
    ["https://t3.example.com", "public"],
  ])("classifies the public URL %s as %s", (publicUrl, reachability) => {
    expect(withPublicUrlEndpoint([], publicUrl)[0]?.reachability).toBe(reachability);
  });

  it("keeps private proxy endpoints shareable despite the LAN label", () => {
    const [endpoint] = withPublicUrlEndpoint([], "http://192.168.1.42:8080");
    expect(endpoint && isQrShareableEndpoint(endpoint)).toBe(true);
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
