# Fork differences and pruning candidates

This exploration records the fork's remaining differences from upstream so separate
threads can investigate consolidation independently. It is a source/history
comparison, not approval to remove features or a verified implementation plan.
No tests or client verification were performed during the exploration.

## Comparison baseline

- Date: 2026-09-19.
- Local branch: `t3code/5f2ea237`.
- Local HEAD: `5addbf0eb96aab0eeab2b535ab3248869b57c18f`.
- Fetched upstream/main: `cb3d95c17487f3d834a5537f7c3aa0106bc9b5ec`.
- Merge base: `869347bc26051bba7c3c0274a7dfcae7770d3e3a`.
- Working tree was clean.

The branch has 79 local-only commits, including merges, and lacks 25 upstream
commits. Its changes from the merge base cover 179 files, with 7,829 insertions
and 4,946 deletions. Excluding `.github`, that is 160 files, 7,811 insertions,
and 584 deletions. Workflow removal accounts for most deleted lines.

Use the merge-base diff to identify fork additions, then compare relevant files
against the upstream tip to check whether upstream superseded them:

```sh
git log --oneline upstream/main..HEAD
git log --oneline HEAD..upstream/main
git diff upstream/main...HEAD -- <paths>
git diff upstream/main HEAD -- <paths>
```

The tip-to-tip diff also includes upstream changes missing locally. Do not treat
those as intentional fork changes. Integrating the pending upstream commits
before editing would reduce confusion, especially around mobile and ACP code.
Recheck the baseline if either branch advances.

## Independent investigation areas

### 1. Consolidate worktree cleanup

**Strongest pruning candidate, but not behaviorally equivalent.**

The fork removes a clean worktree once its last active thread settles and provider
sessions have stopped. It preserves the main checkout and branches. Upstream
added configurable cleanup for age, merge, deletion, and unchanged branches in
`c4ca1b0f9` (#11598).

The fork now has two cleanup mechanisms. The settlement path operates independently
of upstream's cleanup settings. Upstream's cleanup has additional checks around
terminals, ignored files, workspace leases, and revalidation before removal.
It also excludes worktrees shared by multiple nondeleted thread records, whereas
the settlement implementation can remove one after the other users have settled.

Start with [ThreadSettlementReactor.ts](../../apps/server/src/orchestration/ThreadSettlementReactor.ts)
and [storageCleanup.ts](../../apps/server/src/storageCleanup.ts).

Investigate moving any desired settlement trigger and shared-worktree semantics
into the upstream cleanup system. Simply deleting the settlement worker loses
immediate cleanup on settlement. Verify settings behavior, shared worktrees,
active sessions/terminals, and resuming a thread after removal before pruning.

### 2. Reduce Forgejo-specific differences

**Core support overlaps; remaining patches are extensions and fixes.**

Upstream already supports Forgejo/Gitea through `fj` and `tea` in `6fd68f5c3`
(#11436). The original local provider implementation has largely converged with
upstream. Do not revert the original feature wholesale.

Remaining differences include:

- Discovering an SSH remote through its advertised clone URL when the SSH and
  web hosts differ.
- Caching remote refinement and discovery.
- URL/path normalization and preserving HTTP origins and instance-path case.
- PR parsing, matching, linking, and synchronization adjustments.
- A Forgejo repository-publishing option in the web Git actions.

Start with [ForgejoCli.ts](../../apps/server/src/sourceControl/ForgejoCli.ts),
[SourceControlProviderRegistry.ts](../../apps/server/src/sourceControl/SourceControlProviderRegistry.ts),
and [sourceControl.ts](../../packages/shared/src/sourceControl.ts).

Compare residual patches individually against upstream behavior and their focused
tests. This area overlaps the PR-link investigation through repository identity
and shared URL helpers; coordinate ownership before editing those files.

### 3. Simplify branch/worktree creation differences

**Related upstream features exist, but the local behavior remains distinct.**

The fork adds a “Create new branch” toggle on web/desktop and mobile, allowing an
existing unoccupied local branch to be checked out in a new worktree. It carries
that choice through drafts and the mobile outbox, clears unavailable selections,
and forces new branches during multi-model fan-out.

Upstream's mobile “new thread on existing branch” feature (`7dda0b1c0`, #10359)
does not replace this: upstream's new-worktree mode still generates a fresh branch.

The fork also adds a project-only default base branch. Upstream's project settings
framework exists, but does not contain this override at the comparison baseline.

Start with [BranchToolbarBranchSelector.tsx](../../apps/web/src/components/BranchToolbarBranchSelector.tsx),
[useHandleNewThread.ts](../../apps/web/src/hooks/useHandleNewThread.ts), and
[new-task-flow-provider.tsx](../../apps/mobile/src/features/threads/new-task-flow-provider.tsx).

Treat the toggle and default-base setting as one editing area: they share draft
initialization and branch selection code. Preserve explicit selections, background
submission behavior, mobile queued tasks, and fan-out semantics if refactoring.

### 4. Assess optional command-palette and PR-opening differences

**Small candidates for reducing custom behavior.**

The command palette adds “New thread on <branch>”, retaining the current thread's
branch/worktree. Upstream already has “New thread in this worktree” in the branch
toolbar, so the fork adds an entry point rather than an entirely new capability.
See [CommandPalette.tsx](../../apps/web/src/components/CommandPalette.tsx).

Git actions use the shared PR-link handler, and matching prefers the current
thread's project when multiple checkouts match the same repository. Historical
commit titles about opening PRs in the browser are misleading for the current
implementation: supported PR links normally open within T3; modifiers force
external opening.

See [GitActionsControl.tsx](../../apps/web/src/components/GitActionsControl.tsx)
and [openPullRequestLink.ts](../../apps/web/src/lib/openPullRequestLink.ts).
Keep duplicate-checkout and multi-environment correctness separate from preferences
about where links open. Coordinate shared URL/identity edits with the Forgejo thread
and new-thread handler edits with the branch/worktree thread.

### 5. Preserve distinct provider functionality

**No upstream replacement identified.**

OhMyPi remains a fork-only provider, including ACP adaptation, model discovery,
settings/icons, thought streaming, cancellation, and child-agent tracking. It is
the largest distinct feature. Start with
[OhMyPiAdapter.ts](../../apps/server/src/provider/Layers/OhMyPiAdapter.ts)
and [OhMyPiDriver.ts](../../apps/server/src/provider/Drivers/OhMyPiDriver.ts).

The shared ACP runtime also keeps assistant text contiguous across background tool
updates: updates to an existing tool call no longer close the assistant segment.
An observer hook supports OhMyPi child tracking. These remain different upstream;
see [AcpSessionRuntime.ts](../../apps/server/src/provider/acp/AcpSessionRuntime.ts).

Upstream's pending commits include ACP changes. Reconcile those before deciding
whether either local hook can be simplified.

### 6. Preserve distinct connection and CLI functionality

**No upstream equivalent identified at this baseline.**

External proxy support adds `--public-url` / `T3CODE_PUBLIC_URL`, advertised pairing
URLs, stable proxy cookies, desktop configuration, and network classification.
See [config.ts](../../apps/server/src/cli/config.ts),
[auth/utils.ts](../../apps/server/src/auth/utils.ts), and
[pairingUrls.ts](../../apps/web/src/components/settings/pairingUrls.ts).

The fork also adds `t3 wake`, shared running-server discovery, and
`T3CODE_THREAD_ID` in provider process environments. See
[wake.ts](../../apps/server/src/cli/wake.ts) and
[runningServer.ts](../../apps/server/src/cli/runningServer.ts).

These can be investigated separately, but both touch CLI configuration, pairing,
and server discovery. Provider environment edits also overlap the provider area.

### 7. Model labels and fork maintenance

**Small, distinct changes rather than obvious duplicate features.**

Model subtitles infer provider qualifiers from model IDs, deduplicate friendly
labels, and expose the result in picker/search presentation across clients.
Upstream's existing sub-provider metadata does not cover all these inferred
qualifiers. See [model.ts](../../packages/shared/src/model.ts).

Fork CI uses GitHub-hosted runners, reduces checks and event triggers, and removes
18 workflow/action files. These are intentional operational differences, not
product features superseded upstream. The fork also stabilizes a Shiki test's
clock and adds a Knip entry for a CLI smoke tool whose release workflow was removed.
Assess these independently from product pruning.

## Parallel work boundaries

Each numbered area can begin with read-only investigation independently. Before
editing shared files, agree ownership between the affected threads. In particular:

- Cleanup and Forgejo both touch settlement/PR matching.
- Forgejo and PR opening share repository identity and URL helpers.
- Branch creation and command-palette actions share new-thread initialization.
- OhMyPi and CLI thread-ID support share provider adapters.
- Multiple areas extend settings contracts; keep those edits coordinated.

Record concrete follow-up work in its owning issue or PR. This document is a
dated discovery snapshot; remove or revise superseded findings rather than
appending parallel implementation histories here.
