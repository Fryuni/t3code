# ADR 0017: Split terminals with mod+s

- Status: accepted
- Date: 2026-10-11
- Compared with upstream: `pingdotgg/t3code` at `348f217a8` (2026-10-14)

Upstream binds `terminal.split` to `mod+d` and `terminal.splitVertical` to
`mod+shift+d` while a terminal is focused. Outside macOS `mod` is Ctrl, and
Ctrl+D is how a terminal user sends EOF to close a shell or end input. Taking it
for a split surprises exactly the people the terminal serves.

The fork binds the splits to `mod+s` and `mod+shift+s` under `terminalFocus` in
[`DEFAULT_KEYBINDINGS`](../../packages/shared/src/keybindings.ts). Those shortcuts
already belong to `composer.stash` and `thread.settle`, but only under
`!terminalFocus`, so the contexts do not overlap. macOS users move from Cmd+D to
Cmd+S too, so one rule covers every platform.

Startup sync only backfills commands missing from a user's `keybindings.json`,
so existing configs would keep `mod+d`. The late-default list in
[`keybindings.ts`](../../apps/server/src/keybindings.ts) now accepts a `replaces`
entry next to `alongside`: on one startup, an untouched old default is swapped in
place for the new rule when its shortcut is free, and the migration id is
recorded so a user who chooses `mod+d` again keeps it. Customized split
shortcuts are left alone.

When updating from upstream, keep the `mod+s` defaults, the two
`terminal.split*` migration entries, and the `replaces` handling in startup sync.
If upstream moves the splits off `mod+d` itself, adopt its shortcut and replace
these entries with ones that also move fork users off `mod+s`.
