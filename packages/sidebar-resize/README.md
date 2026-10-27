# @madsoftwaredev/opencode-sidebar-resize

Resizes the **whole existing right-hand session sidebar**, including its title,
context, MCP, subagents, usage, and footer. It does not create a panel or replace
sidebar content. The left-hand session tabs are unchanged.

## Install

Add this CLI-only plugin to your global `~/.config/opencode/cli.json`:

```json
{
  "plugins": ["@madsoftwaredev/opencode-sidebar-resize"]
}
```

Merge the entry into your existing `plugins` list, then restart the OpenCode TUI.
A server restart or server-side plugin reload does not load a TUI entrypoint.
Do not also load the original local `plugins/sidebar-resize` copy: it has the
same `sidebar-resize` plugin ID and storage keys.

## Use

- Drag the sidebar's **left edge**. Its two-cell handle highlights on hover.
- Use `/sidebar-width 60` to set the width in terminal columns, or select
  **Set sidebar width** from `Ctrl+P`.
- Use `/sidebar-width reset` to restore the original 42-column width.
- Width is saved across restarts and synced across TUI instances.
- Reserves 64 columns for the transcript when displayed side by side, where
  available. OpenCode's existing narrow-terminal overlay behavior is preserved.
- Terminal resizing temporarily clamps the sidebar without changing the saved
  preference; the preferred width returns when space allows.

## Compatibility and limitations

The supported development baseline is **OpenCode 2.1.0**, **OpenTUI 0.6.6**,
and **Solid 1.9.12**. This is not a guarantee that every later OpenCode layout
will work. The package exports `./tui` only and runs in the OpenCode terminal,
not in the web or desktop UI. Its Node `>=22` engine metadata does not make the
TypeScript/TSX entrypoint a standalone Node program.

OpenCode V2 has no public sidebar-width API. This plugin uses the exposed
OpenTUI renderer and Yoga layout tree, not a browser DOM, to locate and resize
the original sidebar and its host pane from a `sidebar.footer` slot anchor.
The adapter was inspected against OpenCode 2.1.0-era checkout `32b41bab` and requires the
same padded, 42-column sidebar shape, heading, scrollbox, and footer branch.
Unrecognized layouts are left unchanged with a warning. OpenCode updates or
other plugins that replace the footer or alter that tree can prevent attachment.
No installed binaries or OpenCode source files are patched.

OpenTUI 0.6.6 removed `getLayoutNode()`. The adapter uses Renderable's direct
`getWidth()`, `getPadding()`, and `getPositionType()` style getters instead;
`getLayout()` returns computed geometry and is not a replacement for these getters.

The drag fallback temporarily wraps the renderer root's `processMouseEvent`
to catch drags whose first move jumps past the handle. Cleanup restores that
handler if it still owns it, removes the handle, and restores the original
widths. This relies on host internals and can interact with other mouse-handler
wrappers.

Existing sections keep their own text-formatting limits; widening the container
does not remove truncation explicitly applied by another plugin. This plugin
does not force a hidden sidebar to open or change OpenCode's overlay threshold.

OpenCode supplies the UI runtime and rewrites host imports in `tui.tsx`.
`sidebar.ts` keeps its OpenTUI imports type-only and receives constructors from
that entrypoint; `width.ts` has no UI runtime imports.

## Development checks

Install workspace dependencies once from the repository root, then run:

```sh
bun test --preload @opentui/solid/preload ./packages/sidebar-resize
bun run --cwd packages/sidebar-resize typecheck
bun build ./packages/sidebar-resize/tui.tsx --target=bun --external '@opencode/*' --external '@opentui/*' --external 'solid-js'
```

The preload is required for the Solid JSX integration tests. Tests use the
native OpenTUI test renderer with a representative sidebar tree and a fake
plugin context to check whole-sidebar resizing, dragging, persistence success
and failure, terminal resizing, and cleanup. A runtime-import check ensures the
TypeScript adapter does not import UI packages at runtime. These checks do not
by themselves prove the actual layout or plugin loader in a running OpenCode TUI. The build
command checks transpilation, not host integration. Development dependencies
are not needed to load the plugin in OpenCode.

### Actual-host verification

On 2026-10-20, the same adapter was checked with the installed **OpenCode 2.1.0**
binary in an isolated headless PTY at **180 × 50**, using its actual render tree.
The local copy was auto-discovered through a controlled global `plugins` symlink,
not an explicit CLI package entry. This verifies the adapter, not npm package loading.
Disposable HOME/XDG directories, a private `--standalone` server and database, and a
fake local provider endpoint were used. Sounds and notifications were disabled;
no prompts or generations were sent and no existing user sessions changed.

| Action | Sidebar width | Session pane width | Handle x |
| --- | ---: | ---: | ---: |
| Initial layout | 42 | 138 | 138 |
| Dispatch `sidebar-resize.width` with `60` | 60 | 120 | 120 |
| SGR mouse press/drag/release through the PTY | 80 | 100 | 100 |
| Dispatch reset | 42 | 138 | 138 |

Resizing the PTY from 180 to 100 columns unmounted the sidebar handle and expanded
the session pane to 100 columns. Restoring 180 columns remounted the handle at
x=138, with sidebar width 42 and session pane width 138.
Physical-terminal behavior and a human-operated drag remain unverified.

## License

MIT
