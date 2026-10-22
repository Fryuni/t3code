import { expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpServer } from "effect/http";
import * as NetAddress from "effect/net/NetAddress";

import { ServerConfig, layerTest } from "./config.ts";
import { EnvironmentAuth } from "./auth/EnvironmentAuth.ts";

import {
  formatHeadlessServeOutput,
  issueHeadlessServeAccessInfo,
  renderTerminalQrCode,
  resolveHeadlessConnectionString,
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
          address: NetAddress.inetAddressFromIpStringUnsafe("127.0.0.1", 4123),
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
