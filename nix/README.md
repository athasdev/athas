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

- Bun, Node.js 24, nightly Rust, Cargo, Clippy, rustfmt, rust-analyzer, Zig 0.16
- GCC, Clang, libclang, CMake, Make, Python 3
- WebKitGTK 4.1, GTK 3, libsoup 3, libayatana-appindicator, librsvg
- pkg-config, OpenSSL, patchelf, xdg-utils, file, Perl

## Installing Athas with Nix

Athas does not publish a Nix package, the same as Cursor; packaging for Nix is
left to the community in nixpkgs. The portable `linux-<arch>.tar.gz` on each
GitHub release links against the system WebKitGTK 4.1 and GTK 3, so it can be
wrapped with `autoPatchelfHook` and `wrapGAppsHook3`.
