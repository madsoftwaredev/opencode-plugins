# @madsoftwaredev/opencode-stats

An OpenCode V2 TUI plugin by MAD Software. It adds three inline statistics to
the session prompt footer:

```text
44.4 tok/s · 3 turns · 8 steps
```

- **Token speed** matches OpenCode's turn-wide calculation: output and reasoning
  tokens divided by the sum of `time.streamed - time.created` across assistant
  steps in the latest completed step's turn. Input tokens and each step's
  streamed-to-completed tail are excluded. The previous measurement stays
  visible while a new response streams. Before one exists, it shows `— tok/s`.
- **Turns** count session execution groups started by a user or synthetic input.
  Inputs queued during one execution count as one turn; legacy sessions without
  idle boundaries count each input as a turn. The running turn is included.
- **Steps** count assistant model steps, including a running step. Both counts
  cover the full session history, not just the messages currently visible in
  the TUI. Counts show `—` briefly while history loads.

## Install

```sh
opencode plugin add @madsoftwaredev/opencode-stats
```

Restart the TUI to load the plugin. It runs in the terminal, so it does not
need a server-side entry in `opencode.json`.

## Configure

The three statistics are independently configurable in `~/.config/opencode/cli.json`.
Replace the package's string entry with the object form, preserving your other
plugins:

```json
{
  "plugins": [
    {
      "package": "@madsoftwaredev/opencode-stats",
      "options": { "speed": true, "turns": true, "steps": true }
    }
  ]
}
```

Each option is an independent boolean and defaults to `true` when omitted.
Open **Configure footer stats** in the command palette, or run `/stats` in the
TUI, to toggle any statistic. Choices are saved across TUI restarts and take
precedence over `cli.json` defaults. Choose **Reset to configured defaults**
in the same menu to follow the file again. When all three are off, the plugin
adds nothing to the footer. Outside a session, it shows no statistics.

## Develop

From the monorepo root, run the focused unit tests with:

```sh
bun test ./packages/stats/stats.test.js
```
