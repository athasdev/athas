# Athas: working rules

Athas is a native Rust app built on GPUI (desktop + wasm). Work happens on the `gpui` branch;
`main` still holds the old React/TypeScript/Tauri app, kept for reference.

- `crates/`: the app.
- `core/`: the original Athas Rust crates (git, LSP, terminal, database, ACP, ...), a workspace
  of its own that the app uses by path. Edit them here like any other code.
- `extensions/official/`: the extension manifests (embedded by `core/ai`, read by tests).

Working notes live in `.notes/`, untracked (excluded in `.git/info/exclude`): remaining work and
test findings (`REMAINING.md`, `BUGS.md`, `BUGHUNT.md`), the task log (`WORKLOG.md`), port status
(`PORTING.md`, regenerate with `python3 .notes/scripts/porting.py`), the file-by-file audits
(`audits/`) and `visual-parity.md`. `.notes/scripts/disk.sh` reports and sweeps the build caches:
`target/` grows by GBs per build and cargo never collects the dead artifacts, so sweep instead of
`cargo clean` (a sweep keeps the newest artifacts; a clean costs a cold rebuild).

## Iteration loop (the user tests the running app)

Keep the loop short. For a UI change the user asked for:

1. Edit.
2. `cargo check -p <crate>` for the crate you changed.
3. Restart the app: `RUST_BACKTRACE=1 cargo run -p athas`, in the background, log to a file.
   Only restart when the user asked to see it or asked you to run it.

Run the slower checks once per batch, not after every edit:
- `cargo test -p <crate> --lib` for the crates you touched.
- A headless snapshot (`cargo run -p ai_snapshot -- out.png dark session 1280 820`, or
  `athas_snapshot`) when the change is visual and you can't otherwise confirm it. Look at the PNG.
- The wasm check (`cargo check --target wasm32-unknown-unknown -p athas_web`) only before
  handing off a larger change.

Batch the user's feedback: do every item of a message, then one restart.

Don't spawn subagents for this kind of interactive UI work: they share `target/`, wait on each
other's build lock, and one agent's half-finished edit breaks the other's build. Do it yourself.

## GPUI re-entrancy (this crashed the app several times)

An entity can't be read or updated while it is being updated. These all panic
("already being updated" / "RefCell already mutably borrowed"):

- `view.read(cx)` / `view.update(cx, …)` on an entity from inside that entity's own `render`,
  its listeners, or anything they call synchronously. Pass `&self` data in instead.
- Reading a `ListState` (`viewport_bounds`, `bounds_for_item`, `is_scrolled_to_end`,
  `logical_scroll_top`, …) from inside that list's item callback or its scroll handler.
  Measure in `render` before the list lays out; defer scroll-handler work with `cx.defer`.
- Building menu rows with closures that `view.read(cx)` and calling them right away while the
  view is updating. Give the builder the data; read the entity only in callbacks that run later.

When the app crashes, read the backtrace from the run log (or
`~/Library/Logs/dev.athas.gpui/Athas.log`); find the first `panicked at` and its `crates/` frames.

## Safety

- Commit only when the user asks; one commit per task. Never push without being asked: a tag
  push publishes a release. Prefer the Edit tool; check `git diff` after a scripted edit.
- Never run `tauri bundle`, `tauri signer`, `codesign` or `notarytool` (production signing keys
  are in the shell environment).
- The dev build uses its own data folder (`dev.athas.gpui`); it does not touch the Tauri app.
- Keep the `[profile.*]` settings in `Cargo.toml` unless the user agrees to a change.
