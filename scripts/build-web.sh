#!/usr/bin/env bash
# Builds the web workbench (`crates/athas_web`) into a folder `athas-server --web` serves.
#
#   scripts/build-web.sh             debug build      -> target/web/debug
#   scripts/build-web.sh --release   size-optimised   -> target/web/release
#   scripts/build-web.sh --no-build  package the wasm already built
#
# wasm-bindgen-cli is installed into target/tools at the version in Cargo.lock. wasm-opt runs on
# release builds when it is on PATH. CARGO_BUILD_JOBS limits the build (default 2).
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

profile=dev
build=1
for arg in "$@"; do
    case "$arg" in
        --release) profile=web-release ;;
        --no-build) build=0 ;;
        -h | --help)
            sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'
            exit 0
            ;;
        *)
            echo "build-web: unknown option $arg" >&2
            exit 1
            ;;
    esac
done

target=wasm32-unknown-unknown
out_dir=$([ "$profile" = dev ] && echo debug || echo "$profile")
dist="target/web/$([ "$profile" = dev ] && echo debug || echo release)"
wasm="target/$target/$out_dir/athas_web.wasm"

version=$(awk '/^name = "wasm-bindgen"$/ { getline; gsub(/"/, "", $3); print $3; exit }' Cargo.lock)
[ -n "$version" ] || { echo "build-web: wasm-bindgen is not in Cargo.lock" >&2; exit 1; }
bindgen="target/tools/bin/wasm-bindgen"
if [ ! -x "$bindgen" ] || [ "$("$bindgen" --version | awk '{ print $2 }')" != "$version" ]; then
    echo "build-web: installing wasm-bindgen-cli $version into target/tools"
    nice -n 19 cargo install --root target/tools wasm-bindgen-cli --version "$version" --locked -j "${CARGO_BUILD_JOBS:-2}"
fi

if [ "$build" = 1 ]; then
    nice -n 19 cargo build -j "${CARGO_BUILD_JOBS:-2}" --target "$target" --profile "$profile" -p athas_web
fi
[ -f "$wasm" ] || { echo "build-web: $wasm is missing" >&2; exit 1; }

rm -rf "$dist"
mkdir -p "$dist"
"$bindgen" --target web --no-typescript $([ "$profile" = dev ] && echo --keep-debug) --out-dir "$dist" "$wasm"
if [ "$profile" != dev ] && command -v wasm-opt > /dev/null; then
    wasm-opt -Os --enable-bulk-memory --enable-nontrapping-float-to-int --enable-sign-ext --enable-mutable-globals \
        --enable-reference-types --enable-multivalue -o "$dist/athas_web_bg.wasm" "$dist/athas_web_bg.wasm"
fi
cp crates/athas_web/web/index.html "$dist/"

echo "build-web: $dist ($(du -h "$dist/athas_web_bg.wasm" | awk '{ print $1 }') wasm)"
echo "build-web: serve it with: cargo run -p athas_server -- --root <project> --web $dist"
