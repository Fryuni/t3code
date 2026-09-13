import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import { ChildProcessSpawner } from "effect/unstable/process";
import * as ForgejoCli from "./ForgejoCli.ts";
import * as ForgejoSourceControlProvider from "./ForgejoSourceControlProvider.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";

const pullRequest = {
  number: 42,
  title: "Support Forgejo",
  html_url: "https://forge.example/Owner/Repo/pulls/42",
  state: "open",
  merged: false,
  draft: true,
  base: { ref: "main", sha: "base", repo: { full_name: "Owner/Repo", owner: { login: "Owner" } } },
  head: {
    ref: "feature",
    sha: "head",
    repo: { full_name: "Contributor/Repo", owner: { login: "Contributor" } },
  },
};
const output = (body: unknown) => ({
  stdout: JSON.stringify(body),
  stderr: "",
  exitCode: ChildProcessSpawner.ExitCode(0),
  stdoutTruncated: false,
  stderrTruncated: false,
});
const makeProvider = (api: ForgejoCli.ForgejoCli["Service"]["api"]) =>
  ForgejoSourceControlProvider.make.pipe(
    Effect.provide(
      Layer.mergeAll(
        Layer.mock(ForgejoCli.ForgejoCli)({
          resolveRepository: () =>
            Effect.succeed({
              command: "fj",
              login: "forge.example",
              repository: "Owner/Repo",
              baseUrl: "https://forge.example",
            }),
          api,
        }),
        FileSystem.layerNoop({ readFileString: () => Effect.succeed("PR body") }),
        Layer.mock(VcsProcess.VcsProcess)({}),
      ),
    ),
  );

it.effect("preserves fork identity and draft status for a normalized PR URL", () =>
  Effect.gen(function* () {
    const provider = yield* makeProvider(() => Effect.succeed(output(pullRequest)));
    const pr = yield* provider.getChangeRequest({
      cwd: "/repo",
      reference: `  ${pullRequest.html_url.replace("https:", "HTTPS:")}  `,
    });
    assert.strictEqual(pr.number, 42);
    assert.strictEqual(pr.isDraft, true);
    assert.strictEqual(pr.isCrossRepository, true);
    assert.strictEqual(pr.headRepositoryOwnerLogin, "Contributor");
  }),
);

it.effect("pages past other forks and closed unmerged PRs before applying the limit", () =>
  Effect.gen(function* () {
    let page = 0;
    const provider = yield* makeProvider((input) => {
      page++;
      assert.include(input.path, `page=${page}`);
      return Effect.succeed(
        output(
          page === 1
            ? [
                { ...pullRequest, state: "closed" },
                {
                  ...pullRequest,
                  merged: true,
                  head: {
                    ...pullRequest.head,
                    repo: { full_name: "Other/Repo", owner: { login: "Other" } },
                  },
                },
              ]
            : [{ ...pullRequest, merged: true }],
        ),
      );
    });
    const prs = yield* provider.listChangeRequests({
      cwd: "/repo",
      headSelector: "contributor:feature",
      state: "merged",
      limit: 1,
    });
    assert.strictEqual(page, 2);
    assert.strictEqual(prs.length, 1);
    assert.strictEqual(prs[0]?.state, "merged");
  }),
);

it.effect("creates a fork PR with explicit target, branches and literal title", () =>
  Effect.gen(function* () {
    const calls: ForgejoCli.ForgejoApiInput[] = [];
    const provider = yield* makeProvider((input) => {
      calls.push(input);
      return Effect.succeed(output({}));
    });
    yield* provider.createChangeRequest({
      cwd: "/repo",
      source: { owner: "Contributor", repository: "Contributor/Repo", refName: "feature" },
      target: { repository: "Owner/Repo", refName: "trunk" },
      headSelector: "feature",
      baseRefName: "main",
      title: "--literal title $(not a command)",
      bodyFile: "/tmp/body.md",
    });
    assert.deepStrictEqual(calls[0]?.body, {
      base: "trunk",
      head: "Contributor:feature",
      title: "--literal title $(not a command)",
      body: "PR body",
    });
    assert.strictEqual(calls[0]?.path, "repos/Owner/Repo/pulls");
  }),
);

it.effect("rejects incomplete PR metadata", () =>
  Effect.gen(function* () {
    const provider = yield* makeProvider(() => Effect.succeed(output({ number: 42 })));
    const error = yield* provider
      .getChangeRequest({ cwd: "/repo", reference: "42" })
      .pipe(Effect.flip);
    assert.strictEqual(error.operation, "getChangeRequest");
    assert.include(error.detail, "invalid response");
  }),
);
