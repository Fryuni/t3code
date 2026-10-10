import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterEach, assert, it, vi } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import { HttpClient, HttpClientResponse } from "effect/http";
import * as HostProcess from "@t3tools/shared/HostProcess";

import { repointLauncher, resolveLauncherPath, resolveUpdateTarget } from "./update.ts";

const releaseClient = (requests: string[], body: unknown) =>
  HttpClient.make((request) => {
    requests.push(request.url);
    return Effect.succeed(HttpClientResponse.fromWeb(request, Response.json(body)));
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

it.effect("a fork build updates to its latest release and has no channels", () =>
  Effect.gen(function* () {
    // What a fork's release workflow bakes in; see packages/shared/src/cliRelease.ts.
    vi.stubGlobal("__T3CODE_BUILD_RELEASE_REPOSITORY__", "someone/t3code");
    vi.resetModules();
    const fork = yield* Effect.promise(() => import("./update.ts"));
    const requests: string[] = [];
    const resolve = (input: Parameters<typeof resolveUpdateTarget>[0]) =>
      fork
        .resolveUpdateTarget(input)
        .pipe(
          Effect.provideService(
            HttpClient.HttpClient,
            releaseClient(requests, { tag_name: "v0.0.44-fork.20261002.7" }),
          ),
        );

    assert.equal(
      yield* resolve({ channel: undefined, requestedVersion: undefined }),
      "0.0.44-fork.20261002.7",
    );
    assert.equal(yield* resolve({ channel: undefined, requestedVersion: "0.0.43" }), "0.0.43");
    const error = yield* resolve({ channel: "nightly", requestedVersion: undefined }).pipe(
      Effect.flip,
    );
    assert.include(error.reason, "--channel does not apply");
    assert.deepStrictEqual(requests, [
      "https://api.github.com/repos/someone/t3code/releases/latest",
    ]);
  }),
);

it.effect("an upstream build walks the channel it is asked for", () =>
  Effect.gen(function* () {
    const requests: string[] = [];
    const version = yield* resolveUpdateTarget({
      channel: "nightly",
      requestedVersion: undefined,
    }).pipe(
      Effect.provideService(
        HttpClient.HttpClient,
        releaseClient(requests, [
          { tag_name: "v0.0.46-nightly.20261003.5" },
          { tag_name: "v0.0.45" },
        ]),
      ),
    );
    assert.equal(version, "0.0.46-nightly.20261003.5");
    assert.deepStrictEqual(requests, [
      "https://api.github.com/repos/pingdotgg/t3code/releases?per_page=100&page=1",
    ]);
  }),
);

it.layer(NodeServices.layer)("t3 update launcher", (it) => {
  it.effect("repoints a symlink that lives in a runtime versions tree", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-update-" });
      const oldExe = path.join(root, "runtime/versions/1.0.0/t3");
      const newExe = path.join(root, "runtime/versions/2.0.0/t3");
      const launcher = path.join(root, "bin/t3");
      for (const file of [oldExe, newExe]) {
        yield* fs.makeDirectory(path.dirname(file), { recursive: true });
        yield* fs.writeFileString(file, "");
      }
      yield* fs.makeDirectory(path.dirname(launcher), { recursive: true });
      yield* fs.symlink(oldExe, launcher);

      const repointed = yield* repointLauncher({
        launchedAs: launcher,
        versionsDir: path.join(root, "runtime/versions"),
        targetEntryPath: newExe,
      });

      assert.deepStrictEqual(Option.getOrUndefined(repointed), launcher);
      assert.equal(yield* fs.readLink(launcher), newExe);
    }).pipe(Effect.scoped, Effect.provideService(HostProcess.Platform, "linux")),
  );

  it.effect("leaves a plain copy or a foreign symlink alone", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-update-" });
      const newExe = path.join(root, "runtime/versions/2.0.0/t3");
      const copy = path.join(root, "copy/t3");
      const foreign = path.join(root, "foreign/t3");
      const elsewhere = path.join(root, "elsewhere/t3");
      // Another install's versions tree: same shape, different home.
      const otherHome = path.join(root, "other/runtime/versions/1.0.0/t3");
      const otherLauncher = path.join(root, "other/bin/t3");
      for (const file of [newExe, copy, elsewhere, otherHome]) {
        yield* fs.makeDirectory(path.dirname(file), { recursive: true });
        yield* fs.writeFileString(file, "");
      }
      yield* fs.makeDirectory(path.dirname(foreign), { recursive: true });
      yield* fs.symlink(elsewhere, foreign);
      yield* fs.makeDirectory(path.dirname(otherLauncher), { recursive: true });
      yield* fs.symlink(otherHome, otherLauncher);

      for (const launchedAs of [copy, foreign, otherLauncher, undefined]) {
        const repointed = yield* repointLauncher({
          launchedAs,
          versionsDir: path.join(root, "runtime/versions"),
          targetEntryPath: newExe,
        });
        assert.equal(repointed._tag, "None", launchedAs ?? "undefined");
      }
      assert.equal(yield* fs.readLink(foreign), elsewhere);
      assert.equal(yield* fs.readLink(otherLauncher), otherHome);
    }).pipe(Effect.scoped, Effect.provideService(HostProcess.Platform, "linux")),
  );

  it.effect("finds the launcher a bare command name resolved to on PATH", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-update-" });
      const launcher = path.join(root, "bin/t3");
      yield* fs.makeDirectory(path.dirname(launcher), { recursive: true });
      yield* fs.writeFileString(launcher, "");

      const bare = yield* resolveLauncherPath.pipe(
        Effect.provideService(HostProcess.InvokedAs, "t3"),
        Effect.provideService(HostProcess.Environment, {
          PATH: `${path.join(root, "missing")}:${path.join(root, "bin")}`,
        }),
        Effect.provideService(HostProcess.WorkingDirectory, root),
      );
      const relative = yield* resolveLauncherPath.pipe(
        Effect.provideService(HostProcess.InvokedAs, "./bin/t3"),
        Effect.provideService(HostProcess.Environment, { PATH: "" }),
        Effect.provideService(HostProcess.WorkingDirectory, root),
      );
      const absent = yield* resolveLauncherPath.pipe(
        Effect.provideService(HostProcess.InvokedAs, "t3"),
        Effect.provideService(HostProcess.Environment, { PATH: path.join(root, "missing") }),
        Effect.provideService(HostProcess.WorkingDirectory, root),
      );

      assert.equal(bare, launcher);
      assert.equal(relative, launcher);
      assert.equal(absent, undefined);
    }).pipe(Effect.scoped, Effect.provideService(HostProcess.Platform, "linux")),
  );
});
