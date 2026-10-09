import type { ScopedProjectRef } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";

import {
  pullRequestListPreferences,
  readPullRequestListPreferences,
} from "../components/pullRequest/pullRequestListPreferences";
import { buildProjectGroups, selectProjectGroupingSettings } from "../logicalProject";
import {
  readEnvironmentSupportsPullRequests,
  readProject,
  useAllEnvironmentProjectSnapshotsReady,
  useProjects,
  useServerConfigs,
} from "../state/entities";
import { readEnvironmentConnected, usePrimaryEnvironmentId } from "../state/environments";
import { useUiStateStore } from "../uiStateStore";
import { useClientSettings, useLegacySidebarEnabled } from "./useSettings";

export function useOpenProjectPullRequestList() {
  const navigate = useNavigate();
  return useCallback(
    (projectRef: ScopedProjectRef) => {
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
    },
    [navigate],
  );
}

export function useOpenPullRequestList() {
  const navigate = useNavigate();
  const projects = useProjects();
  const serverConfigs = useServerConfigs();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const groupingSettings = useClientSettings(selectProjectGroupingSettings);
  const legacySidebarEnabled = useLegacySidebarEnabled();
  const sidebarScopeKey = useUiStateStore((store) => store.sidebarProjectScopeKey);
  const allProjectSnapshotsReady = useAllEnvironmentProjectSnapshotsReady();
  const groups = useMemo(
    () =>
      buildProjectGroups({
        projects,
        settings: groupingSettings,
        preferredEnvironmentId: primaryEnvironmentId,
      }),
    [projects, groupingSettings, primaryEnvironmentId],
  );
  const resolveScope = useCallback(
    (scopeKey: string | null) => {
      const group = scopeKey === null ? undefined : groups.find((group) => group.key === scopeKey);
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
    },
    [allProjectSnapshotsReady, groups, serverConfigs],
  );
  const { disabledReason } = resolveScope(legacySidebarEnabled ? null : sidebarScopeKey);

  const openPullRequestList = useCallback(() => {
    const scopeKey = legacySidebarEnabled
      ? null
      : useUiStateStore.getState().sidebarProjectScopeKey;
    const { project, disabledReason } = resolveScope(scopeKey);
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
  }, [legacySidebarEnabled, navigate, resolveScope]);

  return { openPullRequestList, disabled: disabledReason !== null, disabledReason };
}
