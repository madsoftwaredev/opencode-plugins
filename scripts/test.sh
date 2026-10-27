#!/usr/bin/env bash
# OpenTUI versions register process-global native state; test each package alone.
set -euo pipefail

for dir in ./packages/*/; do
  tests=("${dir}"*.test.*)
  [[ -e "${tests[0]}" ]] || continue
  bun test --cwd "$dir" --preload @opentui/solid/preload
done

bun test ./scripts
