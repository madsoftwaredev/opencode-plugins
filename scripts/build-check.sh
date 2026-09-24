#!/usr/bin/env bash
# Transpile every plugin entrypoint to catch syntax and import-shape regressions.
# OpenCode supplies @opencode/*, @opentui/*, and solid-js at runtime, so those
# stay external here.
set -euo pipefail

server_externals=(--target=bun --external '@opencode/*')
tui_externals=(--target=bun --external '@opencode/*' --external '@opentui/*' --external 'solid-js')

bun build "${server_externals[@]}" packages/background-subagent/index.ts >/dev/null
bun build "${server_externals[@]}" packages/compaction-model/index.ts >/dev/null
bun build "${server_externals[@]}" packages/direnv/index.ts >/dev/null
bun build "${server_externals[@]}" packages/lint-feedback/index.ts >/dev/null
bun build "${tui_externals[@]}" packages/btw/tui.ts >/dev/null
bun build "${tui_externals[@]}" packages/subagent-sidebar/tui.tsx >/dev/null
bun build "${tui_externals[@]}" packages/stats/tui.tsx >/dev/null

echo "build check ok"
