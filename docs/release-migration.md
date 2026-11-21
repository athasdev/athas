# Shipping the GPUI app as an update of the Tauri app

The GPUI app replaces the Tauri app (`athasdev/athas`, `com.code.athas`, last release
0.18.0-beta.2) as **the next Athas release**. Installed Tauri apps already poll
`https://athas.dev/api/update/stable` and install whatever the newest `athasdev/athas` release's
`latest.json` points at, as long as the version is newer and the minisign signature checks out.
So the GPUI build ships through the existing pipe: same endpoint, same key, same asset names,
same bundle id, same installer identity. This document covers what has to match, what is done in
this repository, what the user data migration does, the risks and the rollback plan, and how to
move the code into the athas repository.

Nothing here has been published. The draft workflow only runs on a manual dispatch.

## Status by platform

| | Tauri → GPUI (first update) | GPUI → GPUI (later updates) | Verified locally |
|---|---|---|---|
| macOS arm64 / x64 | Compatible: `Athas_<arch>.app.tar.gz` with `Athas.app/` at the root, bundle id `com.code.athas`, executable `Contents/MacOS/athas`, minisign `.sig`. The Tauri updater swaps the bundle and relaunches `Contents/MacOS/athas`. | `platform::updater` downloads, checks the signature (and the signed version), swaps the bundle, relaunches. | `bundle-mac.sh --release` dry run (unsigned, throwaway updater key); signature checked against the GPUI verifier. x64 not built. |
| Windows x64 / arm64 | Compatible by construction: the NSIS installer is produced by the Tauri bundler from `packaging/tauri/tauri.conf.json` with the same product name, publisher, identifier, binary name and per-user install mode, so it is the same installer the Tauri app ships with a different `athas.exe` inside. The updater runs it with `/P /UPDATE /R /ARGS`. | `platform::updater` runs the setup with `/P /R /UPDATE`. | Not built (needs Windows). |
| Linux x64 / arm64 | AppImage: compatible (the Tauri updater replaces the file). deb/rpm: compatible (same package name `athas`, installed with `dpkg -i` / `rpm -U` by the Tauri updater). | AppImage only; deb/rpm GPUI installs are told about updates but not installed yet (Tauri 2.14 installs those; see Risks). | Not built (needs Linux). |

## How the Tauri updater installs an update

Source: `tauri-plugin-updater` 2.14.1 (what `athas/src-tauri/Cargo.lock` pins), `src/updater.rs`.

1. `GET https://athas.dev/api/update/stable` with `X-Athas-Update-Channel: stable|beta`. www
   (`src/app/api/(public)/update/[channel]/route.ts`) answers with the `latest.json` asset of the
   newest *published* `athasdev/athas` release: GitHub's "latest" release for stable, the newest
   non-draft release by version (betas included) for beta. 204 when there is none.
2. The manifest (built by `athas/scripts/release/assets/cli.mjs`):
   ```json
   { "version": "0.19.0", "notes": "…", "pub_date": "…",
     "platforms": {
       "darwin-aarch64": { "signature": "<base64 of the .sig file>", "url": ".../Athas_aarch64.app.tar.gz" },
       "darwin-aarch64-app": …, "darwin-x86_64": …, "darwin-x86_64-app": …,
       "linux-x86_64": <AppImage>, "linux-x86_64-appimage": …, "linux-x86_64-deb": …, "linux-x86_64-rpm": …,
       "linux-aarch64…": …,
       "windows-x86_64": <NSIS>, "windows-x86_64-nsis": …, "windows-x86_64-msi": …, "windows-aarch64…": … } }
   ```
   The key is `<os>-<arch>-<bundle type>` first, then `<os>-<arch>`; the bundle type is stamped
   into the Tauri binary by its bundler.
3. Update offered only when `version` > the running version (semver; `0.18.0` > `0.18.0-beta.2`).
4. Download, then `minisign` verification of the bytes against the `pubkey` in
   `tauri.conf.json`. 2.14 also reads `version:` from the signature's trusted comment, when there is
   one, and refuses the update if it differs from the manifest's version.
5. Install:
   - **macOS**: unpacks the `.tar.gz` into a temp dir on the app's volume, dropping the first path
     component of every entry (so the archive must hold `Athas.app/...`), swaps it with the running
     bundle (`renamex_np(RENAME_SWAP)`, else two renames with restore), then the app restarts by
     running its current executable path, `…/Athas.app/Contents/MacOS/athas`. So the new bundle
     **must keep the executable name `athas`** and stay a self-contained `.app`.
   - **Windows**: writes the installer to a temp dir and `ShellExecuteW`s it with
     `/P /UPDATE /R /ARGS <current args>` (passive mode), then exits. For the in-place upgrade the
     installer must use the same NSIS identity as the installed app (below).
   - **Linux**: AppImage → replaces the file at `$APPIMAGE`; deb → `pkexec dpkg -i` (or a
     zenity/sudo fallback); rpm → `rpm -U`.

## What the artifacts must match

| Item | Tauri app | GPUI release build | Where |
|---|---|---|---|
| Bundle id / identifier | `com.code.athas` | `com.code.athas` (`ATHAS_IDENTITY=release`) | `crates/paths`, `scripts/bundle-mac.sh`, `packaging/tauri/tauri.conf.json` |
| Product name | Athas | Athas | same |
| macOS executable | `Contents/MacOS/athas` (`CFBundleExecutable`) | `athas` (+ `athas-cli` beside it) | `bundle-mac.sh` |
| Icon | `Resources/icon.icns` | `Resources/icon.icns` | `packaging/icons` (copied from `src-tauri/icons/prod`) |
| Version | 0.18.0-beta.2 | `[workspace.package] version`, must be newer; `bundle-mac.sh --release` refuses otherwise | `Cargo.toml`, the workflow sets it from the tag |
| URL scheme | `athas` (`CFBundleURLName` "com.code.athas athas") | same | Info.plist |
| Document types | 38 text/source extensions + public.plain-text/source-code/script/xml/html/json, Editor, Alternate | same, plus folders and Markdown | Info.plist |
| Usage strings | microphone, speech, Documents/Desktop/Downloads | same | Info.plist |
| NSServices "Open in Athas" | yes | yes | Info.plist |
| Code signature | Developer ID N43BXFX4H4, hardened runtime, designated requirement `identifier "com.code.athas" and anchor apple generic and … OU = N43BXFX4H4` | same identity and identifier, so the same designated requirement; entitlement `device.audio-input` for native voice input | `bundle-mac.sh`, `scripts/macos/Athas.entitlements` |
| LSMinimumSystemVersion | 10.15 | 10.15.7 (GPUI's floor) | Info.plist |
| Updater key | minisign key `BA494B286EC440EE` | same public key compiled in; artifacts signed with the same private key | `platform::updater`, CI secrets |
| Windows NSIS | product "Athas", publisher "athasdev", per-user (`%LOCALAPPDATA%\Athas\athas.exe`), keys `HKCU\Software\athasdev\Athas` and `HKCU\…\Uninstall\Athas`, Explorer menu hooks | produced by the same bundler with the same values and `installer-hooks.nsh` | `packaging/tauri`, `packaging/windows` |
| Windows MSI | upgrade code derived from the identifier | same identifier, so the same upgrade code; numeric `wix.version` from the tag | workflow |
| Linux packages | deb/rpm name `athas`, `/usr/bin/athas`, desktop template, AppImage `Athas_<v>_amd64.AppImage` | same bundler and template | `packaging/tauri`, `packaging/linux` |
| Asset names | `Athas_<v>_aarch64.dmg`, `Athas_aarch64.app.tar.gz(.sig)`, `Athas_<v>_x64-setup.exe(.sig)`, `Athas_<v>_x64_en-US.msi(.sig)`, `Athas_<v>_amd64.AppImage/.deb(.sig)`, `Athas-<v>-1.x86_64.rpm(.sig)`, `Athas_<v>_linux-x86_64.tar.gz(.sig)` (+ arm64) | same (`release-assets.mjs` checks them and builds `latest.json`) | workflow |

## Development builds stay separate

`crates/paths` decides the identity at compile time:

| | development (default) | shipping (`ATHAS_IDENTITY=release`) |
|---|---|---|
| bundle id, Wayland/Windows app id | `dev.athas.gpui` | `com.code.athas` |
| data folder (settings, workspace, sessions, socket, extensions, …) | `<data dir>/dev.athas.gpui` | `<data dir>/dev.athas.app` |
| keychain service | `dev.athas.gpui` (`…gpui.github` for GitHub) | `dev.athas.app` (`…app.github`) |
| logs | `~/Library/Logs/dev.athas.gpui` | `~/Library/Logs/dev.athas.app` |
| Tauri import | off (`ATHAS_IMPORT_TAURI=1` turns it on) | first run |

Every hard-coded `dev.athas.gpui` in the crates now reads `paths::APP_ID` / `paths::BUNDLE_ID`.
`scripts/bundle-mac.sh` (debug) and `--release --dev-identity` build the development identity;
`--release` builds the shipping one and checks the binary really was compiled with it.

The shipping build keeps its own data folder instead of writing into `com.code.athas`: several
files share names but not formats (`settings.json` is the plugin-store file there, `extensions/`
has per-extension `<id>.json` records), and leaving the Tauri folder untouched is what makes a
rollback to the Tauri build lossless.

## User data migration

`platform::tauri_import::run_once()` runs in `main` before any store loads, only in a shipping
build, only once (`<data dir>/dev.athas.app/tauri-import.json` records what it did), and never
overwrites anything the GPUI app already has. It reads, never changes, the Tauri app's data.

Sources it reads: `<data dir>/com.code.athas/` (macOS `~/Library/Application Support`, Windows
`%APPDATA%`, Linux `~/.local/share`), the Tauri webview's localStorage, and the keychain service
`com.code.athas` (plus the Tauri `secure.json` fallbacks in the data folder,
`<data dir>/athas/` and `~/.athas/`).

### Every store the Tauri app writes, and what the GPUI build does with it

Files in the Tauri data folder:

| Tauri store | GPUI |
|---|---|
| `settings.json` (plugin store; all settings, `mcpServers`, `product_onboarding_state_v1`) | read by `settings::load` as the fallback while GPUI has no `settings.json` (existing) |
| `remote-connections.json` | imported by `remote::connections` on first use (existing); passwords below |
| `credentials.json` (legacy SSH passwords) | not imported (the Tauri app drains it into the keychain itself) |
| `custom-themes.json` `{themes}` | **copied** (same shape) |
| `telemetry.json` (device id, install date, queue) | not imported: GPUI gets a new device id; one-time double count in analytics |
| `chat_history.db` (chats, messages, tool_calls, checkpoints) | **imported**: each chat becomes `sessions/tauri-<id>.json` (title, ACP session id, user/agent messages, tool calls with failed state), dated by its last message so History lists it. Checkpoints, images, plans and usage are not carried over |
| `local_history/<sha256>/entries.json + snapshots/` | **copied** (same layout) |
| `extensions/<id>/` + `extensions/<id>.json` | **copied**, records turned into `extensions/installed.json` (version, enabled, installed time; `athas.disabledExtensions` stays disabled) |
| `tools/`, `runtimes/` | used in place by `lsp_client::registry` (existing) |
| `agents/`, `tools/acp/`, `acp-registry/` | installed agents found in place by `agent_ui::acp::agents` (existing); the registry cache is rebuilt |
| `fff-frecency.lmdb` | not imported (rebuilds with use) |
| `browser/profiles/` | not imported (GPUI's browser view keeps its own profile; logins in the Tauri browser tabs are lost) |
| `.window-state.json` | not imported (GPUI centres the first window) |
| `secure.json` (keychain fallback) | read as a source for the secrets below |
| logs, `shell-integration/` (cache) | not needed |

localStorage (from `localstorage-export.json` when present, else WebKit's
`localstorage.sqlite3` / `*.localstorage` databases on macOS and Linux):

| Key | GPUI |
|---|---|
| `keymaps-storage` | **imported** into `keymap.json` (same entries) |
| `athas-code-recent-folders` | **imported** into `workspace.json` `recent_projects` (pinned, icon, missing kept) |
| `terminal-custom-actions` | **imported** into `run-actions.json` (id, name, command, working directory) |
| `athas-update-preferences` | **imported** into `update-preferences.json` (same shape) |
| `athas.disabledExtensions` | used for the extensions import |
| `workspace-tabs-storage-<window>`, `athas-tab-sessions` | not imported: open project tabs, editor tabs and terminal layouts start fresh (the recent list has the projects) |
| `athas-recent-files`, `actions-storage`, `terminal-sessions:*`, `terminal-profiles` | not imported (history-like; GPUI formats differ) |
| `athas-ai-chat-settings-v7`, `athas-agent-session-panels-v1`, `athas-session-pull-requests-v1`, `athas-continuous-agents-v1`, `athas-cloud-agents-v1`, `athas.intelligence.*`, `athas-codex-integration-settings` | not imported. `athas-continuous-agents-v1` → `continuous-agents.json` and the intelligence allowlists → `agent-allowlist.json` are the next candidates |
| `athas-debugger-*`, `diagnostics-pane-prefs`, `athas:git-stream-sections`, `athas-workspace-management`, `athas-whats-new`, `athas-contextual-tips-v1`, `athas.settingsSync.meta`, collaboration/sharing device ids, `athas-extension:*`, `athas.generated-ui-extensions`, `athas.installedLanguages`, appearance/font caches | not imported |

Keychain (service `com.code.athas`, account = key; GPUI uses the same account names under
`dev.athas.app`):

| Account | GPUI |
|---|---|
| `athas_auth_token` (Athas account) | **copied** |
| `ai_token_<provider>` | **copied** for the providers the Tauri app knew (openai, anthropic, gemini, grok, mistral, deepseek, openrouter, qwen, vercel and a few more) |
| `github_token` (via Athas account) | **copied** (GPUI does not use it yet) |
| `github_pat` | **copied** to `dev.athas.app.github` / `personal-access-token` |
| `remote_cred_<id>` | **copied** for every connection in `remote-connections.json` |
| `mcp_server_<id>` | **copied** for every server in `settings.json` `mcpServers` |
| `extension:<id>:<key>` | not copied (keys are not enumerable; extensions ask again) |

Tests (`cargo test -p platform tauri_import`) run on fixture copies in temp dirs with an
in-memory keychain: a full Tauri install, nothing overwritten on a second run, chats from a
SQLite fixture of the real schema, and a WebKit localStorage database with UTF-16 values.

### Windows localStorage and a bridge release

WebView2 keeps localStorage in LevelDB (`%LOCALAPPDATA%\com.code.athas\EBWebView\Default\Local
Storage\leveldb`), which the importer does not parse. Recommended: ship one last Tauri release
(0.18.x) that writes every `localStorage` key to `<app data>/localstorage-export.json` on start
(a few lines in the frontend). The importer prefers that file on every platform, so it also
covers WebKit layouts the scan misses. Without it, Windows users lose keybindings, recent
folders and run actions (settings, secrets, chats, themes, extensions and history still come
over).

## Building release artifacts

```sh
# macOS (run from a shell where the production updater key is NOT exported, or keep
# ATHAS_SIGN_UPDATE unset — it is opt-in for exactly that reason)
ATHAS_SIGN_IDENTITY="Developer ID Application: Mehmet Ozgul (N43BXFX4H4)" \
APPLE_ID=… APPLE_PASSWORD=… APPLE_TEAM_ID=N43BXFX4H4 \
ATHAS_SIGN_UPDATE=1 TAURI_SIGNING_PRIVATE_KEY=… TAURI_SIGNING_PRIVATE_KEY_PASSWORD=… \
scripts/bundle-mac.sh --release [--target x86_64-apple-darwin]
# -> target/release/bundle/{Athas.app, Athas_aarch64.app.tar.gz(.sig), Athas_<v>_aarch64.dmg}

# Windows / Linux, after `ATHAS_IDENTITY=release cargo build --release -p athas -p cli`:
cd packaging/tauri && CARGO_TARGET_DIR=../../target \
  bunx @tauri-apps/cli@2 bundle --bundles nsis,msi --config '{"version":"0.19.0"}'
#   (Linux: --bundles deb,rpm,appimage)
```

`bundle-mac.sh --release` builds with `ATHAS_IDENTITY=release`, refuses a version not newer than
0.18.0-beta.2 (`ATHAS_ALLOW_OLD_VERSION=1` for dry runs), refuses a binary built for the dev
identity, fails when the binary links non-system libraries, signs `athas-cli` and the app with
the hardened runtime and entitlements, notarizes and staples when the Apple variables are set,
packs `Athas.app/` into the updater archive with `COPYFILE_DISABLE=1`, signs it with
`tauri signer` (opt-in), and builds a compressed DMG with an Applications link.

Windows and Linux use the Tauri bundler on the prebuilt binary (`packaging/tauri` is a stub
Cargo package that is never compiled). Tried on macOS with `tauri bundle --bundles app`: it
packaged the prebuilt GPUI binary as `com.code.athas` with executable `athas` without needing a
Tauri dependency. The Linux deb also inherits the bundler's webkit2gtk/gtk dependencies (wry's
browser view uses them anyway).

The workspace is not self-contained yet: it path-depends on Rust crates and the official
extension catalog of the athas repository (`../athas`), so builds need both checkouts side by side
(the draft workflow checks out `athasdev/athas` next to it).

`.github/workflows/release.draft.yml` mirrors athas's `release.yml`: tag validation (newer than
every published release), the version written into `Cargo.toml`, the six-target matrix, Apple
certificate import, signing and notarization, Windows Authenticode through the bundler, the
updater signatures, the Linux tarball, then athas's own `release-assets.mjs assemble/verify` to
produce `SHA256SUMS.txt` and `latest.json`, a draft (pre)release in `athasdev/athas`, and
optional publishing, which starts athas's `sync-www-release.yml` (stable only) and
`package-managers.yml` exactly as a Tauri release does.

## Bundle size

Measured on an arm64 Mac (2026-11-13), same source tree for both builds, `athas` binary only
unless noted. "Before" is the default release profile (opt 3, no LTO, 16 codegen units, symbols
kept); "after" is the tuned `[profile.release]` in `Cargo.toml`: `opt-level = 3`, thin LTO,
`codegen-units = 1`, `panic = "unwind"` (66 background threads rely on a panic ending only their
own thread; the telemetry panic hook works either way), no debug info, `strip = "symbols"`.

| | before | after | Tauri 0.17 (`/Applications/Athas.app`) |
|---|---|---|---|
| `athas` raw | 144.0 MB | 93.7 MB (already stripped) | 79.5 MB |
| `athas` stripped | 108.0 MB | 93.7 MB | — |
| `athas` gzip -6 | 46.5 MB (42.0 MB stripped) | 38.9 MB | — |
| `.app.tar.gz` (updater download) | ≈46.5 MB | 39.7 MB (with `athas-cli`, icon) | 30.4 MB |
| `.app` on disk | — | 90 MB | 77 MB |
| DMG | — | 43.6 MB | — |

The release profile cuts the download by about 15% and the binary by about a third. The GPUI
build is still about 9 MB (30%) larger to download than the Tauri app, whose UI is JavaScript
compiled into a smaller binary while WebKit comes with the OS. Further options, each measured
before adopting: `opt-level = "s"` for cold crates only (`[profile.release.package]`), fat LTO
on a CI runner with enough memory, dropping unused tree-sitter grammars and fonts from the
embedded assets, and `lzma`/`zstd` DMGs (`hdiutil -format ULMO`); the updater archive must stay
gzip for the Tauri updater.

## Risks

- **Keychain prompts.** The GPUI release has the same designated requirement as the Tauri app,
  so reading `com.code.athas` items during the import should not prompt. If a build is ever
  signed differently (ad hoc, another team), every item prompts once per item; the import then
  stops being silent. Development builds never read them.
- **TCC permissions** (Documents/Desktop/Downloads, microphone, speech) are keyed to the bundle
  id and designated requirement, which do not change, so existing grants carry over. Voice input
  needs the `device.audio-input` entitlement the Tauri build did not have; without it the
  hardened runtime blocks the microphone.
- **Windows uninstall entries.** Same product name and publisher: the NSIS upgrade reuses
  `HKCU\…\Uninstall\Athas` and the install folder. A changed product name or install mode
  (per-machine) would leave a second entry and a stale install. MSI installs upgrade through
  the identifier-derived upgrade code; MSI needs a numeric version (`0.19.0.1` for `-beta.1`).
- **Windows WebView2 data** (`%LOCALAPPDATA%\com.code.athas\EBWebView`) stays behind; harmless.
- **Linux deb/rpm GPUI→GPUI.** The GPUI updater only self-updates AppImages; deb/rpm users of
  the GPUI build are pointed at packages until `platform::updater` learns `dpkg -i`/`rpm -U`
  (the Tauri updater has it). Mark the GPUI binary's bundle type, or detect `/usr/bin/athas`
  owned by dpkg.
- **macOS 10.15.0–10.15.6** users would get a bundle that does not launch (GPUI asks 10.15.7).
- **The shared endpoint serves the newest release to everyone**: the first GPUI release reaches
  every stable Tauri user at once unless it is a beta (below).
- **Signed version.** Recent `tauri signer` versions write `version:` into the signature's
  trusted comment; Tauri 2.14 refuses a mismatch with the manifest. Sign with the version the tag
  carries. The GPUI updater now enforces the same check.
- **The production updater key and Apple credentials are exported in the maintainer's shell.**
  `bundle-mac.sh` only signs updater archives with `ATHAS_SIGN_UPDATE=1`; the Tauri CLI signs and
  notarizes on its own whenever those variables are present (a local `tauri bundle` run did).

## Staged rollout and rollback

1. Ship a Tauri bridge release (0.18.x, stable) with the localStorage export.
2. Publish the first GPUI build as a **prerelease** `v0.19.0-beta.1`: www's beta channel returns
   the newest release including prereleases, stable keeps returning GitHub's latest (non
   prerelease) release, so only users who chose the beta channel get it. Watch crash reports and
   `tauri-import.json` outcomes.
3. Promote to stable with `v0.19.0` once betas are clean.

Rollback if a GPUI release is broken:

- The Tauri data folder is untouched, so the Tauri build still has everything.
- Publish a **Tauri** build with a higher version (e.g. `v0.19.1` built from the Tauri tree):
  both the GPUI updater (same manifest format, same key, same asset names) and any Tauri apps that
  did not update yet install it. Users of the broken GPUI build get the Tauri app back with their
  original data (anything created in the GPUI build only is not carried back).
- Never delete or un-publish a release to roll back: the stable channel would fall back to an
  older version that installed apps consider not newer, and nobody moves.
- If the GPUI build cannot start at all, users need the DMG/installer of the Tauri rollback from
  the download page; keep the Tauri tree buildable until GPUI has been stable for a few releases.

## Moving the code into athasdev/athas

Two options:

A. **Replace** `src/` and `src-tauri/` with this workspace on a branch (workspace at the repo
   root: `Cargo.toml`, `crates/`, `assets/`, `packaging/`, `scripts/`). One product per repo,
   tags/releases/workflows/issue history stay where users and www already look, `release.yml`
   becomes the GPUI workflow.
B. **Add as a subfolder** (`gpui/`) next to the Tauri app. Both build from one repo for a while,
   which helps the rollback story, but the release workflow, CI caching and the version source
   get duplicated, and the root `Cargo.toml` workspace of the Tauri crates (`crates/*`) collides
   with GPUI's crate names (`extensions`, `tooling`, …).

**Recommended: A**, with the Tauri tree kept on a long-lived `tauri` branch (tagged
`tauri-final`) for rollback builds.

Checklist (the user's call; nothing here touches the athas repository):

1. Ship the Tauri bridge release from `main` (localStorage export).
2. Branch `tauri` from `main`; tag it `tauri-final`. Rollback releases build from there with
   the existing `release.yml` (version bumped above the broken GPUI release).
3. On a new branch of `athasdev/athas`: remove `src/`, `src-tauri/` and the frontend tooling
   (`package.json`, `bun.lock`, vite config) except what `scripts/release/` needs (bun is still
   used by `release-assets.mjs`, notes generation and package managers). **Keep** the shared Rust
   crates the GPUI workspace path-depends on today (`../athas/crates/{project, version-control,
   github, docker, browser, claude-ide, wsl, runtime, fff-search, test-support}`, plus
   `#[path]` includes of `github/src/models.rs`, `serde_helpers.rs` and
   `docker/src/types.rs` in a build script) and
   `extensions/official` (read by `extensions::catalog` and `lsp_client::generate`). Move them
   under `crates/` (renaming the clashes, e.g. `athas-extensions` vs GPUI's `extensions`) or a
   `shared/` folder, and drop the Tauri-only crates (`ai`, `lsp`, `extensions` installer …) once
   nothing references them.
4. Copy this workspace in (`Cargo.toml`, `Cargo.lock`, `rust-toolchain.toml`, `crates/`,
   `assets/`, `third_party/`, `packaging/`, `scripts/`, `docs/`) and rewrite every
   `../../../athas/…` path to the new location (`grep -rn '\.\./athas/' crates`). Icons are already
   in `packaging/icons`.
5. Replace `.github/workflows/release.yml` with `release.draft.yml` (switch it to the tag
   trigger, drop the `athasdev/athas` checkout in `assemble` since the scripts are local, keep
   `verify-ci`, `release-metadata` and the notes generator), and adapt `ci.yml`,
   `release-preflight.yml` and `release-cache.yml` to `cargo test`/`cargo build --release`.
   `scripts/release/version.ts` must write `[workspace.package] version` instead of
   `package.json`/`tauri.conf.json`.
6. Keep `sync-www-release.yml` and `package-managers.yml` as they are (asset names are
   unchanged). Update the Nix and Flatpak packaging (binary is no longer a webview app).
7. Dry-run the workflow with `publish: false`, download the draft's assets and `latest.json`,
   and on a test machine per platform update a Tauri 0.18 install through its real updater: the
   endpoint is compiled into the Tauri app, so build a throwaway Tauri 0.18 with
   `plugins.updater.endpoints` pointing at a local server that serves the draft's `latest.json`
   (same pubkey), install it, and let it update. Then point the GPUI build at a newer test
   manifest with `ATHAS_UPDATE_URL` to check GPUI→GPUI.
8. Tag `v0.19.0-beta.1`, publish as prerelease, watch, then `v0.19.0`.
