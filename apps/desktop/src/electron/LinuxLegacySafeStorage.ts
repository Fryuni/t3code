// @effect-diagnostics nodeBuiltinImport:off -- Read historical Chromium keys at the native secret-storage boundary.
// @effect-diagnostics globalTimers:off -- Bound recovery against an unavailable desktop keyring.
import * as NodeCrypto from "node:crypto";
import { sessionBus, Variant, type ClientInterface } from "dbus-next";

interface SecretService extends ClientInterface {
  OpenSession(algorithm: string, input: Variant<string>): Promise<[Variant<unknown>, string]>;
  SearchItems(attributes: Record<string, string>): Promise<[string[], string[]]>;
  GetSecrets(
    paths: string[],
    session: string,
  ): Promise<Record<string, [string, Uint8Array, Uint8Array, string]>>;
}

const legacyApplicationNames = ["T3 Code (Alpha)", "T3 Code Alpha"];

function decryptWithPassword(ciphertext: Uint8Array, password: Uint8Array): string | null {
  // Chromium's Linux v11 format derives AES-128-CBC from the libsecret password.
  const key = NodeCrypto.pbkdf2Sync(password, "saltysalt", 1, 16, "sha1");
  let plaintext: Buffer | undefined;
  try {
    const decipher = NodeCrypto.createDecipheriv("aes-128-cbc", key, Buffer.alloc(16, 32));
    plaintext = Buffer.concat([decipher.update(ciphertext.subarray(3)), decipher.final()]);
    return new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
  } catch {
    return null;
  } finally {
    key.fill(0);
    plaintext?.fill(0);
  }
}

export async function decryptString(ciphertext: Uint8Array): Promise<string | null> {
  if (
    Buffer.from(ciphertext.subarray(0, 3)).toString() !== "v11" ||
    ciphertext.length <= 3 ||
    (ciphertext.length - 3) % 16 !== 0
  ) {
    return null;
  }

  const bus = sessionBus();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const unavailable = new Promise<never>((_, reject) => {
    bus.on("error", reject);
    timer = setTimeout(() => reject(new Error("Legacy keyring lookup timed out.")), 5_000);
  });
  const recover = async () => {
    const object = await bus.getProxyObject("org.freedesktop.secrets", "/org/freedesktop/secrets");
    const service = object.getInterface<SecretService>("org.freedesktop.Secret.Service");
    const [, session] = await service.OpenSession("plain", new Variant("s", ""));
    for (const application of legacyApplicationNames) {
      const [unlocked] = await service.SearchItems({ application });
      if (unlocked.length === 0) continue;
      // Do not generate keys or change a keyring's lock state during recovery.
      const secrets = await service.GetSecrets(unlocked, session);
      try {
        for (const item of unlocked) {
          const secret = secrets[item];
          if (secret === undefined) continue;
          const plaintext = decryptWithPassword(ciphertext, secret[2]);
          if (plaintext !== null) return plaintext;
        }
      } finally {
        for (const secret of Object.values(secrets)) secret[2].fill(0);
      }
    }
    return null;
  };
  try {
    return await Promise.race([recover(), unavailable]);
  } finally {
    clearTimeout(timer);
    // Secret Service sessions are scoped to the D-Bus connection.
    bus.disconnect();
  }
}
