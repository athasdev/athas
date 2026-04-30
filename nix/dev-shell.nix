{ lib, pkgs }:

let
  rustToolchain = pkgs.rust-bin.nightly.latest.default.override {
    extensions = [
      "clippy"
      "rust-src"
      "rustfmt"
    ];
  };

  runtimeLibraries = with pkgs; [
    atk
    cairo
    dbus
    gdk-pixbuf
    glib
    gtk3
    libayatana-appindicator
    librsvg
    libsoup_3
    openssl
    pango
    webkitgtk_4_1
  ];

  linuxPackages = with pkgs; [
    clang
    cmake
    file
    gcc
    gnumake
    llvmPackages_latest.libclang
    patchelf
    perl
    pkg-config
    python3
    xdg-utils
  ] ++ runtimeLibraries;
in
pkgs.mkShell (
  {
    packages =
      with pkgs;
      [
        bun
        nodejs_22
        rustToolchain
        rust-analyzer
      ]
      ++ lib.optionals stdenv.isLinux linuxPackages;

    shellHook = ''
      echo "Athas Nix shell"
      echo "  bun install --frozen-lockfile"
      echo "  bun dev"
    '';
  }
  // lib.optionalAttrs pkgs.stdenv.isLinux {
    LIBCLANG_PATH = "${pkgs.llvmPackages_latest.libclang.lib}/lib";
    LD_LIBRARY_PATH = lib.makeLibraryPath runtimeLibraries;
    PKG_CONFIG_PATH = lib.makeSearchPathOutput "dev" "lib/pkgconfig" runtimeLibraries;
    WEBKIT_DISABLE_DMABUF_RENDERER = "1";
  }
)
