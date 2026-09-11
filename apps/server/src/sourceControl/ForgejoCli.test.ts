import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { detectSourceControlProviderFromRemoteUrl } from "@t3tools/shared/sourceControl";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";
import { ChildProcessSpawner } from "effect/unstable/process";

import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as ForgejoCli from "./ForgejoCli.ts";

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

const refinement = (remoteUrl: string, hosts: string) => ({
  cwd: "/repo",
  context: {
    remoteName: "origin",
    remoteUrl,
    provider: detectSourceControlProviderFromRemoteUrl(remoteUrl)!,
  },
  auth: { stdout: hosts, stderr: "", exitCode: ChildProcessSpawner.ExitCode(0) },
});

function makeCli(input: {
  readonly credentials: () => string;
  readonly response: (request: HttpClientRequest.HttpClientRequest) => Response;
  readonly execute?: (input: VcsProcess.VcsProcessInput) => void;
}) {
  return ForgejoCli.make.pipe(
    Effect.provide(
      Layer.mergeAll(
        Path.layer,
        FileSystem.layerNoop({
          exists: () => Effect.succeed(true),
          readFileString: () => Effect.sync(input.credentials),
        }),
        Layer.mock(VcsProcess.VcsProcess)({
          run: (request) =>
            Effect.sync(() => {
              input.execute?.(request);
              return {
                stdout: "",
                stderr: "",
                exitCode: ChildProcessSpawner.ExitCode(0),
                stdoutTruncated: false,
                stderrTruncated: false,
              };
            }),
        }),
        Layer.succeed(
          HttpClient.HttpClient,
          HttpClient.make((request) =>
            Effect.sync(() => HttpClientResponse.fromWeb(request, input.response(request))),
          ),
        ),
      ),
    ),
  );
}

it.effect("reads REST metadata using only the selected instance's token", () =>
  Effect.gen(function* () {
    const requests: HttpClientRequest.HttpClientRequest[] = [];
    const cli = yield* makeCli({
      credentials: () =>
        encodeJson({
          hosts: {
            "git.example.test:3000": { type: "Application", token: "first-instance-token" },
            "git.example.test:4000": { type: "Application", token: "root-instance-token" },
            "git.example.test:4000/forge": { type: "Application", token: "second-instance-token" },
          },
        }),
      response: (request) => {
        requests.push(request);
        return Response.json(
          { full_name: "Owner/Repo" },
          {
            headers: {
              link: '<https://git.example.test:4000/forge/api/v1/repos/Owner/Repo?page=2>; rel="next"',
            },
          },
        );
      },
    });
    const result = yield* cli.read({
      cwd: "/repo",
      operation: "getRepositoryCloneUrls",
      baseUrl: "http://git.example.test:4000/forge",
      path: "/repos/Owner/Repo",
    });
    assert.deepStrictEqual(result, { body: { full_name: "Owner/Repo" }, hasNextPage: true });
    assert.strictEqual(
      requests[0]?.url,
      "http://git.example.test:4000/forge/api/v1/repos/Owner/Repo",
    );
    assert.strictEqual(requests[0]?.headers.authorization, "token second-instance-token");
  }),
);

for (const basePath of ["", "/Forge"]) {
  it.effect(`lets fj refresh expired OAuth credentials for the instance at '${basePath}'`, () =>
    Effect.gen(function* () {
      let token = "expired";
      const commands: VcsProcess.VcsProcessInput[] = [];
      const tokens: Array<string | undefined> = [];
      const cli = yield* makeCli({
        credentials: () =>
          encodeJson({ hosts: { [`git.example.test${basePath}`]: { type: "OAuth", token } } }),
        response: (request) => {
          tokens.push(request.headers.authorization);
          return request.headers.authorization === "token expired"
            ? new Response(null, { status: 401 })
            : Response.json({ login: "alice" });
        },
        execute: (request) => {
          commands.push(request);
          token = "refreshed";
        },
      });
      yield* cli.read({
        cwd: "/repo",
        operation: "getViewer",
        baseUrl: `https://git.example.test${basePath}/`,
        path: "/user",
      });
      assert.deepStrictEqual(tokens, ["token expired", "token refreshed"]);
      assert.deepStrictEqual(commands[0]?.args, [
        "--style",
        "minimal",
        "--host",
        `https://git.example.test${basePath}/`,
        "whoami",
      ]);
      assert.strictEqual(commands[0]?.command, "fj");
      assert.strictEqual(commands[0]?.cwd, "/repo");
    }),
  );
}

it.effect("does not expose tokens or raw responses in credential and JSON errors", () =>
  Effect.gen(function* () {
    for (const credentials of [
      encodeJson({ hosts: { "git.example.test": { type: "invalid", token: "secret" } } }),
      encodeJson({ hosts: {} }),
    ]) {
      const cli = yield* makeCli({
        credentials: () => credentials,
        response: () => new Response("secret invalid json"),
      });
      const error = yield* cli
        .read({
          cwd: "/repo",
          operation: "getDefaultBranch",
          baseUrl: "https://git.example.test",
          path: "/repos/owner/repo",
        })
        .pipe(Effect.flip);
      assert.strictEqual(encodeJson(error).includes("secret"), false);
      assert.strictEqual(error.cwd, "/repo");
      assert.strictEqual(error.operation, "getDefaultBranch");
    }
  }),
);

it.effect("does not refresh an application token rejected by Forgejo", () =>
  Effect.gen(function* () {
    let commands = 0;
    const cli = yield* makeCli({
      credentials: () =>
        encodeJson({
          hosts: { "git.example.test": { type: "Application", token: "expired" } },
        }),
      response: () => new Response(null, { status: 401 }),
      execute: () => {
        commands++;
      },
    });
    const error = yield* cli
      .read({
        cwd: "/repo",
        operation: "getViewer",
        baseUrl: "https://git.example.test",
        path: "/user",
      })
      .pipe(Effect.flip);
    assert.strictEqual(commands, 0);
    assert.include(error.detail, "auth login");
  }),
);

it.effect("uses fj's saved SSH aliases without probing unrelated hosts", () =>
  Effect.gen(function* () {
    const cli = yield* makeCli({
      credentials: () =>
        encodeJson({
          hosts: { "git.example.test:8443/Forge": { type: "Application", token: "saved-token" } },
          aliases: { "ssh.example.test:2222": "git.example.test:8443/Forge" },
        }),
      response: () => {
        throw new Error("No HTTP request expected for a saved alias");
      },
    });
    assert.deepStrictEqual(
      yield* cli.refineUnknownRemote(
        refinement(
          "  SSH://git@ssh.example.test:2222/Owner/Repo.git  ",
          "codeberg.org\nssh.example.test:2222\ngit.example.test:8443/Forge",
        ),
      ),
      { kind: "forgejo", name: "Forgejo", baseUrl: "https://git.example.test:8443/Forge" },
    );
  }),
);

it.effect("maps a separate SSH hostname using clone metadata and caches instance probes", () =>
  Effect.gen(function* () {
    const requests: HttpClientRequest.HttpClientRequest[] = [];
    const cli = yield* makeCli({
      credentials: () =>
        encodeJson({
          hosts: {
            "git.example.test:8443/Forge": { type: "Application", token: "first-token" },
            "other.example.test": { type: "Application", token: "second-token" },
          },
        }),
      response: (request) => {
        requests.push(request);
        return Response.json({
          ssh_url: request.url.startsWith("https://git.example.test:8443/")
            ? "ssh://git@ssh.example.test:2222/Owner/Repo.git"
            : "git@other.example.test:Owner/Repo.git",
        });
      },
    });
    const input = refinement(
      "ssh://git@ssh.example.test:2222/Owner/Repo.git",
      "other.example.test\ngit.example.test:8443/Forge",
    );
    const provider = yield* cli.refineUnknownRemote(input);
    assert.deepStrictEqual(provider, {
      kind: "forgejo",
      name: "Forgejo",
      baseUrl: "https://git.example.test:8443/Forge",
    });
    assert.deepStrictEqual(yield* cli.refineUnknownRemote(input), provider);
    assert.strictEqual(requests.length, 2);
    assert.deepStrictEqual(
      requests.map((request) => [request.url, request.headers.authorization]),
      [
        ["https://other.example.test/api/v1/repos/Owner/Repo", "token second-token"],
        ["https://git.example.test:8443/Forge/api/v1/repos/Owner/Repo", "token first-token"],
      ],
    );
  }),
);

it.effect("matches scp syntax to advertised SSH URLs with the default port", () =>
  Effect.gen(function* () {
    const cli = yield* makeCli({
      credentials: () => encodeJson({ hosts: {} }),
      response: () => Response.json({ ssh_url: "ssh://git@ssh.example.test:22/Owner/Repo.git" }),
    });
    assert.deepStrictEqual(
      yield* cli.refineUnknownRemote(
        refinement("git@ssh.example.test:Owner/Repo.git", "git.example.test"),
      ),
      {
        kind: "forgejo",
        name: "Forgejo",
        baseUrl: "https://git.example.test",
      },
    );
  }),
);

it.effect("rejects ambiguous SSH mappings, unmatched clone URLs, and failed instance reads", () =>
  Effect.gen(function* () {
    for (const response of [
      () => Response.json({ ssh_url: "git@ssh.example.test:Owner/Repo.git" }),
      () => Response.json({ ssh_url: "git@another.example.test:Owner/Repo.git" }),
      () => Response.json({ ssh_url: "ssh://git@ssh.example.test:2222/Owner/Repo.git" }),
      () => new Response(null, { status: 404 }),
    ]) {
      const cli = yield* makeCli({ credentials: () => encodeJson({ hosts: {} }), response });
      assert.strictEqual(
        yield* cli.refineUnknownRemote(
          refinement(
            "git@ssh.example.test:Owner/Repo.git",
            "first.example.test\nsecond.example.test",
          ),
        ),
        null,
      );
    }
  }),
);
