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
      SandboxMode::Full => eprintln!("athas: using the setuid Chromium sandbox"),
      SandboxMode::NamespaceOnly => {
         eprintln!("athas: using the user namespace Chromium sandbox");
         args.push(("--disable-setuid-sandbox", None));
      }
      SandboxMode::None if sandbox_required() => {
         eprintln!(
            "athas: no usable Chromium sandbox was found and ATHAS_REQUIRE_SANDBOX is set. \
             Install the root-owned chrome-sandbox helper or allow unprivileged user namespaces \
             for Athas, then try again."
         );
         std::process::exit(1);
      }
      SandboxMode::None => {
         eprintln!(
            "athas: warning: no usable Chromium sandbox was found, starting with --no-sandbox. \
             Set ATHAS_REQUIRE_SANDBOX=1 to refuse this fallback."
         );
         args.push(("--no-sandbox", None));
      }
   }

   if linux_gpu_disabled() {
      args.extend([("--disable-gpu", None), ("--disable-gpu-compositing", None)]);
   }

   args
}

fn linux_gpu_disabled() -> bool {
   std::env::var("ATHAS_DISABLE_LINUX_GPU").is_ok_and(|value| env_flag_enabled(&value))
}

#[cfg(feature = "linux")]
fn sandbox_required() -> bool {
   std::env::var("ATHAS_REQUIRE_SANDBOX").is_ok_and(|value| env_flag_enabled(&value))
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
///
/// With `kernel.apparmor_restrict_unprivileged_userns=1` the `unshare` call
/// itself still succeeds, but the new namespace has no capabilities. The
/// child therefore also sets up its uid/gid maps and creates a mount
/// namespace, which is what the sandbox needs and what fails under that
/// restriction.
#[cfg(feature = "linux")]
fn unprivileged_userns_clone_is_usable() -> bool {
   // SAFETY: These calls have no preconditions and cannot fail.
   let (uid, gid) = unsafe { (libc::getuid(), libc::getgid()) };
   let mut uid_map = [0u8; 32];
   let uid_map_len = format_id_map(&mut uid_map, uid);
   let mut gid_map = [0u8; 32];
   let gid_map_len = format_id_map(&mut gid_map, gid);

   // SAFETY: `fork` runs during early process bootstrap, before Tauri or any
   // worker threads start, so the calling process is single-threaded. The
   // child below only issues raw, async-signal-safe syscalls on buffers
   // prepared before the fork, then exits without returning.
   let pid = unsafe { libc::fork() };

   if pid < 0 {
      // Could not fork to probe; assume the namespace sandbox works so a
      // probe failure alone doesn't disable sandboxing entirely.
      return true;
   }

   if pid == 0 {
      let usable = unsafe {
         libc::unshare(libc::CLONE_NEWUSER) == 0
            && write_proc_file(c"/proc/self/setgroups", b"deny")
            && write_proc_file(c"/proc/self/uid_map", &uid_map[..uid_map_len])
            && write_proc_file(c"/proc/self/gid_map", &gid_map[..gid_map_len])
            && libc::unshare(libc::CLONE_NEWNS) == 0
      };
      unsafe { libc::_exit(if usable { 0 } else { 1 }) };
   }

   let mut status: libc::c_int = 0;
   // SAFETY: `pid` was just returned by the `fork` call above and nothing
   // else has waited on it.
   if unsafe { libc::waitpid(pid, &mut status, 0) } < 0 {
      return true;
   }

   libc::WIFEXITED(status) && libc::WEXITSTATUS(status) == 0
}

/// Writes `0 <id> 1` into `buffer` without allocating, so it can be prepared
/// before forking and used from the probe child.
#[cfg(feature = "linux")]
fn format_id_map(buffer: &mut [u8; 32], id: u32) -> usize {
   let mut digits = [0u8; 10];
   let mut digit_count = 0;
   let mut remaining = id;
   loop {
      digits[digit_count] = b'0' + (remaining % 10) as u8;
      digit_count += 1;
      remaining /= 10;
      if remaining == 0 {
         break;
      }
   }

   buffer[..2].copy_from_slice(b"0 ");
   let mut len = 2;
   for digit in digits[..digit_count].iter().rev() {
      buffer[len] = *digit;
      len += 1;
   }
   buffer[len..len + 2].copy_from_slice(b" 1");
   len + 2
}

/// Writes `contents` to a `/proc` file with raw syscalls only.
///
/// # Safety
///
/// Only call this from the single-threaded probe child after `fork`.
#[cfg(feature = "linux")]
unsafe fn write_proc_file(path: &std::ffi::CStr, contents: &[u8]) -> bool {
   let fd = unsafe { libc::open(path.as_ptr(), libc::O_WRONLY | libc::O_CLOEXEC) };
   if fd < 0 {
      return false;
   }
   let written = unsafe { libc::write(fd, contents.as_ptr().cast(), contents.len()) };
   unsafe { libc::close(fd) };
   written == contents.len() as isize
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

   #[cfg(feature = "linux")]
   #[test]
   fn formats_single_id_maps() {
      let mut buffer = [0u8; 32];
      let len = super::format_id_map(&mut buffer, 0);
      assert_eq!(&buffer[..len], b"0 0 1");
      let len = super::format_id_map(&mut buffer, 1000);
      assert_eq!(&buffer[..len], b"0 1000 1");
      let len = super::format_id_map(&mut buffer, u32::MAX);
      assert_eq!(&buffer[..len], b"0 4294967295 1");
   }
}
