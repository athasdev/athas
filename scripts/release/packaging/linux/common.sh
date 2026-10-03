#!/usr/bin/env bash
# Shared helpers for the Linux tarball and Flatpak packaging scripts.

normalize_linux_arch() {
  case "$1" in
    X64 | x64 | amd64 | x86_64)
      echo "x86_64"
      ;;
    ARM64 | arm64 | aarch64)
      echo "aarch64"
      ;;
    *)
      echo "Unsupported Linux architecture: $1" >&2
      return 1
      ;;
  esac
}

# Product names and ids shared by the Linux packaging scripts.
product_name="Athas"
app_dir_name="athas.app"
icon_dir="prod"
desktop_id="com.code.athas"
url_scheme="athas"

# install_linux_icons <hicolor-dir> <icon-name>
install_linux_icons() {
  local hicolor_dir="$1"
  local icon_name="$2"
  local size

  for size in 32 128; do
    install -D -m 644 \
      "src-tauri/icons/${icon_dir}/${size}x${size}.png" \
      "${hicolor_dir}/${size}x${size}/apps/${icon_name}.png"
  done

  install -D -m 644 \
    "src-tauri/icons/${icon_dir}/128x128@2x.png" \
    "${hicolor_dir}/256x256/apps/${icon_name}.png"
}

# Renders the desktop template that the Tauri bundler uses for deb and rpm.
# render_linux_desktop_entry <exec> <icon>
render_linux_desktop_entry() {
  local exec="$1"
  local icon="$2"

  sed \
    -e '/^{{#if comment}}$/,/^{{\/if}}$/d' \
    -e '/^{{#if mime_type}}$/d' \
    -e '/^{{\/if}}$/d' \
    -e "s|{{exec}}|${exec}|g" \
    -e "s|{{icon}}|${icon}|g" \
    -e "s|{{name}}|${product_name}|g" \
    -e "s|{{mime_type}}|x-scheme-handler/${url_scheme}|g" \
    src-tauri/linux/athas.desktop
}
