# OpenCode plugins by MAD Software

Small, focused extensions for OpenCode V2: delegate work in the background, keep
an eye on subagents, get feedback after edits, and shape how sessions use their
environment and context.

[![CI](https://github.com/madsoftwaredev/opencode-plugins/actions/workflows/ci.yml/badge.svg)](https://github.com/madsoftwaredev/opencode-plugins/actions/workflows/ci.yml)
[![npm: background-subagent](https://img.shields.io/npm/v/@madsoftwaredev/opencode-background-subagent)](https://www.npmjs.com/package/@madsoftwaredev/opencode-background-subagent)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Seven independent packages from MAD Software. Install just the ones that fit your workflow.

## Plugins

| Plugin | Runs in | What it does |
| --- | --- | --- |
| [Background subagent](packages/background-subagent/README.md) · [npm](https://www.npmjs.com/package/@madsoftwaredev/opencode-background-subagent) | Server | Runs subagents in the background when `background` is omitted. Explicit foreground calls still work. |
| [Subagent sidebar](packages/subagent-sidebar/README.md) · [npm](https://www.npmjs.com/package/@madsoftwaredev/opencode-subagent-sidebar) | TUI | Shows live child sessions, their status and activity; click to open, expand to see more. |
| [Stats](packages/stats/README.md) · [npm](https://www.npmjs.com/package/@madsoftwaredev/opencode-stats) | TUI | Shows token speed and session-wide turn and step counts in the prompt footer; toggle each in the TUI. |
| [Lint feedback](packages/lint-feedback/README.md) · [npm](https://www.npmjs.com/package/@madsoftwaredev/opencode-lint-feedback) | Server | Appends project-local ESLint diagnostics after successful edits. Checks only; it does not fix files. |
| [direnv](packages/direnv/README.md) · [npm](https://www.npmjs.com/package/@madsoftwaredev/opencode-direnv) | Server | Applies the approved environment for the shell command's working directory. |
| [Compaction model](packages/compaction-model/README.md) · [npm](https://www.npmjs.com/package/@madsoftwaredev/opencode-compaction-model) | Server | Summarizes checkpoints with a selectable model and reasoning variant. |
| [`/btw`](packages/btw/README.md) · [npm](https://www.npmjs.com/package/@madsoftwaredev/opencode-btw) | TUI | Runs a side conversation in a background fork of the current session. |

All seven packages are published at **`0.1.1`** under [`@madsoftwaredev`](https://www.npmjs.com/org/madsoftwaredev).
In `0.1.1`, background-subagent, subagent-sidebar, lint-feedback, and direnv
drop `local.` from their active plugin IDs. Update any config rules that refer
to the old IDs; npm package names have not changed.

## Install

Requires OpenCode V2. Install each package you want with `opencode plugin add`:

```sh
# Server plugins — registered in opencode.json
opencode plugin add @madsoftwaredev/opencode-background-subagent
opencode plugin add @madsoftwaredev/opencode-lint-feedback
opencode plugin add @madsoftwaredev/opencode-direnv
opencode plugin add @madsoftwaredev/opencode-compaction-model

# TUI plugins — registered in cli.json
opencode plugin add @madsoftwaredev/opencode-subagent-sidebar
opencode plugin add @madsoftwaredev/opencode-stats
opencode plugin add @madsoftwaredev/opencode-btw
```

You can also install a single package by copying just its command from above.
Restart the OpenCode TUI after installing a TUI plugin. To manage packages:

```sh
opencode plugin list
opencode plugin check
opencode plugin update
```

The CLI checks and updates installed packages; exact version pins remain pinned.

## Configure compaction

The compaction plugin defaults to
`opencode-go/deepseek-v4.1-flash#max`. To use a different connected model, set
`options.model` in its entry in `opencode.json`. Replace the package's string
entry with the object form below, preserving your other plugins:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "@madsoftwaredev/opencode-compaction-model",
      "options": {
        "model": "provider/model#variant"
      }
    }
  ]
}
```

Use `provider/model` from a connected provider; `#variant` is optional. On
failure, the plugin logs a diagnostic and lets OpenCode use its normal session
model for compaction. See the [full compaction guide](packages/compaction-model/README.md)
for details and a working configuration example.

## Requirements

- **direnv:** install `direnv` where the OpenCode server runs. Review each
  project's `.envrc` and approve it with `direnv allow`.
- **Lint feedback:** requires Node on the shell's `PATH`, project-installed
  ESLint 9 or 10, and a flat `eslint.config.*` file.
- **Subagent sidebar**, **stats**, and **`/btw`:** require the OpenCode terminal UI.

Each plugin README documents its behavior, setup, and limitations.

## Develop

Development and tests require Bun, Node.js 22+, and `direnv`:

```sh
git clone https://github.com/madsoftwaredev/opencode-plugins.git
cd opencode-plugins
bun install --frozen-lockfile
bun run check
```

`bun run check` runs the entrypoint build check and all package tests. Tests use
temporary projects and do not require a live OpenCode server.

To try a package directly from the latest source before a release:

```sh
opencode plugin add 'github:madsoftwaredev/opencode-plugins#main::path:packages/direnv'
```

Replace `direnv` with the package directory you want to try.

Issues and ideas are welcome in the [GitHub issue tracker](https://github.com/madsoftwaredev/opencode-plugins/issues).

<details>
<summary>Maintainers: publishing releases</summary>

All seven packages share one version. To prepare a release, update `version` in
the root manifest and each `packages/*/package.json`, refresh the lockfile, and
run the checks:

```sh
bun install
bun run check
npm pack --workspaces --dry-run
```

Commit the version bump and push a matching tag. For example, after changing
every package to `0.1.2`:

```sh
git add package.json packages/*/package.json bun.lock
git commit -m "release: v0.1.2"
git tag v0.1.2
git push origin main v0.1.2
```

The [release workflow](.github/workflows/release.yml) verifies the packages and
publishes them with provenance. Configure npm Trusted Publishing for **each
package** with GitHub organization `madsoftwaredev`, repository
`opencode-plugins`, workflow filename `release.yml`, and direct `npm publish`
enabled. Trusted Publishing requires Node.js 22.14.0+ and npm 11.5.1+ on the
runner.

</details>

## License

[MIT](LICENSE)
