# Pi

Run your existing [Pi](https://pi.dev) (**0.84.3+**, Node.js **22.19+**) installation in T3 Code while keeping Pi's models, auth, extensions, skills, and native session history.

## Set up Pi

1. Install Pi on the server machine (via Pi's installer or `npm install -g --ignore-scripts @earendil-works/pi-coding-agent`).
2. Run `pi` and `/login` in a terminal on the server (over SSH for remote hosts, or set your model provider's API key in the Pi instance's environment variables).
3. Open **Settings → Providers**, enable **Pi**, and refresh. Set **Binary path** if `pi` isn't on `PATH`.

- In **Launch arguments**, `--provider` must be paired with `--model`. Flags that alter Pi's execution mode or session selection are rejected because T3 Code manages them.
- Update installer-managed Pi with `pi update`, or via your package manager (e.g. `nix profile upgrade pi`).

## Features and extensions

- **Models, thinking & speed**: Discovers Pi models, thinking levels, and `serviceTiers` (exposed as a speed picker).
- **Native sessions**: Resume, rollback, and same-instance forks use Pi's native session files; switching providers uses a [portable handoff](./portable-handoffs.md).
- **Skills & extensions**: Pi user and trusted project skills appear in `$`. Extension `select`, `confirm`, `input`, and `editor` dialogs render in the composer, notifications appear in the activity log, and status text appears near the composer.
- **Subagents**: T3 Code's `delegate_task` creates full child threads; Pi's example `subagent` extension also displays task progress/results (read-only).

## OhMyPi model presets

If Pi's binary path points to [OhMyPi](https://github.com/can1357/oh-my-pi) (`omp`), its saved model presets appear in the model picker labelled **Preset**. Save one in `omp` with `/modelpreset save <name>`, then refresh the provider in Settings. Only presets in your user configuration are listed, not project-only ones.

- Choosing a preset applies its role models and thinking level to that thread only; other threads and `omp` sessions keep theirs. Use the picker rather than `/modelpreset switch`, which changes OhMyPi's global configuration.
- Switch presets, or between a preset and a single model, at any point. Edits to a preset apply the next time a thread switches to it or its session restarts.
- A preset needs a main (`default`) model written as `provider/model`. The `--smol`, `--slow`, and `--plan` launch arguments, and `PI_SMOL_MODEL`, `PI_SLOW_MODEL`, and `PI_PLAN_MODEL`, override those roles in every preset.

## Permission modes

- **Supervised**: Asks before commands, file edits, and extension tools (reads proceed).
- **Auto-accept edits**: Allows Pi's edit/write tools; asks for commands and extension tools.
- **Full access**: Allows all tool calls without prompts.

**Auto** is not supported (behaves as Supervised). Changing modes restarts the Pi session and resumes the same conversation. Note that permissions govern Pi tool calls—not an OS sandbox.

## Troubleshooting

- **Untrusted project folder**: If Pi skips project extensions/skills/MCP, run `pi` in that folder on the server (with the same `PI_CODING_AGENT_DIR` if set), run `/trust`, and start a new thread in that worktree. Add `--no-approve` to launch arguments to keep project files disabled without the notice.
- **Discovery fails**: T3 Code keeps Pi usable with `Pi default` so an interactive session can handle startup prompts.
- **Context window**: Enable **Settings → Appearance → Thread details → Context window** (some model providers report usage only after the first reply completes).
