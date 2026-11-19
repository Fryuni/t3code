import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts/settings";
import { useGT } from "gt-react";

import { DraftInput } from "../ui/draft-input";

import { AdvancedSettings } from "./AdvancedSettings";
import { BranchNamingSettings } from "./BranchNamingSettings";
import { WorktreeSubmodulesRow } from "./ProjectDefaultsSettings";
import { ScopedSwitch } from "./ScopedSwitch";
import { useSettingsScope } from "./SettingsScopeContext";
import {
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "./settingsLayout";
import { useSearchableSetting } from "./settingsSearch";
import { WorktreeCleanupSection, WorktreesDirectoryRow } from "./StorageSettings";
import {
  useScopedSettings,
  useUpdateProjectDefaultThreadBaseBranch,
  useUpdateScopedSettings,
} from "./useScopedSettings";

function DefaultBaseBranchRow() {
  const { targets } = useSettingsScope();
  const updateDefaultThreadBaseBranch = useUpdateProjectDefaultThreadBaseBranch();
  const baseBranches = targets.map((candidate) => candidate.overrides.defaultThreadBaseBranch);
  const mixed = baseBranches.some((branch) => branch !== baseBranches[0]);
  const gt = useGT();
  return (
    <SettingsRow
      title={gt("Default base branch")}
      description={gt(
        "New worktree threads start from this branch. When unset, the repository default branch is used.",
      )}
      resetAction={
        baseBranches.some((branch) => branch !== undefined) ? (
          <SettingResetButton
            ariaLabel={gt("Reset default base branch to default")}
            onClick={() => updateDefaultThreadBaseBranch(null)}
          />
        ) : null
      }
      control={
        <DraftInput
          size="sm"
          className="w-full sm:w-56"
          aria-label={gt("Default base branch")}
          placeholder={mixed ? gt("Mixed") : gt("Repository default")}
          spellCheck={false}
          value={mixed ? "" : (baseBranches[0] ?? "")}
          onCommit={updateDefaultThreadBaseBranch}
        />
      }
    />
  );
}

function StartFromRemoteRow() {
  const gt = useGT();
  const searchableSetting = useSearchableSetting();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  return (
    <SettingsRow
      serverScoped
      settingKeys={["newWorktreesStartFromOrigin"]}
      {...searchableSetting("start-from-origin")}
      description={gt(
        "Uses the latest commit of the base branch’s tracked remote branch, even if its name differs. Otherwise uses the same-named branch on origin. Uses your local branch if that remote branch is missing.",
      )}
      resetAction={
        settings.newWorktreesStartFromOrigin !==
        DEFAULT_UNIFIED_SETTINGS.newWorktreesStartFromOrigin ? (
          <SettingResetButton
            ariaLabel={gt("Reset new worktrees start from remote to default")}
            onClick={() =>
              updateSettings({
                newWorktreesStartFromOrigin: DEFAULT_UNIFIED_SETTINGS.newWorktreesStartFromOrigin,
              })
            }
          />
        ) : null
      }
      control={
        <ScopedSwitch
          settingKeys={["newWorktreesStartFromOrigin"]}
          checked={settings.newWorktreesStartFromOrigin}
          onCheckedChange={(checked) =>
            updateSettings({ newWorktreesStartFromOrigin: Boolean(checked) })
          }
          aria-label={gt("Start new worktrees from remote by default")}
        />
      }
    />
  );
}

export function WorktreesSettingsPanel() {
  const gt = useGT();
  const searchableSetting = useSearchableSetting();
  const { scope } = useSettingsScope();
  const isProjectScope = scope.kind === "project" || scope.kind === "checkout";

  return (
    <SettingsPageContainer>
      <SettingsSection
        id="worktree-creation"
        title={gt("Creation", { $context: "settings section about creating worktrees" })}
      >
        {!isProjectScope && <WorktreesDirectoryRow />}
        {isProjectScope && <DefaultBaseBranchRow />}
        <StartFromRemoteRow />
        <AdvancedSettings targetIds={[searchableSetting("worktree-submodules").id]}>
          <WorktreeSubmodulesRow />
        </AdvancedSettings>
      </SettingsSection>
      <SettingsSection id="worktree-branches" title={gt("Branches")}>
        <BranchNamingSettings />
      </SettingsSection>
      <WorktreeCleanupSection />
    </SettingsPageContainer>
  );
}
