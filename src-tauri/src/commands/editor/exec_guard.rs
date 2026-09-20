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
   "NODE_OPTIONS",
   "JAVA_TOOL_OPTIONS",
   "JDK_JAVA_OPTIONS",
];

/// Binary names that interpret a `-c`-style argument as code. Blocking them
/// by basename closes the `command: "sh", args: ["-c", payload]` shape no
/// matter how the binary is referenced.
const SHELL_BINARIES: &[&str] = &[
   "sh",
   "bash",
   "dash",
   "ash",
   "zsh",
   "fish",
   "ksh",
   "csh",
   "tcsh",
   "powershell",
   "pwsh",
   "cmd",
   "wsl",
];

/// Validate the `command` field of a formatter/linter config.
///
/// The name must be a bare executable (looked up via `PATH`) or an absolute
/// path. Relative paths that traverse the filesystem (containing `..` or a
/// path separator) are rejected so callers cannot smuggle a project-relative
/// binary that would be resolved against a surprising CWD. Known shells are
/// rejected by basename because their `-c` arguments execute arbitrary code,
/// and binaries staged under temporary directories are rejected because
/// those locations are writable by other local users.
pub fn validate_exec_command(command: &str) -> Result<(), String> {
   let trimmed = command.trim();
   if trimmed.is_empty() {
      return Err("Command must not be empty".to_string());
   }
   if trimmed.contains('\0') {
      return Err("Command must not contain NUL bytes".to_string());
   }

   if trimmed.contains("..") {
      return Err("Command must not contain '..'".to_string());
   }

   let file_name = trimmed.rsplit(['/', '\\']).next().unwrap_or(trimmed);
   if SHELL_BINARIES
      .iter()
      .any(|shell| file_name.eq_ignore_ascii_case(shell))
   {
      return Err("Shell interpreters are not allowed as tool commands".to_string());
   }

   let has_separator = trimmed.contains('/') || trimmed.contains('\\');
   if has_separator {
      let path = std::path::Path::new(trimmed);
      if !path.is_absolute() {
         return Err(
            "Command with path separators must be an absolute path, not relative".to_string(),
         );
      }
      if is_temporary_path(path) {
         return Err("Tool commands must not run from temporary directories".to_string());
      }
   }

   Ok(())
}

fn is_temporary_path(path: &std::path::Path) -> bool {
   if path.starts_with(std::env::temp_dir()) {
      return true;
   }
   path.starts_with("/dev/shm")
}

/// Validate the `args` of a formatter/linter config. NUL bytes would panic
/// the process spawn, turning a malicious config into a backend crash.
pub fn validate_exec_args(args: &[String]) -> Result<(), String> {
   if args.iter().any(|arg| arg.contains('\0')) {
      return Err("Tool arguments must not contain NUL bytes".to_string());
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
   fn rejects_shell_interpreters() {
      assert!(validate_exec_command("sh").is_err());
      assert!(validate_exec_command("bash").is_err());
      assert!(validate_exec_command("/bin/sh").is_err());
      assert!(validate_exec_command("C:\\Windows\\System32\\cmd.exe").is_err());
   }

   #[test]
   fn rejects_temporary_directory_commands() {
      let staged = std::env::temp_dir().join("evil");
      assert!(validate_exec_command(staged.to_str().unwrap()).is_err());
      assert!(validate_exec_command("/dev/shm/evil").is_err());
   }

   #[test]
   fn rejects_nul_bytes() {
      assert!(validate_exec_command("prettier\0").is_err());
      assert!(validate_exec_args(&["--write\0".to_string()]).is_err());
      assert!(validate_exec_args(&["--write".to_string()]).is_ok());
   }

   #[test]
   fn accepts_benign_env() {
      let mut env = HashMap::new();
      env.insert("NODE_ENV".to_string(), "production".to_string());
      env.insert("PRETTIER_CONFIG".to_string(), "./prettier.rc".to_string());
      assert!(validate_exec_env(&env).is_ok());
   }
}
