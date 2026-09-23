# OpenCode plugins

OpenCode V2 plugins by [MadSoftwareDev](https://github.com/madsoftwaredev).

Each plugin is its own npm package so it can be installed and enabled
independently. Install with the OpenCode CLI:

```sh
opencode plugin add @madsoftwaredev/opencode-background-subagent
```

## Packages

| Package | What it does |
| --- | --- |
| [`@madsoftwaredev/opencode-background-subagent`](packages/background-subagent) | Makes an omitted `subagent.background` call run in the background. |
| [`@madsoftwaredev/opencode-subagent-sidebar`](packages/subagent-sidebar) | Shows live child subagent sessions in the TUI sidebar. |
| [`@madsoftwaredev/opencode-lint-feedback`](packages/lint-feedback) | Appends check-only project-local ESLint diagnostics after native edits. |
| [`@madsoftwaredev/opencode-direnv`](packages/direnv) | Applies the `direnv` environment to each shell command. |
| [`@madsoftwaredev/opencode-compaction-model`](packages/compaction-model) | Summarizes checkpoints with a dedicated compaction model and variant. |
| [`@madsoftwaredev/opencode-btw`](packages/btw) | Adds `/btw` to fork the current session and run a prompt in the background. |

Server entrypoints export `.`. TUI-only plugins export `./tui`, matching the
[CLI plugin layout](https://opencode.ai/v2/docs/build/plugins/cli) OpenCode loads
automatically.

Choose the compaction model and reasoning variant with `options.model` in
`opencode.json`; see the [compaction configuration example](packages/compaction-model#choose-the-compaction-model).

## Development

```sh
git clone https://github.com/madsoftwaredev/opencode-plugins.git
cd opencode-plugins
bun install
bun run check        # build check + tests
```

`bun run build:check` transpiles every entrypoint. `@opencode/plugin`,
`@opentui/*`, and `solid-js` are provided by the OpenCode process at runtime and
are marked external in that check, so they are development dependencies here
rather than shipped code.

Tests run with `bun test ./packages`. No network access or live OpenCode server
is required.

## Publishing to npm

### One-time npm setup

1. Sign in to npm with the account that will own the scope:
   ```sh
   npm login
   ```
2. The `@madsoftwaredev` scope must be owned by an npm user or organization named
   `madsoftwaredev`. If the npm username differs, create the free npm
   organization `madsoftwaredev` and add the publishing account to it.
3. Scoped packages are private by default. Every package here sets
   `"publishConfig": { "access": "public" }`, so a free account is enough.

### First release (local)

Trusted publishing cannot cover a package that does not exist on npm yet, so
publish the first version from a machine with an npm session:

```sh
npm publish --access public ./packages/background-subagent
npm publish --access public ./packages/subagent-sidebar
npm publish --access public ./packages/lint-feedback
npm publish --access public ./packages/direnv
npm publish --access public ./packages/compaction-model
npm publish --access public ./packages/btw
```

### Every release after that (GitHub Actions)

All packages share one version and are released together from a tag. Bump
`version` in the root and every `packages/*/package.json`, then:

```sh
git commit -am "release: v0.1.1"
git tag v0.1.1
git push origin main --tags
```

The [release workflow](.github/workflows/release.yml) verifies the build and
tests, then runs `npm publish --access public --provenance` for each package.

Publishing is authenticated with **npm Trusted Publishing (OIDC)**, so no npm
token is stored in this repository. Configure it once per package on npmjs.com:
**package → Settings → Trusted Publisher → GitHub Actions**, with

- organization/user: `madsoftwaredev`
- repository: `opencode-plugins`
- workflow: `release.yml`

Provenance is attached to each publish, so `npm provenance` verifies the package
was built by this repository's workflow.

If the npm account cannot use trusted publishing, fall back to a granular access
token in an `NPM_TOKEN` secret and change the publish step to
`npm publish --access public "$dir"` with `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}`.
That keeps a standing credential in the pipeline, which is why it is the fallback
and not the default.

## Install from source

Until a package is on npm, install it from a local checkout:

```sh
opencode plugin add /absolute/path/to/opencode-plugins/packages/direnv
```

## License

[MIT](LICENSE)
