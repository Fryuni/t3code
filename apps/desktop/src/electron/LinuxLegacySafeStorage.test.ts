// @effect-diagnostics nodeBuiltinImport:off -- Exercise the real Chromium ciphertext format against a fake keyring transport.
import * as NodeCrypto from "node:crypto";
import * as NodeEvents from "node:events";
import { afterEach, expect, it, vi } from "vite-plus/test";

import { decryptString } from "./LinuxLegacySafeStorage.ts";

const { sessionBus } = vi.hoisted(() => ({ sessionBus: vi.fn() }));
vi.mock("dbus-next", async (original) => ({
  ...(await original<typeof import("dbus-next")>()),
  sessionBus,
}));

function encrypt(plaintext: string, password: string) {
  const key = NodeCrypto.pbkdf2Sync(password, "saltysalt", 1, 16, "sha1");
  const cipher = NodeCrypto.createCipheriv("aes-128-cbc", key, Buffer.alloc(16, 32));
  return Buffer.concat([Buffer.from("v11"), cipher.update(plaintext), cipher.final()]);
}

function keyring(passwords = ["alpha-key"]) {
  const service = {
    OpenSession: vi.fn(async () => [null, "/session"]),
    SearchItems: vi.fn(async ({ application }: { application: string }) => [
      application === "T3 Code (Alpha)" ? passwords.map((_, i) => `/key/${i}`) : [],
      [],
    ]),
    GetSecrets: vi.fn(async () =>
      Object.fromEntries(
        passwords.map((password, i) => [
          `/key/${i}`,
          ["/session", Buffer.alloc(0), Buffer.from(password), "text/plain"],
        ]),
      ),
    ),
  };
  const bus = Object.assign(new NodeEvents.EventEmitter(), {
    getProxyObject: vi.fn(async () => ({ getInterface: () => service })),
    disconnect: vi.fn(),
  });
  sessionBus.mockReturnValue(bus);
  return { bus, service };
}

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

it("decrypts Alpha v11 data using an existing key without creating or changing keyring entries", async () => {
  const { bus, service } = keyring();
  const catalog = '{"schemaVersion":1,"targets":[]}';
  expect(await decryptString(encrypt(catalog, "alpha-key"))).toBe(catalog);
  expect(service.SearchItems).toHaveBeenCalledWith({ application: "T3 Code (Alpha)" });
  expect(bus.disconnect).toHaveBeenCalledOnce();
});

it("tries remaining matching keys when the first key does not decrypt", async () => {
  keyring(["wrong-key", "alpha-key"]);
  expect(await decryptString(encrypt("saved catalog", "alpha-key"))).toBe("saved catalog");
});

it("returns no recovery when no legacy key decrypts the ciphertext", async () => {
  const { bus } = keyring(["wrong-key"]);
  expect(await decryptString(encrypt("saved catalog", "alpha-key"))).toBeNull();
  expect(bus.disconnect).toHaveBeenCalledOnce();
});

it("does not contact the keyring for a different encryption format", async () => {
  expect(await decryptString(Buffer.from("v10-ciphertext"))).toBeNull();
  expect(sessionBus).not.toHaveBeenCalled();
});

it("leaves locked legacy keys untouched when no unlocked key is available", async () => {
  const { service } = keyring([]);
  service.SearchItems.mockResolvedValueOnce([[], ["/locked/key"]]);
  expect(await decryptString(encrypt("saved catalog", "alpha-key"))).toBeNull();
  expect(service.GetSecrets).not.toHaveBeenCalled();
});

it("bounds the lookup and disconnects when the keyring never responds", async () => {
  vi.useFakeTimers();
  const { bus } = keyring();
  bus.getProxyObject.mockImplementationOnce(() => new Promise(() => {}));
  const result = expect(decryptString(encrypt("saved catalog", "alpha-key"))).rejects.toThrow(
    "timed out",
  );
  await vi.advanceTimersByTimeAsync(5_000);
  await result;
  expect(bus.disconnect).toHaveBeenCalledOnce();
});

it("disconnects and rejects if the keyring connection fails", async () => {
  const { bus } = keyring();
  bus.getProxyObject.mockImplementationOnce(async () => {
    bus.emit("error", new Error("keyring disconnected"));
    throw new Error("keyring disconnected");
  });
  await expect(decryptString(encrypt("saved catalog", "alpha-key"))).rejects.toThrow(
    "keyring disconnected",
  );
  expect(bus.disconnect).toHaveBeenCalledOnce();
});
