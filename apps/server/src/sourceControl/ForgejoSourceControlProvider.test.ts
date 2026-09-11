import { assert, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as ForgejoCli from "./ForgejoCli.ts";
import * as ForgejoSourceControlProvider from "./ForgejoSourceControlProvider.ts";

const context = {
  provider: { kind: "forgejo", name: "Forgejo", baseUrl: "https://git.example.test:8443" },
  remoteName: "upstream",
  remoteUrl: "ssh://git@ssh.example.test:2222/Owner/Repo.git",
} as const;

const repository = {
  full_name: "Owner/Repo",
  clone_url: "https://git.example.test:8443/Owner/Repo.git",
  ssh_url: "ssh://forge@ssh.example.test:2222/Owner/Repo.git",
  default_branch: "trunk",
};
const pullRequest = {
  number: 42,
  title: "Support Forgejo",
  html_url: "https://git.example.test:8443/Owner/Repo/pulls/42",
  state: "open",
  merged: false,
  draft: true,
  base: { ref: "trunk", repo: { full_name: "Owner/Repo" } },
  head: { ref: "feature/forgejo", repo: { full_name: "Contributor/Repo" } },
  updated_at: "2026-09-11T00:00:00Z",
} as const;

function makeProvider(
  input: {
    readonly read?: ForgejoCli.ForgejoCli["Service"]["read"];
    readonly execute?: ForgejoCli.ForgejoCli["Service"]["execute"];
    readonly refineUnknownRemote?: ForgejoCli.ForgejoCli["Service"]["refineUnknownRemote"];
  } = {},
) {
  return ForgejoSourceControlProvider.make.pipe(
    Effect.provide(
      Layer.mergeAll(
        Layer.mock(ForgejoCli.ForgejoCli)({
          read: input.read ?? (() => Effect.succeed({ body: repository, hasNextPage: false })),
          execute: input.execute ?? (() => Effect.succeed("")),
          refineUnknownRemote:
            input.refineUnknownRemote ?? (() => Effect.succeed(context.provider)),
        }),
        Layer.mock(GitVcsDriver.GitVcsDriver)({
          readConfigValue: () => Effect.succeed(context.remoteUrl),
          ensureRemote: () => Effect.succeed("forgejo"),
        }),
      ),
    ),
  );
}

it.effect("reads canonical clone URLs and the default branch from the selected instance", () =>
  Effect.gen(function* () {
    const requests: Parameters<ForgejoCli.ForgejoCli["Service"]["read"]>[0][] = [];
    const provider = yield* makeProvider({
      read: (input) => {
        requests.push(input);
        return Effect.succeed({ body: repository, hasNextPage: false });
      },
    });
    const urls = yield* provider.getRepositoryCloneUrls({
      cwd: "/repo",
      context,
      repository: "Owner/Repo",
    });
    assert.deepStrictEqual(urls, {
      nameWithOwner: "Owner/Repo",
      url: repository.clone_url,
      sshUrl: repository.ssh_url,
    });
    assert.strictEqual(yield* provider.getDefaultBranch({ cwd: "/repo", context }), "trunk");
    assert.deepStrictEqual(
      requests.map(({ baseUrl, path }) => ({ baseUrl, path })),
      [
        { baseUrl: context.provider.baseUrl, path: "/repos/Owner/Repo" },
        { baseUrl: context.provider.baseUrl, path: "/repos/Owner/Repo" },
      ],
    );
  }),
);

it.effect("accepts remote-first repository URLs with web ports and subpaths", () =>
  Effect.gen(function* () {
    const requests: Parameters<ForgejoCli.ForgejoCli["Service"]["read"]>[0][] = [];
    const provider = yield* makeProvider({
      read: (input) => {
        requests.push(input);
        return Effect.succeed({ body: repository, hasNextPage: false });
      },
    });
    yield* provider.getRepositoryCloneUrls({
      cwd: "/tmp",
      repository: "http://git.example.test:3000/forge/Owner/Repo.git",
    });
    yield* provider.getRepositoryCloneUrls({
      cwd: "/tmp",
      repository: "other.example.test/Owner/Repo",
    });
    assert.strictEqual(requests[0]?.baseUrl, "http://git.example.test:3000/forge");
    assert.strictEqual(requests[1]?.baseUrl, "https://other.example.test");
    assert.strictEqual(requests[0]?.path, "/repos/Owner/Repo");
    const error = yield* provider
      .getRepositoryCloneUrls({ cwd: "/tmp", repository: "Owner/Repo" })
      .pipe(Effect.flip);
    assert.include(error.detail, "host/owner/repo");
  }),
);

it.effect("resolves SSH clone inputs to their web instance before reading metadata", () =>
  Effect.gen(function* () {
    const provider = yield* makeProvider({
      read: (input) => {
        assert.strictEqual(input.baseUrl, context.provider.baseUrl);
        return Effect.succeed({ body: repository, hasNextPage: false });
      },
    });
    assert.strictEqual(
      (yield* provider.getRepositoryCloneUrls({ cwd: "/repo", repository: context.remoteUrl })).url,
      repository.clone_url,
    );
    const unknown = yield* makeProvider({ refineUnknownRemote: () => Effect.succeed(null) });
    const error = yield* unknown
      .getRepositoryCloneUrls({ cwd: "/repo", repository: context.remoteUrl })
      .pipe(Effect.flip);
    assert.include(error.detail, "HTTPS repository URL");
  }),
);

it.effect("preserves fork identity, draft state and timestamps when reading a PR URL", () =>
  Effect.gen(function* () {
    const provider = yield* makeProvider({
      read: (input) => {
        assert.strictEqual(input.path, "/repos/Owner/Repo/pulls/42");
        assert.strictEqual(input.baseUrl, context.provider.baseUrl);
        return Effect.succeed({ body: pullRequest, hasNextPage: false });
      },
    });
    const pr = yield* provider.getChangeRequest({ cwd: "/repo", reference: pullRequest.html_url });
    assert.deepStrictEqual(pr, {
      provider: "forgejo",
      number: 42,
      title: "Support Forgejo",
      url: pullRequest.html_url,
      baseRefName: "trunk",
      headRefName: "feature/forgejo",
      state: "open",
      isDraft: true,
      closedAt: null,
      mergedAt: null,
      updatedAt: Option.some(DateTime.makeUnsafe(pullRequest.updated_at)),
      isCrossRepository: true,
      headRepositoryNameWithOwner: "Contributor/Repo",
      headRepositoryOwnerLogin: "Contributor",
    });
  }),
);

it.effect("pages past other forks and closed unmerged PRs before applying the result limit", () =>
  Effect.gen(function* () {
    let page = 0;
    const provider = yield* makeProvider({
      read: (input) => {
        page++;
        const query = new URL(`${input.baseUrl}${input.path}`).searchParams;
        assert.strictEqual(query.get("head"), "feature/forgejo");
        assert.strictEqual(query.get("state"), "closed");
        assert.strictEqual(query.get("page"), String(page));
        return Effect.succeed({
          body:
            page === 1
              ? [
                  { ...pullRequest, state: "closed", merged: false },
                  {
                    ...pullRequest,
                    state: "closed",
                    merged: true,
                    head: { ref: "feature/forgejo", repo: { full_name: "SomeoneElse/Repo" } },
                  },
                ]
              : [
                  {
                    ...pullRequest,
                    state: "closed",
                    merged: true,
                    merged_at: "2026-09-11T01:00:00Z",
                  },
                ],
          hasNextPage: page === 1,
        });
      },
    });
    const prs = yield* provider.listChangeRequests({
      cwd: "/repo",
      context,
      headSelector: "Contributor:feature/forgejo",
      state: "merged",
      limit: 1,
    });
    assert.strictEqual(page, 2);
    assert.strictEqual(prs.length, 1);
    assert.strictEqual(prs[0]?.state, "merged");
    assert.strictEqual(prs[0]?.mergedAt, "2026-09-11T01:00:00Z");
  }),
);

it.effect("creates a fork PR with explicit target, branches, title and body file", () =>
  Effect.gen(function* () {
    const calls: Parameters<ForgejoCli.ForgejoCli["Service"]["execute"]>[0][] = [];
    const provider = yield* makeProvider({
      execute: (input) => {
        calls.push(input);
        return Effect.succeed("");
      },
    });
    yield* provider.createChangeRequest({
      cwd: "/repo",
      context,
      source: { owner: "Contributor", repository: "Contributor/Repo", refName: "feature/forgejo" },
      target: { repository: "Owner/Repo", refName: "trunk" },
      headSelector: "feature/forgejo",
      baseRefName: "main",
      title: "--literal title $(not a command)",
      bodyFile: "/tmp/body file.md",
    });
    assert.deepStrictEqual(calls, [
      {
        cwd: "/repo",
        operation: "createChangeRequest",
        host: context.provider.baseUrl,
        args: [
          "pr",
          "create",
          "--repo",
          "Owner/Repo",
          "--base",
          "trunk",
          "--head",
          "Contributor:feature/forgejo",
          "--body-file",
          "/tmp/body file.md",
          "--",
          "--literal title $(not a command)",
        ],
      },
    ]);
  }),
);

it.effect(
  "publishes personal and organization repositories using their respective fj commands",
  () =>
    Effect.gen(function* () {
      for (const owner of ["Alice", "Team"]) {
        const calls: Parameters<ForgejoCli.ForgejoCli["Service"]["execute"]>[0][] = [];
        const provider = yield* makeProvider({
          read: (input) =>
            Effect.succeed({
              body: input.path === "/user" ? { login: "alice" } : repository,
              hasNextPage: false,
            }),
          execute: (input) => {
            calls.push(input);
            return Effect.succeed("");
          },
        });
        yield* provider.createRepository({
          cwd: "/repo",
          repository: `git.example.test:8443/${owner}/Repo`,
          visibility: "private",
        });
        assert.deepStrictEqual(
          calls[0]?.args,
          owner === "Alice"
            ? ["repo", "create", "Repo", "--private"]
            : ["org", "repo", "create", "Team", "Repo", "--private"],
        );
        assert.strictEqual(calls[0]?.host, context.provider.baseUrl);
      }
    }),
);

it.effect("checks out through fj using the selected remote and a separate fork branch", () =>
  Effect.gen(function* () {
    const calls: Parameters<ForgejoCli.ForgejoCli["Service"]["execute"]>[0][] = [];
    const provider = yield* makeProvider({
      read: (input) =>
        Effect.succeed({
          body: input.path.endsWith("/pulls/42") ? pullRequest : repository,
          hasNextPage: false,
        }),
      execute: (input) => {
        calls.push(input);
        return Effect.succeed("");
      },
    });
    yield* provider.checkoutChangeRequest({ cwd: "/repo", context, reference: "42" });
    assert.deepStrictEqual(calls[0]?.args, [
      "pr",
      "--remote",
      "forgejo",
      "checkout",
      "42",
      "--branch-name",
      "pr-42/feature/forgejo",
    ]);
  }),
);

it.effect("rejects malformed metadata instead of returning incomplete change requests", () =>
  Effect.gen(function* () {
    const provider = yield* makeProvider({
      read: () => Effect.succeed({ body: { number: 42 }, hasNextPage: false }),
    });
    const error = yield* provider
      .getChangeRequest({ cwd: "/repo", context, reference: "42" })
      .pipe(Effect.flip);
    assert.strictEqual(error.operation, "getChangeRequest");
    assert.include(error.detail, "unexpected response");
  }),
);
