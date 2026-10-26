import { expect, it } from "vite-plus/test";

import { foldRepositoryKey, normalizeSourceControlRepository } from "./sourceControl.ts";

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
