# ADR 0015: Record every fork change in an ADR

- Status: accepted
- Date: 2026-10-09

Updating this fork from upstream requires knowing why each local change exists
and whether upstream has replaced it. Every fork change must therefore be covered
by a new or updated ADR, including small code, configuration, and documentation
changes. [AGENTS.md](../../AGENTS.md#documentation) makes ADR coverage a completion
requirement; each record explains the reason for the change and what to preserve,
adapt, or remove during upstream updates. Keep this requirement when syncing
upstream's documentation guidance, and mark superseded fork decisions accordingly.
