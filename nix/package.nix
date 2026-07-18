{
  lib,
  stdenv,
  fetchurl,
  autoPatchelfHook,
  makeWrapper,
  wrapGAppsHook3,
  glib,
  gtk3,
  gdk-pixbuf,
  cairo,
  pango,
  atk,
  at-spi2-core,
  nss,
  nspr,
  dbus,
  cups,
  expat,
  zlib,
  xz,
  alsa-lib,
  libxkbcommon,
  libgbm,
  mesa,
  libGL,
  libdrm,
  fontconfig,
  freetype,
  systemdLibs,
  libx11,
  libxcb,
  libxcomposite,
  libxdamage,
  libxext,
  libxfixes,
  libxrandr,
  libxrender,
  libxcursor,
  libxi,
  libxtst,
  libxscrnsaver,
  libxshmfence,
}:

let
  pname = "athas";
  version = "0.9.0";

  # Keep the formatting of these lines stable
  # (one `"<system>" = "sha256-...";` per line) so the workflow's sed can find
  # them.
  hashes = {
    "x86_64-linux" = "sha256-o8Z6fMHGlPzFRSYiYEEHlbWfW3L24vOZV1uyB4fInnc=";
    "aarch64-linux" = "sha256-5jjGmh8XutNfncqrnamutxnLOUnkncCocZYAZNPZkyY=";
  };

  arches = {
    "x86_64-linux" = "x86_64";
    "aarch64-linux" = "aarch64";
  };

  mkSource =
    system:
    fetchurl {
      url = "https://github.com/athasdev/athas/releases/download/v${version}/Athas_${version}_linux-${arches.${system}}.tar.gz";
      hash = hashes.${system};
    };

  src =
    if hashes ? ${stdenv.hostPlatform.system} then
      mkSource stdenv.hostPlatform.system
    else
      throw "athas: unsupported system ${stdenv.hostPlatform.system}";

  runtimeLibs = [
    glib
    gtk3
    gdk-pixbuf
    cairo
    pango
    atk
    at-spi2-core
    nss
    nspr
    dbus
    cups
    expat
    zlib
    xz
    alsa-lib
    libxkbcommon
    libgbm
    mesa
    libGL
    libdrm
    fontconfig
    freetype
    systemdLibs
    libx11
    libxcb
    libxcomposite
    libxdamage
    libxext
    libxfixes
    libxrandr
    libxrender
    libxcursor
    libxi
    libxtst
    libxscrnsaver
    libxshmfence
  ];
in
stdenv.mkDerivation {
  inherit pname version src;

  sourceRoot = "athas.app";

  nativeBuildInputs = [
    autoPatchelfHook
    makeWrapper
    wrapGAppsHook3
  ];

  buildInputs = runtimeLibs;

  dontWrapGApps = true;

  # The upstream Linux launcher disables Vulkan, so this library is optional.
  autoPatchelfIgnoreMissingDeps = [ "libvulkan.so.1" ];

  installPhase = ''
    runHook preInstall

    mkdir -p $out/libexec $out/lib $out/share
    cp -r libexec/. $out/libexec/
    cp -r lib/. $out/lib/
    cp -r share/. $out/share/

    makeWrapper $out/libexec/athas $out/bin/athas \
      --add-flags "--ozone-platform=x11 --disable-vulkan --disable-features=Vulkan" \
      --prefix LD_LIBRARY_PATH : "$out/libexec:${lib.makeLibraryPath runtimeLibs}" \
      "''${gappsWrapperArgs[@]}"

    runHook postInstall
  '';

  meta = {
    description = "Athas — a fast, extensible code editor (prebuilt Linux release)";
    homepage = "https://github.com/athasdev/athas";
    changelog = "https://github.com/athasdev/athas/releases/tag/v${version}";
    license = lib.licenses.agpl3Only;
    sourceProvenance = with lib.sourceTypes; [ binaryNativeCode ];
    platforms = [
      "x86_64-linux"
      "aarch64-linux"
    ];
    mainProgram = "athas";
  };
}
