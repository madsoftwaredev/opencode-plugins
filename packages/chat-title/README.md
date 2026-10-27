# @madsoftwaredev/opencode-chat-title

Pins the current session title to a one-row header above the chat transcript,
directly under the session tab strip, while the session sidebar is hidden.

## Install

Add this CLI-only plugin to your global `~/.config/opencode/cli.json`:

```json
{
  "plugins": ["@madsoftwaredev/opencode-chat-title"]
}
```

Merge the entry into your existing `plugins` list, then restart the OpenCode TUI.
A server restart or server-side plugin reload does not load a TUI entrypoint.
Do not also load the original local `plugins/chat-title` copy: it has the same
`chat-title` plugin ID and storage keys.

## Use

- Shown only while the session sidebar is **not** on screen. The sidebar already
  shows the session title at its own top, so the plugin avoids printing it twice.
- The header returns when the sidebar is absent: hidden by terminal width or
  `session.sidebar` in `cli.json`, replaced by the terminal or panel pane, or
  viewing a subagent session.
- Takes one row from the transcript instead of covering it. Only the chat column
  changes; the sidebar and right-hand pane are unchanged.
- Follows the live session title and shortens it to the available terminal cells
  with a trailing `…`. Width fitting handles grapheme clusters and common CJK
  and emoji ranges; terminal-specific width differences are still possible.
- Use `/chat-title` or **Toggle the chat title header** in `Ctrl+P` to turn it
  off and on. The choice is saved across restarts and synced across TUI instances.

## Compatibility and limitations

The supported development baseline is **OpenCode 2.1.0**, **OpenTUI 0.6.6**,
and **Solid 1.9.12**. This is not a guarantee that every later OpenCode layout
will work. The package exports `./tui` only and runs in the OpenCode terminal,
not in the web or desktop UI. Its Node `>=22` engine metadata does not make the
TypeScript/TSX entrypoint a standalone Node program.

OpenCode V2 publishes no slot above the transcript. This plugin uses the exposed
OpenTUI render tree and renderable style getters, not a browser DOM, to insert
the header into the session column that owns the `session.composer.top` slot.

Sidebar visibility is tracked through the documented `sidebar.content` slot,
which mounts while the sidebar renders. Replacing that slot can interfere with
this visibility signal.

The adapter matches the layout inspected in OpenCode 2.0.27: exactly three rows
for the transcript (a box wrapping the scrollbox), the one-row "jump to latest"
bar, and the composer branch containing the plugin anchor. Unrecognized layouts
are left alone and reported with a warning toast. Errors during initial layout
discovery also leave the transcript intact rather than crashing the composer
slot. OpenCode updates or other plugins that change that tree may require an
adapter update. No installed
binaries or OpenCode source files are patched.

Version 0.1.1 replaces the removed `getLayoutNode()` API with renderable style
getters. The header requests a frame after insertion and uses `onSizeChange` to
refit its text after native layout and terminal resizes. It never accesses or
modifies a raw Yoga node. Host structure remains an implementation dependency,
not a public layout guarantee.

OpenCode supplies the UI runtime and rewrites host imports in `tui.tsx`.
`header.ts` and `title.ts` deliberately avoid runtime imports of UI packages so
the adapter receives the host's own constructors.

## Development checks

Install workspace dependencies once from the repository root, then run:

```sh
bun run --cwd packages/chat-title test
bun run --cwd packages/chat-title typecheck
bun build ./packages/chat-title/tui.tsx --target=bun --external '@opencode/*' --external '@opentui/*' --external 'solid-js'
```

Unit tests cover title fitting and render-tree matching. Headless OpenTUI 0.6.6
integration tests cover rendering, title updates, narrow-terminal resizing,
sidebar visibility, saved-toggle wiring, disposal, and safe layout rejection.
They use the inspected host shape, not a live installed OpenCode release.
The build command checks transpilation, not host integration. Development
dependencies are not needed to load the plugin in OpenCode.

## License

MIT
