# Athas (GPUI)

Athas rewritten in Rust on [GPUI](https://gpui.rs), for macOS, Windows, Linux and the web (wasm).

## Run

```sh
cargo run -p athas
```

The workspace state (open projects, sessions, layout) is saved to
`~/Library/Application Support/dev.athas.gpui/workspace.json` on macOS.

## Check the UI without a window

```sh
cargo run -p athas_snapshot -- out.png dark session 1280 820
```

Renders the workbench with the GPU into a PNG. Scenes: `project`, `session`, `empty`,
`hidden-sidebar`, `terminal`, `archived`, `files`, `git`, `palette`, `quick-open`, `settings`,
`themes`, `keybindings`, `appearance`. `ATHAS_SNAPSHOT_PROJECT=/some/folder` opens a real folder,
`ATHAS_SNAPSHOT_THEME=tokyo-night` picks a theme, and `ATHAS_SNAPSHOT_SETTLE_MS` waits for
background work (git status, a shell prompt).

## Layout

- `crates/`: the app (below).
- `core/`: the Rust crates the Tauri app was built on (git, LSP, terminal, database, ACP, GitHub,
  Docker, browser, remote, ...), a workspace of their own that the app uses by path.
- `extensions/official/`: the official extension manifests.

## Crates

| Crate | What it holds |
|---|---|
| `theme` | Theme files and the design tokens derived from them (`styles/theme.css`) |
| `ui` | Shared controls: buttons, tooltips, menus, list rows, pane chrome, tabs, icons, fonts |
| `workspace` | The model: projects, sessions, tabs, layout, persistence. No UI |
| `workbench` | The shell: title row, activity bar, sidebar, centre, dock, bottom pane, modals |
| `settings` | All Athas settings keys and defaults; imports the Tauri app's `settings.json` |
| `settings_ui` | The Settings view: pages, search, rows |
| `keymap` | Athas's command catalog, default bindings, presets and user bindings |
| `palette` | The picker: quick open, command palette, theme selector |
| `file_tree` | The Files tool |
| `git_panel` | The Source Control tool |
| `terminal_view` | The terminal in the bottom pane |
| `athas` | The desktop app |
| `athas_snapshot` | Headless screenshots |

Notes:
- GPUI comes from Zed's repository at a pinned revision; `Cargo.toml` mirrors the crate patches
  Zed's workspace applies.
- Shaders compile at run time (`runtime_shaders`), so the Xcode Metal toolchain is not needed.
