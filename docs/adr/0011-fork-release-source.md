# ADR 0011: Fork builds release and update from their own repository

- Status: accepted
- Date: 2026-10-04
- Tracking: [Fryuni/t3code#47](https://github.com/Fryuni/t3code/pull/47)
- Compared with upstream: `pingdotgg/t3code` at `37eaf5d29` (2026-10-08)

**Operational rule.** This feature and any reset or sync onto upstream must land on
`main` in the same push, and
[`server-linux-release.yml`](../../.github/workflows/server-linux-release.yml) must
never publish from a tree without the release-repository define. The workflow runs on
a schedule from `main`. A build without the define follows upstream, and every fork
install that updates to it leaves the fork (see [Failure mode](#failure-mode)).

Upstream's `t3` knows one release source. [`cliRelease.ts`](../../packages/shared/src/cliRelease.ts)
hardcodes `pingdotgg/t3code` for the download base URL and the release index.
`T3CODE_RELEASE_BASE_URL` only redirects downloads at runtime: it does not change which
version is chosen, and it is read from each command's environment, so it is gone after
the first install. `t3 update` walks upstream's channel trains. Remote self-updates
install whatever version the client asks for, and clients always ask for their own
upstream version, both from the
**Update server** offer and from the protocol-mismatch updater in
[`outdatedHostUpdate.ts`](../../packages/client-runtime/src/connection/outdatedHostUpdate.ts).
A fork never publishes those versions, so a fork install either 404s on the fork's
release page or, without the base-URL override, quietly updates back onto upstream.
Upstream has no reason to support other release sources, and its release pipelines
(signing, npm, desktop, mobile, relay and Clerk config) cannot run here. Fork commits
`0d1a4859a` and `0168d4b3f` deleted `release.yml` and the test that read it, so
`server-linux-release.yml` is the fork's only release path.

## Decision

The fork bakes its own `owner/repo` into the server bundle at build time. The workflow
sets `T3CODE_RELEASE_REPOSITORY`, [`apps/server/vite.config.ts`](../../apps/server/vite.config.ts)
turns it into the `__T3CODE_BUILD_RELEASE_REPOSITORY__` define, and `cliRelease.ts`
exposes it as `CLI_RELEASE_FORK_REPOSITORY`. A `typeof` guard leaves it `undefined`
in the web, mobile, and desktop bundles, which have no define. In a fork build:

- Every download (pinned runtimes, `t3 service install`, self-updates) comes from the
  fork's GitHub releases.
- The whole update policy is the fork's GitHub `releases/latest`, which excludes
  drafts and prereleases, read by
  [`latestRelease.ts`](../../apps/server/src/cloud/latestRelease.ts). `t3 update`
  moves to it and rejects `--channel`. An explicit `t3 update <version>` is still
  honored, but only fork versions can be downloaded.
- Remote self-updates ([`selfUpdate.ts`](../../apps/server/src/cloud/selfUpdate.ts))
  ignore the client's requested version and move to the fork's latest release.
- The server advertises the source as the optional descriptor field
  `releaseRepository` ([`environment.ts`](../../packages/contracts/src/environment.ts)).
  Fork-aware clients stop offering upstream versions: the web's
  `resolveServerConfigVersionMismatch` ([`versionSkew.ts`](../../apps/web/src/versionSkew.ts))
  reports no mismatch, and mobile's **Check for updates** reads the fork's latest
  release.

Builds without the define, including every build from source, behave exactly like
upstream. The workflow publishes a linux-x64 build every four hours when `main` has
moved, versioned `<apps/server version core>-fork.<YYYYMMDD>.<run>`.

Rejected alternatives:

- Runtime configuration (an environment variable or setting). The binary has to know
  where it came from so that `t3 service install`, launcher restarts, and remote
  updates agree. A setting can drift from the installed bits and is lost by any
  install that forgets it.
- Fork channels or trains. One linear train needs no channel walk, and GitHub's latest
  release is the simplest policy. `--channel` is refused rather than silently ignored.

## Ignoring the requested version

Re-targeting `server.updateServer` is a deliberate reinterpretation of the contract.
Clients already adopt the result's `targetVersion` and correlate the launcher's update
ID ([client acknowledgement](../internals/server-updates.md#client-acknowledgement)),
so the result and the reconnect check are right. Progress labels show no version. The
client's "server is behind" check no longer bounds the
target, so the server refuses a release that is not newer than the one it runs, with
"This server already runs the latest release, _version_." That is also what a user
sees after clicking an upstream offer while the fork is current. `t3 update` keeps its
own downgrade check and `--allow-downgrade`.

## Known caveats

- **Version scheme.** The core comes from `apps/server/package.json`, now `0.0.45`, so
  post-reset builds are `0.0.45-fork.*`. A `-fork.` suffix is a semver prerelease.
  These builds sort above the existing `0.0.44-fork` release but below upstream's
  stable `0.0.45`, which is still orchestration protocol 1, while upstream labels the
  same V2 code `0.0.46-nightly.*`. `cliReleaseChannelOf` classifies them as stable.
  The server-side re-target makes the order harmless for fork installs, so the scheme
  stays. The cost is that anything resolving upstream stable from a fork build, such
  as a lost define, would install V1, which runs on the stale pre-V2 `state.sqlite`.
- **Protocol.** Upstream stable clients and the store apps speak protocol 1 and cannot
  connect to a V2 fork server at all: the server answers their `/ws` upgrade with 426.
  Only nightly and beta V2 clients and the web UI the fork server serves itself reach
  the re-target. `IS_NIGHTLY_BUILD` ([`NightlyMobileBeta.tsx`](../../apps/web/src/components/NightlyMobileBeta.tsx))
  is false on `-fork` versions, so the fork-served web does not show the hint that the
  store apps cannot connect.
  [Install the Fryuni fork](../user/install.md#install-the-fryuni-fork) says it instead.
- **Client pieces.** The `releaseRepository` checks run only in fork-built clients,
  which in practice means the web UI the fork server serves. app.t3.codes, the upstream
  desktop app, and the beta mobile app run upstream code and keep offering upstream
  versions, and the server re-target handles them. A fork-served web connected to an
  upstream server still offers its own `-fork` version, which that server cannot
  download. This is accepted.
- **Relay.** The upstream T3 Connect relay re-decodes the descriptor and drops the
  unknown `releaseRepository` key. That is harmless: clients read
  `serverConfig.environment` over the WebSocket, and fork builds bake no relay config.

## The existing V1 release

`v0.0.44-fork.20261004.1` was published as Latest at 2026-10-04T10:41Z from pre-reset
`main` (`25402caf7`: V1, orchestration protocol 1, with the define). Scheduled runs
skip while `main` is unchanged. Installs of it follow the fork's `releases/latest`, so
the first post-reset release crosses the V1 to V2 storage migration. A remote
self-update crosses through the launcher's trial and SQLite snapshot rollback
([server updates](../internals/server-updates.md)). `t3 update`, including the
recommended cron job, has no trial: it writes the new active version and restarts the
service onto it, so a failed first V2 start stays on the new version, with nothing to
roll back, until someone runs `t3 update 0.0.44-fork.20261004.1 --allow-downgrade`. V1 data survives either way,
because V2 imports `state.sqlite` read-only into a separate `statev2.sqlite`.
Until that release exists, a V2 client's protocol-mismatch update of such a server
fails at once with "already runs the latest release". If the reset reached `main`
without this feature, the next release would follow upstream. Its updates could leave
the fork, or move it to upstream's V1 stable `0.0.45`, which runs on the stale
pre-V2 `state.sqlite` and hides every thread from the V2 era.

## Failure mode

Losing the define is silent. A tree without it still builds, passes the archive smoke
test, and publishes. The reset produced such a tree: it dropped every file of #47
except the workflow. After building the executable, the workflow therefore requires
`apps/server/dist-exe/bin.mjs` to contain `"$GITHUB_REPOSITORY"` and fails otherwise.
That file is the single-chunk bundle inside the shipped binary; `dist/bin.mjs` is only
a loader stub. Without the define the repository name appears nowhere in the bundle.

## Scope

Fork releases are linux-x64 only, with no macOS, Windows, desktop, npm, or mobile
builds. They bake in no T3 Connect relay or Clerk public config, because the workflow
sets none of `T3CODE_RELAY_URL` or `T3CODE_CLERK_*`. The desktop SSH runner
([`packages/ssh/src/tunnel.ts`](../../packages/ssh/src/tunnel.ts), around line 799)
ships only in the desktop bundle, which has no define, so it keeps installing upstream
runtimes on SSH hosts.

Leaving the fork means reinstalling with the upstream installer. An explicit
`t3 update <upstream version>` on a fork build downloads from the fork and 404s. While
upstream stable is still protocol 1, choose upstream's nightly channel
(`T3CODE_CHANNEL=nightly`) so the server stays on V2, then run `t3 service install`;
[Install the Fryuni fork](../user/install.md#install-the-fryuni-fork) tells users so.

Drop this when the fork stops publishing its own builds, or when upstream supports a
configurable release repository.
