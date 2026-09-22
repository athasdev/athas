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

   match sandbox_mode() {
      SandboxMode::Full => {}
      SandboxMode::NamespaceOnly => args.push(("--disable-setuid-sandbox", None)),
      SandboxMode::None => args.push(("--no-sandbox", None)),
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
enum SandboxMode {
   /// The root-owned setuid helper next to the executable is usable.
   Full,
   /// No setuid helper, but the kernel allows sandboxing via an unprivileged
   /// user namespace instead.
   NamespaceOnly,
   /// Neither sandboxing mechanism is available. CEF's zygote refuses to
   /// start at all unless sandboxing is fully disabled.
   None,
}

#[cfg(feature = "linux")]
fn sandbox_mode() -> SandboxMode {
   if setuid_sandbox_available() {
      SandboxMode::Full
   } else if unprivileged_userns_clone_is_usable() {
      SandboxMode::NamespaceOnly
   } else {
      SandboxMode::None
   }
}

#[cfg(feature = "linux")]
fn setuid_sandbox_available() -> bool {
   if std::env::var_os("APPIMAGE").is_some() {
      return false;
   }

   let Ok(executable) = std::env::current_exe() else {
      return false;
   };
   let Some(executable_dir) = executable.parent() else {
      return false;
   };

   setuid_sandbox_is_usable(&executable_dir.join("chrome-sandbox"))
}

#[cfg(feature = "linux")]
fn setuid_sandbox_is_usable(path: &std::path::Path) -> bool {
   use std::os::unix::fs::{MetadataExt, PermissionsExt};

   let Ok(metadata) = path.metadata() else {
      return false;
   };

   metadata.is_file() && metadata.uid() == 0 && metadata.permissions().mode() & 0o4777 == 0o4755
}

/// Probes whether this process can create an unprivileged user namespace,
/// which CEF's zygote falls back to as a sandbox when no setuid helper is
/// present. Some distributions (e.g. Ubuntu 24.04+) restrict this via
/// AppArmor by default, in which case CEF aborts on startup with
/// "No usable sandbox!" unless `--no-sandbox` is passed instead of
/// `--disable-setuid-sandbox`.
///
/// This runs a real `unshare(CLONE_NEWUSER)` in a short-lived forked child
/// so the result matches what CEF's own sandbox check will see. Reading the
/// relevant sysctls alone can't account for a permissive AppArmor profile
/// covering this binary specifically.
#[cfg(feature = "linux")]
fn unprivileged_userns_clone_is_usable() -> bool {
   // SAFETY: `fork` runs during early process bootstrap, before Tauri or any
   // worker threads start, so the calling process is single-threaded. The
   // child below only issues raw, async-signal-safe syscalls before exiting
   // and never touches Rust or libc state shared with the parent.
   let pid = unsafe { libc::fork() };

   if pid < 0 {
      // Could not fork to probe; assume the namespace sandbox works so a
      // probe failure alone doesn't disable sandboxing entirely.
      return true;
   }

   if pid == 0 {
      let result = unsafe { libc::unshare(libc::CLONE_NEWUSER) };
      unsafe { libc::_exit(if result == 0 { 0 } else { 1 }) };
   }

   let mut status: libc::c_int = 0;
   // SAFETY: `pid` was just returned by the `fork` call above and nothing
   // else has waited on it.
   if unsafe { libc::waitpid(pid, &mut status, 0) } < 0 {
      return true;
   }

   libc::WIFEXITED(status) && libc::WEXITSTATUS(status) == 0
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

   #[cfg(feature = "linux")]
   #[test]
   fn userns_probe_completes_without_panicking() {
      // The result depends on the sandbox the test runs under (CI containers
      // commonly restrict this too), so this only guards against the probe
      // hanging or crashing the test process.
      let _: bool = super::unprivileged_userns_clone_is_usable();
   }
}
