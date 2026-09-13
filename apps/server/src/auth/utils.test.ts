import { describe, expect, it } from "vite-plus/test";

import {
  deriveAuthClientMetadata,
  isRemoteReachableHost,
  isRemoteReachableServer,
  resolveSessionCookieName,
} from "./utils.ts";

describe("deriveAuthClientMetadata", () => {
  it("labels Electron user agents as Electron instead of Chrome", () => {
    const metadata = deriveAuthClientMetadata({
      request: {
        headers: {
          "user-agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) t3code/0.0.15 Chrome/136.0.7103.93 Electron/36.3.2 Safari/537.36",
        },
        source: {
          remoteAddress: "::ffff:127.0.0.1",
        },
      } as never,
    });

    expect(metadata).toMatchObject({
      browser: "Electron",
      deviceType: "desktop",
      ipAddress: "127.0.0.1",
      os: "macOS",
    });
  });

  it("applies client-presented display identity without replacing transport metadata", () => {
    const metadata = deriveAuthClientMetadata({
      request: {
        headers: {
          "user-agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/136.0.7103.93 Electron/36.3.2 Safari/537.36",
        },
        source: {
          remoteAddress: "::ffff:192.168.213.72",
        },
      } as never,
      presented: {
        label: "T3 Code Mobile",
        deviceType: "mobile",
        os: "iOS",
      },
    });

    expect(metadata).toMatchObject({
      label: "T3 Code Mobile",
      browser: "Electron",
      deviceType: "mobile",
      ipAddress: "192.168.213.72",
      os: "iOS",
    });
    expect(metadata.userAgent).toContain("Electron/36.3.2");
  });
});

describe("session cookie isolation", () => {
  it("isolates loopback web servers by port and server state", () => {
    const first = resolveSessionCookieName({
      mode: "web",
      port: 5775,
      host: "127.0.0.1",
      publicUrl: undefined,
      instanceKey: "/tmp/t3-agent-one",
      environmentId: "environment-one",
      development: true,
    });
    const second = resolveSessionCookieName({
      mode: "web",
      port: 5775,
      host: "127.0.0.1",
      publicUrl: undefined,
      instanceKey: "/tmp/t3-agent-two",
      environmentId: "environment-two",
      development: true,
    });

    expect(first).toMatch(/^t3_session_5775_[a-f0-9]{12}$/);
    expect(second).toMatch(/^t3_session_5775_[a-f0-9]{12}$/);
    expect(first).not.toBe(second);
  });

  it("isolates remote web servers by server state", () => {
    const first = resolveSessionCookieName({
      mode: "web",
      port: 3773,
      host: "192.168.1.50",
      publicUrl: undefined,
      instanceKey: "/srv/t3-one",
      environmentId: "environment-one",
      development: false,
    });
    const second = resolveSessionCookieName({
      mode: "web",
      port: 5775,
      host: "192.168.1.50",
      publicUrl: undefined,
      instanceKey: "/srv/t3-two",
      environmentId: "environment-two",
      development: false,
    });

    expect(first).toMatch(/^t3_session_[a-f0-9]{12}$/);
    expect(second).toMatch(/^t3_session_[a-f0-9]{12}$/);
    expect(first).not.toBe(second);
  });

  it("keeps a remote web server cookie stable across port changes", () => {
    const first = resolveSessionCookieName({
      mode: "web",
      port: 8080,
      host: "0.0.0.0",
      publicUrl: undefined,
      instanceKey: "/srv/t3",
      environmentId: "environment-one",
      development: false,
    });
    const second = resolveSessionCookieName({
      mode: "web",
      port: 9090,
      host: "app.example.com",
      publicUrl: undefined,
      instanceKey: "/srv/t3",
      environmentId: "environment-one",
      development: false,
    });

    expect(first).toBe(second);
  });

  it("retains desktop port scoping", () => {
    expect(
      resolveSessionCookieName({
        mode: "desktop",
        port: 3773,
        host: "127.0.0.1",
        publicUrl: undefined,
        instanceKey: "/tmp/desktop",
        environmentId: "environment-one",
        development: true,
      }),
    ).toBe("t3_session_3773");
  });

  it("isolates development servers even when they bind a wildcard host", () => {
    expect(
      resolveSessionCookieName({
        mode: "web",
        port: 5775,
        host: "0.0.0.0",
        publicUrl: undefined,
        instanceKey: "/tmp/t3-wildcard-dev",
        environmentId: "environment-one",
        development: true,
      }),
    ).toMatch(/^t3_session_5775_[a-f0-9]{12}$/);
  });

  it("keeps a proxied loopback server's cookie stable when its internal port moves", () => {
    // `--public-url` servers keep binding 127.0.0.1, but browsers only ever see
    // the proxy origin. Port-scoped names would log everyone out whenever the
    // server restarted onto a different internal port.
    const first = resolveSessionCookieName({
      mode: "web",
      port: 3773,
      host: "127.0.0.1",
      publicUrl: new URL("https://t3.example.com"),
      instanceKey: "/srv/t3",
      environmentId: "environment-one",
      development: false,
    });
    const second = resolveSessionCookieName({
      mode: "web",
      port: 3774,
      host: "127.0.0.1",
      publicUrl: new URL("https://t3.example.com"),
      instanceKey: "/srv/t3",
      environmentId: "environment-one",
      development: false,
    });

    expect(first).toMatch(/^t3_session_[a-f0-9]{12}$/);
    expect(first).toBe(second);
  });

  it("keeps loopback-only servers port-scoped when no public URL is advertised", () => {
    expect(
      resolveSessionCookieName({
        mode: "web",
        port: 3773,
        host: "127.0.0.1",
        publicUrl: undefined,
        instanceKey: "/srv/t3",
        environmentId: "environment-one",
        development: false,
      }),
    ).toMatch(/^t3_session_3773_[a-f0-9]{12}$/);
  });

  it("does not treat a loopback public URL as remotely reachable", () => {
    expect(
      isRemoteReachableServer({
        host: "127.0.0.1",
        publicUrl: new URL("http://localhost:8080"),
      }),
    ).toBe(false);
    expect(
      isRemoteReachableServer({ host: "127.0.0.1", publicUrl: new URL("https://t3.example.com") }),
    ).toBe(true);
    expect(isRemoteReachableServer({ host: "0.0.0.0", publicUrl: undefined })).toBe(true);
  });

  it("keeps a proxied desktop backend's cookie stable across its port scan", () => {
    // DesktopApp scans upward from 3773, so a restart can land on a new port
    // while the proxy origin stays put.
    const first = resolveSessionCookieName({
      mode: "desktop",
      port: 3773,
      host: "127.0.0.1",
      publicUrl: new URL("https://t3.example.com"),
      instanceKey: "/tmp/desktop",
      environmentId: "environment-one",
      development: false,
    });
    const second = resolveSessionCookieName({
      mode: "desktop",
      port: 3774,
      host: "127.0.0.1",
      publicUrl: new URL("https://t3.example.com"),
      instanceKey: "/tmp/desktop",
      environmentId: "environment-one",
      development: false,
    });

    expect(first).toMatch(/^t3_session_[a-f0-9]{12}$/);
    expect(first).toBe(second);
  });

  it("keeps ordinary desktop access port-scoped", () => {
    const loopbackPublicUrl = resolveSessionCookieName({
      mode: "desktop",
      port: 3773,
      host: "127.0.0.1",
      publicUrl: new URL("http://localhost:8080"),
      instanceKey: "/tmp/desktop",
      environmentId: "environment-one",
      development: false,
    });
    const developmentPublicUrl = resolveSessionCookieName({
      mode: "desktop",
      port: 3773,
      host: "127.0.0.1",
      publicUrl: new URL("https://t3.example.com"),
      instanceKey: "/tmp/desktop",
      environmentId: "environment-one",
      development: true,
    });
    const wildcardBound = resolveSessionCookieName({
      mode: "desktop",
      port: 3773,
      host: "0.0.0.0",
      publicUrl: undefined,
      instanceKey: "/tmp/desktop",
      environmentId: "environment-one",
      development: false,
    });

    expect(loopbackPublicUrl).toBe("t3_session_3773");
    expect(developmentPublicUrl).toBe("t3_session_3773");
    // Network-exposed desktop backends predate --public-url; renaming their
    // cookie would sign every existing client out.
    expect(wildcardBound).toBe("t3_session_3773");
  });

  it("classifies loopback aliases separately from remotely reachable hosts", () => {
    expect(isRemoteReachableHost(undefined)).toBe(false);
    expect(isRemoteReachableHost("localhost")).toBe(false);
    expect(isRemoteReachableHost("127.12.0.1")).toBe(false);
    expect(isRemoteReachableHost("[::1]")).toBe(false);
    expect(isRemoteReachableHost("0.0.0.0")).toBe(true);
    expect(isRemoteReachableHost("192.168.1.50")).toBe(true);
  });
});
