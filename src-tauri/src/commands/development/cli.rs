use std::fs;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
#[cfg(unix)]
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

#[command]
pub fn check_cli_installed() -> Result<bool, String> {
   let cli_path = get_cli_script_path()?;
   Ok(cli_path.exists())
}

#[cfg(unix)]
#[command]
pub fn install_cli_command() -> Result<String, String> {
   let cli_path = get_cli_script_path()?;
   let bin_dir = cli_path
      .parent()
      .ok_or_else(|| "Failed to get parent directory".to_string())?;

   // Create the CLI launcher script content
   let script_content = r#"#!/bin/bash
# Athas CLI launcher

# Try to find Athas.app in common locations
if [ -d "/Applications/Athas.app" ]; then
    open -a "/Applications/Athas.app" "$@"
elif [ -d "$HOME/Applications/Athas.app" ]; then
    open -a "$HOME/Applications/Athas.app" "$@"
else
    # Fallback: try to open by name (macOS will search)
    open -a "Athas" "$@"
fi
"#;

   // Create the bin directory if it doesn't exist
   if !bin_dir.exists() {
      fs::create_dir_all(bin_dir).map_err(|e| format!("Failed to create directory: {}", e))?;
   }

   // Write the script
   fs::write(&cli_path, script_content)
      .map_err(|e| format!("Failed to write CLI script: {}", e))?;

   // Make the script executable
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
   let bin_dir = cli_path
      .parent()
      .ok_or_else(|| "Failed to get parent directory".to_string())?;

   // Create the bin directory if it doesn't exist
   if !bin_dir.exists() {
      fs::create_dir_all(bin_dir).map_err(|e| format!("Failed to create bin directory: {}", e))?;
   }

   // Create the CLI launcher batch script content
   let script_content = r#"@echo off
REM Athas CLI launcher for Windows

REM Try to find Athas.exe in common locations
if exist "%LOCALAPPDATA%\Programs\Athas\Athas.exe" (
    start "" "%LOCALAPPDATA%\Programs\Athas\Athas.exe" %*
) else if exist "%PROGRAMFILES%\Athas\Athas.exe" (
    start "" "%PROGRAMFILES%\Athas\Athas.exe" %*
) else if exist "%PROGRAMFILES(X86)%\Athas\Athas.exe" (
    start "" "%PROGRAMFILES(X86)%\Athas\Athas.exe" %*
) else (
    echo Error: Athas installation not found
    echo Please ensure Athas is installed in one of the standard locations
    exit /b 1
)
"#;

   // Write the script
   fs::write(&cli_path, script_content)
      .map_err(|e| format!("Failed to write CLI script: {}", e))?;

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

   if !cli_path.exists() {
      return Err("CLI command is not installed".to_string());
   }

   fs::remove_file(&cli_path).map_err(|e| format!("Failed to remove CLI script: {}", e))?;

   Ok("CLI command uninstalled successfully".to_string())
}
