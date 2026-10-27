# @madsoftwaredev/opencode-usage

Read-only OpenCode V2 terminal plugin. The sidebar shows this chat's total tokens,
**API-equivalent USD** and **actual recorded USD**, input, output, reasoning, cache reads, cache writes, and cache-hit
rate. Click it or run **`/usage`** to open the detailed popup.

The scope is **the selected chat and its subagent chats**, including nested subagents.

This is separate from [`opencode-stats`](../stats/README.md), which adds token
speed, turns, and steps to the prompt footer. You can install either or both.

## Install

```sh
opencode plugin add @madsoftwaredev/opencode-usage
```

Requires OpenCode V2 with the 2.0.27 plugin API and OpenTUI 0.5.17 or later.
Restart the TUI after installation.

The popup includes:

- **This chat**, **Subagent chats**, and **Combined total**, with API-equivalent and actual costs side by side.
- Per-provider/coding-plan cost totals, separately from per-model totals.
- Every provider/model/reasoning variant, with token buckets, cost, assistant
  steps, compactions, and cache-hit rate.
- Every subagent's own usage and parent session ID. Nested descendants are included
  once, even when they were created in another directory or are archived.
- **Unattributed / auxiliary** usage when session accounting includes usage that
  message history cannot reliably assign to a model, such as title generation.

Models are totaled across their variants by default. Press **v** to split them by
reasoning variant, **s** for each chat's model breakdown, **r** to reload all accounting and
history, **↑/↓** or **Page Up/Down** to scroll, and **Esc** to close. Narrow terminals
use vertical metric tables instead of squeezing or omitting columns. Exact token
counts are shown in the popup; the sidebar uses compact `k`/`m` counts.
**←/→** scroll horizontally if a very narrow terminal still cannot fit a metric table.
The popup holds a timestamped snapshot until you press **r**, so live activity cannot
move its rows while you read or scroll. The sidebar continues updating automatically.

**`/usage-sidebar`** toggles the sidebar and saves the preference across restarts.
The command palette also exposes both commands. `/chat-usage` aliases `/usage`.

## Accounting

OpenCode's session totals are the source of truth. Sessions that never completed an accounting step, and steps that failed before usage was recorded, carry no accounting and count as zero. Total tokens are the sum of its
disjoint buckets: **input + output + reasoning + cache read + cache write**.
Input means **uncached** input, and output excludes the separate reasoning bucket.
Cache-hit rate is `cache read / (input + cache read + cache write)`; it is `—` when
there is no recorded input.

**API equivalent** is what the recorded tokens would cost at the current catalog's
API rates. It includes uncached input, output **plus reasoning**, cache-read discounts,
and cache writes. Long-context tiers are chosen for **each request's input**, not the
sum of an entire chat. This is a current-price estimate, not a historical invoice.

Coding plans often erase their model prices. The plugin resolves matching paid API
catalog entries for **ChatGPT/Codex, OpenCode Go, Z.ai Coding Plan, and Claude Code**.
Historical message models are resolved against their API counterparts even if the
subscription provider no longer lists them. Claude context aliases are normalized;
an exact dated snapshot is preferred before its version alias. The popup lists each
pricing reference. Real free models remain free; an unidentified model is not
silently assigned another model's price.

**OpenAI Fast and Ultrafast premiums are included**, using the
[published pricing](https://developers.openai.com/api/docs/pricing) checked on
2026-10-03. GPT-6 Fast costs 2× Standard, GPT-6 Astra Ultrafast costs 6×, and GPT-5.5
Fast costs 2.5×. The multiplier applies to input, output/reasoning, cache reads, cache
writes, and supported context tiers. GPT-5.4/5.5 Fast requests above the published
272K input limit stay unpriced. Unrecognized speed aliases, including Z.ai highspeed
without a matching API entry, stay unpriced rather than silently using Standard rates.

**Claude cache writes need a lifetime to price accurately:**
[5-minute writes cost 1.25× input; 1-hour writes cost 2×](https://platform.claude.com/docs/en/about-claude/pricing#prompt-caching).
OpenCode's normalized message accounting does not expose that breakdown, so those
write tokens are explicitly **unpriced**. Their input, output/reasoning, and cache-read
costs are still included. The popup identifies the missing write tokens; the `+`
subtotal marker propagates through model, provider, session, and chat totals.

**Actual USD** remains OpenCode's recorded usage charge. For subscription-backed
requests it can be **$0 while API equivalent is positive**. Fixed subscription fees
are not per-chat charges and are not included. Missing model-level actual cost is
shown as `—`, never replaced with the API estimate.

API totals show **`+`** for a known subtotal when some usage has no price or reliable
model attribution. **`—`** means there is no known estimate. Auxiliary/title tokens
are not assigned to the current model just to make the total look complete.
Streaming requests are
counted when OpenCode records usage; costs and tokens for requests that fail before
usage is reported cannot be recovered by this plugin.

All message pages are read for model attribution and sidebar API pricing, not just the visible transcript.
Only accounting fields are retained in memory, never prompts or tool output.
Recent history is replaced on updates to avoid double-counting repeated events.
Sidebar usage updates on server events, with a 15-second accounting resync to recover missed
events or activity from another SDK process. Unchanged histories are not re-fetched.
Full history is reloaded after a committed revert or manual refresh. If model detail
and recorded totals disagree, the popup says so rather than changing the totals.
Unavailable or stale data is labeled. Separate forks are not descendant subagents;
when inspecting a fork, its recorded totals can include inherited history.

## Configuration

Configured in `~/.config/opencode/cli.json`, alongside the existing footer stats:

```json
{
  "plugins": [
    {
      "package": "@madsoftwaredev/opencode-usage",
      "options": { "sidebar": true, "includeSubagents": true }
    }
  ]
}
```

Both options default to `true`. A saved sidebar toggle takes precedence over the
configured sidebar default. This terminal-only plugin uses the connected client,
so it also works with remote servers; it does not access the database or credentials.
No server restart is needed. Reopen the TUI to pick up plugin code changes.

## Tests

```sh
bun test ./packages/usage
```
