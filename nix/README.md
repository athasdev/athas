# Nix support

Athas currently provides a Linux development shell through flakes.
Flake inputs are pinned in `flake.nix` so CI and local shells evaluate the same
Nixpkgs, flake-utils, Rust, and Zig revisions.

```sh
nix develop
bun install --frozen-lockfile
bun dev
```

The shell matches the Linux/Tauri dependency set used by `scripts/setup/linux.sh`:

- Bun, Node.js 22, nightly Rust, Cargo, Clippy, rustfmt, rust-analyzer, Zig 0.16
- GCC, Clang, libclang, CMake, Make, Python 3
- WebKitGTK 4.1, GTK 3, libsoup 3, libayatana-appindicator, librsvg
- pkg-config, OpenSSL, patchelf, xdg-utils, file, Perl

## Run the packaged editor

The default package wraps the latest stable, prebuilt Athas Linux release for
`x86_64-linux` and `aarch64-linux`:

```sh
nix run github:athasdev/athas
```

This package does not build Athas from source. It downloads the release archive,
patches its runtime library paths for Nix, and launches the packaged editor.

A future source-built package will need the Bun dependencies vendored as a
fixed-output derivation so the Tauri build can run without network access.
