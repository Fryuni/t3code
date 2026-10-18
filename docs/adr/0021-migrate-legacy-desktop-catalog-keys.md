# ADR 0021: Migrate legacy desktop catalog encryption keys

- Status: accepted
- Date: 2026-10-18
- Compared with upstream: `81493efb7` (Alpha-to-Beta branding change)

On Linux, Electron selects its libsecret encryption key using the application's
name. Changing the packaged name from `T3 Code (Alpha)` to `T3 Code (Beta)` leaves
the existing connection catalog encrypted with the Alpha key. The key and saved
connections still exist, but the desktop cannot list or add connections.

When normal catalog decryption fails, or succeeds with plaintext that is not a
valid connection document (AES-CBC accepts a wrong key about 1 in 256 times),
try existing libsecret keys for the two historical Alpha names. Validate the
recovered connection document, then rewrite its original plaintext through the current Electron
safeStorage and the catalog's atomic writer. This preserves connection targets,
profiles, credentials, and unknown document fields. Serialize catalog reads,
writes, and clears so migration cannot overwrite a newer connection update.

Recovery only reads already-unlocked legacy entries: it never creates keys,
changes keyring contents, or treats an unreadable catalog as an empty one.
Missing keys, unsupported platforms/backends, invalid documents, and failed
writes preserve the original encrypted file and surface an error. When the
current key produced the plaintext and no legacy key matches, return that
plaintext unchanged. Bound the legacy keyring lookup so an unavailable secret
service cannot hang startup, and load the D-Bus client only through a dynamic
import so other platforms never evaluate it.

This migration is limited to Linux libsecret and the desktop connection catalog.
Other surfaces and operating systems retain their existing storage behavior.
Keep it when syncing upstream until upstream supports equivalent key migration
or uses an encryption identity stable across product renames. Do not replace
the current Beta key with the Alpha key: that would break data already encrypted
by the Beta application.
