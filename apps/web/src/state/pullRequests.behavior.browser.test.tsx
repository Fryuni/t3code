import {
  EnvironmentId,
  ProjectId,
  SourceControlProviderKind,
  type PullRequestRef,
  type PullRequestSummary,
} from "@t3tools/contracts";
import { useLayoutEffect } from "react";
import { describe, expect, it } from "vite-plus/test";

import { render } from "../../test/render";
import { AppAtomRegistryProvider } from "../rpc/atomRegistry";
import { useSharedPullRequestSummary } from "./pullRequests";

const environmentId = EnvironmentId.make("forgejo-cache-test");
const reference: PullRequestRef = {
  projectId: ProjectId.make("checkout"),
  host: "forge.test:3000",
  repository: "Forge/acme/repo",
  number: 7,
};
const summary: PullRequestSummary = {
  provider: SourceControlProviderKind.make("forgejo"),
  projectId: reference.projectId,
  repository: reference.repository,
  number: reference.number,
  title: "Update repository",
  url: "http://forge.test:3000/Forge/acme/repo/pulls/7",
  state: "open",
  headBranch: "feature",
  baseBranch: "main",
  updatedAt: "2026-09-21T00:00:00Z",
  checksState: "passing",
};

describe("shared pull request observations", () => {
  async function observe(
    writer: PullRequestRef,
    reader: PullRequestRef,
    readerEnvironment = environmentId,
  ) {
    let result: PullRequestSummary | null = null;
    function Writer() {
      useSharedPullRequestSummary(environmentId, writer, summary, 100);
      return null;
    }
    function Reader() {
      const observed = useSharedPullRequestSummary(readerEnvironment, reader, null);
      useLayoutEffect(() => {
        result = observed;
      }, [observed]);
      return null;
    }
    // router: false because neither observer reads a route.
    await using _screen = await render(
      <AppAtomRegistryProvider>
        <Writer />
        <Reader />
      </AppAtomRegistryProvider>,
      { router: false },
    );
    return result;
  }

  it("shares legacy URL observations with list references despite owner/name casing", async () => {
    const { host: _, ...legacy } = reference;
    expect(
      await observe(legacy, {
        ...reference,
        host: "FORGE.TEST:3000",
        repository: "Forge/Acme/Repo",
      }),
    ).toMatchObject({ checksState: "passing" });
  });

  it.each([
    { host: "other.test:3000" },
    { host: "forge.test:4000" },
    { repository: "forge/acme/repo" },
    { projectId: ProjectId.make("other-checkout") },
  ])("keeps a different repository instance or checkout separate: %j", async (difference) => {
    expect(await observe(reference, { ...reference, ...difference })).toBeNull();
  });

  it("keeps the same checkout ID on another environment separate", async () => {
    expect(await observe(reference, reference, EnvironmentId.make("remote"))).toBeNull();
  });
});
