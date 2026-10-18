import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as Electron from "electron";
import * as HostProcess from "@t3tools/shared/HostProcess";

import * as LinuxLegacySafeStorage from "./LinuxLegacySafeStorage.ts";

const electronSafeStorageErrorFields = {
  cause: Schema.Defect(),
};

export class ElectronSafeStorageAvailabilityError extends Schema.TaggedError<ElectronSafeStorageAvailabilityError>()(
  "ElectronSafeStorageAvailabilityError",
  {
    ...electronSafeStorageErrorFields,
  },
) {
  override get message(): string {
    return "Electron safe storage failed to check encryption availability.";
  }
}

export class ElectronSafeStorageEncryptError extends Schema.TaggedError<ElectronSafeStorageEncryptError>()(
  "ElectronSafeStorageEncryptError",
  {
    ...electronSafeStorageErrorFields,
  },
) {
  override get message(): string {
    return "Electron safe storage failed to encrypt a string.";
  }
}

export class ElectronSafeStorageDecryptError extends Schema.TaggedError<ElectronSafeStorageDecryptError>()(
  "ElectronSafeStorageDecryptError",
  {
    ...electronSafeStorageErrorFields,
  },
) {
  override get message(): string {
    return "Electron safe storage failed to decrypt a string.";
  }
}

export const ElectronSafeStorageError = Schema.Union([
  ElectronSafeStorageAvailabilityError,
  ElectronSafeStorageEncryptError,
  ElectronSafeStorageDecryptError,
]);
export type ElectronSafeStorageError = typeof ElectronSafeStorageError.Type;

export class ElectronSafeStorage extends Context.Service<
  ElectronSafeStorage,
  {
    readonly isEncryptionAvailable: Effect.Effect<boolean, ElectronSafeStorageAvailabilityError>;
    readonly encryptString: (
      value: string,
    ) => Effect.Effect<Uint8Array, ElectronSafeStorageEncryptError>;
    readonly decryptString: (
      value: Uint8Array,
    ) => Effect.Effect<string, ElectronSafeStorageDecryptError>;
    readonly selectedStorageBackend: Effect.Effect<Option.Option<string>>;
    readonly decryptLegacyString: (
      value: Uint8Array,
    ) => Effect.Effect<Option.Option<string>, ElectronSafeStorageDecryptError>;
  }
>()("@t3tools/desktop/electron/ElectronSafeStorage") {}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const platform = yield* HostProcess.Platform;
  const selectedStorageBackend = Effect.sync(() => {
    if (platform !== "linux") return Option.none<string>();
    try {
      return Option.fromNullishOr(Electron.safeStorage.getSelectedStorageBackend());
    } catch {
      return Option.none<string>();
    }
  });

  return ElectronSafeStorage.of({
    isEncryptionAvailable: Effect.try({
      try: () => Electron.safeStorage.isEncryptionAvailable(),
      catch: (cause) => new ElectronSafeStorageAvailabilityError({ cause }),
    }),
    encryptString: (value) =>
      Effect.try({
        try: () => Electron.safeStorage.encryptString(value),
        catch: (cause) => new ElectronSafeStorageEncryptError({ cause }),
      }),
    decryptString: (value) =>
      Effect.try({
        try: () => Electron.safeStorage.decryptString(Buffer.from(value)),
        catch: (cause) => new ElectronSafeStorageDecryptError({ cause }),
      }),
    decryptLegacyString: (value) =>
      Effect.gen(function* () {
        const backend = yield* selectedStorageBackend;
        if (Option.isNone(backend) || backend.value !== "gnome_libsecret") {
          return Option.none<string>();
        }
        return yield* Effect.tryPromise({
          try: () => LinuxLegacySafeStorage.decryptString(value),
          catch: (cause) => new ElectronSafeStorageDecryptError({ cause }),
        }).pipe(Effect.map(Option.fromNullishOr));
      }),
    selectedStorageBackend,
  });
});

export const layer = Layer.effect(ElectronSafeStorage, make);
