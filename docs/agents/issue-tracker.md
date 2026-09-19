# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues on **`Fryuni/t3code`**. Use the `gh` CLI for all operations.

**Always pass `--repo Fryuni/t3code`.** This clone has two remotes (`origin` → `Fryuni/t3code`, `upstream` → `pingdotgg/t3code`), so `gh` can resolve to the upstream repo and file issues in the wrong place. Never rely on inference here, and don't run `gh repo set-default` — `.git/config` is shared with the main checkout and every other worktree.

## Conventions

- **Create an issue**: `gh issue create --repo Fryuni/t3code --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --repo Fryuni/t3code --comments`.
- **List issues**: `gh issue list --repo Fryuni/t3code --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --repo Fryuni/t3code --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --repo Fryuni/t3code --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --repo Fryuni/t3code --reason completed --comment "..."`

Triage state is a label, not a line in the body (see `triage-labels.md`). Acceptance criteria stay as task-list checkboxes in the body; tick them as they land.

A merged PR remains the durable implementation record (see "Plans and work artifacts" in `AGENTS.md`). An issue tracks the work and closes when the PR lands; it is not a second checklist to maintain afterwards.

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature requests; `/triage` reads this flag.)_

When set to `yes`, PRs run through the same labels and states as issues, using the `gh pr` equivalents:

- **Read a PR**: `gh pr view <number> --comments` and `gh pr diff <number>` for the diff.
- **List external PRs for triage**: `gh pr list --state open --json number,title,body,labels,author,authorAssociation,comments` then keep only `authorAssociation` of `CONTRIBUTOR`, `FIRST_TIME_CONTRIBUTOR`, or `NONE` (drop `OWNER`/`MEMBER`/`COLLABORATOR`).
- **Comment / label / close**: `gh pr comment`, `gh pr edit --add-label`/`--remove-label`, `gh pr close`.

GitHub shares one number space across issues and PRs, so a bare `#42` may be either: resolve with `gh pr view 42` and fall back to `gh issue view 42`.

## When a skill says "publish to the issue tracker"

Create a GitHub issue on `Fryuni/t3code`. Group the issues of one effort by naming the effort in the first line of the body (`Part of the **<effort-slug>** effort.`) so they can be found together later.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --repo Fryuni/t3code --comments`.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue with **child** issues as tickets.

- **Map**: a single issue labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog body. `gh issue create --repo Fryuni/t3code --label wayfinder:map`.
- **Child ticket**: an issue linked to the map as a GitHub sub-issue (`gh api` on the sub-issues endpoint). Where sub-issues aren't enabled, add the child to a task list in the map body and put `Part of #<map>` at the top of the child body. Labels: `wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`). Once claimed, the ticket is assigned to the driving dev.
- **Blocking**: GitHub's **native issue dependencies**, which this repo supports and which the GitHub UI surfaces. Add an edge with `gh api --method POST repos/Fryuni/t3code/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`, where `<blocker-db-id>` is the blocker's numeric **database id** (`gh api repos/Fryuni/t3code/issues/<n> --jq .id`, _not_ the `#number` or `node_id`). Read the live gate from `issue_dependencies_summary.blocked_by`, which counts open blockers only.
- **Frontier query**: list the map's open children (`gh issue list --repo Fryuni/t3code --state open`, scoped to the map's sub-issues / task list), drop any with an open blocker (`issue_dependencies_summary.blocked_by > 0`) or an assignee; first in map order wins.
- **Claim**: `gh issue edit <n> --repo Fryuni/t3code --add-assignee @me`, the session's first write.
- **Resolve**: `gh issue comment <n> --repo Fryuni/t3code --body "<answer>"`, then `gh issue close <n> --repo Fryuni/t3code`, then append a context pointer (gist + link) to the map's Decisions-so-far.
