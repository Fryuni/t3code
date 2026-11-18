# ADR 0029: Codex Full access answers approvals itself

- Status: accepted
- Date: 2026-11-18
- Compared with upstream: `pingdotgg/t3code` at `2ebe7f8e2` (2026-11-17)

Upstream [pingdotgg/t3code#37104](https://github.com/pingdotgg/t3code/pull/37104) changed
Codex **Full access** from `approvalPolicy: "never"` to a `granular` policy, so MCP
elicitations (browser and app access) reach T3 Code. With `granular` and
`sandbox_approval: false`, Codex still sends a command approval for any command its
dangerous-command heuristic matches, such as `rm -f` inside a `trap`. Under `never` it rejected
those instead. Upstream showed the request to the user, so Full access threads stopped to ask.

The fork owner's rule: Full access never asks for approval. An elicitation asks what to do, not
whether to proceed, so it may still be answered. The
[Codex adapter](../../apps/server/src/orchestration-v2/Adapters/CodexAdapterV2.ts) accepts
command, file-change, and permissions approvals (v2 and legacy) in Full access without
showing them. Dangerous commands now run, where `never` refused them. A mode between Auto
and Full access that still asks for dangerous commands would be a new selector entry, not a
change to Full access.

Drop this if upstream answers these approvals itself in Full access, or returns to `never`.
