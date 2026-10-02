# End-to-end tests

These tests drive a real debug build of Athas through WebDriver, using
[`tauri-driver`](https://v2.tauri.app/develop/tests/webdriver/) with
`selenium-webdriver` and Bun's test runner, following Tauri's Selenium example.
On Linux `tauri-driver` launches the app through `WebKitWebDriver`. On Windows
the harness launches the app itself and attaches `msedgedriver` to it (see
below).

macOS is not supported: Apple ships no WebDriver for WKWebView, so
`tauri-driver` cannot run there. On a Mac, run the suite in a Linux VM or
container (see below) or rely on the `E2E` GitHub workflow.

## Layout

- `run.ts` (`bun run e2e`) passes every `specs/*.e2e.ts` file to `bun test`.
  Neither `bun test` nor Vitest discovers `.e2e.ts` files on its own, so a plain
  test run from the repository root never starts the app.
- `support/setup.ts` is preloaded by `bun test`: it builds the app and starts
  the WebDriver server (`tauri-driver`, or `msedgedriver` on Windows) once for
  the whole run, and stops it at the end.
- `tests/` holds plain Vitest checks for the e2e configuration.
- `support/session.ts` gives each spec file a fresh session: it kills any
  leftover app process from the e2e binary, resets state, and opens the app.
  Failed tests save a screenshot and the page source.
- `support/app.ts` holds the selectors and UI helpers the specs share.
- `fixtures/sample-project/` is copied to `target/e2e/workspace/` before each
  spec file and opened by passing its path to the app on the command line. The
  copy is turned into its own git repository with one commit, so the Git view
  starts clean and the checkout's ignore rules never hide fixture files. `git`
  must be on `PATH`.
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
bun run e2e -t "editor"    # extra arguments are passed to bun test
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

Windows does not use `tauri-driver`. WebView2 150 and later ignores the
DevTools port that `msedgedriver` requests through
`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` once the app sets its own browser
arguments, which wry always does, and `msedgedriver` turns launch arguments
into `--switches`, which mangles the workspace path. Instead:

- `bun run e2e:build:windows` adds `src-tauri/tauri.e2e.windows.conf.json`,
  which opens DevTools on `127.0.0.1:9222` through `additionalBrowserArgs`.
  Tauri merges `--config` files as JSON merge patches, so the overlay repeats
  the whole Windows main window; `tests/windows-config.test.ts` keeps it in
  sync with `src-tauri/tauri.windows.conf.json`.
- For each spec file the harness launches the app with the workspace path,
  waits for the DevTools endpoint, and attaches with
  `{ browserName: "webview2", "ms:edgeOptions": { debuggerAddress } }`. It kills
  the app by PID when the spec file is done.

Install an `msedgedriver` that matches the installed WebView2 runtime and point
the harness at it:

```powershell
cargo install --git https://github.com/chippers/msedgedriver-tool
msedgedriver-tool.exe   # downloads msedgedriver.exe into the current folder
$env:TAURI_NATIVE_DRIVER = "$PWD\msedgedriver.exe"
bun run e2e
```

The verbose `msedgedriver` log and the app's console output land in
`target/e2e/artifacts/`.

## Environment variables

- `ATHAS_E2E_SKIP_BUILD=1` reuses the existing binary.
- `ATHAS_E2E_APP` points at a different binary.
- `TAURI_DRIVER_PATH` overrides where `tauri-driver` is found (Linux).
- `TAURI_NATIVE_DRIVER` passes `--native-driver` to `tauri-driver` on Linux,
  and is the path to `msedgedriver.exe` on Windows.
- `TAURI_DRIVER_PORT` changes the WebDriver server port (default `4444`).
