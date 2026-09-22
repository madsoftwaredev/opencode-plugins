# @madsoftwaredev/opencode-direnv

```sh
opencode plugin add @madsoftwaredev/opencode-direnv
```

Loads the command's direnv environment through V2's `shell.create.before` hook.
The active plugin ID is `local.direnv`.

Requires `direnv` on the OpenCode service's PATH and an approved `.envrc`:

```sh
cd /path/to/project
direnv allow
```

Each shell invocation runs `direnv export json` in its actual working directory.
direnv handles parent-directory lookup, watched files, PATH changes, variable
removal, and unloading an inherited environment from another project. Values
are applied only to that shell invocation, never to the shared service's
`process.env`. There is no plugin cache, so edits and approval changes take
effect on the next command.

This covers commands using OpenCode's shell hook. Provider credentials, config
environment substitutions, and MCP processes have separate lifecycles. A `cd`
inside a shell command does not rerun the hook; select the command's `workdir`
or use `direnv exec /path/to/project command` explicitly.

Loading errors are reported without including environment values or `.envrc`
output. The plugin never approves an `.envrc` automatically. Loading has a
60-second timeout.

This plugin uses the V2 `@opencode/plugin` API. The older
`@simonwjackson/opencode-direnv` package uses V1's plugin API and fails to load
in V2.

## Local tests

Requires Bun and `direnv`:

```sh
bun test ./packages/direnv/index.test.js
```

Tests use temporary projects and a separate direnv approval store.

## License

MIT
