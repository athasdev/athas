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
pub fn check_cli_installed() -> Result<bool, String> {
   let cli_path = get_cli_script_path()?;

   if !cli_path.exists() {
      return Ok(false);
   }

   #[cfg(all(unix, not(target_os = "macos")))]
   if !validate_cli_script(&cli_path) {
      return Ok(false);
   }

   Ok(true)
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

#[cfg(unix)]
fn current_cli_script() -> Result<String, String> {
   let binary = std::env::current_exe().map_err(|error| error.to_string())?;
   Ok(unix_cli_script(&binary))
}

#[cfg(target_os = "macos")]
#[command]
pub fn install_cli_command() -> Result<String, String> {
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

   Ok(format!(
      "CLI command installed successfully at {}.\n\nNote: Make sure {} is in your PATH. Add this \
       to your ~/.zshrc or ~/.bashrc:\nexport PATH=\"$HOME/.local/bin:$PATH\"",
      cli_path.display(),
      bin_dir.display()
   ))
}

#[cfg(all(unix, not(target_os = "macos")))]
#[command]
pub fn install_cli_command() -> Result<String, String> {
   let cli_path = get_cli_script_path()?;
   let bin_dir = cli_path
      .parent()
      .ok_or_else(|| "Failed to get parent directory".to_string())?;

   let script_content = current_cli_script()?;

   if !bin_dir.exists() {
      fs::create_dir_all(bin_dir).map_err(|e| format!("Failed to create directory: {}", e))?;
   }

   fs::write(&cli_path, script_content)
      .map_err(|e| format!("Failed to write CLI script: {}", e))?;

   let mut perms = fs::metadata(&cli_path)
      .map_err(|e| format!("Failed to get file permissions: {}", e))?
      .permissions();
   perms.set_mode(0o755);
   fs::set_permissions(&cli_path, perms)
      .map_err(|e| format!("Failed to set executable permissions: {}", e))?;

   Ok(format!(
      "CLI command installed successfully at {}.\n\nNote: Make sure {} is in your PATH. Add this \
       to your ~/.zshrc or ~/.bashrc:\nexport PATH=\"$HOME/.local/bin:$PATH\"",
      cli_path.display(),
      bin_dir.display()
   ))
}

#[cfg(windows)]
#[command]
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

   let path_instruction = format!(
      "CLI command installed successfully at {}.\n\nTo use 'athas' from anywhere, add the \
       following directory to your PATH:\n{}\n\nYou can do this by:\n1. Search for 'Environment \
       Variables' in Windows Settings\n2. Edit the 'Path' variable under User variables\n3. Add \
       the directory above\n4. Restart your terminal",
      cli_path.display(),
      bin_dir.display()
   );

   Ok(path_instruction)
}

#[cfg(target_os = "macos")]
#[command]
pub fn get_cli_install_command() -> Result<String, String> {
   let script = current_cli_script()?;

   Ok(format!(
      "mkdir -p ~/.local/bin && cat > ~/.local/bin/athas << 'SCRIPT'\n{}\nSCRIPT\nchmod +x \
       ~/.local/bin/athas",
      script.trim()
   ))
}

#[cfg(all(unix, not(target_os = "macos")))]
#[command]
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

   match install_cli_command() {
      Ok(_) => log::info!("CLI script auto-fixed successfully"),
      Err(e) => log::warn!("Failed to auto-fix CLI script: {}", e),
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
