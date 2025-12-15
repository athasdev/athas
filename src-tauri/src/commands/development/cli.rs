use std::fs;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
#[cfg(unix)]
use std::path::Path;
use tauri::command;

// Platform-specific CLI paths
#[cfg(unix)]
const CLI_SCRIPT_PATH: &str = "/usr/local/bin/athas";

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
   #[cfg(unix)]
   {
      Ok(Path::new(CLI_SCRIPT_PATH).exists())
   }

   #[cfg(windows)]
   {
      let cli_path = get_cli_script_path()?;
      Ok(cli_path.exists())
   }
}

#[cfg(unix)]
#[command]
pub fn install_cli_command() -> Result<String, String> {
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

   // Check if /usr/local/bin exists, create if not
   let bin_dir = Path::new("/usr/local/bin");
   if !bin_dir.exists() {
      fs::create_dir_all(bin_dir).map_err(|e| {
         format!(
            "Failed to create /usr/local/bin directory: {}. You may need to run this with \
             administrator privileges.",
            e
         )
      })?;
   }

   // Write the script
   fs::write(CLI_SCRIPT_PATH, script_content).map_err(|e| {
      format!(
         "Failed to write CLI script: {}. You may need to run this with administrator privileges.",
         e
      )
   })?;

   // Make the script executable
   let mut perms = fs::metadata(CLI_SCRIPT_PATH)
      .map_err(|e| format!("Failed to get file permissions: {}", e))?
      .permissions();
   perms.set_mode(0o755);
   fs::set_permissions(CLI_SCRIPT_PATH, perms)
      .map_err(|e| format!("Failed to set executable permissions: {}", e))?;

   Ok(format!(
      "CLI command installed successfully at {}. You can now type 'athas' in your terminal!",
      CLI_SCRIPT_PATH
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
   if !Path::new(CLI_SCRIPT_PATH).exists() {
      return Err("CLI command is not installed".to_string());
   }

   fs::remove_file(CLI_SCRIPT_PATH).map_err(|e| {
      format!(
         "Failed to remove CLI script: {}. You may need to run this with administrator privileges.",
         e
      )
   })?;

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
