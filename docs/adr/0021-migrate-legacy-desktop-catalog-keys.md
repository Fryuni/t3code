# ADR 0021: Migrate legacy desktop catalog encryption keys

- Status: accepted
- Date: 2026-10-18
- Compared with upstream: `pingdotgg/t3code` at `2547fb284` (2026-11-28); the rename landed in `81493efb7`

On Linux, Electron selects its libsecret encryption key using the application's
name. Changing the packaged name from `T3 Code (Alpha)` to `T3 Code (Beta)` leaves
the existing connection catalog encrypted with the Alpha key. The key and saved
connections still exist, but the desktop cannot list or add connections.

When normal catalog decryption fails, or succeeds with plaintext that is not a
valid connection document (AES-CBC accepts a wrong key about 1 in 256 times),
try existing libsecret keys for the two historical Alpha names. Validate the
recovered connection document, then rewrite its original plaintext through the current Electron
safeStorage and the catalog's atomic writer. This preserves connection targets,
profiles, credentials, and unknown document fields. Serialize catalog reads
and writes so migration cannot overwrite a newer connection update.

Recovery only reads already-unlocked legacy entries: it never creates keys or
changes keyring contents. A failed legacy lookup, an invalid recovered document,
and a failed write preserve the original encrypted file and surface an error.
Bound the legacy keyring lookup so an unavailable secret service cannot hang
startup, and load the D-Bus client only through a dynamic import so other
platforms never evaluate it.

This migration is limited to Linux libsecret and the desktop connection catalog.
Other surfaces and operating systems retain their existing storage behavior.

Upstream merged its own recovery for catalogs encrypted under the Beta name on macOS
and Linux ([pingdotgg/t3code#20907](https://github.com/pingdotgg/t3code/pull/20907)),
which also pinned the safeStorage name at startup, then reverted it
([pingdotgg/t3code#22219](https://github.com/pingdotgg/t3code/pull/22219)) because
existing installs could no longer decrypt catalogs written under the current identity.
Upstream at `2547fb284` has neither, so the fork keeps this migration. Upstream deleted
the catalog store's unused `clear`
([pingdotgg/t3code#26238](https://github.com/pingdotgg/t3code/pull/26238)), and the fork's
serialized version went with it.

Upstream now copies a catalog it cannot decrypt or decode to `connection-catalog.json.unreadable-<ms>`
before a save replaces it ([pingdotgg/t3code#34944](https://github.com/pingdotgg/t3code/pull/34944)).
That is a second safety net, not a migration, so the fork keeps both: the copy runs with the write
under the store's mutex.

Upstream then made a catalog the current key cannot decrypt read as empty after copying it to
`connection-catalog.json.<sha256>.undecryptable`, so a user whose keyring entry was lost can
reconnect ([pingdotgg/t3code#23476](https://github.com/pingdotgg/t3code/pull/23476)). The fork's
`get` now tries the legacy keys first, when the current key fails or yields plaintext that is not a
connection document, and hands anything they cannot recover to upstream's `decryptDocument`. So a
catalog no key opens is backed up and read as empty, as upstream does, and undecodable plaintext
from the current key is returned, as upstream's is, and copied aside by the next save. The fork no
longer fails those reads: upstream's backups keep the data the failure protected.

Keep it when syncing upstream until upstream supports equivalent key migration
or uses an encryption identity stable across product renames. Do not replace
the current Beta key with the Alpha key: that would break data already encrypted
by the Beta application.
