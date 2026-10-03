use std::path::Path;

/// Sets WebKitGTK rendering overrides before the first webview is created.
///
/// Variables the user already exported always win. Nothing changes for
/// machines that are not affected, because every override here costs
/// rendering performance or works around a specific driver bug:
///
/// - `ATHAS_DISABLE_LINUX_GPU=1` is the manual escape hatch for broken GPU stacks: it turns off the
///   DMA-BUF renderer and accelerated compositing.
/// - The proprietary NVIDIA driver breaks the WebKitGTK DMA-BUF renderer before 2.54 (blank
///   windows, Wayland "Error 71"), so it is disabled there. 2.54 reworked that path and the
///   workaround no longer helps, so newer versions keep it. Explicit sync on NVIDIA Wayland causes
///   the same protocol error and costs nothing to turn off.
pub fn configure_webkit_environment() {
   if env_flag("ATHAS_DISABLE_LINUX_GPU") {
      set_env_if_missing("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
      set_env_if_missing("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
      return;
   }

   if !nvidia_driver_loaded() {
      return;
   }

   set_env_if_missing("__NV_DISABLE_EXPLICIT_SYNC", "1");
   if webkit_version() < (2, 54) {
      set_env_if_missing("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
   }
}

// /proc/driver/nvidia is also visible inside the Flatpak sandbox, which hides
// /sys/module.
fn nvidia_driver_loaded() -> bool {
   Path::new("/sys/module/nvidia").exists() || Path::new("/proc/driver/nvidia/version").exists()
}

fn webkit_version() -> (u32, u32) {
   // SAFETY: Both functions return constants of the linked WebKitGTK library
   // and are safe to call before GTK is initialized.
   unsafe {
      (
         webkit2gtk_sys::webkit_get_major_version(),
         webkit2gtk_sys::webkit_get_minor_version(),
      )
   }
}

fn env_flag(key: &str) -> bool {
   std::env::var(key).is_ok_and(|value| env_flag_enabled(&value))
}

fn env_flag_enabled(value: &str) -> bool {
   let value = value.trim();
   value == "1" || value.eq_ignore_ascii_case("true")
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
