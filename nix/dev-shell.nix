{ lib, pkgs }:

let
  rustToolchain = (pkgs.rust-bin.fromRustupToolchainFile ../rust-toolchain.toml).override {
    extensions = [
      "clippy"
      "rust-analyzer"
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

in
pkgs.mkShell {
  packages =
    with pkgs;
    [
      bun
      nodejs_24
      rustToolchain
      perl
      pkg-config
      python3
      xdg-utils
    ]
    ++ runtimeLibraries;

  shellHook = ''
    echo "Athas Nix shell"
    echo "  bun install --frozen-lockfile --ignore-scripts"
    echo "  bun run prepare"
    echo "  bun dev"
  '';
  LD_LIBRARY_PATH = lib.makeLibraryPath runtimeLibraries;
}
