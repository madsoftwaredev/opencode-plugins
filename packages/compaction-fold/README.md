# Compaction Fold

Fold **only the generated compaction summary** into a clickable inline row:

```text
▶ Compaction summary
```

Click to expand; click again to collapse. The compaction status and token-usage
line stay visible. Earlier conversation, failed-compaction errors, stored
history, and model context are never changed. No server plugin is needed.

## Install

Requires OpenCode 2.1.0 and OpenTUI 0.6.6 or later. Version 0.1.1 uses the
supported renderable style getters instead of the removed `getLayoutNode()` API.

```sh
opencode plugin add @madsoftwaredev/opencode-compaction-fold
```

Alternatively, add the package to `plugins` in your global
`~/.config/opencode/cli.json` (or `$XDG_CONFIG_HOME/opencode/cli.json`), preserving
existing entries, and restart the TUI:

```json
{
  "plugins": [
    {
      "package": "@madsoftwaredev/opencode-compaction-fold",
      "options": { "defaultExpanded": false }
    }
  ]
}
```

## Options

| Option | Default | Meaning |
| --- | --- | --- |
| `defaultExpanded` | `false` | Start newly encountered summaries open (`true`) or closed (`false`). Must be a boolean. |

Each summary can be toggled independently. Choices survive transcript-row
remounts within the current session view, not switching sessions, plugin reloads,
or TUI restarts. Mouse support must be enabled to click the row.

## Compatibility and safety

OpenCode has no public transcript slot. Like this repository's chat-title and
sidebar-resize plugins, this package uses a hidden composer-slot anchor and
host-provided OpenTUI constructors to inspect the existing render tree.

The adapter matches the shallow `CompactionMessage` header/body structure
inspected in OpenCode `dev` commit `32b41ba`, then cross-checks the Markdown body
against cached messages explicitly typed `compaction` (running or completed).
It never identifies a summary by searching ordinary chat text. Failed, empty,
ambiguous duplicate summaries and unknown layouts are left unchanged. Provider
compactions without a summary have nothing to fold.

Only the original summary body's visibility changes; its Markdown node is kept
intact and restored when the plugin detaches. A plugin-owned row is inserted
above it. Streaming summaries and lazily mounted history are checked before
each existing renderer frame, scanning only direct transcript rows and a fixed
depth of children. The plugin starts no timers or continuous rendering and
removes its callback and rows on cleanup.

This is an internal-layout compatibility adapter, **not a stable OpenCode API**.
Future host changes or other transcript-mutating plugins can prevent folding;
unsupported session layouts, including errors during initial layout discovery,
show one warning and remain untouched. Headless tests run against OpenTUI 0.6.6
and cover the inspected shape, not a live installed OpenCode release. Expanding
a long summary changes transcript height and can move the scroll position.

## Development

From the repository root: `bun install`, then `bun run check`.
From this directory: `bun run typecheck` and `npm pack --dry-run`.

MIT licensed. See [LICENSE](LICENSE).
