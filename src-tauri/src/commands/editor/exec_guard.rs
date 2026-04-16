//! Shared validation for extension-supplied formatter/linter execution.
//!
//! Formatter and linter configs come from the frontend via IPC (ultimately
//! populated by installed extensions). While the frontend is trusted in the
//! current threat model, this module enforces defense-in-depth limits so a
//! malicious or mis-configured extension cannot trivially hijack the host
//! process with a dynamic-linker override or a surprise absolute binary
//! path.

use std::collections::HashMap;

/// Environment variables that can alter binary loading or code execution and
/// must never be supplied by a tool config. The comparison is case-insensitive
/// because Windows environment variables are case-insensitive.
const FORBIDDEN_ENV_KEYS: &[&str] = &[
   "PATH",
   "LD_PRELOAD",
   "LD_LIBRARY_PATH",
   "LD_AUDIT",
   "LD_DEBUG",
   "DYLD_INSERT_LIBRARIES",
   "DYLD_LIBRARY_PATH",
   "DYLD_FRAMEWORK_PATH",
   "DYLD_FALLBACK_LIBRARY_PATH",
   "DYLD_FALLBACK_FRAMEWORK_PATH",
   "DYLD_FORCE_FLAT_NAMESPACE",
   "DYLD_IMAGE_SUFFIX",
];

/// Validate the `command` field of a formatter/linter config.
///
/// The name must be a bare executable (looked up via `PATH`) or an absolute
/// path. Relative paths that traverse the filesystem (containing `..` or a
/// path separator) are rejected so callers cannot smuggle a project-relative
/// binary that would be resolved against a surprising CWD.
pub fn validate_exec_command(command: &str) -> Result<(), String> {
   let trimmed = command.trim();
   if trimmed.is_empty() {
      return Err("Command must not be empty".to_string());
   }

   if trimmed.contains("..") {
      return Err("Command must not contain '..'".to_string());
   }

   let has_separator = trimmed.contains('/') || trimmed.contains('\\');
   if has_separator {
      let is_absolute = std::path::Path::new(trimmed).is_absolute();
      if !is_absolute {
         return Err(
            "Command with path separators must be an absolute path, not relative".to_string(),
         );
      }
   }

   Ok(())
}

/// Validate the `env` map of a formatter/linter config. Rejects any key that
/// can influence binary loading or process injection.
pub fn validate_exec_env(env: &HashMap<String, String>) -> Result<(), String> {
   for key in env.keys() {
      let upper = key.to_ascii_uppercase();
      if FORBIDDEN_ENV_KEYS
         .iter()
         .any(|forbidden| upper == *forbidden)
      {
         return Err(format!(
            "Environment variable '{}' is not allowed in tool configs",
            key
         ));
      }
   }
   Ok(())
}

#[cfg(test)]
mod tests {
   use super::*;

   #[test]
   fn accepts_bare_command_names() {
      assert!(validate_exec_command("prettier").is_ok());
      assert!(validate_exec_command("rustfmt").is_ok());
      assert!(validate_exec_command("eslint.cmd").is_ok());
   }

   #[test]
   fn accepts_absolute_paths() {
      if cfg!(unix) {
         assert!(validate_exec_command("/usr/local/bin/prettier").is_ok());
      }
      if cfg!(windows) {
         assert!(validate_exec_command("C:\\Tools\\prettier.exe").is_ok());
      }
   }

   #[test]
   fn rejects_relative_paths_with_separators() {
      assert!(validate_exec_command("./evil").is_err());
      assert!(validate_exec_command("tools/evil").is_err());
      assert!(validate_exec_command("..\\evil.exe").is_err());
   }

   #[test]
   fn rejects_empty_or_traversal_commands() {
      assert!(validate_exec_command("").is_err());
      assert!(validate_exec_command("   ").is_err());
      assert!(validate_exec_command("..").is_err());
      assert!(validate_exec_command("foo/../bar").is_err());
   }

   #[test]
   fn rejects_loader_hijack_env_vars() {
      let mut env = HashMap::new();
      env.insert("LD_PRELOAD".to_string(), "/tmp/evil.so".to_string());
      assert!(validate_exec_env(&env).is_err());

      let mut env = HashMap::new();
      env.insert(
         "DYLD_INSERT_LIBRARIES".to_string(),
         "/tmp/evil.dylib".to_string(),
      );
      assert!(validate_exec_env(&env).is_err());

      let mut env = HashMap::new();
      env.insert("PATH".to_string(), "/tmp:/usr/bin".to_string());
      assert!(validate_exec_env(&env).is_err());
   }

   #[test]
   fn env_key_check_is_case_insensitive() {
      let mut env = HashMap::new();
      env.insert("ld_preload".to_string(), "/tmp/evil.so".to_string());
      assert!(validate_exec_env(&env).is_err());
   }

   #[test]
   fn accepts_benign_env() {
      let mut env = HashMap::new();
      env.insert("NODE_ENV".to_string(), "production".to_string());
      env.insert("PRETTIER_CONFIG".to_string(), "./prettier.rc".to_string());
      assert!(validate_exec_env(&env).is_ok());
   }
}
