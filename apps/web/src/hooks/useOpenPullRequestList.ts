import { useNavigate } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";

import {
  pullRequestListPreferences,
  readPullRequestListPreferences,
} from "../components/pullRequest/pullRequestListPreferences";
import { buildProjectGroups, selectProjectGroupingSettings } from "../logicalProject";
import {
  useAllEnvironmentProjectSnapshotsReady,
  useProjects,
  useServerConfigs,
} from "../state/entities";
import { usePrimaryEnvironmentId } from "../state/environments";
import { useUiStateStore } from "../uiStateStore";
import { useClientSettings, useLegacySidebarEnabled } from "./useSettings";

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
  const disabled =
    !legacySidebarEnabled &&
    sidebarScopeKey !== null &&
    !allProjectSnapshotsReady &&
    !groups.some((group) => group.key === sidebarScopeKey);

  const openPullRequestList = useCallback(() => {
    const scopeKey = legacySidebarEnabled
      ? null
      : useUiStateStore.getState().sidebarProjectScopeKey;
    const group = scopeKey === null ? undefined : groups.find((group) => group.key === scopeKey);
    // An incomplete or cached catalog cannot establish that a persisted scope is gone.
    if (scopeKey !== null && group === undefined && !allProjectSnapshotsReady) {
      return;
    }
    const project = group
      ? ([group.representative, ...group.members.map((member) => member.project)].find(
          (candidate) =>
            serverConfigs.get(candidate.environmentId)?.environment.capabilities.pullRequests ===
            true,
        ) ?? group.representative)
      : undefined;

    return navigate({
      to: "/pull-requests",
      search: pullRequestListPreferences({
        ...readPullRequestListPreferences(),
        environmentId: project?.environmentId,
        projectId: project?.id,
        host: undefined,
      }),
    });
  }, [allProjectSnapshotsReady, groups, legacySidebarEnabled, navigate, serverConfigs]);

  return { openPullRequestList, disabled };
}
