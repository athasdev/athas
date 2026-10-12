{
  lib,
  stdenv,
  fetchurl,
  autoPatchelfHook,
  wrapGAppsHook3,
  atk,
  cairo,
  dbus,
  gdk-pixbuf,
  glib,
  glib-networking,
  gtk3,
  libsoup_3,
  openssl,
  pango,
  webkitgtk_4_1,
  zlib,
}:

let
  pname = "athas";
  version = "0.16.1";

  # Keep the formatting of these lines stable
  # (one `"<system>" = "sha256-...";` per line) so the workflow's sed can find
  # them.
  hashes = {
    "x86_64-linux" = "sha256-ywixnt3Rt9fg4G/T9ljzmOXxjXCD2Pc+sedpOZeXBvg=";
    "aarch64-linux" = "sha256-8pKOkDBMG8DcDG7W0LhUELsdSao+rox81Yz40lOckg0=";
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
in
stdenv.mkDerivation {
  inherit pname version src;

  sourceRoot = "athas.app";

  nativeBuildInputs = [
    autoPatchelfHook
    wrapGAppsHook3
  ];

  # The release tarball links against the system WebKitGTK 4.1 and GTK 3;
  # glib-networking provides TLS for the webview.
  buildInputs = [
    atk
    cairo
    dbus
    gdk-pixbuf
    glib
    glib-networking
    gtk3
    libsoup_3
    openssl
    pango
    stdenv.cc.cc.lib
    webkitgtk_4_1
    zlib
  ];

  installPhase = ''
    runHook preInstall

    mkdir -p $out
    cp -r bin lib share $out/

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
