# @madsoftwaredev/opencode-background-subagent

```sh
opencode plugin add @madsoftwaredev/opencode-background-subagent
```

`local.background-subagent` makes the native V2 `subagent` tool run in the
background when the caller omits `background`. This is a dispatch default, not
a new subagent implementation.

## Behavior

- Omitted `background` becomes `true`.
- Explicit `background: false` remains foreground for dependent work.
- Explicit `background: true` remains unchanged.
- The wrapper does not change the child agent, prompt, permissions, or tool
  result. OpenCode still returns and tracks the native child session ID.
- The tool description tells agents to use foreground execution when the next
  parent step depends on the child result.

OpenCode V2 has no configuration field for a global background-subagent
default. This plugin uses the supported `tool.transform` API to wrap the
built-in tool.

## Reload

Reload after changing the server entrypoint. The reload endpoint rebuilds every
loaded location and cancels pending permission requests and forms; running
sessions continue with fresh services at their next step boundary:

```sh
opencode api post /api/location/reload
opencode api get /api/plugin
```

Look for `local.background-subagent`. A service restart is not required.

## Local check

From the repository root:

```sh
bun test ./packages/background-subagent/index.test.js
bun build ./packages/background-subagent/index.ts --target=bun --external '@opencode/*'
```

## License

MIT
