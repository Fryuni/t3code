import { assert, expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpServer } from "effect/unstable/http";

import { ServerConfig, layerTest } from "./config.ts";
import { EnvironmentAuth } from "./auth/EnvironmentAuth.ts";

import {
  buildPairingUrl,
  formatHeadlessServeOutput,
  issueHeadlessServeAccessInfo,
  renderTerminalQrCode,
  resolveHeadlessConnectionHost,
  resolveHeadlessConnectionString,
  resolveListeningPort,
} from "./startupAccess.ts";

it.effect("prints the public URL and QR at startup with a loopback listener", () =>
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const access = yield* issueHeadlessServeAccessInfo().pipe(
      Effect.provideService(ServerConfig, {
        ...config,
        host: "127.0.0.1",
        port: 3773,
        publicUrl: new URL("https://t3.example.com:8443"),
      }),
    );
    expect(access.connectionString).toBe("https://t3.example.com:8443/");
    expect(access.pairingUrl).toBe("https://t3.example.com:8443/pair#token=PAIRCODE");
    expect(formatHeadlessServeOutput(access)).toContain(renderTerminalQrCode(access.pairingUrl));
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        layerTest(process.cwd(), { prefix: "t3-startup-access-test-" }),
        Layer.mock(HttpServer.HttpServer)({
          address: { _tag: "TcpAddress", hostname: "127.0.0.1", port: 4123 },
        }),
        Layer.mock(EnvironmentAuth)({
          issueStartupPairingCredential: () =>
            Effect.map(DateTime.now, (expiresAt) => ({
              id: "startup-pairing",
              credential: "PAIRCODE",
              expiresAt,
            })),
        }),
      ).pipe(Layer.provide(NodeServices.layer)),
    ),
  ),
);

it("prefers localhost when no explicit host is configured", () => {
  expect(resolveHeadlessConnectionHost(undefined)).toBe("localhost");
  expect(resolveHeadlessConnectionString(undefined, 3773)).toBe("http://localhost:3773");
});

it("keeps explicit bind hosts in the connection string", () => {
  expect(resolveHeadlessConnectionString("127.0.0.1", 3773)).toBe("http://127.0.0.1:3773");
  expect(resolveHeadlessConnectionString("::1", 3773)).toBe("http://[::1]:3773");
});

it("resolves wildcard hosts to a concrete external interface when one is available", () => {
  const connectionString = resolveHeadlessConnectionString("0.0.0.0", 3773, {
    en0: [
      {
        address: "192.168.1.42",
        netmask: "255.255.255.0",
        family: "IPv4",
        mac: "00:00:00:00:00:00",
        internal: false,
        cidr: "192.168.1.42/24",
      },
    ],
    lo0: [
      {
        address: "127.0.0.1",
        netmask: "255.0.0.0",
        family: "IPv4",
        mac: "00:00:00:00:00:00",
        internal: true,
        cidr: "127.0.0.1/8",
      },
    ],
  });

  expect(connectionString).toBe("http://192.168.1.42:3773");
});

it("prefers the actual bound port when an http server address is available", () => {
  expect(resolveListeningPort({ port: 4123 }, 3773)).toBe(4123);
  expect(resolveListeningPort("pipe", 3773)).toBe(3773);
  expect(resolveListeningPort(null, 3773)).toBe(3773);
});

it("builds a pairing URL that embeds the token in the hash", () => {
  expect(buildPairingUrl("http://192.168.1.42:3773", "PAIRCODE")).toBe(
    "http://192.168.1.42:3773/pair#token=PAIRCODE",
  );
});

it("renders terminal QR codes as a multi-line unicode block grid", () => {
  const qrCode = renderTerminalQrCode("http://192.168.1.42:3773/pair#token=PAIRCODE");

  assert.isTrue(qrCode.includes("█"));
  assert.isTrue(qrCode.split("\n").length > 10);
});

it("formats headless serve output with the connection string, token, pairing url, and qr code", () => {
  const output = formatHeadlessServeOutput({
    connectionString: "http://192.168.1.42:3773",
    token: "PAIRCODE",
    pairingUrl: "http://192.168.1.42:3773/pair#token=PAIRCODE",
  });

  expect(output).toContain("Connection string: http://192.168.1.42:3773");
  expect(output).toContain("Token: PAIRCODE");
  expect(output).toContain("Pairing URL: http://192.168.1.42:3773/pair#token=PAIRCODE");
  assert.isTrue(output.includes("█") || output.includes("▀") || output.includes("▄"));
});
