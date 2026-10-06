import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";

import {
  pullRequestListPreferences,
  readPullRequestListPreferences,
} from "../components/pullRequest/pullRequestListPreferences";
import { buildProjectGroups, selectProjectGroupingSettings } from "../logicalProject";
import { useProjects, useServerConfigs } from "../state/entities";
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

  return useCallback(() => {
    const scopeKey = legacySidebarEnabled
      ? null
      : useUiStateStore.getState().sidebarProjectScopeKey;
    const group =
      scopeKey === null
        ? undefined
        : buildProjectGroups({
            projects,
            settings: groupingSettings,
            preferredEnvironmentId: primaryEnvironmentId,
          }).find((candidate) => candidate.key === scopeKey);
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
  }, [
    groupingSettings,
    legacySidebarEnabled,
    navigate,
    primaryEnvironmentId,
    projects,
    serverConfigs,
  ]);
}
