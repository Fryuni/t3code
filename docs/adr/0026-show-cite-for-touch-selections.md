# ADR 0026: Show Cite for touch text selections

- Status: accepted
- Date: 2026-10-26
- Compared with upstream: `pingdotgg/t3code` at `58e60bf5e` (2026-10-29)

Selecting assistant text in a mobile browser (seen on Chrome for Android) never
showed the **Cite** button. A touch selection starts with a long-press. That
long-press fires `contextmenu` and `pointercancel`, and both dismissed the
selection action. The handles that adjust the selection afterwards fire no
pointer events, so the `mouseup` that shows the action on desktop never came.

[`observeSelectionActions`](../../apps/web/src/lib/selectionActions.ts) now
remembers whether the last primary pointer was touch. For touch it ignores
`contextmenu`, does not dismiss on `pointercancel`, and shows the action once
`selectionchange` or scrolling has settled for 150 ms. An explicit dismissal,
such as Escape, still holds until the next press. Mouse and pen behaviour is
unchanged.

When updating from upstream, keep the touch path if upstream's observer still
waits for `mouseup`. Remove this if upstream handles touch selections itself.
