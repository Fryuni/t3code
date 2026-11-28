# ADR 0031: Negotiate OhMyPi RPC protocol v2 and reassemble chunked frames

- Status: accepted
- Date: 2026-11-20
- Compared with upstream: `pingdotgg/t3code` at `2547fb284` (2026-11-28)

OhMyPi (`omp` v19+) enforces a 1 MiB (`maxFrameBytes: 1048576`) single-frame limit on RPC protocol
v1. Environments with large model catalogs (for example when `OPENROUTER_API_KEY` exposes hundreds
of OpenRouter models) exceed 1 MiB on `get_available_models`, causing `omp` to reply with
`"RPC response exceeded the transport limit"` and discovery to degrade to the warning that models
and commands could not be refreshed.

When a Pi RPC connection receives a `ready` frame advertising `supportedProtocolVersions` with `2`,
[rpc.ts](../../packages/provider-pi/src/server/rpc.ts) sends `negotiate_protocol` for version `2`
and reassembles incoming `rpc_chunk` frames (base64 UTF-8 slices up to 64 MiB) before routing them.
Requests queued after `ready` wait for negotiation to settle; a request sent before `ready` that
fails with `"RPC response exceeded the transport limit"` retries once after v2 negotiation succeeds.
Plain Pi never emits `ready` with protocol v2, so its transport behavior is unchanged.

Preserve when updating from upstream unless upstream adds Pi/OhMyPi RPC protocol v2 negotiation and
`rpc_chunk` reassembly itself, in which case drop this fork change in favor of upstream's
implementation.
