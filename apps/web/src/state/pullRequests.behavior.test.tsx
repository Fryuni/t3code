import { RegistryContext } from "@effect/atom-react";
import {
  EnvironmentId,
  ProjectId,
  type PullRequestRef,
  type PullRequestSummary,
} from "@t3tools/contracts";
import { AtomRegistry } from "effect/unstable/reactivity";
import { act, useLayoutEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({ registry: undefined as AtomRegistry.AtomRegistry | undefined }));
vi.mock("../rpc/atomRegistry", () => ({
  get appAtomRegistry() {
    return state.registry;
  },
}));

import { useSharedPullRequestSummary } from "./pullRequests";

const environmentId = EnvironmentId.make("forgejo-cache-test");
const reference: PullRequestRef = {
  projectId: ProjectId.make("checkout"),
  host: "forge.test:3000",
  repository: "Forge/acme/repo",
  number: 7,
};
const summary: PullRequestSummary = {
  provider: "forgejo",
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
  let registry: AtomRegistry.AtomRegistry;
  let renderer: ReactTestRenderer | undefined;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    registry = AtomRegistry.make();
    state.registry = registry;
  });

  afterEach(async () => {
    await act(async () => renderer?.unmount());
    renderer = undefined;
    registry.dispose();
    state.registry = undefined;
    vi.unstubAllGlobals();
  });

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
    await act(async () => {
      renderer = create(
        <RegistryContext.Provider value={registry}>
          <Writer />
          <Reader />
        </RegistryContext.Provider>,
      );
    });
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
