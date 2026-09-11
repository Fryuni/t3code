import { SourceControlProviderError, type ChangeRequest } from "@t3tools/contracts";
import {
  detectSourceControlProviderFromRemoteUrl,
  isSshRemoteUrl,
} from "@t3tools/shared/sourceControl";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { ChildProcessSpawner } from "effect/unstable/process";

import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as ForgejoCli from "./ForgejoCli.ts";
import * as SourceControlProvider from "./SourceControlProvider.ts";
import { discovery } from "./forgejoAuth.ts";

export const makeDiscovery = Effect.gen(function* () {
  const fj = yield* ForgejoCli.ForgejoCli;
  return { ...discovery, refineUnknownRemote: fj.refineUnknownRemote };
});

const Repository = Schema.Struct({
  full_name: Schema.String,
  clone_url: Schema.String,
  ssh_url: Schema.String,
  default_branch: Schema.optional(Schema.String),
});
const Branch = Schema.Struct({
  ref: Schema.String,
  repo: Schema.NullOr(Schema.Struct({ full_name: Schema.String })),
});
const PullRequest = Schema.Struct({
  number: Schema.Int.check(Schema.isGreaterThan(0)),
  title: Schema.String,
  html_url: Schema.String,
  state: Schema.Literals(["open", "closed"]),
  merged: Schema.Boolean,
  draft: Schema.optional(Schema.Boolean),
  base: Branch,
  head: Branch,
  updated_at: Schema.optional(Schema.NullOr(Schema.String)),
  closed_at: Schema.optional(Schema.NullOr(Schema.String)),
  merged_at: Schema.optional(Schema.NullOr(Schema.String)),
});

interface RepositoryLocator {
  readonly baseUrl: string;
  readonly repository: string;
}

/** Keep the web authority separate from the repository, including nonstandard ports/subpaths. */
function parseRepository(value: string, baseUrl?: string): RepositoryLocator | null {
  const trimmed = value
    .trim()
    .replace(/\/+$/u, "")
    .replace(/\.git$/u, "");
  let url: URL;
  try {
    const scp = /^[^@/]+@([^:/]+):(.+)$/u.exec(trimmed);
    if (scp) {
      url = new URL(`${baseUrl ?? `https://${scp[1]}`}/${scp[2]}`);
    } else if (/^(?:https?|ssh|git):\/\//u.test(trimmed)) {
      url = new URL(trimmed);
      if (url.protocol === "ssh:" || url.protocol === "git:") {
        url = new URL(url.pathname.replace(/^\//u, ""), `${baseUrl ?? `https://${url.host}`}/`);
      }
    } else if (trimmed.split("/").length === 2 && baseUrl) {
      url = new URL(`${baseUrl.replace(/\/+$/u, "")}/${trimmed}`);
    } else if (trimmed.split("/").length >= 3) {
      url = new URL(`https://${trimmed}`);
    } else {
      return null;
    }
    if (url.username || url.password || url.search || url.hash) return null;
    const segments = url.pathname.split("/").filter(Boolean);
    const repository = segments.slice(-2).map(decodeURIComponent);
    if (
      repository.length !== 2 ||
      repository.some(
        (part) =>
          !part || part.startsWith("-") || /[\s/:?#]/u.test(part) || part === "." || part === "..",
      )
    )
      return null;
    return {
      baseUrl: `${url.origin}${segments.length > 2 ? `/${segments.slice(0, -2).join("/")}` : ""}`,
      repository: repository.join("/"),
    };
  } catch {
    return null;
  }
}

function repositoryPath(locator: RepositoryLocator): string {
  return `/repos/${locator.repository.split("/").map(encodeURIComponent).join("/")}`;
}

function cloneUrls(repository: typeof Repository.Type) {
  return {
    nameWithOwner: repository.full_name,
    url: repository.clone_url,
    sshUrl: repository.ssh_url || repository.clone_url,
  };
}

function toChangeRequest(pr: typeof PullRequest.Type): ChangeRequest {
  const headRepository = pr.head.repo?.full_name;
  return {
    provider: "forgejo",
    number: pr.number,
    title: pr.title,
    url: pr.html_url,
    baseRefName: pr.base.ref,
    headRefName: pr.head.ref,
    state: pr.merged ? "merged" : pr.state,
    isDraft: pr.draft ?? pr.title.startsWith("WIP:"),
    closedAt: pr.closed_at ?? null,
    mergedAt: pr.merged_at ?? null,
    updatedAt: pr.updated_at ? DateTime.make(pr.updated_at) : Option.none(),
    ...(headRepository
      ? {
          isCrossRepository: headRepository !== pr.base.repo?.full_name,
          headRepositoryNameWithOwner: headRepository,
          headRepositoryOwnerLogin: headRepository.split("/")[0] ?? null,
        }
      : {}),
  };
}

export const make = Effect.gen(function* () {
  const fj = yield* ForgejoCli.ForgejoCli;
  const git = yield* GitVcsDriver.GitVcsDriver;

  const fail = (operation: string, cwd: string, detail: string) =>
    new SourceControlProviderError({
      provider: "forgejo",
      command: "fj",
      operation,
      cwd,
      detail,
    });

  const resolveRepository = Effect.fn("ForgejoSourceControlProvider.resolveRepository")(function* (
    input: {
      readonly cwd: string;
      readonly context?: SourceControlProvider.SourceControlProviderContext;
      readonly repository?: string;
    },
    operation: string,
  ) {
    const remote =
      input.repository ??
      input.context?.remoteUrl ??
      (yield* git
        .readConfigValue(input.cwd, "remote.origin.url")
        .pipe(Effect.orElseSucceed(() => null)));
    let baseUrl = input.context?.provider.baseUrl;
    if (
      remote &&
      (isSshRemoteUrl(remote) || remote.startsWith("git://")) &&
      (input.repository || !baseUrl)
    ) {
      const provider = detectSourceControlProviderFromRemoteUrl(remote);
      const stdout = yield* fj.execute({ cwd: input.cwd, operation, args: discovery.authArgs });
      const refined = provider
        ? yield* fj.refineUnknownRemote({
            cwd: input.cwd,
            context: { provider, remoteUrl: remote, remoteName: "origin" },
            auth: { stdout, stderr: "", exitCode: ChildProcessSpawner.ExitCode(0) },
          })
        : null;
      if (!refined)
        return yield* fail(
          operation,
          input.cwd,
          "Could not match this Git remote to a Forgejo instance. Sign in with fj or use the HTTPS repository URL.",
        );
      baseUrl = refined.baseUrl;
    }
    const locator = remote ? parseRepository(remote, baseUrl) : null;
    if (!locator)
      return yield* fail(
        operation,
        input.cwd,
        "Specify the Forgejo repository as host/owner/repo or a full repository URL.",
      );
    return locator;
  });

  const read = <S extends Schema.Top>(
    input: {
      readonly cwd: string;
      readonly operation: string;
      readonly baseUrl: string;
      readonly path: string;
    },
    schema: S,
  ) =>
    fj.read(input).pipe(
      Effect.flatMap((response) =>
        Schema.decodeUnknownEffect(schema)(response.body).pipe(
          Effect.map((body) => ({ body, hasNextPage: response.hasNextPage })),
          Effect.mapError(() =>
            fail(input.operation, input.cwd, "Forgejo returned unexpected response data."),
          ),
        ),
      ),
    );

  const readRepository = (cwd: string, operation: string, locator: RepositoryLocator) =>
    read(
      { cwd, operation, baseUrl: locator.baseUrl, path: repositoryPath(locator) },
      Repository,
    ).pipe(Effect.map((response) => response.body));

  const listChangeRequests: SourceControlProvider.SourceControlProvider["Service"]["listChangeRequests"] =
    Effect.fn("ForgejoSourceControlProvider.listChangeRequests")(function* (input) {
      const operation = "listChangeRequests";
      const locator = yield* resolveRepository(input, operation);
      const source = SourceControlProvider.sourceControlRefFromInput(input);
      const branch = SourceControlProvider.sourceBranch(input);
      const limit = Math.max(1, Math.min(input.limit ?? 20, 100));
      const items: ChangeRequest[] = [];
      let page = 1;
      do {
        const query = new URLSearchParams({
          state: input.state === "merged" ? "closed" : input.state,
          // Forgejo's list endpoint compares head_branch literally. Unlike PR creation,
          // it does not accept owner:branch; filter the fork's owner/repository below.
          head: branch,
          sort: "recentupdate",
          limit: "50",
          page: String(page),
        });
        const response = yield* read(
          {
            cwd: input.cwd,
            operation,
            baseUrl: locator.baseUrl,
            path: `${repositoryPath(locator)}/pulls?${query}`,
          },
          Schema.Array(PullRequest),
        );
        for (const raw of response.body) {
          const pr = toChangeRequest(raw);
          if (pr.headRefName !== branch) continue;
          if (
            source?.repository &&
            pr.headRepositoryNameWithOwner?.toLowerCase() !== source.repository.toLowerCase()
          )
            continue;
          if (
            source?.owner &&
            pr.headRepositoryOwnerLogin?.toLowerCase() !== source.owner.toLowerCase()
          )
            continue;
          if (input.state !== "all" && pr.state !== input.state) continue;
          items.push(pr);
          if (items.length === limit) return items;
        }
        if (!response.hasNextPage || response.body.length === 0) return items;
        page += 1;
      } while (true);
    });

  const resolveReference = Effect.fn("ForgejoSourceControlProvider.resolveReference")(function* (
    input: {
      readonly cwd: string;
      readonly context?: SourceControlProvider.SourceControlProviderContext;
      readonly reference: string;
    },
    operation: string,
  ) {
    const reference = input.reference.trim();
    const urlMatch = /^(https?:\/\/.+)\/pulls\/(\d+)(?:[/?#].*)?$/u.exec(reference);
    const locator = yield* resolveRepository(
      { ...input, ...(urlMatch ? { repository: urlMatch[1] } : {}) },
      operation,
    );
    const number = Number(urlMatch?.[2] ?? reference.replace(/^#/u, ""));
    if (!Number.isSafeInteger(number) || number <= 0)
      return yield* fail(operation, input.cwd, "Enter a Forgejo pull request number or URL.");
    return { ...locator, number };
  });

  const getChangeRequest: SourceControlProvider.SourceControlProvider["Service"]["getChangeRequest"] =
    Effect.fn("ForgejoSourceControlProvider.getChangeRequest")(function* (input) {
      if (!/^#?\d+$/u.test(input.reference) && !/^https?:\/\//u.test(input.reference)) {
        const [pr] = yield* listChangeRequests({
          ...input,
          headSelector: input.reference,
          state: "all",
          limit: 1,
        });
        if (!pr)
          return yield* fail(
            "getChangeRequest",
            input.cwd,
            "No Forgejo pull request was found for this branch.",
          );
        return pr;
      }
      const locator = yield* resolveReference(input, "getChangeRequest");
      const response = yield* read(
        {
          cwd: input.cwd,
          operation: "getChangeRequest",
          baseUrl: locator.baseUrl,
          path: `${repositoryPath(locator)}/pulls/${locator.number}`,
        },
        PullRequest,
      );
      return toChangeRequest(response.body);
    });

  return SourceControlProvider.SourceControlProvider.of({
    kind: "forgejo",
    listChangeRequests,
    getChangeRequest,
    getRepositoryCloneUrls: Effect.fn("ForgejoSourceControlProvider.getRepositoryCloneUrls")(
      function* (input) {
        const locator = yield* resolveRepository(input, "getRepositoryCloneUrls");
        return cloneUrls(yield* readRepository(input.cwd, "getRepositoryCloneUrls", locator));
      },
    ),
    getDefaultBranch: Effect.fn("ForgejoSourceControlProvider.getDefaultBranch")(function* (input) {
      const locator = yield* resolveRepository(input, "getDefaultBranch");
      const repository = yield* readRepository(input.cwd, "getDefaultBranch", locator);
      return repository.default_branch || null;
    }),
    createRepository: Effect.fn("ForgejoSourceControlProvider.createRepository")(function* (input) {
      const operation = "createRepository";
      const locator = yield* resolveRepository(input, operation);
      const [owner, name] = locator.repository.split("/");
      const user = yield* read(
        { cwd: input.cwd, operation, baseUrl: locator.baseUrl, path: "/user" },
        Schema.Struct({ login: Schema.String }),
      );
      const args =
        user.body.login.toLowerCase() === owner?.toLowerCase()
          ? ["repo", "create", name!]
          : ["org", "repo", "create", owner!, name!];
      yield* fj.execute({
        cwd: input.cwd,
        operation,
        host: locator.baseUrl,
        args: [...args, ...(input.visibility === "private" ? ["--private"] : [])],
      });
      return cloneUrls(yield* readRepository(input.cwd, operation, locator));
    }),
    createChangeRequest: Effect.fn("ForgejoSourceControlProvider.createChangeRequest")(
      function* (input) {
        const operation = "createChangeRequest";
        const locator = yield* resolveRepository(input, operation);
        const source = SourceControlProvider.sourceControlRefFromInput(input);
        const owner = source?.owner ?? source?.repository?.split("/")[0];
        const branch = SourceControlProvider.sourceBranch(input);
        const head = owner ? `${owner}:${branch}` : branch;
        yield* fj.execute({
          cwd: input.cwd,
          operation,
          host: locator.baseUrl,
          args: [
            "pr",
            "create",
            "--repo",
            input.target?.repository ?? locator.repository,
            "--base",
            input.target?.refName ?? input.baseRefName,
            "--head",
            head,
            "--body-file",
            input.bodyFile,
            "--",
            input.title,
          ],
        });
      },
    ),
    checkoutChangeRequest: Effect.fn("ForgejoSourceControlProvider.checkoutChangeRequest")(
      function* (input) {
        const operation = "checkoutChangeRequest";
        const locator = yield* resolveReference(input, operation);
        const pr = yield* getChangeRequest(input);
        const repository = yield* readRepository(input.cwd, operation, locator);
        const contextRepository = input.context ? parseRepository(input.context.remoteUrl) : null;
        // fj resolves the API host from --remote even when --host is supplied.
        // A web remote keeps checkout working when SSH has its own authority.
        const remoteName =
          contextRepository?.repository === locator.repository &&
          contextRepository.baseUrl === locator.baseUrl
            ? input.context!.remoteName
            : yield* git
                .ensureRemote({
                  cwd: input.cwd,
                  preferredName: "forgejo",
                  url: repository.clone_url,
                })
                .pipe(
                  Effect.mapError(() =>
                    fail(operation, input.cwd, "Could not configure the Forgejo Git remote."),
                  ),
                );
        yield* fj.execute({
          cwd: input.cwd,
          operation,
          host: locator.baseUrl,
          args: [
            "pr",
            "--remote",
            remoteName,
            "checkout",
            String(locator.number),
            "--branch-name",
            pr.isCrossRepository ? `pr-${pr.number}/${pr.headRefName}` : pr.headRefName,
          ],
        });
      },
    ),
  });
});
