use std::{fs, os::unix::fs::PermissionsExt, path::Path};
use tauri::command;

const CLI_SCRIPT_PATH: &str = "/usr/local/bin/athas";

#[command]
pub fn check_cli_installed() -> Result<bool, String> {
   Ok(Path::new(CLI_SCRIPT_PATH).exists())
}

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
