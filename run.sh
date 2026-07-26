#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"
unset ELECTRON_RUN_AS_NODE

# NFS may leave busy .nfs* stubs when a previous binary is still open.
# Move the tree aside so packaging can recreate ./release, then delete best-effort.
nfs_safe_rm() {
  local target=$1
  [[ -e "$target" || -L "$target" ]] || return 0
  local trash="${target}.trash.$$"
  mv "$target" "$trash"
  rm -rf "$trash" 2>/dev/null || true
}

app=./release/linux-unpacked/desktopllm
needs_package=false
shopt -s globstar nullglob
for source in package.json vite.config.ts index.html src/**/* electron/**/*; do
  if [[ "$source" -nt "$app" ]]; then
    needs_package=true
    break
  fi
done

if [[ ! -x "$app" || "$needs_package" == true ]]; then
  nfs_safe_rm ./release
  npm run package
fi

electron_args=(--disable-gpu)
if [[ "$(id -u)" -eq 0 ]]; then
  electron_args+=(--no-sandbox)
fi

exec "$app" "${electron_args[@]}"
