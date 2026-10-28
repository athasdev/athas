# Development with Nix

Athas provides a development shell for `x86_64-linux` and `aarch64-linux`.
Run the commands below from the repository root in your graphical desktop session.
Nix must have the `nix-command` and `flakes` experimental features enabled.

## Start development

```sh
nix develop
bun install --frozen-lockfile --ignore-scripts
bun run prepare
bun dev
```

Like the repository's CI, this skips dependency installation scripts. Run
`bun run prepare` separately to complete Athas's own setup.

`bun dev` starts the local extension server and the Tauri desktop app with frontend
hot reload. No `.env` file is required for normal development; `.env.example`
documents optional service overrides.

Use the shell directly instead of `bun setup`, whose Linux setup script installs
dependencies through distribution package managers. If you use direnv with flake
support, `direnv allow` enables the repository's existing `.envrc` instead of
manually running `nix develop`.

## Provided tools

The shell supplies the native build tools and libraries needed by the Linux/Tauri
development environment:

- Bun, Node.js 24, Rust, Cargo, Clippy, rustfmt, rust-analyzer
- GCC (provided by the Nix build environment), Make, Python 3
- WebKitGTK 4.1, GTK 3, libsoup 3, libayatana-appindicator, librsvg
- pkg-config, OpenSSL, patchelf, xdg-utils, file, Perl

GCC, Make, file, and patchelf come from Nix's standard build environment; the
shell does not add duplicate compiler or build-tool packages. pkg-config discovers
the libraries through Nix's setup hook without a manual `PKG_CONFIG_PATH`.

Rust follows `rust-toolchain.toml` (currently nightly), with rust-analyzer from the
same toolchain. `flake.lock` pins the Nixpkgs and Rust overlay revisions, so the
shell stays reproducible between updates. CI checks Bun against the minimum
version in `package.json` and Node against its `engines.node` requirement.

## Validation and updates

Inside the shell, run the checks relevant to your changes:

```sh
bun check
bunx vp test run
```

When changing the shell or updating its dependencies, run:

```sh
nix flake update
nix flake check --no-write-lock-file
nix develop
bun --version
node --version
rustc --version
pkg-config --modversion gtk+-3.0 webkit2gtk-4.1 libsoup-3.0 openssl
```

Run the version checks in the newly entered shell, then install dependencies and
launch `bun dev` to verify the app. Commit `flake.lock` with intentional input
updates. The Nix CI workflow checks shell evaluation, toolchain requirements,
native library discovery, and Rust compilation/linking; it does not install app
dependencies or launch the app.

## Installing a release

To use a packaged release from nixpkgs unstable, see
[Package managers](../README.md#package-managers). The development flake in this
repository provides a shell, not an installable Athas package.
