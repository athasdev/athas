use std::fs;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use tauri::command;

// Platform-specific CLI paths
#[cfg(unix)]
fn get_cli_script_path() -> Result<std::path::PathBuf, String> {
   let home = std::env::var("HOME").map_err(|_| "Failed to get home directory".to_string())?;
   Ok(std::path::PathBuf::from(home)
      .join(".local")
      .join("bin")
      .join("athas"))
}

#[cfg(windows)]
fn get_cli_script_path() -> Result<std::path::PathBuf, String> {
   let home = std::env::var("USERPROFILE")
      .map_err(|_| "Failed to get user profile directory".to_string())?;
   Ok(std::path::PathBuf::from(home)
      .join(".athas")
      .join("bin")
      .join("athas.cmd"))
}

#[cfg(windows)]
fn get_cli_powershell_path() -> Result<std::path::PathBuf, String> {
   let cli_path = get_cli_script_path()?;
   Ok(cli_path.with_extension("ps1"))
}

/// On Linux, check if an existing CLI script contains macOS-specific commands (`open -a`).
/// Returns `false` if the script has wrong-platform content.
#[cfg(all(unix, not(target_os = "macos")))]
fn validate_cli_script(path: &std::path::Path) -> bool {
   match fs::read_to_string(path) {
      Ok(content) => !content.contains("open -a"),
      Err(_) => false,
   }
}

#[command]
#[specta::specta]
pub fn check_cli_installed() -> Result<bool, String> {
   let cli_path = get_cli_script_path()?;

   let installed = cli_path.exists();
   #[cfg(all(unix, not(target_os = "macos")))]
   let installed = installed && validate_cli_script(&cli_path);
   Ok(installed)
}

pub const CLI_HELP_TEXT: &str = r#"Athas CLI

Usage:
  athas [--new-window | --reuse-window] [paths...]
  athas open [--new-window | --reuse-window] <paths...>
  athas window
  athas terminal [--cwd <directory>] [--reuse-window] [--] [command...]
  athas settings
  athas extensions
  athas pr <number> [--cwd <repository>]
  athas issue <number> [--cwd <repository>]
  athas action <run-id> [--cwd <repository>]
  athas remote [--new-window] <connection-id> [name]
  athas web <url>

Options:
  -n, --new-window     Open each target in a new window
  -r, --reuse-window   Open in an existing editor (create one if needed)
  --cwd <directory>   Working directory for terminals and repository commands
  --                  End Athas options; following arguments belong to the command
  -h, --help          Show this help

Terminal, Settings, Extensions, and GitHub resources open in their own windows.
Files, folders, and remote connections use the editor. Web URLs use your browser.
Pass shell expressions as one quoted command string.

Examples:
  athas terminal
  athas terminal --cwd ~/projects/my-app
  athas terminal -- bun test
  athas terminal 'git status && git diff'
  athas --new-window src/main.rs:120
  athas pr 42 --cwd ~/projects/my-app
"#;

#[cfg(unix)]
fn unix_cli_script(binary: &std::path::Path) -> String {
   let binary = binary.to_string_lossy().replace('\'', "'\\''");
   format!(
      r#"#!/bin/bash
# Athas CLI launcher
athas_binary='{binary}'
case "${{1:-}}" in
    help|-h|--help) exec "$athas_binary" --help ;;
esac
"$athas_binary" --validate-cli "$@" || exit $?
nohup "$athas_binary" "$@" >/dev/null 2>&1 &
"#
   )
}

#[cfg(windows)]
fn windows_cmd_script() -> String {
   r#"@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0athas.ps1" %*
"#
   .to_string()
}

#[cfg(windows)]
fn windows_powershell_script() -> Result<String, String> {
   let binary = std::env::current_exe().map_err(|error| error.to_string())?;
   let binary = binary.to_string_lossy().replace('\'', "''");
   Ok(format!(
      r#"$ErrorActionPreference = 'Stop'
$athasBinary = '{binary}'
if ($args.Count -gt 0 -and $args[0] -in @('help', '-h', '--help')) {{
  Write-Output @'
{CLI_HELP_TEXT}
'@
  exit 0
}}
function Quote-NativeArgument([string]$value) {{
  $value = [regex]::Replace($value, '(\\*)"', '$1$1\"')
  $value = [regex]::Replace($value, '(\\+)$', '$1$1')
  return '"' + $value + '"'
}}
$encodedArgs = @($args | ForEach-Object {{ Quote-NativeArgument $_ }}) -join ' '
$start = New-Object System.Diagnostics.ProcessStartInfo
$start.FileName = $athasBinary
$start.WorkingDirectory = (Get-Location).Path
$start.UseShellExecute = $false
$start.CreateNoWindow = $true
$start.Arguments = '--validate-cli ' + $encodedArgs
$validation = [System.Diagnostics.Process]::Start($start)
$validation.WaitForExit()
if ($validation.ExitCode -ne 0) {{
  Write-Error 'Invalid arguments or inaccessible path. Run athas --help for usage.'
  exit $validation.ExitCode
}}
$start.Arguments = $encodedArgs
[System.Diagnostics.Process]::Start($start) | Out-Null
"#
   ))
}

#[cfg(any(target_os = "macos", test))]
const UNIX_CLI_SCRIPT_HEADER: &str = "#!/bin/bash\n# Athas CLI launcher\n";

#[cfg(unix)]
fn current_cli_script() -> Result<String, String> {
   let binary = std::env::current_exe().map_err(|error| error.to_string())?;
   Ok(unix_cli_script(&binary))
}

/// macOS mounts apps opened straight from Downloads or a disk image at a random
/// read-only App Translocation path that disappears after the app quits, so a
/// launcher pointing there stops working.
#[cfg(target_os = "macos")]
fn is_translocated(binary: &std::path::Path) -> bool {
   binary
      .components()
      .any(|component| component.as_os_str() == "AppTranslocation")
}

#[cfg(target_os = "macos")]
fn ensure_installable_location() -> Result<(), String> {
   let binary = std::env::current_exe().map_err(|error| error.to_string())?;
   if is_translocated(&binary) {
      return Err(
         "Athas is running from a temporary location. Move Athas to your Applications folder, \
          reopen it, and install the CLI command again."
            .to_string(),
      );
   }
   Ok(())
}

/// Returns the binary an Athas launcher script execs, or `None` for launchers
/// written by older versions that went through `open` and URL schemes instead.
#[cfg(any(target_os = "macos", test))]
fn launcher_binary(script: &str) -> Option<std::path::PathBuf> {
   let quoted = script
      .lines()
      .find_map(|line| line.strip_prefix("athas_binary="))?;
   let inner = quoted.strip_prefix('\'')?.strip_suffix('\'')?;
   Some(std::path::PathBuf::from(inner.replace("'\\''", "'")))
}

/// Decides whether a launcher found on disk should be replaced by `current`.
/// Scripts Athas did not write are left alone, and a working launcher that
/// points at another existing Athas build (for example a preview channel) is
/// kept so channels do not keep overwriting each other.
#[cfg(any(target_os = "macos", test))]
fn launcher_needs_rewrite(existing: &str, current: &str) -> bool {
   if !existing.starts_with(UNIX_CLI_SCRIPT_HEADER) || existing == current {
      return false;
   }
   match launcher_binary(existing) {
      Some(binary) => !binary.exists(),
      None => true,
   }
}

#[cfg(unix)]
fn write_unix_launcher() -> Result<std::path::PathBuf, String> {
   #[cfg(target_os = "macos")]
   ensure_installable_location()?;
   let cli_path = get_cli_script_path()?;
   let bin_dir = cli_path
      .parent()
      .ok_or_else(|| "Failed to get parent directory".to_string())?;

   if !bin_dir.exists() {
      fs::create_dir_all(bin_dir).map_err(|e| format!("Failed to create directory: {}", e))?;
   }

   fs::write(&cli_path, current_cli_script()?)
      .map_err(|e| format!("Failed to write CLI script: {}", e))?;

   let mut perms = fs::metadata(&cli_path)
      .map_err(|e| format!("Failed to get file permissions: {}", e))?
      .permissions();
   perms.set_mode(0o755);
   fs::set_permissions(&cli_path, perms)
      .map_err(|e| format!("Failed to set executable permissions: {}", e))?;

   Ok(cli_path)
}

#[cfg(unix)]
const POSIX_PATH_LINE: &str = "export PATH=\"$HOME/.local/bin:$PATH\"";

#[cfg(unix)]
const FISH_PATH_LINE: &str = "fish_add_path -g \"$HOME/.local/bin\"";

/// Startup files a shell reads, the one Athas appends to, and the line that puts
/// `~/.local/bin` on PATH there. Returns `None` for shells Athas does not know.
#[cfg(unix)]
fn shell_path_setup(
   shell: &str,
   home: &std::path::Path,
   zdotdir: Option<&std::path::Path>,
) -> Option<(Vec<std::path::PathBuf>, std::path::PathBuf, &'static str)> {
   let name = std::path::Path::new(shell).file_name()?.to_str()?;
   match name {
      "zsh" => {
         let dir = zdotdir.unwrap_or(home);
         let files = [".zshenv", ".zprofile", ".zshrc"].map(|file| dir.join(file));
         Some((files.to_vec(), dir.join(".zshrc"), POSIX_PATH_LINE))
      }
      "bash" => {
         let files = [".bashrc", ".bash_profile", ".profile"].map(|file| home.join(file));
         let target = if cfg!(target_os = "macos") {
            home.join(".bash_profile")
         } else {
            home.join(".bashrc")
         };
         Some((files.to_vec(), target, POSIX_PATH_LINE))
      }
      "fish" => {
         let config = home.join(".config").join("fish");
         let target = config.join("conf.d").join("athas.fish");
         Some((
            vec![config.join("config.fish"), target.clone()],
            target,
            FISH_PATH_LINE,
         ))
      }
      _ => None,
   }
}

#[cfg(unix)]
fn mentions_local_bin(content: &str) -> bool {
   content
      .lines()
      .map(str::trim)
      .filter(|line| !line.starts_with('#'))
      .any(|line| line.contains(".local/bin"))
}

#[cfg(unix)]
enum ShellPathSetup {
   AlreadyOnPath,
   Added(std::path::PathBuf),
   Manual,
}

/// Makes sure new terminals find the launcher in `bin_dir`, appending one PATH
/// line to the user's shell startup file when none of them mentions it yet.
#[cfg(unix)]
fn ensure_bin_dir_on_shell_path(bin_dir: &std::path::Path) -> ShellPathSetup {
   let on_process_path = std::env::var_os("PATH")
      .is_some_and(|path| std::env::split_paths(&path).any(|entry| entry == bin_dir));
   let Ok(home) = std::env::var("HOME") else {
      return ShellPathSetup::Manual;
   };
   let home = std::path::PathBuf::from(home);
   let shell = std::env::var("SHELL")
      .ok()
      .or_else(|| cfg!(target_os = "macos").then(|| "/bin/zsh".to_string()));
   let zdotdir = std::env::var_os("ZDOTDIR").map(std::path::PathBuf::from);
   let Some((files, target, line)) = shell
      .as_deref()
      .and_then(|shell| shell_path_setup(shell, &home, zdotdir.as_deref()))
   else {
      return if on_process_path {
         ShellPathSetup::AlreadyOnPath
      } else {
         ShellPathSetup::Manual
      };
   };

   let configured = files.iter().any(|file| {
      fs::read_to_string(file)
         .map(|content| mentions_local_bin(&content))
         .unwrap_or(false)
   });
   if configured || on_process_path {
      return ShellPathSetup::AlreadyOnPath;
   }

   let existing = fs::read_to_string(&target).unwrap_or_default();
   let separator = if existing.is_empty() || existing.ends_with('\n') {
      ""
   } else {
      "\n"
   };
   let block = format!("{separator}\n# Added by Athas for the `athas` command\n{line}\n");
   let written = target
      .parent()
      .map_or(Ok(()), fs::create_dir_all)
      .and_then(|_| {
         use std::io::Write;
         fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&target)?
            .write_all(block.as_bytes())
      });
   match written {
      Ok(()) => ShellPathSetup::Added(target),
      Err(error) => {
         log::warn!(
            "Failed to add {} to PATH in {}: {error}",
            bin_dir.display(),
            target.display()
         );
         ShellPathSetup::Manual
      }
   }
}

#[cfg(unix)]
#[command]
#[specta::specta]
pub fn install_cli_command() -> Result<String, String> {
   let cli_path = write_unix_launcher()?;
   let bin_dir = cli_path
      .parent()
      .ok_or_else(|| "Failed to get parent directory".to_string())?;

   let installed = format!(
      "CLI command installed successfully at {}.",
      cli_path.display()
   );
   Ok(match ensure_bin_dir_on_shell_path(bin_dir) {
      ShellPathSetup::AlreadyOnPath => {
         format!("{installed}\n\nOpen a new terminal and run `athas .` to open a folder.")
      }
      ShellPathSetup::Added(file) => format!(
         "{installed}\n\nAdded {} to your PATH in {}. Open a new terminal and run `athas .` to \
          open a folder.",
         bin_dir.display(),
         file.display()
      ),
      ShellPathSetup::Manual => format!(
         "{installed}\n\nNote: Make sure {} is in your PATH. Add this to your shell startup \
          file:\n{POSIX_PATH_LINE}",
         bin_dir.display()
      ),
   })
}

#[cfg(windows)]
#[command]
#[specta::specta]
pub fn install_cli_command() -> Result<String, String> {
   let cli_path = get_cli_script_path()?;
   let powershell_path = get_cli_powershell_path()?;
   let bin_dir = cli_path
      .parent()
      .ok_or_else(|| "Failed to get parent directory".to_string())?;

   if !bin_dir.exists() {
      fs::create_dir_all(bin_dir).map_err(|e| format!("Failed to create bin directory: {}", e))?;
   }

   fs::write(&cli_path, windows_cmd_script())
      .map_err(|e| format!("Failed to write CLI script: {}", e))?;
   fs::write(&powershell_path, windows_powershell_script()?)
      .map_err(|e| format!("Failed to write PowerShell CLI script: {}", e))?;

   let installed = format!(
      "CLI command installed successfully at {}.",
      cli_path.display()
   );
   Ok(match add_to_user_path(bin_dir) {
      Ok(true) => format!(
         "{installed}\n\nAdded {} to your user PATH. Open a new terminal and run `athas .` to \
          open a folder.",
         bin_dir.display()
      ),
      Ok(false) => {
         format!("{installed}\n\nOpen a new terminal and run `athas .` to open a folder.")
      }
      Err(error) => {
         log::warn!(
            "Failed to add {} to the user PATH: {error}",
            bin_dir.display()
         );
         format!(
            "{installed}\n\nTo use 'athas' from anywhere, add the following directory to your \
             PATH:\n{}\n\nYou can do this by:\n1. Search for 'Environment Variables' in Windows \
             Settings\n2. Edit the 'Path' variable under User variables\n3. Add the directory \
             above\n4. Restart your terminal",
            bin_dir.display()
         )
      }
   })
}

/// PowerShell that appends `%USERPROFILE%\.athas\bin` to the user PATH unless an
/// entry already expands to `{dir}`. It keeps the value an expandable string so
/// other `%VAR%` entries survive, then sets and clears a throwaway variable so
/// Windows broadcasts the change to Explorer and new terminals. Exits 3 when the
/// directory was already there.
#[cfg(any(windows, test))]
fn user_path_script(dir: &str) -> String {
   let dir = dir.replace('\'', "''");
   format!(
      r#"$ErrorActionPreference = 'Stop'
$dir = '{dir}'.TrimEnd('\')
$key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment')
$raw = [string]$key.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
$entries = @($raw -split ';' | Where-Object {{ $_ -ne '' }})
foreach ($entry in $entries) {{
  if ([Environment]::ExpandEnvironmentVariables($entry).TrimEnd('\') -ieq $dir) {{ exit 3 }}
}}
$entries += '%USERPROFILE%\.athas\bin'
$key.SetValue('Path', ($entries -join ';'), [Microsoft.Win32.RegistryValueKind]::ExpandString)
$key.Close()
[Environment]::SetEnvironmentVariable('ATHAS_PATH_REFRESH', '1', 'User')
[Environment]::SetEnvironmentVariable('ATHAS_PATH_REFRESH', $null, 'User')
"#
   )
}

/// Returns `Ok(true)` when the directory was added and `Ok(false)` when the user
/// PATH already had it.
#[cfg(windows)]
fn add_to_user_path(bin_dir: &std::path::Path) -> Result<bool, String> {
   use base64::Engine as _;
   use std::os::windows::process::CommandExt;
   const CREATE_NO_WINDOW: u32 = 0x0800_0000;

   let script = user_path_script(&bin_dir.to_string_lossy());
   let utf16 = script
      .encode_utf16()
      .flat_map(u16::to_le_bytes)
      .collect::<Vec<_>>();
   let output = std::process::Command::new("powershell.exe")
      .args([
         "-NoProfile",
         "-NonInteractive",
         "-ExecutionPolicy",
         "Bypass",
         "-EncodedCommand",
         &base64::engine::general_purpose::STANDARD.encode(utf16),
      ])
      .creation_flags(CREATE_NO_WINDOW)
      .output()
      .map_err(|error| error.to_string())?;
   match output.status.code() {
      Some(0) => Ok(true),
      Some(3) => Ok(false),
      _ => Err(String::from_utf8_lossy(&output.stderr).trim().to_string()),
   }
}

#[cfg(target_os = "macos")]
#[command]
#[specta::specta]
pub fn get_cli_install_command() -> Result<String, String> {
   ensure_installable_location()?;
   let script = current_cli_script()?;

   Ok(format!(
      "mkdir -p ~/.local/bin && cat > ~/.local/bin/athas << 'SCRIPT'\n{}\nSCRIPT\nchmod +x \
       ~/.local/bin/athas",
      script.trim()
   ))
}

#[cfg(all(unix, not(target_os = "macos")))]
#[command]
#[specta::specta]
pub fn get_cli_install_command() -> Result<String, String> {
   let script = current_cli_script()?;
   Ok(format!(
      "mkdir -p ~/.local/bin && cat > ~/.local/bin/athas << 'EOF'\n{}\nEOF\nchmod +x \
       ~/.local/bin/athas",
      script.trim()
   ))
}

#[cfg(windows)]
#[command]
#[specta::specta]
pub fn get_cli_install_command() -> Result<String, String> {
   let powershell_script = windows_powershell_script()?.replace('\'', "''");
   Ok(format!(
      r#"mkdir "%USERPROFILE%\.athas\bin" 2>nul && (
echo @echo off
echo powershell -NoProfile -ExecutionPolicy Bypass -File "%%~dp0athas.ps1" %%*
) > "%USERPROFILE%\.athas\bin\athas.cmd" && powershell -NoProfile -ExecutionPolicy Bypass -Command "$script = @'
{powershell_script}
'@; Set-Content -LiteralPath \"$env:USERPROFILE\.athas\bin\athas.ps1\" -Value $script""#
   ))
}

#[cfg(unix)]
#[command]
#[specta::specta]
pub fn uninstall_cli_command() -> Result<String, String> {
   let cli_path = get_cli_script_path()?;

   if !cli_path.exists() {
      return Err("CLI command is not installed".to_string());
   }

   fs::remove_file(&cli_path).map_err(|e| format!("Failed to remove CLI script: {}", e))?;

   Ok("CLI command uninstalled successfully".to_string())
}

#[cfg(windows)]
#[command]
#[specta::specta]
pub fn uninstall_cli_command() -> Result<String, String> {
   let cli_path = get_cli_script_path()?;
   let powershell_path = get_cli_powershell_path()?;

   if !cli_path.exists() {
      return Err("CLI command is not installed".to_string());
   }

   fs::remove_file(&cli_path).map_err(|e| format!("Failed to remove CLI script: {}", e))?;
   if powershell_path.exists() {
      fs::remove_file(&powershell_path)
         .map_err(|e| format!("Failed to remove PowerShell CLI script: {}", e))?;
   }

   Ok("CLI command uninstalled successfully".to_string())
}

/// On Linux, silently fix a CLI script that contains macOS commands (`open -a`).
/// Called once during app startup to auto-repair wrong-platform scripts.
#[cfg(all(unix, not(target_os = "macos")))]
pub fn auto_fix_cli_on_startup() {
   let cli_path = match get_cli_script_path() {
      Ok(p) => p,
      Err(_) => return,
   };

   if !cli_path.exists() {
      return;
   }

   if validate_cli_script(&cli_path) {
      return;
   }

   log::info!(
      "CLI script at {} contains macOS commands, rewriting with Linux version",
      cli_path.display()
   );

   match write_unix_launcher() {
      Ok(_) => log::info!("CLI script auto-fixed successfully"),
      Err(e) => log::warn!("Failed to auto-fix CLI script: {}", e),
   }
}

/// On macOS, replace launchers written by older Athas versions. Those ran
/// `open "athas://open?..."`, which could leave a blank window instead of
/// opening the requested path.
#[cfg(target_os = "macos")]
pub fn auto_fix_cli_on_startup() {
   if cfg!(debug_assertions) {
      return;
   }
   let Ok(cli_path) = get_cli_script_path() else {
      return;
   };
   let Ok(existing) = fs::read_to_string(&cli_path) else {
      return;
   };
   let Ok(binary) = std::env::current_exe() else {
      return;
   };
   if is_translocated(&binary) || !launcher_needs_rewrite(&existing, &unix_cli_script(&binary)) {
      return;
   }

   log::info!("Updating outdated CLI launcher at {}", cli_path.display());
   match write_unix_launcher() {
      Ok(_) => log::info!("CLI launcher updated"),
      Err(error) => log::warn!("Failed to update CLI launcher: {error}"),
   }
}

#[cfg(all(test, unix))]
mod tests {
   use super::*;
   use std::{
      process::Command,
      time::{SystemTime, UNIX_EPOCH},
   };

   #[test]
   fn reads_the_binary_back_from_a_launcher() {
      let binary = std::path::Path::new("/Applications/Athas's App.app/Contents/MacOS/athas");
      assert_eq!(
         launcher_binary(&unix_cli_script(binary)).as_deref(),
         Some(binary)
      );
   }

   #[test]
   fn rewrites_legacy_launchers_and_ones_pointing_at_missing_binaries() {
      let current = unix_cli_script(std::path::Path::new("/bin/sh"));
      let legacy = "#!/bin/bash\n# Athas CLI launcher\n\nopen \"athas://open?path=$1\"\n";
      assert!(launcher_needs_rewrite(legacy, &current));

      let missing = unix_cli_script(std::path::Path::new("/nonexistent/Athas.app/athas"));
      assert!(launcher_needs_rewrite(&missing, &current));
   }

   #[test]
   fn keeps_current_foreign_and_other_channel_launchers() {
      let current = unix_cli_script(std::path::Path::new("/bin/sh"));
      assert!(!launcher_needs_rewrite(&current, &current));
      assert!(!launcher_needs_rewrite(
         "#!/bin/bash\nexec my-editor \"$@\"\n",
         &current
      ));

      let other_channel = unix_cli_script(std::path::Path::new("/bin/bash"));
      assert!(!launcher_needs_rewrite(&other_channel, &current));
   }

   #[test]
   fn picks_the_startup_file_for_each_shell() {
      let home = std::path::Path::new("/home/me");
      let (files, target, line) = shell_path_setup("/bin/zsh", home, None).unwrap();
      assert_eq!(target, home.join(".zshrc"));
      assert!(files.contains(&home.join(".zprofile")));
      assert_eq!(line, POSIX_PATH_LINE);

      let zdotdir = std::path::Path::new("/home/me/.config/zsh");
      let (_, target, _) = shell_path_setup("/bin/zsh", home, Some(zdotdir)).unwrap();
      assert_eq!(target, zdotdir.join(".zshrc"));

      let (_, target, line) = shell_path_setup("/usr/local/bin/fish", home, None).unwrap();
      assert_eq!(target, home.join(".config/fish/conf.d/athas.fish"));
      assert_eq!(line, FISH_PATH_LINE);

      assert!(shell_path_setup("/bin/bash", home, None).is_some());
      assert!(shell_path_setup("/usr/bin/nu", home, None).is_none());
   }

   #[test]
   fn ignores_commented_out_path_lines() {
      assert!(mentions_local_bin(
         "export PATH=\"$HOME/.local/bin:$PATH\"\n"
      ));
      assert!(mentions_local_bin("  path+=(~/.local/bin)\n"));
      assert!(!mentions_local_bin(
         "# export PATH=\"$HOME/.local/bin:$PATH\"\n"
      ));
      assert!(!mentions_local_bin("export PATH=\"$HOME/bin:$PATH\"\n"));
   }

   #[test]
   fn user_path_script_quotes_the_directory() {
      let script = user_path_script(r"C:\Users\O'Brien\.athas\bin");
      assert!(script.contains(r"$dir = 'C:\Users\O''Brien\.athas\bin'"));
      assert!(script.contains(r"'%USERPROFILE%\.athas\bin'"));
   }

   #[test]
   fn launcher_preserves_arguments_and_the_callers_directory() {
      let directory = std::env::temp_dir().join(format!(
         "athas-cli-test-{}",
         SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
      ));
      fs::create_dir_all(&directory).unwrap();
      let binary = directory.join("Athas's binary");
      fs::write(
         &binary,
         "#!/bin/bash\nif [ \"$1\" = --validate-cli ]; then exit 0; fi\nprintf '%s\\0' \"$PWD\" \
          \"$@\" > result\n",
      )
      .unwrap();
      fs::set_permissions(&binary, fs::Permissions::from_mode(0o755)).unwrap();
      let launcher = directory.join("athas");
      fs::write(&launcher, unix_cli_script(&binary)).unwrap();
      let status = Command::new("bash")
         .arg(&launcher)
         .args([
            "terminal",
            "--",
            "printf",
            "two words",
            "$(echo literal)",
            "ünicode",
         ])
         .current_dir(&directory)
         .status()
         .unwrap();
      assert!(status.success());
      let result = directory.join("result");
      for _ in 0..100 {
         if result.exists() && fs::metadata(&result).unwrap().len() > 0 {
            break;
         }
         std::thread::sleep(std::time::Duration::from_millis(10));
      }
      let output = fs::read_to_string(result).unwrap();
      let args = output
         .trim_end_matches('\0')
         .split('\0')
         .collect::<Vec<_>>();
      assert_eq!(
         &args[1..],
         &[
            "terminal",
            "--",
            "printf",
            "two words",
            "$(echo literal)",
            "ünicode"
         ]
      );
      assert_eq!(
         std::path::Path::new(args[0]).canonicalize().unwrap(),
         directory.canonicalize().unwrap()
      );
      fs::remove_dir_all(directory).unwrap();
   }
}
