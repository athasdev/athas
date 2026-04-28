# Nix support

Athas currently provides a Linux development shell through flakes.
Flake inputs are pinned in `flake.nix` so CI and local shells evaluate the same
Nixpkgs, flake-utils, and rust-overlay revisions.

```sh
nix develop
bun install --frozen-lockfile
bun dev
```

The shell matches the Linux/Tauri dependency set used by `scripts/setup/linux.sh`:

- Bun, Node.js 22, nightly Rust, Cargo, Clippy, rustfmt, rust-analyzer
- GCC, Clang, libclang, CMake, Make, Python 3
- WebKitGTK 4.1, GTK 3, libsoup 3, libayatana-appindicator, librsvg
- pkg-config, OpenSSL, patchelf, xdg-utils, file, Perl

## Packaging status

`nix build` source packaging is intentionally not exposed yet. The project uses
Bun for JavaScript dependencies, and a pure Nix package needs those dependencies
vendored as a fixed-output derivation instead of running an online
`bun install` during the build.

The next packaging step is to add a generated Nix dependency set for `bun.lock`
and then wire a source-built `packages.default` that runs the Tauri build without
network access.
