# End-to-end tests

These tests drive a real debug build of Athas through WebDriver, using
[`tauri-driver`](https://v2.tauri.app/develop/tests/webdriver/) with
WebdriverIO and Mocha. `tauri-driver` proxies to `WebKitWebDriver` on Linux
and `msedgedriver` on Windows.

macOS is not supported: Apple ships no WebDriver for WKWebView, so
`tauri-driver` cannot run there. On a Mac, run the suite in a Linux VM or
container (see below) or rely on the `E2E` GitHub workflow.

## Layout

- `wdio.conf.ts` builds the app, starts `tauri-driver`, and resets state before
  every spec file.
- `specs/*.e2e.ts` are the specs. Vitest ignores them because they do not match
  `*.test.ts`.
- `fixtures/sample-project/` is copied to `target/e2e/workspace/` before each
  spec file and opened by passing its path to the app on the command line.
- Screenshots, page sources, app logs, and the driver log of failed runs land in
  `target/e2e/artifacts/`.

## Isolation

The binary is built with `src-tauri/tauri.e2e.conf.json`, which sets a separate
identifier (`com.code.athas.e2e`), disables the updater, and sets
`app > appDirectoriesOverride` to `./e2e-app-data`. Tauri resolves that path
next to the executable, so config, data, cache, logs, and the webview profile
all live in `target/debug/e2e-app-data/`, which is wiped before every spec file.
On Linux the XDG directories are also redirected into `target/e2e/sandbox/`.
The tests never read or write your real Athas data.

## Running on Linux

Install the WebDriver and build dependencies (Debian/Ubuntu):

```sh
sudo apt-get install libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev \
  libayatana-appindicator3-dev patchelf webkit2gtk-driver xvfb
cargo install tauri-driver --locked
```

Then run the suite. It builds the e2e binary first unless
`ATHAS_E2E_SKIP_BUILD=1` is set:

```sh
bun run e2e:build          # optional, builds the e2e debug binary
bun run e2e                # builds (unless skipped) and runs every spec
```

Without a display, wrap the run in Xvfb:

```sh
xvfb-run -a bun run e2e
```

To run from a Mac, use any Ubuntu 24.04 VM (for example OrbStack, UTM, or
Lima) or container with the packages above, Bun, and Rust installed, clone the
repository inside it, and run the same commands under `xvfb-run`. A container
needs no GPU; set `ATHAS_DISABLE_LINUX_GPU=1` there.

## Running on Windows

Install `tauri-driver` and an `msedgedriver` that matches the installed
WebView2 runtime, then point the harness at it:

```powershell
cargo install tauri-driver --locked
cargo install --git https://github.com/chippers/msedgedriver-tool
msedgedriver-tool.exe   # downloads msedgedriver.exe into the current folder
$env:TAURI_NATIVE_DRIVER = "$PWD\msedgedriver.exe"
bun run e2e
```

## Environment variables

- `ATHAS_E2E_SKIP_BUILD=1` reuses the existing binary.
- `ATHAS_E2E_APP` points at a different binary.
- `TAURI_DRIVER_PATH` overrides where `tauri-driver` is found.
- `TAURI_NATIVE_DRIVER` passes `--native-driver` to `tauri-driver`.
- `TAURI_DRIVER_PORT` changes the driver port (default `4444`).
