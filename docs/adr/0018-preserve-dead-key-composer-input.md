# ADR 0018: Preserve dead-key input in the composer

- Status: accepted
- Date: 2026-10-14

The composer's selection-surround shortcut treated every nonempty text-input
replacement range as selected text. Dead keys also replace provisional text when
the next key commits their result: quote followed by Space could therefore insert
three quotes and select the middle one instead of committing a single quote.

Only surround text when the editor has a nonempty selection and no composition is
active or pending. Also check the default input transaction's composition metadata:
a final DOM replacement can arrive after the composing flag clears while the state
still holds the pre-composition selection. ProseMirror already tracks that pending
edit, so the composer needs no separate composition state or timeout. Keep native
replacement behavior for composition, and preserve surrounding
deliberately selected text with quotes, brackets, and formatting markers. The
[shared handler](../../apps/web/src/composer-selection-surround.ts) applies to both
plain and rich-text composers on web and desktop; mobile uses a separate native
editor. No provider, transport, or connection-mode behavior changes.

A quote entered through a dead-key sequence replaces selected text, as in a native
input. The surrounding shortcut applies to direct character input.

When updating from upstream, preserve the selection, composing, and transaction
metadata guards. Keep regressions for both collapsed carets and selected text,
including DOM replacements flushed after composition ends.
Remove the fork implementation if upstream supplies equivalent behavior and passes
those regressions.
