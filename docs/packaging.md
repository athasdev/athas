# Packaging and the desktop layer

## macOS bundle

```sh
scripts/bundle-mac.sh                          # debug build, dev identity -> target/debug/bundle/Athas.app
scripts/bundle-mac.sh --release                # shipping build -> target/release/bundle/
scripts/bundle-mac.sh --release --dev-identity # optimised, but still dev.athas.gpui
scripts/bundle-mac.sh --no-build               # bundle the binaries already built
```

The bundle holds:

| Path | What |
|---|---|
| `Contents/MacOS/athas` | the app (the Tauri bundle's executable name, which its updater relaunches) |
| `Contents/MacOS/athas-cli` | the `athas` terminal command |
| `Contents/Resources/icon.icns` | the icon from `packaging/icons` (copied from the Tauri app; `ATHAS_ICON_DIR` picks another folder; a folder with only `icon.png` is converted with `sips` and `iconutil`) |
| `Contents/Info.plist` | bundle id `dev.athas.gpui`, or `com.code.athas` for `--release`; version from `[workspace.package]` in `Cargo.toml`; the `athas` URL scheme, the Tauri app's document types plus folders, usage strings |

`--release` builds with `ATHAS_IDENTITY=release` (see `crates/paths` and
[release-migration.md](release-migration.md)) and also writes `Athas_<arch>.app.tar.gz` (the
updater archive; signed with `tauri signer` when `ATHAS_SIGN_UPDATE=1` and
`TAURI_SIGNING_PRIVATE_KEY` are set) and `Athas_<version>_<arch>.dmg`. It refuses a version that
is not newer than the last Tauri release.

The binaries are cloned (`cp -c`), so a debug bundle takes no extra disk until they are rebuilt.
`ATHAS_SIGN_IDENTITY="Developer ID Application: …"` signs the bundle with the hardened runtime
and `scripts/macos/Athas.entitlements` (`-` signs ad hoc); with `APPLE_ID`, `APPLE_PASSWORD` and
`APPLE_TEAM_ID` as well, `--release` notarizes and staples the app and the DMG. Windows and Linux
packages come from the Tauri bundler on the prebuilt binary (`packaging/tauri`).

Note: Launch Services may register any bundle it finds, so a debug bundle in `target/` can start
answering `athas://` links. Delete it when you are done with it.

## Web build

The workbench also runs in the browser: `crates/athas_web` compiles it to wasm32, GPUI's web
platform draws it into a canvas (WebGPU, else WebGL2), and the project lives on a workspace server
(`crates/athas_server`) reached over the workspace protocol (`crates/web_protocol`).

```sh
scripts/build-web.sh              # debug build         -> target/web/debug
scripts/build-web.sh --release    # size-optimised build -> target/web/release
scripts/build-web.sh --no-build   # package the wasm already built
cargo run -p athas_server -- --root ~/src/project --web target/web/release
```

The script installs `wasm-bindgen-cli` into `target/tools` at the version in `Cargo.lock` (nothing
is installed globally), builds `athas_web` for `wasm32-unknown-unknown`, runs `wasm-bindgen
--target web` and copies `crates/athas_web/web/index.html` next to the output. Release builds use
the `web-release` profile (`opt-level = "s"`, thin LTO, no debug info) and run `wasm-opt -Os` when
it is on PATH. `CARGO_BUILD_JOBS` limits the build (default 2). The debug wasm is about 220 MB
(with debug info), the release one about 48 MB (13 MB gzipped) before `wasm-opt`.

`athas-server [--root DIR] [--listen ADDR] [--token TOKEN] [--web DIR]` serves `DIR` at `/` and
prints the address to open, `http://127.0.0.1:7878/?token=…`. The token comes from `--token`, then
`ATHAS_SERVER_TOKEN`, else a random one; the page keeps it for the tab's session. `?server=URL`
points a page at another server. The server only listens on loopback unless `--listen` says
otherwise; put it behind TLS before exposing it.

| Endpoint | What |
|---|---|
| `GET /workspace` | the root, repository and branch the workbench opens |
| `POST /call` | one protocol call, `{ method, params }`; the browser makes the blocking calls the workbench's file system and git interfaces expect this way |
| `GET /socket` | the WebSocket: auth, file changes, terminal output (binary frames), language-server messages, and calls nobody waits for (terminal input, `lsp.send`) |
| anything else | the web build's files |

What runs on the server: files and the file watcher (`fs.*`), content search (`search.content`),
terminals on a PTY (`terminal.*`), git as the git command line, including diffs, blame and commit
views (`git.*`), and language servers (`lsp.start`/`lsp.send`/`lsp.stop`): the server starts the
process the extension catalog names, frames what the editor sends with `Content-Length` and relays
each message the server writes as `lsp.message`, so `lsp_client` runs over the socket
(`LanguageServer::connect_messages`) with no process of its own. Language servers must be
installed on the server machine.

Agent sessions run their ACP agent on the server too (`agent.start`/`agent.send`/`agent.stop`,
messages back as `agent.message`, one JSON-RPC message per line): the client names the agent and
the program its catalog expects, the server finds it on its `PATH` (plus Homebrew, `/usr/local`
and the usual user bins), and the agent reads, writes and runs tools in the project directly, so
the browser offers it no client file system or terminals. `ATHAS_AGENT_COMMAND`, a whole command
line in the server's environment, runs instead of every agent, as on desktop. The built-in agent
runs in the page.

The GitHub views call GitHub from the server (`github.*`) with the server's credential
(`GITHUB_TOKEN`/`GH_TOKEN`, else its `gh` CLI); Settings > Git > GitHub Account shows which one is
active and whom it belongs to, never the token. AI drafts for issues and pull requests use the
page's AI settings and read the repository's status and branch diff from the server.

The Docker view runs the server's `docker` CLI (`docker.*`; `ATHAS_DOCKER_PROGRAM` replaces it, as
on desktop), with host paths kept inside the workspace and followed logs polled from the server.

Browser tabs and HTML previews are frames laid over the canvas. Previews load from the server's
`/preview/<key>/…`, a key (`preview.base`) that only reads workspace files, served sandboxed so a
previewed page never sees the workbench's token; web pages load as their sites allow framing, and a
frame hides while workbench UI covers it. SVG and markdown previews are drawn by GPUI from the
server's files.

Not on the web yet: sharing a local server, Athas Browser for agents, remote (SSH, WSL)
connections, team presence and the native window chrome.

## Single instance and the `athas` command

The first Athas listens on a Unix domain socket in its data folder
(`~/Library/Application Support/dev.athas.gpui/athas.sock`, `dev.athas.app` for shipping builds, `athas-dev.sock` for debug builds; a
named pipe `\\.\pipe\athas-<user>` on Windows; `ATHAS_SOCKET` overrides it). A second launch, or
the `athas` command, sends its requests there as one JSON line and gets one back:

```json
{"version":1,"message":{"type":"open","requests":[{"kind":"path","path":"/src/main.rs","is_directory":false,"line":12,"column":4,"wait_marker":null}]}}
{"type":"ok"}
```

When nothing answers, the command starts Athas (`open -a` on the bundle it ships in, the `athas`
binary next to it, or `open -b` with the build's bundle id; `ATHAS_APP` overrides) and waits for the socket.
`athas --wait` creates an empty marker in `$TMPDIR/athas-cli-wait/` and returns once Athas deletes
it: when every file it sent was opened and closed, when a file did not open within 15 seconds, or
when Athas quits.

"CLI: Install Terminal Command" (`platform::InstallCliCommand`) links `~/.local/bin/athas` to the
bundle's `athas-cli` and adds `~/.local/bin` to the shell's PATH when no startup file mentions it.
Launchers the Tauri app wrote there are replaced; any other file of that name is left alone.

## Links

`athas://open?path=…&line=…&column=…` (and `type=directory|web|remote|terminal|settings`),
`athas://settings?tab=…`, `athas://extension/install/<id>` and `athas://mcp/install?…` are read by
`platform::deep_link`, as the Tauri app read them. Terminals, remotes and MCP installs are not
supported by the GPUI workbench yet and say so. Files opened from Finder or dropped on the Dock
arrive as `file://` URLs.

## Updates

Release builds check `https://athas.dev/api/update/stable` (channel from the `updateChannel`
setting, sent as `X-Athas-Update-Channel`) ten seconds after launch and every twelve hours while
`autoCheckForUpdates` is on. A newer version raises a notification; "Download Update" downloads
the archive for this platform, checks its minisign signature against the updater key (and the
version named in the signature, as tauri-plugin-updater 2.14 does), installs it (the bundle
swapped on macOS, the AppImage replaced on Linux, the setup run on Windows) and restarts.

The GPUI build ships as the next release of the Tauri app through the same endpoint; see
[release-migration.md](release-migration.md).

## Window state

The window's bounds, display and maximized/fullscreen state are saved half a second after they
change, and on quit, to `window-state.json` in the data folder, and restored on the next launch.
A display that is gone, or a place no display shows, centres the saved size on the main display.
