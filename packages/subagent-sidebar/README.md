# @madsoftwaredev/opencode-subagent-sidebar

```sh
opencode plugin add @madsoftwaredev/opencode-subagent-sidebar
```

`subagent-sidebar` is a CLI/TUI-only plugin. It adds a live `SUBAGENTS`
section to the session sidebar without changing server-side subagent execution.

- Shows child and nested subagent sessions with live status.
- Shows a shortened current task or tool activity.
- Click a row to open that session.
- Click `+N more` to expand all children into a scrollable list.
- Use the button below the list to collapse it.
- Clickable rows and controls have a subtle theme-colored hover highlight.

Rows are ordered by most recent activity across every descendant of the current
session. The collapsed list shows up to eight rows.

Restart the OpenCode TUI after installing or changing the plugin; TUI entrypoints
are not picked up by the server reload endpoint.

## Local check

From the repository root:

```sh
bun test ./packages/subagent-sidebar/subagent-view.test.js
bun build ./packages/subagent-sidebar/tui.tsx --target=bun --external '@opencode/*' --external '@opentui/*' --external 'solid-js'
```

## License

MIT
