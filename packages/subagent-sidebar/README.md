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

## Options

Pass options in the plugin registration (for example in `cli.json`):

```json
{
  "package": "@madsoftwaredev/opencode-subagent-sidebar",
  "options": {
    "sortBy": "active",
    "show": { "running": true, "idle": true, "done": false, "failed": true, "stopped": false }
  }
}
```

| Option | Values | Meaning |
| --- | --- | --- |
| `show.<status>` | boolean | Per-status row visibility. Statuses: `running`, `idle`, `done` (finished successfully), `failed`, `stopped` (interrupted). Default: all visible. |
| `hide` | array of statuses | Hides the listed statuses (unknown entries are ignored). Applied last: wins over `show.<status>`. |
| `sortBy` | `"recent"` (default) \| `"active"` | `"active"` puts running rows first; within both groups, most-recently-updated rows come first. `"recent"` orders purely by most recent activity. |

By default (`sortBy: "recent"`), rows are ordered by most recent activity
across every descendant of the current session. The collapsed list shows up to
eight rows. Statuses that do not exist in this plugin version are always rendered visible, so a newer host cannot introduce a status that is silently hidden. The `SUBAGENTS (N)` header and the `+N more` control count visible
rows only — hidden statuses are not included in the total.

Restart the OpenCode TUI after installing or changing the plugin; TUI entrypoints
are not picked up by the server reload endpoint.

## Local check

From the repository root:

```sh
bun test ./packages/subagent-sidebar/subagent-view.test.js ./packages/subagent-sidebar/options.test.js
bun build ./packages/subagent-sidebar/tui.tsx --target=bun --external '@opencode/*' --external '@opentui/*' --external 'solid-js'
```

## License

MIT
