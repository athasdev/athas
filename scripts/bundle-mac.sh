#!/usr/bin/env bash
# Builds Athas.app from the `athas` and `athas-cli` binaries. See docs/packaging.md and
# docs/release-migration.md.
#
#   scripts/bundle-mac.sh                 debug build, dev identity  -> target/debug/bundle/Athas.app
#   scripts/bundle-mac.sh --release       shipping build             -> target/release/bundle/
#   scripts/bundle-mac.sh --release --dev-identity   optimised build that stays dev.athas.gpui
#   scripts/bundle-mac.sh --no-build      bundle the binaries already built
#   scripts/bundle-mac.sh --target T      build for target triple T (x86_64-apple-darwin, ...)
#
# --release builds with ATHAS_IDENTITY=release: bundle id com.code.athas, the Tauri app's
# executable name, document types and URL scheme, so the Tauri updater can replace the installed
# Athas with this one. Next to Athas.app it writes Athas_<arch>.app.tar.gz (the updater archive),
# its .sig when a signing key is set, and Athas_<version>_<arch>.dmg.
#
# Environment:
#   ATHAS_SIGN_IDENTITY        codesign identity ("-" signs ad hoc); unset leaves the bundle unsigned
#   APPLE_ID, APPLE_PASSWORD, APPLE_TEAM_ID   notarize and staple (release, with a real identity)
#   ATHAS_SIGN_UPDATE=1        sign the updater archive (off by default: a shell may export the live key)
#   TAURI_SIGNING_PRIVATE_KEY  updater key contents (as the CI secret holds it), or
#   TAURI_SIGNING_PRIVATE_KEY_PATH  a file with it; never commit either
#   TAURI_SIGNING_PRIVATE_KEY_PASSWORD
#   ATHAS_TAURI_CLI            the `tauri` command that signs (default: ../athas/node_modules/.bin/tauri if present,
#                              else `bunx @tauri-apps/cli@2`)
#   ATHAS_ALLOW_OLD_VERSION=1  allow a shipping bundle whose version is not newer than the Tauri app's
#   ATHAS_ICON_DIR             another icon folder (default: packaging/icons, copied from the Tauri app)
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

# The last Tauri release a shipping build has to be newer than.
tauri_version="0.18.0-beta.2"

profile=debug
build=1
identity=dev
identity_set=0
target=""
while [ $# -gt 0 ]; do
    case "$1" in
        --release) profile=release ;;
        --no-build) build=0 ;;
        --dev-identity) identity=dev; identity_set=1 ;;
        --target)
            target="${2:?--target needs a triple}"
            shift
            ;;
        -h | --help)
            awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "$0"
            exit 0
            ;;
        *)
            echo "bundle-mac: unknown option $1" >&2
            exit 1
            ;;
    esac
    shift
done
if [ "$profile" = release ] && [ "$identity_set" = 0 ]; then
    identity=release
fi

if [ "$(uname)" != Darwin ]; then
    echo "bundle-mac: macOS only" >&2
    exit 1
fi

version="$(awk '/^\[workspace.package\]/ { in_package = 1; next } /^\[/ { in_package = 0 } in_package && $1 == "version" { gsub(/"/, "", $3); print $3; exit }' Cargo.toml)"
if [ -z "$version" ]; then
    echo "bundle-mac: could not read the version from Cargo.toml" >&2
    exit 1
fi

# Whether semver $1 is newer than $2 (prereleases: numeric parts compared as numbers).
version_newer() {
    local a_core="${1%%-*}" b_core="${2%%-*}" a_pre="" b_pre=""
    [[ "$1" == *-* ]] && a_pre="${1#*-}"
    [[ "$2" == *-* ]] && b_pre="${2#*-}"
    local IFS=.
    local -a a=($a_core) b=($b_core)
    for i in 0 1 2; do
        if ((10#${a[i]:-0} != 10#${b[i]:-0})); then
            ((10#${a[i]:-0} > 10#${b[i]:-0}))
            return
        fi
    done
    [ "$a_pre" = "$b_pre" ] && return 1
    [ -z "$a_pre" ] && return 0
    [ -z "$b_pre" ] && return 1
    local -a ap=($a_pre) bp=($b_pre)
    local n=${#ap[@]}
    ((${#bp[@]} > n)) && n=${#bp[@]}
    for ((i = 0; i < n; i++)); do
        local x="${ap[i]:-}" y="${bp[i]:-}"
        [ -z "$x" ] && return 1
        [ -z "$y" ] && return 0
        [ "$x" = "$y" ] && continue
        if [[ "$x" =~ ^[0-9]+$ && "$y" =~ ^[0-9]+$ ]]; then
            ((10#$x > 10#$y))
            return
        fi
        [[ "$x" > "$y" ]]
        return
    done
    return 1
}

if [ "$identity" = release ]; then
    bundle_id="com.code.athas"
    if ! version_newer "$version" "$tauri_version"; then
        if [ "${ATHAS_ALLOW_OLD_VERSION:-}" = 1 ]; then
            echo "bundle-mac: warning: $version is not newer than $tauri_version; the updater will not offer this bundle" >&2
        else
            echo "bundle-mac: a shipping bundle needs a version newer than $tauri_version (Cargo.toml has $version)." >&2
            echo "            Set [workspace.package] version, or ATHAS_ALLOW_OLD_VERSION=1 for a local dry run." >&2
            exit 1
        fi
    fi
else
    bundle_id="dev.athas.gpui"
fi

target_dir="${CARGO_TARGET_DIR:-$root/target}"
if [ -n "$target" ]; then
    binaries="$target_dir/$target/$profile"
else
    binaries="$target_dir/$profile"
fi
case "${target:-$(uname -m)}" in
    aarch64* | arm64*) arch=aarch64 ;;
    x86_64*) arch=x64 ;;
    *) arch="$(uname -m)" ;;
esac

if [ "$build" = 1 ]; then
    cargo_args=(build -p athas -p cli -j "${CARGO_BUILD_JOBS:-2}")
    [ "$profile" = release ] && cargo_args+=(--release)
    [ -n "$target" ] && cargo_args+=(--target "$target")
    if [ "$identity" = release ]; then
        ATHAS_IDENTITY=release nice -n 19 cargo "${cargo_args[@]}"
    else
        env -u ATHAS_IDENTITY nice -n 19 cargo "${cargo_args[@]}"
    fi
fi
for binary in athas athas-cli; do
    if [ ! -x "$binaries/$binary" ]; then
        echo "bundle-mac: $binaries/$binary is missing; build it first" >&2
        exit 1
    fi
done
# A binary built for the other identity would keep its own data folder and keychain entries.
if [ "$identity" = release ] && ! grep -q "dev.athas.app" "$binaries/athas"; then
    echo "bundle-mac: $binaries/athas was not built with ATHAS_IDENTITY=release" >&2
    exit 1
fi

out="$binaries/bundle"
app="$out/Athas.app"
contents="$app/Contents"
rm -rf "$app"
mkdir -p "$contents/MacOS" "$contents/Resources"

# `cp -c` clones on APFS, so the bundle takes no extra space until a binary is rebuilt.
copy() { cp -c "$1" "$2" 2>/dev/null || cp "$1" "$2"; }
# The Tauri bundle's executable is `athas` too (`CFBundleExecutable`), which the updater keeps.
copy "$binaries/athas" "$contents/MacOS/athas"
copy "$binaries/athas-cli" "$contents/MacOS/athas-cli"

icon_dir="${ATHAS_ICON_DIR:-$root/packaging/icons}"
if [ -f "$icon_dir/icon.icns" ]; then
    cp "$icon_dir/icon.icns" "$contents/Resources/icon.icns"
elif [ -f "$icon_dir/icon.png" ]; then
    iconset="$(mktemp -d)/icon.iconset"
    mkdir -p "$iconset"
    for size in 16 32 128 256 512; do
        sips -z "$size" "$size" "$icon_dir/icon.png" --out "$iconset/icon_${size}x${size}.png" >/dev/null
        double=$((size * 2))
        if [ "$double" -le 512 ]; then
            sips -z "$double" "$double" "$icon_dir/icon.png" --out "$iconset/icon_${size}x${size}@2x.png" >/dev/null
        fi
    done
    iconutil --convert icns "$iconset" --output "$contents/Resources/icon.icns"
    rm -rf "$(dirname "$iconset")"
else
    echo "bundle-mac: no icon in $icon_dir; the bundle gets the generic icon" >&2
fi

# Document types as the Tauri bundle declares them (tauri.macos.conf.json), plus folders.
extensions=(txt md markdown json jsonc yaml yml toml xml c h m mm cc cpp hpp swift rs go zig py rb php js jsx ts tsx css scss html htm sh zsh bash fish sql vue svelte)
extension_items=""
for extension in "${extensions[@]}"; do
    extension_items+="        <string>$extension</string>"$'\n'
done

cat >"$contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>English</string>
  <key>CFBundleDisplayName</key>
  <string>Athas</string>
  <key>CFBundleExecutable</key>
  <string>athas</string>
  <key>CFBundleIconFile</key>
  <string>icon.icns</string>
  <key>CFBundleIdentifier</key>
  <string>$bundle_id</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>Athas</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>$version</string>
  <key>CFBundleVersion</key>
  <string>$version</string>
  <key>CSResourcesFileMapped</key>
  <true/>
  <key>LSApplicationCategoryType</key>
  <string>public.app-category.developer-tools</string>
  <key>LSMinimumSystemVersion</key>
  <string>10.15.7</string>
  <key>NSHighResolutionCapable</key>
  <true/>
  <key>NSSupportsAutomaticGraphicsSwitching</key>
  <true/>
  <key>NSHumanReadableCopyright</key>
  <string>Copyright © 2026 Athas</string>
  <key>CFBundleURLTypes</key>
  <array>
    <dict>
      <key>CFBundleTypeRole</key>
      <string>Editor</string>
      <key>CFBundleURLName</key>
      <string>$bundle_id athas</string>
      <key>CFBundleURLSchemes</key>
      <array>
        <string>athas</string>
      </array>
    </dict>
  </array>
  <key>CFBundleDocumentTypes</key>
  <array>
    <dict>
      <key>CFBundleTypeExtensions</key>
      <array>
${extension_items}      </array>
      <key>CFBundleTypeName</key>
      <string>Text and Source Code</string>
      <key>CFBundleTypeRole</key>
      <string>Editor</string>
      <key>LSHandlerRank</key>
      <string>Alternate</string>
      <key>LSItemContentTypes</key>
      <array>
        <string>public.xml</string>
        <string>public.plain-text</string>
        <string>public.script</string>
        <string>public.html</string>
        <string>public.json</string>
        <string>public.source-code</string>
        <string>net.daringfireball.markdown</string>
      </array>
    </dict>
    <dict>
      <key>CFBundleTypeName</key>
      <string>Folder</string>
      <key>CFBundleTypeRole</key>
      <string>Editor</string>
      <key>LSHandlerRank</key>
      <string>Alternate</string>
      <key>LSItemContentTypes</key>
      <array>
        <string>public.folder</string>
      </array>
    </dict>
  </array>
  <key>NSServices</key>
  <array>
    <dict>
      <key>NSMenuItem</key>
      <dict>
        <key>default</key>
        <string>Open in Athas</string>
      </dict>
      <key>NSMessage</key>
      <string>openInAthas</string>
      <key>NSPortName</key>
      <string>Athas</string>
      <key>NSSendTypes</key>
      <array>
        <string>NSFilenamesPboardType</string>
      </array>
    </dict>
  </array>
  <key>NSMicrophoneUsageDescription</key>
  <string>Athas uses the microphone for optional voice input in Agent.</string>
  <key>NSSpeechRecognitionUsageDescription</key>
  <string>Athas uses speech recognition to transcribe optional voice input in Agent.</string>
  <key>NSDocumentsFolderUsageDescription</key>
  <string>Athas needs access to project files in Documents so terminals, Git, and editor tools can run inside your workspace.</string>
  <key>NSDesktopFolderUsageDescription</key>
  <string>Athas needs access to project files on Desktop so terminals, Git, and editor tools can run inside your workspace.</string>
  <key>NSDownloadsFolderUsageDescription</key>
  <string>Athas needs access to project files in Downloads so terminals, Git, and editor tools can run inside your workspace.</string>
</dict>
</plist>
PLIST
printf 'APPL????' >"$contents/PkgInfo"

plutil -lint "$contents/Info.plist" >/dev/null

# Only system libraries may be linked; a Homebrew library found at build time is missing on
# users' Macs (the check release.yml runs on the Tauri binary).
foreign="$(otool -L "$contents/MacOS/athas" | tail -n +2 | awk '{print $1}' | grep -vE '^(/System/|/usr/lib/)' || true)"
if [ -n "$foreign" ]; then
    echo "bundle-mac: athas links libraries users' Macs do not have:" >&2
    echo "$foreign" >&2
    [ "$identity" = release ] && exit 1
fi

signed=0
if [ -n "${ATHAS_SIGN_IDENTITY:-}" ]; then
    sign_args=(--force --sign "$ATHAS_SIGN_IDENTITY")
    if [ "$ATHAS_SIGN_IDENTITY" != - ]; then
        # Notarization needs the hardened runtime and a secure timestamp.
        sign_args+=(--options runtime --timestamp)
        signed=1
    fi
    codesign "${sign_args[@]}" "$contents/MacOS/athas-cli"
    codesign "${sign_args[@]}" --entitlements "$root/scripts/macos/Athas.entitlements" "$app"
    codesign --verify --strict --deep "$app"
fi

if [ "$profile" != release ]; then
    echo "$app ($version, $profile, $bundle_id)"
    exit 0
fi

if [ "$signed" = 1 ] && [ -n "${APPLE_ID:-}" ] && [ -n "${APPLE_PASSWORD:-}" ] && [ -n "${APPLE_TEAM_ID:-}" ]; then
    submission="$(mktemp -d)/Athas.zip"
    ditto -c -k --keepParent "$app" "$submission"
    xcrun notarytool submit "$submission" --apple-id "$APPLE_ID" --password "$APPLE_PASSWORD" --team-id "$APPLE_TEAM_ID" --wait
    xcrun stapler staple "$app"
    rm -rf "$(dirname "$submission")"
elif [ "$identity" = release ]; then
    echo "bundle-mac: not notarized (needs ATHAS_SIGN_IDENTITY, APPLE_ID, APPLE_PASSWORD, APPLE_TEAM_ID)" >&2
fi

# The updater archive: `Athas.app/...` at its root, as `tauri build` packs it.
archive="$out/Athas_${arch}.app.tar.gz"
rm -f "$archive" "$archive.sig"
COPYFILE_DISABLE=1 tar -czf "$archive" -C "$out" Athas.app

# Opt-in, because a developer shell may export the production key for the Tauri app: only the
# release workflow (or someone who means it) sets ATHAS_SIGN_UPDATE=1.
if [ "${ATHAS_SIGN_UPDATE:-}" = 1 ] && [ -n "${TAURI_SIGNING_PRIVATE_KEY:-}${TAURI_SIGNING_PRIVATE_KEY_PATH:-}" ]; then
    tauri_cli="${ATHAS_TAURI_CLI:-}"
    if [ -z "$tauri_cli" ] && [ -x "$root/../athas/node_modules/.bin/tauri" ]; then
        tauri_cli="$root/../athas/node_modules/.bin/tauri"
    fi
    if [ -n "$tauri_cli" ]; then
        $tauri_cli signer sign "$archive" >/dev/null
    else
        bunx @tauri-apps/cli@2 signer sign "$archive" >/dev/null
    fi
    test -s "$archive.sig"
else
    echo "bundle-mac: the updater archive is unsigned (needs ATHAS_SIGN_UPDATE=1 and TAURI_SIGNING_PRIVATE_KEY or _PATH)" >&2
fi

dmg="$out/Athas_${version}_${arch}.dmg"
rm -f "$dmg"
staging="$(mktemp -d)"
cp -R "$app" "$staging/Athas.app"
ln -s /Applications "$staging/Applications"
hdiutil create -quiet -volname Athas -srcfolder "$staging" -fs HFS+ -format UDZO -ov "$dmg"
rm -rf "$staging"
if [ "$signed" = 1 ]; then
    codesign --force --sign "$ATHAS_SIGN_IDENTITY" --timestamp "$dmg"
    if [ -n "${APPLE_ID:-}" ] && [ -n "${APPLE_PASSWORD:-}" ] && [ -n "${APPLE_TEAM_ID:-}" ]; then
        xcrun notarytool submit "$dmg" --apple-id "$APPLE_ID" --password "$APPLE_PASSWORD" --team-id "$APPLE_TEAM_ID" --wait
        xcrun stapler staple "$dmg"
    fi
fi

echo "$app ($version, $profile, $bundle_id)"
if [ -f "$archive.sig" ]; then echo "$archive (+ .sig)"; else echo "$archive"; fi
echo "$dmg"
