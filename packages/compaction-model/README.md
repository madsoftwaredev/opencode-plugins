# @madsoftwaredev/opencode-compaction-model

Summarizes local checkpoint compaction with a dedicated model and variant while
the session keeps its selected working model.

```sh
opencode plugin add @madsoftwaredev/opencode-compaction-model
```

## Choose the compaction model

Set `options.model` in your global `~/.config/opencode/opencode.json` or your
project's `opencode.json` (JSONC also works). If the CLI already added a string
entry for this package, replace that entry with the object below, keeping your
other plugins:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "@madsoftwaredev/opencode-compaction-model",
      "options": {
        "model": "deepseek/deepseek-flash#max"
      }
    }
  ]
}
```

Use `provider/model#variant`, with `#variant` optional. Choose an enabled model
and supported reasoning variant from `/models`, using a provider connected in
OpenCode. The example selects direct DeepSeek; you can select another provider
and model the same way. Omitting `#variant` uses that model's default settings.

When model options are omitted, the default is
`opencode-go/deepseek-v4.1-flash#max`, which requires an OpenCode Go connection.
This default is overridable. The separate `providerID`, `modelID`, and `variant`
options are also supported; a full `model` string takes precedence over them.

There is no default character cutoff. Optional `maxTranscriptChars` is a guard:
exceeding it logs a fallback rather than silently deleting the middle of the history.

## Why the Go adapter exists

In OpenCode 2.0.8–2.0.9, `ctx.generate.text()` makes a stateless request without
`x-opencode-session`. OpenCode Go rejects that request. The plugin's Go adapter
uses the existing OpenCode connection, catalog endpoint, model ID, and variant,
and sends the **originating session ID** to the chat-completions endpoint. It does
not store an API key or change the session's model. Other providers use the native
`ctx.generate.text()` API.

The Go adapter currently supports models using
`@opencode/ai/providers/openai-compatible` (including the default DeepSeek model).
Other Go protocols produce a diagnostic and fall back to normal compaction.

## Check a compaction

Successful checkpoints carry this metadata:

```json
{
  "compactionModel": "opencode-go/deepseek-v4.1-flash#max",
  "compactionPlugin": "compaction-model"
}
```

OpenCode still stamps the checkpoint's top-level `model` with the session's working
model. Check `metadata.compactionModel` to identify the actual summarizer:

```sh
opencode api get '/api/session/SESSION_ID/message?type=compaction&order=desc&limit=1'
```

Successes and fallbacks are logged in
`~/.local/share/opencode/log/compaction-model.log` (or beneath `$XDG_DATA_HOME`).
The log does not include transcripts, summaries, credentials, or Go response bodies.

## Summary and failure behavior

- Sends the full supplied text/tool transcript, including prior checkpoints. Binary
  media is represented by a filename/type descriptor.
- Requires the checkpoint headings and retries an invalid summary once with the
  original transcript. Empty, truncated, or twice-invalid summaries are not installed.
- Go requests have a three-minute timeout and a 32,768-token output ceiling.
- On failure, logs the reason and lets OpenCode use the session's normal compaction.
- OpenCode owns automatic scheduling, recent-context retention, and checkpoint installation.
  The plugin handles requests delivered to the `compaction` hook; native provider checkpoint
  routes are outside this adapter's verification.

## Verification

From the repository root:

```sh
bun test ./packages/compaction-model/index.test.js
```

The regression suite covers Go session routing, concurrent sessions, variant selection,
long-history preservation, invalid/truncated results, and logged fallback. A live scratch
session using Muse was manually compacted with DeepSeek and its checkpoint metadata verified.

References: [V2 plugin hooks](https://opencode.ai/v2/docs/build/plugins/),
[V2 compaction](https://opencode.ai/v2/docs/compaction/).

## License

MIT
