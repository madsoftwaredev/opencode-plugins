# @madsoftwaredev/opencode-background-subagent

```sh
opencode plugin add @madsoftwaredev/opencode-background-subagent
```

`background-subagent` makes the native V2 `subagent` tool run in the
background when the caller omits `background`. It also highlights native child
session activity in a clickable strip above the prompt. This is a dispatch
default and a CLI view, not a new subagent implementation.

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

## Activity strip

The package's `./tui` entrypoint loads automatically alongside the server plugin.
Restart the OpenCode TUI after adding or updating it; server reload alone does
not load a new TUI entrypoint. No second plugin entry is needed in `cli.json`.

- A highlighted **Subagents** header and up to three one-line rows stay above
  the prompt, independently of folded tool/command summaries and the sidebar.
- Rows show the agent, native session title/task, and live state or recorded outcome.
  Running state and pending inbox work take precedence over an earlier outcome.
  **Pending** requires native queued work. An inactive child with an empty queue
  and no recorded outcome is **idle**, not pending or stopped. Newly created
  children can briefly show idle until native work is queued or starts running.
- Click a row to open that native child session. Click **Open all**, use
  `/subagents`, or choose **Open subagent activity** in `Ctrl+P` to select any
  child, including rows beyond the visible limit. The header shows the total and
  omitted-row count; the picker shows full task labels and supports keyboard
  selection. A single click opens the picker; click outside it to close.
  Right/middle clicks do not navigate, and dragging selects text without activating rows.
- Only direct children of the current session appear. Active work comes first.
  Archived children and historical completed work are excluded.
- Children created or observed active while this view is mounted remain visible
  as **done**, **failed**, or **stopped** when those outcomes are recorded,
  including very short runs. Without an outcome, inactive children show **idle**.
  **Dismiss inactive** clears these rows; keyboard users can use `Ctrl+D`
  inside the activity picker. The next delegation also clears inactive rows.
  Leaving the parent view or restarting discards this completion history. There
  are no timers, saved activity records, notifications, or new permissions.
- Labels clip at the right edge instead of wrapping or hiding the agent name
  with middle truncation. The strip normally uses at most five rows (header,
  three children, optional dismissal).
  A synchronization failure adds a retry row and leaves cached activity visible.

Set `activityStrip` to `false` to retain background execution without the strip:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "@madsoftwaredev/opencode-background-subagent",
      "options": { "activityStrip": false }
    }
  ]
}
```

Merge this with your existing configuration rather than replacing its plugin
list. The option affects only the CLI view, not the server dispatch default.

### Compatibility and limitations

Targets OpenCode V2's supported CLI plugin APIs (`@opencode/plugin` 2.0.27+),
OpenTUI 0.5.17+, and Solid 1.9.12+. Development checks use the installed plugin
SDK 2.1.1; headless rendering does not establish live-host integration.

The strip appends to `session.composer.top`; it does not replace the goal island
or inspect/change transcript render trees. A plugin replacing that slot, or a
host view that does not mount it, can hide the strip. This surface is for the
full-screen terminal UI, not Mini, web, or desktop views. Terminal mouse capture
must be enabled for clicks; `/subagents` provides the keyboard alternative.

Child discovery and live state use the connected server's native session APIs,
including remote connections. Titles are the server's session titles, not a new
task/prompt parser. Missing outcome metadata does not prove interruption:
**stopped** is shown only for a native **interrupted** outcome. During metadata
hydration, a retained inactive child may show neutral **idle** until its recorded
outcome arrives. Historical inactive children are not restored after the view is
remounted.

## Reload

Reload after changing the server entrypoint. The reload endpoint rebuilds every
loaded location and cancels pending permission requests and forms; running
sessions continue with fresh services at their next step boundary:

```sh
opencode api post /api/location/reload
opencode api get /api/plugin
```

Look for `background-subagent`. A service restart is not required.

## Local check

From the repository root:

```sh
bun test --preload @opentui/solid/preload ./packages/background-subagent
bun run --cwd packages/background-subagent typecheck
bun build ./packages/background-subagent/index.ts --target=bun --external '@opencode/*'
bun build ./packages/background-subagent/tui.tsx --target=bun --external '@opencode/*' --external '@opentui/*' --external 'solid-js'
```

Install workspace dependencies first. Tests cover the unchanged server default,
headless rendered wide/narrow layout, native child navigation, activity lifecycle,
parent scoping, bounded rows/picker access, synchronization errors, and cleanup.
They do not launch OpenCode or modify an installed CLI/configuration.

## License

MIT
