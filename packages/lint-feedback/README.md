# @madsoftwaredev/opencode-lint-feedback

```sh
opencode plugin add @madsoftwaredev/opencode-lint-feedback
```

`lint-feedback` appends project-local ESLint diagnostics to successful native
`write`, `edit`, and `patch` results. It runs **checks only**, after native formatting;
it does not fix files, install packages, supply rules, or run repository-wide lint
or typechecks. Use the existing `/lint` command for safe corrections and re-checks.

OpenCode V2 [does not run language servers or produce LSP diagnostics](https://opencode.ai/v2/docs/migrate-v1).
Automatic formatting is a separate feature and does not prove a file is lint-clean.
The global formatter settings use project-aware built-ins (including JavaScript/
TypeScript and Dart) with the existing bundled RuboCop override retained.

## Requirements and selection

- Node on the native shell's PATH, **project-installed ESLint 9 or 10**, and a flat
  `eslint.config.{js,mjs,cjs,ts,mts,cts}` file. TS configs/parsers still need their
  project's normal dependencies. There are no production dependencies to install
  for this plugin itself.
- Checks cover changed `.js`, `.jsx`, `.mjs`, `.cjs`, `.ts`, `.tsx`, `.mts`, and
  `.cts` files. Native structured results identify additions, modifications, and
  move destinations. Deleted files, failed edits, unrelated tools, and filenames
  appearing only in patch bodies or result text never trigger a check. Unsupported
  native result shapes skip rather than guessing.
- The root is the **current session directory**, not the service cwd or the plugin
  instance's directory. Discovery walks upward from each edited file, stopping at
  that root. Nested packages use their nearest flat config and installed ESLint;
  hoisted dependencies inside the root work. Run a monorepo session from its root
  if nested packages need shared configuration/dependencies above their directory.
- Only regular files are linted. Session-root aliases and internal symlinks work;
  edited files, configs, or ESLint installs resolving outside the root are skipped.
  No global ESLint, `npx`, package downloads, arbitrary repository globs, or fallback
  rules are used. Flat config is explicit and the ESLint cwd is its directory, so
  config patterns keep their usual base without searching above the root.

Unsupported projects are **skipped, not passed**. These include legacy `.eslintrc`
configurations, ESLint versions outside 9/10, `ESLINT_USE_FLAT_CONFIG=false`, Yarn
PnP without `node_modules`, dependencies symlinked outside the root, and remote
workspaces. Use `/lint` with the project's own command in those cases. Custom
config names, repository scripts with special flags, Biome diagnostics, and full
TypeScript/compiler checks also remain explicit verification tasks.

## Permissions, environment, and limits

The V2 `tool.transform` wrapper first awaits the original edit executor. It then
invokes the registered native **shell tool executor**, passing the original
session, agent, message, call ID, and progress context unchanged. It does not use
`ctx.shell.create`, spawn a process, or load project JavaScript in the hook.
Before calling shell it only canonicalizes the session directory and approved
edited file paths; all config/package inspection happens in `check.mjs` under
shell authorization. Missing shell support has no direct-process fallback.

The authorized command is `node /path/to/check.mjs /session/root /changed/file ...`.
Normal shell rules apply to that command; permissions are never widened or
auto-approved. Denial or environment failures leave the successful edit intact and
append an incomplete-check message. The native shell executor performs
`external_directory` and `shell` assertions using this original context before
starting the command. Keep this boundary covered when upgrading OpenCode.

Each changed directory uses a separate native shell invocation, with that
directory as `workdir`, so the existing direnv `shell.create.before` integration
applies the correct inherited/nested environment. The helper and ESLint inherit
that environment unchanged. Project config and plugins are executable code, just
as with manual lint; native shell approval is not a filesystem sandbox for their
imports or side effects. This plugin confines its own discovery, not arbitrary
code explicitly loaded by a project's config.

Per edit: at most 32 files, 8 directories, and a 30-second scheduling budget.
Each shell command has a maximum 10-second timeout; helper ESLint subprocesses
share 8 seconds and have a 64 KiB stdout/stderr capture limit. Helper reports are
capped at 12,000 characters and appended feedback at 16,000 characters. Remaining
files, timeouts, truncation, ignored-file warnings, config failures, and command
failures are reported, never converted into a clean result. Permission prompts
and existing environment-hook preparation (direnv has its own timeout) are outside
the lint process budget. Concurrent edits can change files before a check reads
them; feedback describes the file on disk, not an immutable edit snapshot.

## Reload

After changing plugin code, reload to rebuild every loaded location. This cancels
pending permission requests and forms; running sessions continue with fresh
services at their next step boundary. Use it only when those global side effects
are acceptable:

```sh
opencode api post /api/location/reload
opencode api get /api/plugin
```

Look for `lint-feedback`. A service restart is not required. Formatting
changes are global; the check only runs where the project already provides
supported ESLint configuration.

## Local tests and real ESLint fixture

From the repository root:

```sh
bun test ./packages/lint-feedback/index.test.js ./packages/lint-feedback/check.test.js
```

Tests exercise project/file selection, returned output, bounded failures, literal
arguments, and the permission-preserving executor boundary with deterministic
native-shell doubles. One test executes a disposable local CLI to cover the real
subprocess/argv/environment path. Native permission enforcement itself must also
be checked in a live V2 session; the doubles do not prove the host's policy engine.

`fixtures/project` is a deliberately broken, real ESLint project, isolated from
this repository's rules. For a disposable manual fixture using cached npm
packages only (no downloads), run from this repository:

```sh
FIXTURE=$(mktemp -d "${TMPDIR%/}/opencode/lint-real-XXXXXX")
cp -R packages/lint-feedback/fixtures/project/. "$FIXTURE/"
npm install --prefix "$FIXTURE" --offline --ignore-scripts --no-audit --no-fund
node packages/lint-feedback/check.mjs "$FIXTURE" "$FIXTURE/broken.js"
```

If the pinned packages are not cached, stop rather than falling back to an online
install. An existing ESLint 9/10 project's `node_modules` can instead be copied
into the disposable fixture (not symlinked outside it). Expected helper output:
`ESLint found lint errors` and `missingValue ... no-undef`. The source must remain
unchanged. Changing the source to `export const answer = 42;` should report
`No ESLint diagnostics`.

For the native path, use a session located at the fixture and actually **patch**
`broken.js` to `export const answer=anotherMissingValue` (not a shell write). The
project's Prettier should format the file, while the successful patch result
should also contain ESLint's `no-undef` diagnostic. A shell-denied agent should
retain the edit result with an incomplete check and never execute the lint helper.
The fixture is manual verification, not an E2E suite or a global lint policy.

## License

MIT
