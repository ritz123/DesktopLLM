#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"
unset ELECTRON_RUN_AS_NODE

app=./dist/linux-unpacked/desktopllm
if [[ ! -x "$app" || electron/main.ts -nt "$app" || electron/preload.cts -nt "$app" || electron/tools.ts -nt "$app" || src/App.tsx -nt "$app" || vite.config.ts -nt "$app" || package.json -nt "$app" ]]; then
  npm run package
fi

electron_args=(--disable-gpu)
if [[ "$(id -u)" -eq 0 ]]; then
  electron_args+=(--no-sandbox)
fi

exec "$app" "${electron_args[@]}"
