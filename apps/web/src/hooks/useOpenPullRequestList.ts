import type { ScopedProjectRef } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import {
  pullRequestListPreferences,
  readPullRequestListPreferences,
} from "../components/pullRequest/pullRequestListPreferences";
import {
  buildProjectGroups,
  selectProjectGroupingSettings,
} from "@t3tools/client-runtime/state/project-grouping";
import {
  readEnvironmentSupportsPullRequests,
  readProject,
  useAllEnvironmentProjectSnapshotsReady,
  useProjects,
  useServerConfigs,
} from "../state/entities";
import { readEnvironmentConnected, usePrimaryEnvironmentId } from "../state/environments";
import { useUiStateStore } from "../uiStateStore";
import { useClientSettings } from "./useSettings";

// The PR page filters by one project, so a sidebar filter of several opens it unscoped.
const singleScopeKey = (keys: readonly string[]) => (keys.length === 1 ? keys[0]! : null);

export function useOpenProjectPullRequestList() {
  const navigate = useNavigate();
  return (projectRef: ScopedProjectRef) => {
    // Menus and cached project/config data can outlive the target's connection.
    if (
      !readEnvironmentConnected(projectRef.environmentId) ||
      readProject(projectRef) === null ||
      !readEnvironmentSupportsPullRequests(projectRef.environmentId)
    ) {
      return;
    }
    return navigate({
      to: "/pull-requests",
      search: pullRequestListPreferences({
        ...readPullRequestListPreferences(),
        environmentId: projectRef.environmentId,
        projectId: projectRef.projectId,
        host: undefined,
      }),
    });
  };
}

export function useOpenPullRequestList() {
  const navigate = useNavigate();
  const projects = useProjects();
  const serverConfigs = useServerConfigs();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const groupingSettings = useClientSettings(selectProjectGroupingSettings);
  const sidebarScopeKeys = useUiStateStore((store) => store.sidebarProjectScopeKeys);
  const allProjectSnapshotsReady = useAllEnvironmentProjectSnapshotsReady();
  const groups = buildProjectGroups({
    projects,
    settings: groupingSettings,
    preferredEnvironmentId: primaryEnvironmentId,
  });
  const resolveScope = (scopeKey: string | null) => {
    // The sidebar reads an archived project's scope as all projects.
    const group =
      scopeKey === null
        ? undefined
        : groups.find((group) => group.key === scopeKey && !group.archived);
    const project = group
      ? [group.representative, ...group.members.map((member) => member.project)].find(
          (candidate) =>
            serverConfigs.get(candidate.environmentId)?.environment.capabilities.pullRequests ===
            true,
        )
      : undefined;
    // An incomplete or cached catalog cannot establish that a persisted scope is gone.
    const disabledReason =
      scopeKey !== null && group === undefined && !allProjectSnapshotsReady
        ? "Waiting for projects"
        : group !== undefined && project === undefined
          ? "Pull requests unavailable for this project"
          : null;
    return { project, disabledReason };
  };
  const { disabledReason } = resolveScope(singleScopeKey(sidebarScopeKeys));

  const openPullRequestList = () => {
    const { project, disabledReason } = resolveScope(
      singleScopeKey(useUiStateStore.getState().sidebarProjectScopeKeys),
    );
    if (disabledReason !== null) {
      return;
    }

    return navigate({
      to: "/pull-requests",
      search: pullRequestListPreferences({
        ...readPullRequestListPreferences(),
        environmentId: project?.environmentId,
        projectId: project?.id,
        host: undefined,
      }),
    });
  };

  return { openPullRequestList, disabled: disabledReason !== null, disabledReason };
}
