pub fn configure_graphics_fallback() {
   if !linux_gpu_disabled() {
      return;
   }

   set_env_if_missing("WEBKIT_DISABLE_DMABUF_RENDERER", "1");

   #[cfg(feature = "linux")]
   set_env_if_missing("LIBGL_ALWAYS_SOFTWARE", "1");
}

#[cfg(feature = "linux")]
pub fn cef_command_line_args() -> Vec<(&'static str, Option<&'static str>)> {
   let mut args = Vec::new();

   if should_disable_setuid_sandbox() {
      args.push(("--disable-setuid-sandbox", None));
   }

   if linux_gpu_disabled() {
      args.extend([("--disable-gpu", None), ("--disable-gpu-compositing", None)]);
   }

   args
}

fn linux_gpu_disabled() -> bool {
   std::env::var("ATHAS_DISABLE_LINUX_GPU").is_ok_and(|value| env_flag_enabled(&value))
}

fn env_flag_enabled(value: &str) -> bool {
   let value = value.trim();
   value == "1" || value.eq_ignore_ascii_case("true")
}

#[cfg(feature = "linux")]
fn should_disable_setuid_sandbox() -> bool {
   if std::env::var_os("APPIMAGE").is_some() {
      return true;
   }

   let Ok(executable) = std::env::current_exe() else {
      return true;
   };
   let Some(executable_dir) = executable.parent() else {
      return true;
   };

   !setuid_sandbox_is_usable(&executable_dir.join("chrome-sandbox"))
}

#[cfg(feature = "linux")]
fn setuid_sandbox_is_usable(path: &std::path::Path) -> bool {
   use std::os::unix::fs::{MetadataExt, PermissionsExt};

   let Ok(metadata) = path.metadata() else {
      return false;
   };

   metadata.is_file() && metadata.uid() == 0 && metadata.permissions().mode() & 0o4777 == 0o4755
}

fn set_env_if_missing(key: &str, value: &str) {
   if std::env::var_os(key).is_none() {
      // SAFETY: Called during process bootstrap before Tauri starts worker threads.
      unsafe {
         std::env::set_var(key, value);
      }
   }
}

#[cfg(test)]
mod tests {
   use super::env_flag_enabled;

   #[test]
   fn parses_enabled_environment_flags() {
      for value in ["1", "true", "TRUE", " true "] {
         assert!(env_flag_enabled(value));
      }
   }

   #[test]
   fn rejects_disabled_or_ambiguous_environment_flags() {
      for value in ["", "0", "false", "yes", "2"] {
         assert!(!env_flag_enabled(value));
      }
   }
}
