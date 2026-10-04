# Install T3 Code

T3 Code runs coding agents on your computer and lets you control them from its
desktop, web, or mobile app. Set up the machine where the agents will work first.

## Requirements

You need an installed, authenticated provider before starting a thread. You can
launch T3 Code and configure providers afterwards.

## Command line

```bash
curl -fsSL https://t3.codes/install.sh | sh
```

On Windows, in PowerShell:

```powershell
irm https://t3.codes/install.ps1 | iex
```

This puts `t3` in `~/.local/bin`. If your shell reports `command not found`
afterwards, that directory is not on your `PATH` yet; the installer prints the
line to add. Set `T3CODE_CHANNEL=nightly` to install the nightly train, or
`T3CODE_VERSION` to pin an exact version.

| Task                                             | Command                                                   |
| ------------------------------------------------ | --------------------------------------------------------- |
| Start the server and open the web app            | `t3`                                                      |
| Start the server without a browser               | `t3 serve`                                                |
| Keep it running in the background (macOS, Linux) | `t3 service install` ([details](./background-service.md)) |
| Move to the newest release                       | `t3 update`                                               |
| Remove it again                                  | `t3 uninstall`                                            |

Run `t3 --help` for the full reference.

To try T3 Code once without installing it, run `npx t3@latest` instead (needs
Node.js for `npx`).

### Install the Fryuni fork

The `Fryuni/t3code` fork publishes its own Linux x64 builds as
[GitHub releases](https://github.com/Fryuni/t3code/releases), a few hours after
each change to the fork. To install one, look up the fork's latest release and
point the installer at it:

```bash
version="$(curl -fsSL https://api.github.com/repos/Fryuni/t3code/releases/latest | sed -n 's/.*"tag_name": *"v\([^"]*\)".*/\1/p')"
curl -fsSL https://raw.githubusercontent.com/Fryuni/t3code/main/scripts/install.sh |
  T3CODE_VERSION="$version" T3CODE_RELEASE_BASE_URL=https://github.com/Fryuni/t3code/releases/download sh
```

The variables are only needed for this first install. The `t3` it installs
always downloads from the fork, including for `t3 service install`. `t3 update`
and **Update server** in a connected app move to the fork's latest release,
never an upstream one.

T3 Code does not update itself on a schedule. To receive each fork release
unattended, run `t3 update --yes` regularly; it does nothing when you are
already current. For example, this `crontab -e` line checks every night at
4 AM:

```text
0 4 * * * XDG_RUNTIME_DIR=/run/user/$(id -u) $HOME/.local/bin/t3 update --yes
```

`XDG_RUNTIME_DIR` lets cron reach the
[background service](./background-service.md) to restart it on the new version. The restart interrupts running agent turns,
so pick an hour when none are running. The fork publishes no builds for macOS
or Windows; use the standard installer there.

Like Nightly builds, fork builds need the [beta mobile app](#mobile-app). The
store apps cannot connect to them.

To return to upstream builds, rerun the standard installer with
`T3CODE_CHANNEL=nightly`, then run `t3 service install` to move the background
service to it. Fork builds share Nightly's database, so your threads come
along; the current Stable build does not read that database.

### Intel Macs

There is no `t3` executable for Intel Macs (the desktop app is available). To
run a server there, build it from source with Node.js 24 and `vp`
([Install vp](https://github.com/pingdotgg/t3code#install-vp)):

```bash
git clone https://github.com/pingdotgg/t3code
cd t3code && vp i && vp run build:desktop
node apps/server/dist/bin.mjs
```

`t3 update` and the background service do not apply to a server run this way;
update it with `git pull` and a rebuild.

## Desktop app

Download a release from [GitHub Releases](https://github.com/pingdotgg/t3code/releases),
or use a package manager:

| Platform           | Install                            |
| ------------------ | ---------------------------------- |
| Windows            | `winget install T3Tools.T3Code`    |
| macOS              | `brew install --cask t3-code`      |
| Debian, Ubuntu     | `sudo apt install ./T3-Code-*.deb` |
| Arch Linux         | `yay -S t3code-bin`                |
| Arch Linux nightly | `yay -S t3code-nightly-bin`        |

The `.deb` updates itself like the other desktop builds. It asks for your
password to install each update. If your desktop has no password prompt, the
update fails. Download the new `.deb` and install it the same way.

### Windows Subsystem for Linux

Choose a WSL distro in **Settings → Connections** to run agents and projects
there. Install the provider CLIs inside that distro. T3 Code installs its own
server runtime there automatically; the first launch after an app update can
take longer.

### Open a project from a terminal

With the desktop app already running on the same machine:

```bash
t3 app
```

This opens a new thread for the current directory, adding the project if needed.
Pass a path, such as `t3 app ../my-project`, to open another directory. It requires
the desktop app, so a standalone server or an SSH session is not enough. If the
command cannot reach the app, start or update the desktop app and try again.

## Mobile app

Install T3 Code from the
[App Store](https://apps.apple.com/us/app/t3-code-remote-claude-more/id6787819824) or
[Google Play](https://play.google.com/store/apps/details?id=com.t3tools.t3code).
The phone connects to a server on another machine. Follow
[remote access](./remote-access.md) to link it through T3 Connect or a pairing URL.

Nightly builds need the beta app. The store apps cannot connect to them. A Nightly build also
shows these links as QR codes in **Settings → General → Mobile app**.

- **iPhone and iPad:** join the [TestFlight beta](https://testflight.apple.com/join/XgaxaRtd).
- **Android:** join the [beta group](https://groups.google.com/g/t3-code-v2-beta). With the same
  Google account, open the [Google Play testing page](https://play.google.com/apps/testing/com.t3tools.t3code)
  and become a tester.

If the app crashes during launch, open Settings → Diagnostics on the next launch
that succeeds. It lists startup crashes from the last 7 days with the error and
component stack that store crash reports leave out. Copy the report and paste it
into a GitHub issue. Error messages can quote values from the app, so read it over
before sharing.

## Providers

Open **Settings → Providers** in the web or desktop app, select the environment,
and enable the provider you want. Installation, login, and configuration belong
to that environment's machine, even when you connect from a phone or another
computer.

| Provider    | Install and authenticate                                                                                                                                  |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex       | [Connect with ChatGPT](./providers-codex.md#connect-with-chatgpt), or install [Codex CLI](https://developers.openai.com/codex/cli) and run `codex login`. |
| Claude      | Install [Claude Code](https://claude.com/product/claude-code), then run `claude auth login`.                                                              |
| Cursor      | Install [Cursor CLI](https://cursor.com/cli), then run `agent login`.                                                                                     |
| Grok Build  | Install [Grok Build CLI](https://x.ai/cli), then run `grok login`.                                                                                        |
| OpenCode    | Install [OpenCode](https://opencode.ai), then run `opencode auth login`.                                                                                  |
| Antigravity | Install and sign in with Google from T3 Code's provider settings.                                                                                         |
| Pi          | Install [Pi](https://pi.dev), then run `pi` once to finish its login or API-key setup.                                                                    |

Provider CLIs must be on the server's `PATH`. If T3 Code cannot find one, set its
**Binary path** in provider settings, especially when using a version manager.
Cursor's executable is `cursor-agent`, although its login command is
`agent login`. Codex connected through ChatGPT and Antigravity can use their
managed runtimes without a `PATH` entry.

T3 Code warns when a provider version has known compatibility problems with your
release. Check **Settings → Providers** on that environment for the recommended
version or range. When its package manager supports installing a specific version,
you can install the recommendation there. Otherwise use the provider's installer
on the environment's machine. An unlisted version is unverified.

When a provider CLI is behind its latest release, its provider card shows the
available version. **Update now** appears only when T3 Code can tell which
installer owns the CLI (its own update command, Homebrew, or a global npm, pnpm,
bun, or Vite+ install) and runs that installer. Otherwise update the CLI the same
way you installed it. Homebrew installs compare against the version Homebrew
offers, which can trail the npm release by a few hours.

Add another provider instance for a separate account or configuration. Each
instance can have its own environment variables, such as API keys or a custom
base URL. Mark secret values as sensitive; after saving, T3 Code does not display
their original values.

For provider-specific setup and accounts, see [Codex](./providers-codex.md),
[Claude](./providers-claude.md), [OpenCode](./providers-opencode.md),
[Antigravity](./providers-antigravity.md), and [Pi](./providers-pi.md).

## Next steps

- [Working with threads](./thread-sidebar.md): start tasks and organize parallel work.
- [Permission modes](./permission-modes.md): choose when agents ask before acting.
- [Remote access](./remote-access.md): connect from another device.
- [Running in the background](./background-service.md): keep a Linux or macOS host available.
- [Updating T3 Code](./updating.md): update the app and connected servers.
