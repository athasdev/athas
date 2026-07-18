#!/usr/bin/env bash

find_cef_dir() {
  local roots=()

  if [[ -n "${CEF_PATH:-}" ]]; then
    roots+=("$CEF_PATH")
  fi

  roots+=(
    ".cache/tauri-cef"
    "${HOME}/.cache/tauri-cef"
    "${HOME}/.local/share/cef"
    "target/release/build"
    "target/debug/build"
  )

  for root in "${roots[@]}"; do
    if [[ -f "${root}/libcef.so" ]]; then
      dirname "${root}/libcef.so"
      return 0
    fi

    if [[ -d "$root" ]]; then
      local found
      found="$(find "$root" -maxdepth 5 -type f -name libcef.so -print -quit)"
      if [[ -n "$found" ]]; then
        dirname "$found"
        return 0
      fi
    fi
  done

  return 1
}
