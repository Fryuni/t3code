# ADR 0025: Select OhMyPi model presets per thread

- Status: accepted
- Date: 2026-10-26
- Compared with upstream: `pingdotgg/t3code` at `6ffde5ba3` (2026-10-26)

OhMyPi (`omp`) is a Pi fork that T3 runs through the Pi provider. Its model
presets assign models to every role (`default`, `task`, `plan`, `smol`, ...)
and a default thinking level. Neither Pi RPC nor omp's ACP mode exposes them,
so T3 could only change the main model.

When the Pi binary reports an `omp/<version>` version, discovery reads
`omp config get modelPresets --json` and lists each preset as a model with the
slug `preset:<name>` and a "Preset" qualifier. Its Thinking select is the one
for the preset's main model and starts at the preset's level. Config reads pass
the instance's `--profile` and time out on their own, so a slow read only loses
the presets, not the discovered models.

Applying a preset with omp's own `/modelpreset switch` writes roles to the
user's global config, and every running omp process reloads it, so one thread
would change all the others and the user's terminal. T3 instead starts the
thread's omp process with a `--config` overlay file in T3's cache. The overlay
holds the preset's roles, `null` tombstones for roles the preset leaves out (as
`/modelpreset switch` clears them), and its thinking level. The overlay is
rebuilt from the current preset each time the process starts. Changing which
preset a thread uses returns `restart_session`, so the session resumes on a
new process with the new overlay, and the first turn sends `set_model` for the
preset's `default` role. A preset whose main model is an alias rather than
`provider/model` fails with a clear error. Text generation has no per-model
filter, so a preset chosen there uses only its main model.

When updating from upstream, keep presets inside the Pi provider and keep the
per-process overlay; do not switch presets by writing omp's global config.
Remove this if Pi or omp exposes presets over RPC, or if upstream adds OhMyPi
support.
