# @madsoftwaredev/opencode-btw

OpenCode V2 TUI plugin that adds `/btw` to run a prompt in a background fork of
the current session.

## Install

```sh
opencode plugin add @madsoftwaredev/opencode-btw
```

Restart the OpenCode TUI after installing.

## Usage

Open a session, then run:

```
/btw <your prompt>
```

The plugin forks the current session, titles the fork with a `#BTW ` prefix, and
submits the prompt to that fork. The fork runs in the background while you keep
working in the current session.

The fork is remembered per parent session, so repeated `/btw` calls from the same
session reuse it. A toast reports when the fork finishes.

## Requirements

OpenCode V2 with the TUI. The plugin contributes a slash command and keymap layer
through `@opencode/plugin/tui`, so it needs the OpenTUI and Solid runtimes that
OpenCode already ships.

## License

MIT
