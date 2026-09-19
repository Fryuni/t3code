# 01: Remove settlement-triggered worktree deletion

**What to build:** Settling a thread must no longer delete its worktree immediately. Worktree removal should happen only through the configurable delayed cleanup behavior inherited from upstream, without changing settlement detection or pull-request matching.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] Settling a thread or stopping its provider session does not enqueue or perform immediate worktree removal.
- [ ] Configured storage cleanup remains able to remove eligible worktrees according to its existing age, merge, deletion, and unchanged-branch settings and safety checks.
- [ ] Settlement behavior unrelated to worktree deletion remains unchanged, including normalized repository matching for linked pull requests.
- [ ] Focused tests cover the absence of settlement-triggered deletion and the continued delayed-cleanup path.
