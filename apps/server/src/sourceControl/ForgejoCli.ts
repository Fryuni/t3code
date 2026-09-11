import * as NodeOS from "node:os";
import { HostProcessEnvironment, HostProcessPlatform } from "@t3tools/shared/hostProcess";

import { SourceControlProviderError, type SourceControlProviderInfo } from "@t3tools/contracts";
import { isSshRemoteUrl } from "@t3tools/shared/sourceControl";
import * as Cache from "effect/Cache";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/unstable/http";

import { collectUint8StreamText } from "../stream/collectUint8StreamText.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import { discovery, parseForgejoAuthHosts } from "./forgejoAuth.ts";
import type { SourceControlUnknownRemoteRefinementInput } from "./SourceControlProviderDiscovery.ts";

interface ForgejoOperation {
  readonly operation: string;
  readonly cwd: string;
}

const Credentials = Schema.fromJsonString(
  Schema.Struct({
    hosts: Schema.Record(
      Schema.String,
      Schema.Struct({
        type: Schema.Literals(["Application", "OAuth"]),
        token: Schema.String.check(Schema.isMinLength(1)),
      }),
    ),
    aliases: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  }),
);

const decodeCredentials = Schema.decodeEffect(Credentials);
const decodeJson = Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown));
const decodeCloneUrls = Schema.decodeUnknownEffect(Schema.Struct({ ssh_url: Schema.String }));

class RemoteLookup extends Data.Class<{
  readonly cwd: string;
  readonly remoteUrl: string;
  readonly hosts: string;
  readonly directBaseUrl: string | null;
}> {}

function sshRemote(value: string) {
  if (!isSshRemoteUrl(value)) return null;
  try {
    const scp = value.startsWith("ssh://") ? null : /^(?:[^@/]+@)?([^:/]+):(.+)$/u.exec(value);
    const url = new URL(scp ? `ssh://${scp[1]}/${scp[2]}` : value);
    const repository = url.pathname.replace(/^\/+|\/+$/gu, "").replace(/\.git$/u, "");
    if (repository.split("/").length !== 2) return null;
    return {
      host: `${url.hostname.toLowerCase()}${url.port && url.port !== "22" ? `:${url.port}` : ""}`,
      repository,
    };
  } catch {
    return null;
  }
}

export class ForgejoCli extends Context.Service<
  ForgejoCli,
  {
    readonly refineUnknownRemote: (
      input: SourceControlUnknownRemoteRefinementInput,
    ) => Effect.Effect<SourceControlProviderInfo | null>;
    readonly execute: (
      input: ForgejoOperation & {
        readonly args: ReadonlyArray<string>;
        readonly host?: string;
      },
    ) => Effect.Effect<string, SourceControlProviderError>;
    readonly read: (
      input: ForgejoOperation & {
        readonly baseUrl: string;
        readonly path: string;
      },
    ) => Effect.Effect<
      { readonly body: unknown; readonly hasNextPage: boolean },
      SourceControlProviderError
    >;
  }
>()("t3/sourceControl/ForgejoCli") {}

export const make = Effect.gen(function* () {
  const vcsProcess = yield* VcsProcess.VcsProcess;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const httpClient = yield* HttpClient.HttpClient;
  const refreshLock = yield* Semaphore.make(1);

  const fail = (input: ForgejoOperation, detail: string) =>
    new SourceControlProviderError({
      provider: "forgejo",
      command: "fj",
      operation: input.operation,
      cwd: input.cwd,
      detail,
    });

  const execute: ForgejoCli["Service"]["execute"] = Effect.fn("ForgejoCli.execute")(
    function* (input) {
      const result = yield* vcsProcess
        .run({
          operation: input.operation,
          command: "fj",
          cwd: input.cwd,
          args: [
            "--style",
            "minimal",
            ...(input.host ? ["--host", input.host] : []),
            ...input.args,
          ],
          stdin: "",
          timeoutMs: 30_000,
          maxOutputBytes: 1_000_000,
          outputMode: "error",
        })
        .pipe(
          Effect.mapError(
            (cause) =>
              new SourceControlProviderError({
                provider: "forgejo",
                command: "fj",
                operation: input.operation,
                cwd: input.cwd,
                detail:
                  cause._tag === "VcsProcessSpawnError"
                    ? "Forgejo CLI (`fj`) is required but not available on PATH."
                    : cause._tag === "VcsProcessExitError" && cause.failureKind === "authentication"
                      ? "Forgejo CLI is not authenticated. Run `fj --host <instance> auth login` and retry."
                      : "Forgejo CLI could not complete the operation.",
                cause,
              }),
          ),
        );
      return result.stdout;
    },
  );

  // fj uses Rust's directories::ProjectDirs. The old organization name only
  // changes the path on macOS/Windows; fj still reads it when migrating logins.
  const home = NodeOS.homedir();
  const platform = yield* HostProcessPlatform;
  const environment = yield* HostProcessEnvironment;
  const credentialPaths = processEnvCredentialPaths();
  function processEnvCredentialPaths(): ReadonlyArray<string> {
    switch (platform) {
      case "darwin":
        return ["forgejo-cli.forgejo-cli", "Cyborus.forgejo-cli"].map((directory) =>
          path.join(home, "Library", "Application Support", directory, "keys.json"),
        );
      case "win32":
        return ["forgejo-cli", "Cyborus"].map((organization) =>
          path.join(
            environment.APPDATA ?? path.join(home, "AppData", "Roaming"),
            organization,
            "forgejo-cli",
            "data",
            "keys.json",
          ),
        );
      default:
        return [
          path.join(
            environment.XDG_DATA_HOME || path.join(home, ".local", "share"),
            "forgejo-cli",
            "keys.json",
          ),
        ];
    }
  }

  const readSavedAuth = Effect.fn("ForgejoCli.readSavedAuth")(function* (input: ForgejoOperation) {
    for (const credentialPath of credentialPaths) {
      if (
        !(yield* fileSystem
          .exists(credentialPath)
          .pipe(Effect.mapError(() => fail(input, "Could not read Forgejo CLI credentials."))))
      )
        continue;
      // Never attach a decoding error here: its input contains every saved token.
      const text = yield* fileSystem
        .readFileString(credentialPath)
        .pipe(Effect.mapError(() => fail(input, "Could not read Forgejo CLI credentials.")));
      const credentials = yield* decodeCredentials(text).pipe(
        Effect.mapError(() =>
          fail(input, "Could not read Forgejo CLI credentials. Sign in with fj again."),
        ),
      );
      return credentials;
    }
    return null;
  });

  const readCredentials = (input: ForgejoOperation, host: string) =>
    readSavedAuth(input).pipe(Effect.map((saved) => saved?.hosts[host] ?? null));

  const read: ForgejoCli["Service"]["read"] = Effect.fn("ForgejoCli.read")(function* (input) {
    const base = yield* Effect.try({
      try: () => new URL(input.baseUrl),
      catch: () => fail(input, "Invalid Forgejo instance URL."),
    });
    if (
      !/^https?:$/u.test(base.protocol) ||
      base.username ||
      base.password ||
      base.search ||
      base.hash ||
      !input.path.startsWith("/") ||
      input.path.startsWith("//")
    ) {
      return yield* fail(input, "Invalid Forgejo instance URL or API path.");
    }
    const url = `${base.href.replace(/\/+$/u, "")}/api/v1${input.path}`;
    // fj's host_name key includes the instance path, so two instances can share an authority.
    const credentialHost = `${base.host}${base.pathname.replace(/\/+$/u, "")}`;
    let credentials = yield* readCredentials(input, credentialHost);

    const request = (token: string | undefined) => {
      let request = HttpClientRequest.get(url).pipe(
        HttpClientRequest.acceptJson,
        HttpClientRequest.setHeader("User-Agent", "T3-Code"),
      );
      if (token)
        request = request.pipe(HttpClientRequest.setHeader("Authorization", `token ${token}`));
      return httpClient.execute(request).pipe(
        Effect.provideService(FetchHttpClient.RequestInit, { redirect: "error" }),
        Effect.mapError(() => fail(input, "Could not reach the Forgejo instance.")),
      );
    };

    let response = yield* request(credentials?.token);
    if (response.status === 401 && credentials?.type === "OAuth") {
      const expiredToken = credentials.token;
      // Let fj own OAuth refresh, and serialize refreshes so concurrent reads
      // cannot spend the same refresh token twice.
      credentials = yield* refreshLock.withPermits(1)(
        Effect.gen(function* () {
          const current = yield* readCredentials(input, credentialHost);
          if (current?.token !== expiredToken) return current;
          yield* execute({ ...input, host: base.href, args: ["whoami"] });
          return yield* readCredentials(input, credentialHost);
        }),
      );
      response = yield* request(credentials?.token);
    }
    if (response.status < 200 || response.status >= 300) {
      return yield* fail(
        input,
        response.status === 401 || response.status === 403
          ? "Forgejo denied access. Run `fj --host <instance> auth login` and check your repository permissions."
          : `Forgejo returned HTTP ${response.status}.`,
      );
    }
    const collected = yield* collectUint8StreamText({
      stream: response.stream,
      maxBytes: 4 * 1024 * 1024,
    }).pipe(Effect.mapError(() => fail(input, "Could not read the Forgejo response.")));
    if (collected.truncated || collected.invalidUtf8) {
      return yield* fail(input, "Forgejo returned an oversized or invalid response.");
    }
    const body = yield* decodeJson(collected.text).pipe(
      Effect.mapError(() => fail(input, "Forgejo returned invalid JSON.")),
    );
    return { body, hasNextPage: /rel="next"/u.test(response.headers.link ?? "") };
  });

  const remoteCache = yield* Cache.makeWith<RemoteLookup, SourceControlProviderInfo | null>(
    Effect.fn("ForgejoCli.resolveSshRemote")(function* (input) {
      const remote = sshRemote(input.remoteUrl);
      if (!remote) return null;
      const hosts = input.hosts.split("\n");
      const operation = "detectProvider";
      const saved = yield* readSavedAuth({ ...input, operation }).pipe(
        Effect.orElseSucceed(() => null),
      );
      const alias = saved?.aliases?.[remote.host];
      if (alias && hosts.includes(alias)) {
        return { kind: "forgejo", name: "Forgejo", baseUrl: `https://${alias}` };
      }
      if (input.directBaseUrl) {
        return { kind: "forgejo", name: "Forgejo", baseUrl: input.directBaseUrl };
      }

      // An instance can advertise an entirely different SSH hostname. Only the
      // exact clone URL is evidence: the same owner/repo may exist on many hosts.
      const matches = yield* Effect.forEach(
        hosts,
        (host) =>
          read({
            cwd: input.cwd,
            operation,
            baseUrl: `https://${host}`,
            path: `/repos/${remote.repository.split("/").map(encodeURIComponent).join("/")}`,
          }).pipe(
            Effect.flatMap((response) => decodeCloneUrls(response.body)),
            Effect.map((repository) => {
              const clone = sshRemote(repository.ssh_url);
              return clone?.host === remote.host &&
                clone.repository.toLowerCase() === remote.repository.toLowerCase()
                ? host
                : null;
            }),
            Effect.timeout("5 seconds"),
            Effect.orElseSucceed(() => null),
          ),
        { concurrency: 3 },
      );
      const matchingHosts = matches.filter((host) => host !== null);
      return matchingHosts.length === 1
        ? { kind: "forgejo", name: "Forgejo", baseUrl: `https://${matchingHosts[0]}` }
        : null;
    }),
    { capacity: 512, timeToLive: () => "1 minute" },
  );

  return ForgejoCli.of({
    refineUnknownRemote: (input) => {
      const direct = discovery.refineUnknownRemote(input);
      const hosts = parseForgejoAuthHosts(input.auth);
      return hosts.length === 0 || !isSshRemoteUrl(input.context.remoteUrl)
        ? Effect.succeed(direct)
        : Cache.get(
            remoteCache,
            new RemoteLookup({
              cwd: input.cwd,
              remoteUrl: input.context.remoteUrl,
              hosts: hosts.join("\n"),
              directBaseUrl: direct?.baseUrl ?? null,
            }),
          );
    },
    execute,
    read: (input) =>
      read(input).pipe(
        Effect.timeoutOrElse({
          duration: "30 seconds",
          orElse: () => Effect.fail(fail(input, "Forgejo request timed out.")),
        }),
      ),
  });
});

export const layer = Layer.effect(ForgejoCli, make);
