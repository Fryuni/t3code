import { describe, expect, it } from "vite-plus/test";

import {
  foldRepositoryKey,
  isSshRemoteUrl,
  normalizeSourceControlRepository,
} from "./sourceControl.ts";

describe("isSshRemoteUrl", () => {
  it.each([
    "git@github.com:owner/repo.git",
    "ssh://git@github.com/owner/repo.git",
    "github.com:owner/repo.git",
    "github-work:owner/repo.git",
  ])("reads %s as SSH", (remoteUrl) => {
    expect(isSshRemoteUrl(remoteUrl)).toBe(true);
  });

  it.each([
    "https://github.com/owner/repo.git",
    "C:/repos/repo",
    "/srv/git/repo.git",
    "./team:group/repo",
    "file:///srv/git/repo.git",
    "hg::owner/repo",
  ])("does not read %s as SSH", (remoteUrl) => {
    expect(isSshRemoteUrl(remoteUrl)).toBe(false);
  });
});

it("folds repository paths without losing Forgejo instance path case", () => {
  expect(normalizeSourceControlRepository("Forge/Owner/Repo", "forgejo")).toBe("Forge/owner/repo");
  expect(normalizeSourceControlRepository("Forge/Owner/Repo")).toBe("Forge/owner/repo");
  expect(normalizeSourceControlRepository("Group/Subgroup/Repo", "gitlab")).toBe(
    "group/subgroup/repo",
  );
});

it("folds a repository key's host and owner/name, keeping a Forgejo mount", () => {
  expect(foldRepositoryKey("GIT.EXAMPLE.TEST/Forge/Owner/Repo", "forgejo")).toBe(
    "git.example.test/Forge/owner/repo",
  );
  expect(foldRepositoryKey("GitLab.com/Group/Sub/Repo", "gitlab")).toBe(
    "gitlab.com/group/sub/repo",
  );
});
