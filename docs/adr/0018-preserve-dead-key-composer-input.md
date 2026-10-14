# ADR 0018: Preserve dead-key input in the composer

- Status: accepted
- Date: 2026-10-14

The composer's selection-surround shortcut treated every nonempty text-input
replacement range as selected text. Dead keys also replace provisional text when
the next key commits their result: quote followed by Space could therefore insert
three quotes and select the middle one instead of committing a single quote.

Only surround text when the editor has a nonempty selection and no composition is
active. The selection check also covers commits delivered after the composing flag
clears. Keep native replacement behavior for composition, and preserve surrounding
deliberately selected text with quotes, brackets, and formatting markers. The
[shared handler](../../apps/web/src/composer-selection-surround.ts) applies to both
plain and rich-text composers on web and desktop; mobile uses a separate native
editor. No provider, transport, or connection-mode behavior changes.

When updating from upstream, preserve both guards and the regression coverage for
committed quotes with a collapsed caret, including commits after composition ends.
Remove the fork implementation if upstream supplies equivalent behavior and passes
those regressions.
