#!/usr/bin/env bash
set -euo pipefail

# Builds a single-file Flatpak bundle from the release tarball. Run
# package-linux-tarball.sh first. Needs flatpak, a user-level flathub remote
# for the GNOME runtime and SDK, and Flathub's builder app:
#   flatpak remote-add --user --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo
#   flatpak install --user -y flathub org.flatpak.Builder
# A distro flatpak-builder is used when the app is missing, but releases older
# than 1.3 call appstream-compose, which GNOME 50's SDK no longer ships.

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${script_dir}/common.sh"

arch="$(normalize_linux_arch "${1:?Usage: flatpak.sh <arch> [out-dir]}")"
out_dir="${2:-release-dist}"

if ! command -v flatpak >/dev/null 2>&1; then
  echo "flatpak is required to build the Flatpak bundle." >&2
  exit 1
fi
if flatpak info --user org.flatpak.Builder >/dev/null 2>&1; then
  builder=(flatpak run --command=flatpak-builder org.flatpak.Builder)
elif command -v flatpak-builder >/dev/null 2>&1; then
  builder=(flatpak-builder)
else
  echo "org.flatpak.Builder or flatpak-builder is required to build the Flatpak bundle." >&2
  exit 1
fi

version="$(bun -e 'console.log(JSON.parse(await Bun.file("package.json").text()).version)')"
tarball="${out_dir}/${product_name}_${version}_linux-${arch}.tar.gz"
if [[ ! -f "$tarball" ]]; then
  echo "Missing Linux tarball at ${tarball}" >&2
  exit 1
fi

# Inside the checkout rather than /tmp: the builder app has its own /tmp.
work_dir="${PWD}/target/flatpak-build"
rm -rf "$work_dir"
mkdir -p "$work_dir"
trap 'rm -rf "$work_dir"' EXIT

cp "$tarball" "${work_dir}/athas.tar.gz"
cp flatpak/com.code.athas.yml "${work_dir}/${desktop_id}.yml"
sed \
  -e "s/@VERSION@/${version}/" \
  -e "s/@DATE@/$(date -u +%F)/" \
  flatpak/com.code.athas.metainfo.xml > "${work_dir}/${desktop_id}.metainfo.xml"

# The runtime and SDK are installed by the host flatpak: the builder app can
# only install them over a D-Bus session, which CI runners do not have.
runtime="$(sed -n 's/^runtime: *//p' flatpak/com.code.athas.yml)"
sdk="$(sed -n 's/^sdk: *//p' flatpak/com.code.athas.yml)"
runtime_version="$(sed -n 's/^runtime-version: *"\{0,1\}\([^"]*\)"\{0,1\}$/\1/p' flatpak/com.code.athas.yml)"
flatpak install --user -y --noninteractive --arch="$arch" flathub \
  "${runtime}//${runtime_version}" "${sdk}//${runtime_version}"

if [[ -z "${DBUS_SESSION_BUS_ADDRESS:-}" ]] && command -v dbus-run-session >/dev/null 2>&1; then
  builder=(dbus-run-session -- "${builder[@]}")
fi

"${builder[@]}" \
  --user \
  --arch="$arch" \
  --force-clean \
  --disable-rofiles-fuse \
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
