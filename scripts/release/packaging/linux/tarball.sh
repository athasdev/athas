#!/usr/bin/env bash
set -euo pipefail

# Portable tarball for package managers that wrap the release binary
# themselves (the Nix package in nix/package.nix, and the Flatpak manifest).
# It links against the host WebKitGTK 4.1 and GTK 3 instead of bundling them.

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${script_dir}/common.sh"

arch="$(normalize_linux_arch "${1:?Usage: package-linux-tarball.sh <arch> [out-dir]}")"
out_dir="${2:-release-dist}"

version="$(bun -e 'console.log(JSON.parse(await Bun.file("package.json").text()).version)')"
binary="${CARGO_TARGET_DIR:-target}/release/athas"

if [[ ! -x "$binary" ]]; then
  echo "Missing release binary at $binary" >&2
  exit 1
fi

staging="$(mktemp -d)"
trap 'rm -rf "$staging"' EXIT

app_root="${staging}/${app_dir_name}"
# Tauri resolves resources from <prefix>/lib/<productName> next to <prefix>/bin.
resource_dir="${app_root}/lib/${product_name}"

install -D -m 755 "$binary" "${app_root}/bin/athas"
# The Tauri bundler stamps the bundle type into the binary while it builds
# deb, rpm and AppImage packages. A tarball must report an unknown bundle so
# the in-app updater leaves it to the package manager that installed it.
perl -0777 -pi -e 's/__TAURI_BUNDLE_TYPE_VAR_(?:DEB|RPM|APP)/__TAURI_BUNDLE_TYPE_VAR_UNK/g' \
  "${app_root}/bin/athas"
if command -v strip >/dev/null 2>&1; then
  strip --strip-unneeded "${app_root}/bin/athas"
fi

install -d "${resource_dir}/bundled"
cp -R src/extensions/bundled/icon-themes "${resource_dir}/bundled/icon-themes"

install_linux_icons "${app_root}/share/icons/hicolor" athas
render_linux_desktop_entry "athas %U" athas > "${staging}/athas.desktop"
install -D -m 644 "${staging}/athas.desktop" "${app_root}/share/applications/${desktop_id}.desktop"

install -d "$out_dir"
archive_path="${out_dir}/${product_name}_${version}_linux-${arch}.tar.gz"
tar -C "$staging" -czf "$archive_path" "$app_dir_name"

archive_contents="${staging}/archive-contents.txt"
tar -tzf "$archive_path" > "$archive_contents"

for required in \
  "${app_dir_name}/bin/athas" \
  "${app_dir_name}/lib/${product_name}/bundled" \
  "${app_dir_name}/share/applications/${desktop_id}.desktop"
do
  if ! grep -Fxq "$required" "$archive_contents" \
    && ! grep -Fxq "${required}/" "$archive_contents"; then
    echo "Linux tarball is missing ${required}" >&2
    exit 1
  fi
done

echo "Created ${archive_path}"
