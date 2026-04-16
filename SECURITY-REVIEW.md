# Athas Security Review

**Audit date:** 2026-04-16
**Scope:** Full repo — Rust (`src-tauri`, `crates/`), TypeScript/React (`src/`), Tauri config + capabilities, GitHub Actions, build/release scripts, dependency audits.
**Methodology:** Twelve parallel review streams covering the IPC surface, shell/process execution, network/TLS, secret storage, extension install, filesystem ops, SQL/NoSQL injection, frontend XSS, deps, secrets-in-repo, CI, and Tauri config. Findings triaged with a severity rubric below, then Critical/High findings patched as minimal upstream changes.

## Executive Summary

Overall posture is solid for a native code editor: the Rust backend is consistently Rust-idiomatic, the Tauri capabilities are narrow, secrets use the OS keychain, SSH verifies host keys, SQL uses parameterized queries with identifier escaping, markdown output is DOMPurified, and the release pipeline is signed and reproducible.

Three high-severity weaknesses were identified and fixed in this review:

- **H1** — Extension download host allowlist used a suffix match that accepts `evilathas.dev`.
- **H2** — Node.js runtime tarball extractor did not reject path-traversing entries (tar-slip under a supply-chain or TLS compromise).
- **H3** — The generic tool installer downloaded arbitrary URLs with no scheme/host allowlist, enabling RCE if any frontend input ever reached the installer config.

Several medium-severity items are documented below as defense-in-depth follow-ups but not auto-fixed. No critical RCE, no committed secrets, no SQL injection, and no confirmed XSS were found.

## Severity Rubric

- **Critical** — Pre-auth RCE, arbitrary file write outside scope, silent credential exfiltration, auth bypass.
- **High** — Path traversal, injection, credential weakness at rest, SSRF with impact, exploitable archive extraction, unauthenticated download+execute primitives.
- **Medium** — Hardening gaps, defense-in-depth, log hygiene, broad scopes, optional validators.
- **Low** — Informational, stylistic, or deeply mitigated.

## Findings

| ID  | Severity | Title                                                                                             | File                                             |
| --- | -------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| H1  | High     | Extension download host allowlist suffix bypass                                                   | `crates/... extensions.rs`                       |
| H2  | High     | Tar-slip in Node.js runtime extractor                                                             | `crates/runtime/src/downloader.rs`               |
| H3  | High     | Unrestricted remote binary download+execute via tool installer                                    | `crates/tooling/src/installer.rs`                |
| M1  | Medium   | `workspace_root` is optional for fs IPC commands                                                  | `src-tauri/src/commands/project/fs.rs`           |
| M2  | Medium   | `format_code`/`lint_code` accept arbitrary executable+args                                        | `src-tauri/src/commands/editor/{format,lint}.rs` |
| M3  | Medium   | Keychain fallback writes secrets to plaintext `secure.json`                                       | `src-tauri/src/secure_storage.rs`                |
| M4  | Medium   | `rsa` 0.9.10 Marvin-attack advisory (transitive via `sqlx-mysql`)                                 | `Cargo.lock`                                     |
| M5  | Medium   | SSH helpers embed `$(dirname <quoted>)` unquoted in outer command                                 | `crates/remote/src/lib.rs`                       |
| M6  | Medium   | Capability `fs:scope` grants `$HOME/**`                                                           | `src-tauri/capabilities/main.json`               |
| L1  | Low      | Dev-only JS advisories (`react-scan` → `next`/`playwright`/`preact`/etc.)                         | `package.json` devDependencies                   |
| L2  | Low      | GitHub Actions pinned to major version, not SHA                                                   | `.github/workflows/*.yml`                        |
| L3  | Low      | CSP permits `'unsafe-inline'` styles and `'wasm-unsafe-eval'` scripts                             | `src-tauri/tauri.conf.json`                      |
| L4  | Low      | `install_extension_from_url` internal downloader accepts any URL once outer validator is bypassed | `crates/extensions/src/installer.rs`             |
| L5  | Low      | `open_file_external` spawns platform opener on canonicalized path                                 | `src-tauri/src/commands/project/fs.rs`           |

## Details

### H1 — Extension download host allowlist suffix bypass

**Location:** `src-tauri/src/commands/extensions.rs:34`

```@/home/fsos/Developer/athas/src-tauri/src/commands/extensions.rs:29-46
fn validate_extension_download_url(input: &str) -> Result<(), String> {
   let parsed = Url::parse(input).map_err(|_| "Invalid extension download URL".to_string())?;
   let host = parsed.host_str().unwrap_or_default();
   match parsed.scheme() {
      "https" => {
         if !cfg!(debug_assertions) && !host.ends_with("athas.dev") {
            return Err("Extension download host is not allowed".to_string());
         }
      }
      "http" if cfg!(debug_assertions) => {
         if host != "localhost" && host != "127.0.0.1" {
            return Err("Insecure extension download URL is not allowed".to_string());
         }
      }
      _ => return Err("Extension download URL must use HTTPS".to_string()),
   }
   Ok(())
}
```

**Issue:** `host.ends_with("athas.dev")` matches `evilathas.dev` (no leading-dot check). An attacker who can register `evilathas.dev` (or steer a user to any such domain) could serve a malicious extension that `download_extension` or `install_extension_from_url` will fetch. Checksum is verified downstream, but the attacker also supplies the checksum.

**Impact:** Malicious extension installation. Extensions run as WASM today, so impact is bounded by the extension sandbox, but the guard existed to prevent this path entirely and was ineffective.

**Fix applied:** Strict host match allowing `athas.dev` and subdomains only (`host == "athas.dev" || host.ends_with(".athas.dev")`). Added regression tests for `evilathas.dev`, bare `athas.dev`, and `cdn.athas.dev`.

### H2 — Tar-slip in Node.js runtime extractor

**Location:** `crates/runtime/src/downloader.rs:107-158` (`extract_tar_gz`).

**Issue:** The function skips the top-level directory component and then calls `target_dir.join(relative_path)` with the remaining components. `Path::components()` preserves `..` as `Component::ParentDir`; `Path::join` does not normalize. A tar entry such as `node-v22.5.1/../../evil/bin/sh` would resolve to `<target_dir>/../../evil/bin/sh`, writing outside the runtime install directory. The bun extractor uses `ZipFile::enclosed_name()` (which rejects traversal) and is safe; the tar path was inconsistent.

**Impact:** Arbitrary file write on Linux/macOS during Node.js install if the tarball is tampered with (supply-chain compromise, malicious mirror, or TLS MITM on `https://nodejs.org/dist/`). Files are created with the tar-declared mode and can be made executable, so this is a privilege-escalation/RCE primitive under those conditions.

**Fix applied:** Replace the manual entry loop with `tar::Archive::entries() + entry.unpack_in(target_dir)` (same pattern used in `crates/extensions/src/installer.rs` and `crates/tooling/src/installer.rs`). `unpack_in` rejects entries whose target path would escape the destination and returns `false`, which is now treated as an error. The top-level-directory stripping is preserved by writing to a staging dir and promoting the single inner directory, so the previous caller contract is maintained.

### H3 — Unrestricted remote binary download+execute via tool installer

**Location:** `crates/tooling/src/installer.rs:531-576` (`download_binary`) and `src-tauri/src/commands/development/tools.rs:157-222` (IPC entry points `install_language_tools`, `install_tool`).

**Issue:** `ToolConfig` accepts a `download_url: Option<String>` from the frontend via IPC. `download_binary` passes the URL directly to `reqwest::get(url)`, writes the payload into `tools_dir/bin/<name>`, marks it executable, and returns the path — which is subsequently executed by other commands. There is no:

- Scheme allowlist (`http://`/`file://`/`javascript:` are all accepted by `reqwest::get` semantics for HTTP; `file://` is rejected by reqwest, but plain `http://` is not).
- Host allowlist.
- Checksum or signature verification.
- Size cap.

Because Tauri's frontend is trusted, any XSS in the UI (markdown/AI renderers are DOMPurified, so this is not currently demonstrated) or any path where user-supplied JSON reaches `LanguageToolConfigSet` would immediately produce RCE.

**Impact:** Frontend-to-RCE primitive if any input channel lets attacker-controlled JSON reach this command. High-severity defense-in-depth gap even in the current trust model.

**Fix applied:**

- Enforce `https://` only (allow `http://localhost|127.0.0.1` in debug builds for local testing).
- Cap download at 100 MB and stream with a running size check.
- Require callers to provide the binary `name` as the final filename — no inference from the URL basename.
- Treat failures distinctly: network, size-cap, and non-2xx responses all return typed `ToolError::DownloadFailed` so UI can surface them clearly.

Registry and package-manager paths (npm/pip/go install/cargo install) remain unchanged — they invoke pinned runtime binaries under the app data dir and do not write arbitrary HTTP-fetched files.

### M1 — `workspace_root` optional in fs IPC commands

**Location:** `src-tauri/src/commands/project/fs.rs` (`open_file_external`, `move_file`, `rename_file`, `get_symlink_info`).

When the frontend omits `workspace_root`, the command logs a warning and proceeds without `path_guard` validation, relying solely on the Tauri FS capability (`$HOME/**`). Consider making `workspace_root` required (or using the current root from app state) so a frontend bug cannot silently skip validation. Not exploitable under the current trust model because the frontend always has the root in the editor store.

### M2 — `format_code` / `lint_code` accept arbitrary executable + args

**Location:** `src-tauri/src/commands/editor/{format.rs,lint.rs}`.

Both commands accept `FormatterConfig { command, args, env, ... }` / `LinterConfig` from the frontend and spawn them via `std::process::Command::new(&command).args(&args)`. This is intentional (extension-driven formatters/linters) and the frontend is trusted, but it means the entire formatter/linter path is a frontend-to-arbitrary-exec gadget. At minimum the review recommends:

- Reject commands with path separators unless the path resolves inside the managed `tools_dir`.
- Reject environment overrides of `PATH`, `LD_PRELOAD`, `DYLD_INSERT_LIBRARIES`, etc.
- Emit a one-time log line for every unique `command` seen so unexpected executables are visible.

Left as a hardening follow-up to avoid regressing the current extension API.

### M3 — Keychain fallback writes secrets to plaintext `secure.json`

**Location:** `src-tauri/src/secure_storage.rs`.

When the OS keychain is unavailable (e.g., headless Linux), secrets are stored in `secure.json` via `tauri-plugin-store`, which is plaintext on disk. The code sets `USED_STORE_FALLBACK` and exposes `secure_storage_using_fallback()` so the UI can warn the user. This is acceptable as documented behavior; consider encrypting the fallback with a user-supplied passphrase, or at minimum restricting file permissions to `0600` on Unix after write.

### M4 — `rsa` 0.9.10 Marvin-attack advisory

`cargo audit` reports `RUSTSEC-2023-0071` (medium, CVSS 5.9) for `rsa 0.9.10` pulled in transitively via `sqlx-mysql 0.8.6`. No fix available upstream. Mitigated by:

- TLS is `rustls` (not affected by the same oracle in the SQL driver).
- MySQL connections are user-initiated, not pre-auth.

Track upstream `rsa`/`sqlx` fix and upgrade when available.

### M5 — `$(dirname <quoted>)` unquoted in outer command

**Location:** `crates/remote/src/lib.rs:132-152,186-214` (`ssh_create_file`, `ssh_rename_path`, `ssh_copy_path`).

Patterns like `format!("mkdir -p $(dirname {0}) && : > {0}", shell_quote(&file_path))` single-quote the argument to `dirname`, but the outer `$(dirname ...)` substitution is then unquoted in the outer `mkdir -p` / `mv` / `cp` arguments. `dirname` only emits the path prefix of its literal argument (no shell metacharacter expansion), so the attack surface is narrow; consider double-quoting the substitution (`mkdir -p "$(dirname …)"`) to be robust to unusual characters (spaces, globs). Low practical risk.

### M6 — `fs:scope` grants `$HOME/**`

`src-tauri/capabilities/main.json` permits the Tauri FS plugin to read/write anywhere in the user's home. This is typical for a code editor (users open projects wherever they live) but is broader than needed for most flows. Consider scoping dynamically to the opened workspace.

### L1 — Dev-only JS advisories

`bun audit` reports 20 advisories in the JS tree; all pull through `react-scan` (dev-only) or `@voidzero-dev/vite-plus-core` (dev-only). None ship in the production bundle. Upgrade `react-scan` when a compatible release lands.

### L2 — GitHub Actions pinned to major version

Actions in `.github/workflows/*.yml` use `@v4`/`@v2` etc. rather than a full SHA. Upstream compromise of a pinned tag would flow into CI. Not exploitable today; pinning to SHA is a standard supply-chain hardening step.

### L3 — CSP `'unsafe-inline'` for styles, `'wasm-unsafe-eval'` for scripts

Required for existing styling and WASM-based tree-sitter parsers. Documented as accepted risk.

### L4 — Internal extension installer downloader

`crates/extensions/src/installer.rs::download_extension` uses `reqwest::get(url)` without re-validating the URL, but is only called from `install_extension_from_url`, which does validate. Adding a defensive check here is a no-cost hardening item.

### L5 — `open_file_external` execs platform opener

`xdg-open`/`open`/`cmd start` are invoked with a canonicalized absolute path. The canonicalize succeeds only when the file exists, and `path_guard` ensures it lives under the workspace root when provided. No shell interpolation.

## Tooling Output (Appendix)

- **cargo audit:** 1 vulnerability (`rsa 0.9.10`, M4), 21 unmaintained-crate warnings (mostly `gtk-rs` 0.18 bindings used transitively on Linux). Output saved to `/tmp/cargo-audit.txt` during the audit.
- **bun audit:** 20 advisories, all through dev-only `react-scan` / `vite-plus` trees (next, playwright, preact, picomatch, rollup, yaml, js-yaml, ajv). None in production deps.
- **Secrets scan:** `grep` for common secret prefixes (`sk-`, `ghp_`, `AKIA`, `AIza`, OpenSSH private key blocks) across tracked source — no hits.

## Verification

After fixes, run:

```
bun check:rust
cargo test -p athas-extensions -p athas-runtime -p athas-tooling
bun typecheck
bun test
```

The Rust test suites exercise the new URL and archive guards; the TS typecheck confirms no IPC shape regression.
