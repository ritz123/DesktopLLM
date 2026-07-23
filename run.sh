#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"
unset ELECTRON_RUN_AS_NODE

app=./dist/linux-unpacked/desktopllm
needs_package=false
shopt -s globstar nullglob
for source in package.json vite.config.ts index.html src/**/* electron/**/*; do
  if [[ "$source" -nt "$app" ]]; then
    needs_package=true
    break
  fi
done

if [[ ! -x "$app" || "$needs_package" == true ]]; then
  npm run package
fi

electron_args=(--disable-gpu)
if [[ "$(id -u)" -eq 0 ]]; then
  electron_args+=(--no-sandbox)
fi

exec "$app" "${electron_args[@]}"
