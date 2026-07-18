#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${script_dir}/cef.sh"

usage() {
  cat <<'EOF'
Usage: scripts/release/package-linux-native.sh <deb|rpm|appimage|all> [--preview]

Build experimental native Linux packages for the CEF runtime.

Examples:
  scripts/release/package-linux-native.sh deb
  scripts/release/package-linux-native.sh rpm
  scripts/release/package-linux-native.sh appimage
  scripts/release/package-linux-native.sh all --preview
EOF
}

target="${1:-}"
channel="${2:-}"

if [[ -z "$target" || "$target" == "-h" || "$target" == "--help" ]]; then
  usage
  exit 0
fi

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "Native Linux packages must be built on Linux." >&2
  exit 1
fi

case "$target" in
  deb)
    bundles="deb"
    ;;
  rpm)
    bundles="rpm"
    ;;
  appimage)
    bundles="appimage"
    ;;
  all)
    bundles="deb,rpm,appimage"
    ;;
  *)
    echo "Unsupported package target: $target" >&2
    usage >&2
    exit 1
    ;;
esac

config_args=()
if [[ "$channel" == "--preview" ]]; then
  config_args+=(--config src-tauri/tauri.preview.conf.json)
elif [[ -n "$channel" ]]; then
  echo "Unsupported option: $channel" >&2
  usage >&2
  exit 1
fi

# Disable updater artifacts for local package builds so this path does not
# require release signing secrets.
config_args+=(--config '{"bundle":{"createUpdaterArtifacts":false}}')

export CEF_PATH="${CEF_PATH:-$PWD/.cache/tauri-cef}"
export NO_STRIP="${NO_STRIP:-true}"

cef_dir="$(find_cef_dir)" || {
  echo "Could not find a CEF distribution containing libcef.so." >&2
  echo "Set CEF_PATH or run the Linux build once to populate .cache/tauri-cef." >&2
  exit 1
}
cef_dir="$(cd "$cef_dir" && pwd)"

cef_files=(
  libcef.so
  icudtl.dat
  v8_context_snapshot.bin
  chrome_100_percent.pak
  chrome_200_percent.pak
  resources.pak
  libEGL.so
  libGLESv2.so
  libvk_swiftshader.so
  vk_swiftshader_icd.json
  libvulkan.so.1
  chrome-sandbox
)

for file in "${cef_files[@]}"; do
  if [[ ! -f "${cef_dir}/${file}" ]]; then
    echo "CEF file is missing: ${cef_dir}/${file}" >&2
    exit 1
  fi
done

if [[ ! -d "${cef_dir}/locales" ]]; then
  echo "CEF locales directory is missing: ${cef_dir}/locales" >&2
  exit 1
fi

native_config="$(mktemp)"
trap 'rm -f "$native_config"' EXIT

CEF_DIR="$cef_dir" NATIVE_CONFIG="$native_config" bun --eval '
const cefDir = Bun.env.CEF_DIR;
const nativeConfig = Bun.env.NATIVE_CONFIG;
const workspace = process.cwd();
const files = [
  "libcef.so",
  "icudtl.dat",
  "v8_context_snapshot.bin",
  "chrome_100_percent.pak",
  "chrome_200_percent.pak",
  "resources.pak",
  "libEGL.so",
  "libGLESv2.so",
  "libvk_swiftshader.so",
  "vk_swiftshader_icd.json",
  "libvulkan.so.1",
  "chrome-sandbox",
];
const resources = {
  [`${workspace}/src/extensions/bundled`]: "bundled",
  [`${cefDir}/locales`]: "locales",
};
for (const file of files) {
  resources[`${cefDir}/${file}`] = file;
}
await Bun.write(
  nativeConfig,
  JSON.stringify(
    {
      bundle: {
        resources,
        linux: {
          deb: {
            depends: [
              "libgtk-3-0",
              "libnss3",
              "libnspr4",
              "libasound2",
              "libx11-6",
              "libxcomposite1",
              "libxdamage1",
              "libxrandr2",
              "libgbm1",
              "libatk-bridge2.0-0",
              "libxkbcommon0",
              "libdrm2",
              "libxcb1",
              "libxfixes3",
              "libxext6",
              "libglib2.0-0",
              "libpango-1.0-0",
              "libcairo2",
              "libgdk-pixbuf-2.0-0",
            ],
          },
          rpm: {
            depends: [
              "gtk3",
              "nss",
              "nspr",
              "alsa-lib",
              "libX11",
              "libXcomposite",
              "libXdamage",
              "libXrandr",
              "mesa-libgbm",
              "at-spi2-atk",
              "libxkbcommon",
              "libdrm",
              "libxcb",
              "libXfixes",
              "libXext",
              "glib2",
              "pango",
              "cairo",
              "gdk-pixbuf2",
            ],
          },
        },
      },
    },
    null,
    2,
  ),
);
'

config_args+=(--config "$native_config")

cargo tauri build \
  --bundles "$bundles" \
  "${config_args[@]}" \
  -- \
  --no-default-features \
  --features linux

patch_deb_dependencies() {
  local depends="libgtk-3-0, libnss3, libnspr4, libasound2, libx11-6, libxcomposite1, libxdamage1, libxrandr2, libgbm1, libatk-bridge2.0-0, libxkbcommon0, libdrm2, libxcb1, libxfixes3, libxext6, libglib2.0-0, libpango-1.0-0, libcairo2, libgdk-pixbuf-2.0-0"
  local deb

  while IFS= read -r deb; do
    local work_dir
    work_dir="$(mktemp -d)"

    dpkg-deb -R "$deb" "$work_dir/package"
    awk -v depends="$depends" '
      BEGIN { replaced = 0 }
      /^Depends:/ {
        print "Depends: " depends
        replaced = 1
        next
      }
      { print }
      END {
        if (!replaced) {
          print "Depends: " depends
        }
      }
    ' "$work_dir/package/DEBIAN/control" > "$work_dir/control"
    mv "$work_dir/control" "$work_dir/package/DEBIAN/control"
    dpkg-deb --root-owner-group -b "$work_dir/package" "$work_dir/repacked.deb" >/dev/null
    mv "$work_dir/repacked.deb" "$deb"
    rm -rf "$work_dir"
  done < <(find target/release/bundle/deb -maxdepth 1 -type f -name '*.deb' -print)
}

if [[ "$bundles" == "deb" || "$bundles" == "deb,"* || "$bundles" == *",deb" || "$bundles" == *",deb,"* ]]; then
  patch_deb_dependencies
fi
