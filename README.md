# OpenCode V2 plugins

Independent OpenCode V2 plugins by [MadSoftwareDev](https://github.com/madsoftwaredev)
for background subagents, the terminal sidebar, lint feedback, project environments,
compaction, and background conversations.

Each plugin is its own package under `@madsoftwaredev`. Install only the plugins
you need.

## Packages

| Package and documentation | Runs in | npm | What it does |
| --- | --- | --- | --- |
| [`@madsoftwaredev/opencode-background-subagent`](packages/background-subagent) | Server | [0.1.0](https://www.npmjs.com/package/@madsoftwaredev/opencode-background-subagent) | Runs subagents in the background when `background` is omitted; preserves explicit foreground execution. |
| [`@madsoftwaredev/opencode-subagent-sidebar`](packages/subagent-sidebar) | TUI | [0.1.0](https://www.npmjs.com/package/@madsoftwaredev/opencode-subagent-sidebar) | Shows live child sessions, status, and current activity in a clickable, expandable sidebar. |
| [`@madsoftwaredev/opencode-lint-feedback`](packages/lint-feedback) | Server | [0.1.0](https://www.npmjs.com/package/@madsoftwaredev/opencode-lint-feedback) | Adds project-local ESLint diagnostics after successful native edits. |
| [`@madsoftwaredev/opencode-direnv`](packages/direnv) | Server | [0.1.0](https://www.npmjs.com/package/@madsoftwaredev/opencode-direnv) | Loads the working directory's approved direnv environment for each shell command. |
| [`@madsoftwaredev/opencode-compaction-model`](packages/compaction-model) | Server | [0.1.0](https://www.npmjs.com/package/@madsoftwaredev/opencode-compaction-model) | Summarizes checkpoints using a configurable model and reasoning variant. |
| [`@madsoftwaredev/opencode-btw`](packages/btw) | TUI | [0.1.0](https://www.npmjs.com/package/@madsoftwaredev/opencode-btw) | Adds `/btw <prompt>` to run a background conversation in a fork of the current session. |

All six packages are published on npm at version **0.1.0**.

## Install from npm

Requires OpenCode V2. Run the command for each plugin you want:

```sh
opencode plugin add @madsoftwaredev/opencode-background-subagent
opencode plugin add @madsoftwaredev/opencode-subagent-sidebar
opencode plugin add @madsoftwaredev/opencode-lint-feedback
opencode plugin add @madsoftwaredev/opencode-direnv
opencode plugin add @madsoftwaredev/opencode-compaction-model
opencode plugin add @madsoftwaredev/opencode-btw
```

To pin a specific release:

```sh
opencode plugin add @madsoftwaredev/opencode-background-subagent@0.1.0
```

Manage installed packages with:

```sh
opencode plugin list
opencode plugin check
opencode plugin update
```

The CLI registers server plugins in the global `opencode.json` and TUI plugins
in `cli.json`. Restart the OpenCode TUI after installing `subagent-sidebar` or
`btw`. Exact versions remain pinned when checking for updates.

## Install from source

To try unreleased changes, install a package directly from its directory in
this Git repository:

```sh
opencode plugin add 'github:madsoftwaredev/opencode-plugins#main::path:packages/direnv'
```

Replace `direnv` with another directory linked in the package table.

## Configuration and requirements

- **Compaction model:** set `options.model` to `provider/model#variant` in the
  plugin's `opencode.json` entry. Choose a model from a connected provider;
  `#variant` is optional. The default is `opencode-go/deepseek-v4.1-flash#max`.
  See the [configuration example](packages/compaction-model#choose-the-compaction-model).
- **direnv:** requires `direnv` on the OpenCode server's PATH and an approved
  `.envrc`. Run `direnv allow` in the project after reviewing that file.
- **Lint feedback:** requires Node on the shell's PATH, project-installed ESLint
  9 or 10, and a flat `eslint.config.*` file. It checks edited files without
  applying fixes.
- **Subagent sidebar and `/btw`:** require the OpenCode terminal UI. Their
  behavior and controls are documented in their package READMEs.

## Development

Install Bun, Node.js 22 or newer, and `direnv` before running the checks.

```sh
git clone https://github.com/madsoftwaredev/opencode-plugins.git
cd opencode-plugins
bun install --frozen-lockfile
bun run check        # build check + tests
```

`bun run build:check` transpiles every entrypoint with the OpenCode, OpenTUI,
and Solid runtime imports marked external. Each package declares
`@opencode/plugin` as a dependency; TUI packages also declare OpenTUI and Solid
peer dependencies.

Tests run with `bun test ./packages`. No network access or live OpenCode server
is required to run the tests after dependencies are installed. The direnv tests
use temporary projects and an isolated approval store.

Server entrypoints export `.` and TUI-only entrypoints export `./tui`, following
the [OpenCode CLI plugin layout](https://opencode.ai/v2/docs/build/plugins/cli).

## Releases

All packages share one version. Releases are maintained in this repository and
published publicly under the `@madsoftwaredev` npm organization.

### First publication of a package

Publish each new package once from an authenticated maintainer's terminal,
completing npm's two-factor authentication prompts. For example:

```sh
npm login
npm publish --access public ./packages/direnv
```

When resuming a partial release, publish only the missing packages. A published
package version cannot be overwritten.

### Configure automated publishing

The [release workflow](.github/workflows/release.yml) is designed to use
[npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers) through
GitHub Actions. After each package exists on npm, configure its **Settings →
Trusted Publisher → GitHub Actions** with:

- organization/user: `madsoftwaredev`
- repository: `opencode-plugins`
- workflow filename: `release.yml`
- allowed actions: enable direct publishing with `npm publish`

Trusted publishing requires Node.js 22.14.0 or newer and npm 11.5.1 or newer
on the runner. Complete this setup for every package before triggering a
tag-based release. GitHub Actions publications include provenance linking the
package to this repository's workflow.

### Publish the next shared version

Update `version` in the root `package.json` and every `packages/*/package.json`.
Refresh the lockfile and verify the release:

```sh
bun install
bun run check
npm pack --workspaces --dry-run
```

Commit the version changes, then push the matching tag. For example, after
updating every package to `0.1.1`:

```sh
git add package.json packages/*/package.json bun.lock
git commit -m "release: v0.1.1"
git tag v0.1.1
git push origin main v0.1.1
```

The workflow reruns the build check and tests, then publishes all packages with
public access and provenance.

## License

[MIT](LICENSE)
