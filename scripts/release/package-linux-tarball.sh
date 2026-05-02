#!/usr/bin/env bash
set -euo pipefail

arch_input="${1:?Usage: package-linux-tarball.sh <arch> [out-dir]}"
out_dir="${2:-release-dist}"
channel="${ATHAS_RELEASE_CHANNEL:-stable}"

case "$arch_input" in
  X64 | x64 | amd64 | x86_64)
    arch="x86_64"
    ;;
  ARM64 | arm64 | aarch64)
    arch="aarch64"
    ;;
  *)
    echo "Unsupported Linux architecture: $arch_input" >&2
    exit 1
    ;;
esac

if [[ "$channel" == "preview" ]]; then
  product_name="Athas Preview"
  app_dir_name="athas-preview.app"
  icon_dir="preview"
  desktop_id="com.code.athas.preview"
else
  product_name="Athas"
  app_dir_name="athas.app"
  icon_dir="prod"
  desktop_id="com.code.athas"
fi

version="$(bun -e 'console.log(JSON.parse(await Bun.file("package.json").text()).version)')"
binary="target/release/athas"

if [[ ! -x "$binary" ]]; then
  echo "Missing release binary at $binary" >&2
  exit 1
fi

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

cef_dir="$(find_cef_dir)" || {
  echo "Could not find a CEF distribution containing libcef.so." >&2
  echo "Set CEF_PATH or run the Linux build first." >&2
  exit 1
}

if command -v readelf >/dev/null 2>&1; then
  if ! readelf -d "$binary" | grep -q '\$ORIGIN'; then
    echo "Release binary does not include an \$ORIGIN RUNPATH for bundled CEF." >&2
    exit 1
  fi
fi

staging="$(mktemp -d)"
trap 'rm -rf "$staging"' EXIT

app_root="${staging}/${app_dir_name}"
bin_dir="${app_root}/bin"
libexec_dir="${app_root}/libexec"
resource_dir="${app_root}/lib/${product_name}"
desktop_dir="${app_root}/share/applications"
icon_base_dir="${app_root}/share/icons/hicolor"

install -d "$bin_dir" "$libexec_dir" "$resource_dir" "$desktop_dir"
install -m 755 "$binary" "${libexec_dir}/athas"
ln -s ../libexec/athas "${bin_dir}/athas"

cp -R src/extensions/bundled "${resource_dir}/bundled"

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
  install -m 755 "${cef_dir}/${file}" "${libexec_dir}/${file}"
done

if [[ ! -d "${cef_dir}/locales" ]]; then
  echo "CEF locales directory is missing: ${cef_dir}/locales" >&2
  exit 1
fi
install -d "${libexec_dir}/locales"
cp "${cef_dir}/locales/"*.pak "${libexec_dir}/locales/"

if command -v strip >/dev/null 2>&1; then
  find "$libexec_dir" -maxdepth 1 -type f \( -name '*.so' -o -name '*.so.*' \) -exec strip --strip-unneeded {} +
fi

for size in 32 128; do
  icon_src="src-tauri/icons/${icon_dir}/${size}x${size}.png"
  if [[ -f "$icon_src" ]]; then
    install -D -m 644 "$icon_src" "${icon_base_dir}/${size}x${size}/apps/athas.png"
  fi
done

if [[ -f "src-tauri/icons/${icon_dir}/128x128@2x.png" ]]; then
  install -D -m 644 \
    "src-tauri/icons/${icon_dir}/128x128@2x.png" \
    "${icon_base_dir}/256x256@2/apps/athas.png"
fi

cat > "${desktop_dir}/${desktop_id}.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=${product_name}
Exec=athas %U
Icon=athas
Terminal=false
Categories=Development;TextEditor;
MimeType=text/plain;
StartupNotify=true
EOF

install -d "$out_dir"
archive_name="${product_name}_${version}_linux-${arch}.tar.gz"
archive_path="${out_dir}/${archive_name}"
tar -C "$staging" -czf "$archive_path" "$app_dir_name"

archive_contents="${staging}/archive-contents.txt"
tar -tzf "$archive_path" > "$archive_contents"

for required in \
  "${app_dir_name}/libexec/athas" \
  "${app_dir_name}/libexec/libcef.so" \
  "${app_dir_name}/libexec/icudtl.dat" \
  "${app_dir_name}/libexec/locales/en-US.pak" \
  "${app_dir_name}/lib/${product_name}/bundled"
do
  if ! grep -Fxq "$required" "$archive_contents" \
    && ! grep -Fxq "${required}/" "$archive_contents"; then
    echo "Linux tarball is missing ${required}" >&2
    exit 1
  fi
done

echo "Created ${archive_path}"
