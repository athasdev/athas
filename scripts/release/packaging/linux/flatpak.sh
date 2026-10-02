#!/usr/bin/env bash
set -euo pipefail

# Builds a single-file Flatpak bundle from the release tarball. Run
# package-linux-tarball.sh first. Needs flatpak and flatpak-builder, plus a
# user-level flathub remote for the GNOME runtime and SDK:
#   flatpak remote-add --user --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${script_dir}/common.sh"

arch="$(normalize_linux_arch "${1:?Usage: flatpak.sh <arch> [out-dir]}")"
out_dir="${2:-release-dist}"

for tool in flatpak flatpak-builder; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "${tool} is required to build the Flatpak bundle." >&2
    exit 1
  fi
done

version="$(bun -e 'console.log(JSON.parse(await Bun.file("package.json").text()).version)')"
tarball="${out_dir}/${product_name}_${version}_linux-${arch}.tar.gz"
if [[ ! -f "$tarball" ]]; then
  echo "Missing Linux tarball at ${tarball}" >&2
  exit 1
fi

work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT

cp "$tarball" "${work_dir}/athas.tar.gz"
cp flatpak/com.code.athas.yml "${work_dir}/${desktop_id}.yml"
sed \
  -e "s/@VERSION@/${version}/" \
  -e "s/@DATE@/$(date -u +%F)/" \
  flatpak/com.code.athas.metainfo.xml > "${work_dir}/${desktop_id}.metainfo.xml"

flatpak-builder \
  --user \
  --arch="$arch" \
  --force-clean \
  --disable-rofiles-fuse \
  --install-deps-from=flathub \
  --repo="${work_dir}/repo" \
  "${work_dir}/build" \
  "${work_dir}/${desktop_id}.yml"

install -d "$out_dir"
bundle_path="${out_dir}/${product_name}_${version}_linux-${arch}.flatpak"
flatpak build-bundle \
  --arch="$arch" \
  --runtime-repo=https://dl.flathub.org/repo/flathub.flatpakrepo \
  "${work_dir}/repo" \
  "$bundle_path" \
  "$desktop_id"

echo "Created ${bundle_path}"
