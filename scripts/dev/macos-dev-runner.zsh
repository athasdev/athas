#!/bin/zsh

set -euo pipefail

binary_path="${1:-}"
if [[ -z "$binary_path" ]]; then
  print -u2 "macOS dev runner requires the application binary path"
  exit 1
fi
shift

script_dir="${0:A:h}"
repo_root="${script_dir:h:h}"
signing_identity="${APPLE_SIGNING_IDENTITY:-}"
identifier="${ATHAS_DEV_CODE_SIGN_IDENTIFIER:-}"

if [[ -z "$signing_identity" ]]; then
  signing_identity="$(
    /usr/bin/plutil -extract bundle.macOS.signingIdentity raw -o - \
      "$repo_root/src-tauri/tauri.conf.json" 2>/dev/null || true
  )"
fi

if [[ -n "$signing_identity" && -n "$identifier" ]]; then
  identities="$(/usr/bin/security find-identity -v -p codesigning)"
  if [[ "$identities" == *\"$signing_identity\"* ]]; then
    /usr/bin/codesign \
      --force \
      --sign "$signing_identity" \
      --timestamp=none \
      --identifier "$identifier" \
      "$binary_path"
  else
    print -u2 "macOS dev signing identity is unavailable: $signing_identity"
  fi
fi

exec "$binary_path" "$@"
