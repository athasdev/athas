# Contributing to Athas

Thank you for contributing to Athas! Please check existing issues and pull requests before creating new ones.

## Setup

See [setup guides](https://athas.dev/docs/contributing) for your platform.

Prerequisites:

- [Rust](https://rustup.rs): the toolchain in `rust-toolchain.toml` installs itself on the first
  build.
- On Linux, the libraries listed in the [README](README.md#development).

```bash
cargo run -p athas
```

The development build keeps its data in its own folder (`dev.athas.gpui`), apart from an
installed Athas.

## Project layout

- `crates/`: the app, one crate per part (`workbench` is the window's shell, `editor`, `agent_ui`,
  `git_panel`, `terminal_view`, `settings_ui`, ...; `ui` and `theme` hold the shared controls and
  design tokens).
- `core/`: the Rust crates the app is built on (git, LSP, terminal, database, ACP, ...), a
  workspace of their own that the app uses by path.
- `extensions/official/`: the official extension manifests.

## Checking the UI without a window

`athas_snapshot` renders the workbench with the GPU into a PNG, without opening a window:

```bash
cargo run -p athas_snapshot -- out.png dark session 1280 820
```

Scenes include `project`, `session`, `files`, `git`, `github`, `settings` and `palette`; the
crate's documentation lists every scene and option. `ATHAS_SNAPSHOT_PROJECT=/some/folder` opens a
real folder and `ATHAS_SNAPSHOT_THEME=tokyo-night` picks a theme.

## Before Submitting

1. The workspace builds: `cargo check --workspace --all-targets`
2. Tests pass for the crates you changed: `cargo test -p <crate> --lib`
3. Code is formatted: `cargo fmt`
4. The web build still compiles when you change shared UI:
   `cargo check --target wasm32-unknown-unknown -p athas_web`
5. Rebase on main: `git rebase origin/main`
6. Squash commits into logical units
7. Read and agree to the
   [Contributor License and Feedback Agreement](CONTRIBUTOR_LICENSE_AND_FEEDBACK_AGREEMENT.md)
   by checking the box in the pull request

## Contributor License and Feedback Agreement

Athas is licensed under the AGPL-3.0, and Athas also distributes it under other terms, such as
through the Mac App Store or in commercial editions. The
[Contributor License and Feedback Agreement](CONTRIBUTOR_LICENSE_AND_FEEDBACK_AGREEMENT.md) gives
Athas the rights to include your contribution in both. You keep the copyright in your work. Pull
requests without the agreement checked can't be merged.

## Guidelines

- Follow the existing code style
- Use descriptive commit messages (i.e., "Add autocompletion")
- One logical change per commit
- Update documentation if needed

## Rust Tests

- Keep small unit tests in a `#[cfg(test)] mod tests` block beside the code they exercise.
- Move a large unit-test suite to `src/<module>/tests.rs` and declare it with
  `#[cfg(test)] mod tests;` from the owning module.
- Use `crates/<crate>/tests/` for integration tests that exercise the crate through its public API.
- Add focused regression tests for behavior changes and bug fixes instead of targeting a coverage
  percentage.
- Run one crate or test while iterating with `cargo test -p <crate> <test-name>`, then run the
  checks under [Before Submitting](#before-submitting).
