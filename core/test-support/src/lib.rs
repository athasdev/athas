//! Helpers shared by the workspace's tests.

use std::path::Path;

/// Writes `contents` to `path` as an executable (mode 0755) that tests can run right away.
///
/// The file is written by a short-lived `sh`, never through a descriptor in the test process.
/// Tests run in parallel threads, and a thread that spawns a process forks first: the child
/// gets a copy of every descriptor the test process has open until it execs. If one of them is
/// a script still open for writing, running that script fails with `ETXTBSY` ("Text file busy")
/// for as long as the copy lives, even after this process has closed its own. Writing from
/// another process leaves nothing open here for a fork to copy.
#[cfg(unix)]
pub fn write_executable(path: &Path, contents: &str) {
   use std::os::unix::fs::PermissionsExt;

   let status = std::process::Command::new("/bin/sh")
      .args(["-c", "printf '%s' \"$1\" > \"$2\"", "sh", contents])
      .arg(path)
      .status()
      .unwrap_or_else(|error| panic!("failed to write {}: {error}", path.display()));
   assert!(status.success(), "failed to write {}", path.display());
   std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755))
      .unwrap_or_else(|error| panic!("failed to make {} executable: {error}", path.display()));
}

/// Writes a `/bin/sh` script running `body` to `path`. See [`write_executable`].
#[cfg(unix)]
pub fn write_script(path: &Path, body: &str) {
   write_executable(path, &format!("#!/bin/sh\n{body}\n"));
}

#[cfg(all(test, unix))]
mod tests {
   use super::*;
   use std::os::unix::fs::PermissionsExt;

   #[test]
   fn writes_the_contents_verbatim_as_a_runnable_file() {
      let dir = std::env::temp_dir().join(format!("athas-test-support-{}", std::process::id()));
      std::fs::create_dir_all(&dir).unwrap();
      let path = dir.join("it's a script");
      let body = "printf '%s\\n' \"$1\" '100%' \\\\";
      write_script(&path, body);

      assert_eq!(
         std::fs::read_to_string(&path).unwrap(),
         format!("#!/bin/sh\n{body}\n")
      );
      assert_eq!(
         std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
         0o755
      );
      let output = std::process::Command::new(&path)
         .arg("hi")
         .output()
         .unwrap();
      assert_eq!(String::from_utf8(output.stdout).unwrap(), "hi\n100%\n\\\n");
      std::fs::remove_dir_all(dir).unwrap();
   }
}
