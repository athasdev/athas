use base64::{
   Engine,
   engine::general_purpose::{STANDARD, STANDARD_NO_PAD},
};
use serde::Serialize;
use sha2::{Digest, Sha256};
use ssh2::{CheckResult, KnownHostFileKind, KnownHostKeyFormat, Session};
use std::{
   fs,
   path::{Path, PathBuf},
   sync::Mutex,
};

static HOST_TRUST_LOCK: Mutex<()> = Mutex::new(());
const CHALLENGE_PREFIX: &str = "ATHAS_SSH_UNKNOWN_HOST:";

#[derive(Serialize)]
struct HostChallenge<'a> {
   host: &'a str,
   port: u16,
   fingerprint: String,
}

pub(super) fn validate_endpoint(host: &str, port: u16) -> Result<(), String> {
   if host.is_empty()
      || port == 0
      || host
         .chars()
         .any(|c| c.is_whitespace() || c.is_control() || matches!(c, ',' | '[' | ']'))
   {
      return Err("Invalid SSH host or port.".into());
   }
   Ok(())
}

fn trust_paths(home: &Path) -> Result<Vec<PathBuf>, String> {
   if !home.is_absolute() {
      return Err("Cannot locate SSH trusted hosts: HOME must be an absolute path.".into());
   }
   let mut paths = Vec::new();
   if cfg!(unix) {
      paths.push(PathBuf::from("/etc/ssh/ssh_known_hosts"));
   }
   paths.push(home.join(".ssh/known_hosts"));
   paths.push(home.join(".ssh/athas_known_hosts"));
   Ok(paths)
}

fn fingerprint(key: &[u8]) -> String {
   format!("SHA256:{}", STANDARD_NO_PAD.encode(Sha256::digest(key)))
}

fn matches_pattern(pattern: &str, value: &str) -> bool {
   let pattern = pattern.to_ascii_lowercase();
   let value = value.to_ascii_lowercase();
   let pattern = pattern.as_bytes();
   let value = value.as_bytes();
   let (mut p, mut v, mut star, mut resume) = (0, 0, None, 0);
   while v < value.len() {
      if p < pattern.len() && (pattern[p] == b'?' || pattern[p] == value[v]) {
         p += 1;
         v += 1;
      } else if p < pattern.len() && pattern[p] == b'*' {
         star = Some(p);
         p += 1;
         resume = v;
      } else if let Some(index) = star {
         resume += 1;
         v = resume;
         p = index + 1;
      } else {
         return false;
      }
   }
   while p < pattern.len() && pattern[p] == b'*' {
      p += 1;
   }
   p == pattern.len()
}

fn matches_host_patterns(patterns: &str, host: &str, port: u16) -> bool {
   let endpoint = format!("[{host}]:{port}");
   let mut matched = false;
   for pattern in patterns.split(',') {
      let (negative, pattern) = pattern
         .strip_prefix('!')
         .map_or((false, pattern), |pattern| (true, pattern));
      let applies =
         matches_pattern(pattern, &endpoint) || (port == 22 && matches_pattern(pattern, host));
      if applies && negative {
         return false;
      }
      matched |= applies;
   }
   matched
}

fn check_key(
   session: &Session,
   paths: &[PathBuf],
   host: &str,
   port: u16,
   key: &[u8],
) -> Result<bool, String> {
   validate_endpoint(host, port)?;
   let mut matched = false;
   for path in paths {
      let content = match fs::read_to_string(path) {
         Ok(content) => content,
         Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
         Err(error) => {
            return Err(format!(
               "Cannot read SSH trusted hosts {}: {error}",
               path.display()
            ));
         }
      };
      let mut known = session.known_hosts().map_err(|error| error.to_string())?;
      for (index, line) in content.lines().enumerate() {
         let line = line.trim();
         if line.is_empty() || line.starts_with('#') {
            continue;
         }
         let mut fields = line.split_whitespace();
         let first = fields.next().ok_or("Missing SSH host entry.")?;
         let (marker, names) = if first.starts_with('@') {
            (
               Some(first),
               fields.next().ok_or("Missing marked SSH host entry.")?,
            )
         } else {
            (None, first)
         };
         let algorithm = fields.next().ok_or("Missing SSH host key algorithm.")?;
         let encoded = fields.next().ok_or("Missing SSH host key.")?;
         let saved_key = STANDARD.decode(encoded).map_err(|error| {
            format!(
               "Cannot read SSH trusted hosts {} at line {}: {error}",
               path.display(),
               index + 1
            )
         })?;
         let applies = if names.starts_with('|') {
            let mut hashed = session.known_hosts().map_err(|error| error.to_string())?;
            hashed
               .read_str(
                  &format!("{names} ssh-rsa {encoded}"),
                  KnownHostFileKind::OpenSSH,
               )
               .map_err(|error| error.to_string())?;
            match hashed.check_port(host, port, key) {
               CheckResult::NotFound => false,
               CheckResult::Match | CheckResult::Mismatch => true,
               CheckResult::Failure => {
                  return Err("Host key verification failed for hashed SSH host entry.".into());
               }
            }
         } else {
            matches_host_patterns(names, host, port)
         };
         if !applies {
            continue;
         }
         match marker {
            Some("@revoked") => {
               if saved_key == key {
                  return Err(format!(
                     "Host key verification failed for {host}:{port}: the server key is revoked \
                      in {}.",
                     path.display()
                  ));
               }
               continue;
            }
            Some("@cert-authority") => {
               return Err(format!(
                  "Host key verification failed for {host}:{port}: SSH certificate authorities \
                   are not supported by this connection backend. Use a directly trusted server \
                   key."
               ));
            }
            Some(_) => {
               return Err(format!(
                  "Host key verification failed: unsupported SSH trust marker in {}.",
                  path.display()
               ));
            }
            None => {}
         }
         if !matches!(
            algorithm,
            "ssh-rsa"
               | "ssh-dss"
               | "ssh-ed25519"
               | "ecdsa-sha2-nistp256"
               | "ecdsa-sha2-nistp384"
               | "ecdsa-sha2-nistp521"
         ) {
            return Err(format!(
               "Host key verification failed: unsupported SSH host key algorithm {algorithm}."
            ));
         }
         let name = if port == 22 {
            host.to_string()
         } else {
            format!("[{host}]:{port}")
         };
         known
            .read_str(
               &format!("{name} {algorithm} {encoded}"),
               KnownHostFileKind::OpenSSH,
            )
            .map_err(|error| {
               format!(
                  "Cannot read SSH trusted hosts {} at line {}: {error}",
                  path.display(),
                  index + 1
               )
            })?;
      }
      match known.check_port(host, port, key) {
         CheckResult::Match => matched = true,
         CheckResult::NotFound => {}
         CheckResult::Mismatch => {
            return Err(format!(
               "Host key verification failed for {host}:{port}: the server key changed. Presented \
                {}. Verify the server identity and repair {} before reconnecting.",
               fingerprint(key),
               path.display()
            ));
         }
         CheckResult::Failure => {
            return Err(format!("Host key verification failed for {host}:{port}."));
         }
      }
   }
   Ok(matched)
}

pub(super) fn verify_session(
   session: &Session,
   host: &str,
   port: u16,
   home: &Path,
) -> Result<(), String> {
   let guard = HOST_TRUST_LOCK.lock().map_err(|error| error.to_string())?;
   let (key, _) = session
      .host_key()
      .ok_or("The SSH server did not provide a host key.")?;
   let trusted = check_key(session, &trust_paths(home)?, host, port, key)?;
   drop(guard);
   if trusted {
      return Ok(());
   }
   let challenge = serde_json::to_string(&HostChallenge {
      host,
      port,
      fingerprint: fingerprint(key),
   })
   .map_err(|error| error.to_string())?;
   Err(format!("{CHALLENGE_PREFIX}{challenge}"))
}

pub(super) fn trust_session(
   session: &Session,
   host: &str,
   port: u16,
   home: &Path,
   approved: &str,
) -> Result<(), String> {
   let (key, kind) = session
      .host_key()
      .ok_or("The SSH server did not provide a host key.")?;
   trust_key(session, host, port, home, key, kind.into(), approved)
}

fn trust_key(
   session: &Session,
   host: &str,
   port: u16,
   home: &Path,
   key: &[u8],
   kind: KnownHostKeyFormat,
   approved: &str,
) -> Result<(), String> {
   let guard = HOST_TRUST_LOCK.lock().map_err(|error| error.to_string())?;
   let paths = trust_paths(home)?;
   if approved != fingerprint(key) {
      return Err(
         "The SSH server key changed after review. Verify its identity before reconnecting.".into(),
      );
   }
   if check_key(session, &paths, host, port, key)? {
      return Ok(());
   }
   let target = home.join(".ssh/athas_known_hosts");
   if fs::symlink_metadata(&target).is_ok_and(|metadata| metadata.file_type().is_symlink()) {
      return Err("Athas SSH trusted hosts must be a regular file, not a symbolic link.".into());
   }
   let mut known = session.known_hosts().map_err(|error| error.to_string())?;
   let name = if port == 22 {
      host.to_string()
   } else {
      format!("[{host}]:{port}")
   };
   known
      .add(&name, key, "Athas", kind)
      .map_err(|error| error.to_string())?;
   let entry = known
      .iter()
      .map_err(|error| error.to_string())?
      .into_iter()
      .next()
      .ok_or("Could not encode SSH host key.")?;
   let line = known
      .write_string(&entry, KnownHostFileKind::OpenSSH)
      .map_err(|error| error.to_string())?;
   athas_project::file_mutations::mutate_text(&target, Some(4 * 1024 * 1024), |current| {
      check_key(session, &paths, host, port, key)?;
      let mut next = current.unwrap_or_default().to_string();
      if !next.is_empty() && !next.ends_with('\n') {
         next.push('\n');
      }
      next.push_str(&line);
      Ok(Some(next))
   })
   .map_err(|error| format!("Could not save SSH server trust: {error}"))?;
   drop(guard);
   Ok(())
}

#[cfg(test)]
mod tests {
   use super::*;

   fn known_file(directory: &Path, name: &str, host: &str, key: &[u8]) -> PathBuf {
      let session = Session::new().unwrap();
      let mut known = session.known_hosts().unwrap();
      known
         .add(host, key, "fixture", KnownHostKeyFormat::SshRsa)
         .unwrap();
      let path = directory.join(name);
      known.write_file(&path, KnownHostFileKind::OpenSSH).unwrap();
      path
   }

   #[test]
   fn requires_matching_host_port_and_key_and_rejects_conflicting_stores() {
      let dir = tempfile::tempdir().unwrap();
      let first = known_file(dir.path(), "first", "[example.com]:2222", b"first-key");
      let other = known_file(dir.path(), "other", "[example.com]:2222", b"other-key");
      let session = Session::new().unwrap();
      assert!(
         check_key(
            &session,
            std::slice::from_ref(&first),
            "example.com",
            2222,
            b"first-key"
         )
         .unwrap()
      );
      assert!(
         !check_key(
            &session,
            std::slice::from_ref(&first),
            "example.com",
            22,
            b"first-key"
         )
         .unwrap()
      );
      assert!(
         !check_key(
            &session,
            std::slice::from_ref(&first),
            "other.com",
            2222,
            b"first-key"
         )
         .unwrap()
      );
      assert!(
         check_key(
            &session,
            std::slice::from_ref(&first),
            "example.com",
            2222,
            b"other-key"
         )
         .unwrap_err()
         .contains("server key changed")
      );
      assert!(check_key(&session, &[first, other], "example.com", 2222, b"first-key").is_err());
   }

   #[test]
   fn unreadable_or_malformed_stores_never_become_unknown_hosts() {
      let dir = tempfile::tempdir().unwrap();
      let session = Session::new().unwrap();
      let malformed = dir.path().join("malformed");
      fs::write(&malformed, "example.com ssh-ed25519 invalid!\n").unwrap();
      assert!(check_key(&session, &[malformed], "example.com", 22, b"key").is_err());
      assert!(
         check_key(
            &session,
            &[dir.path().to_path_buf()],
            "example.com",
            22,
            b"key"
         )
         .is_err()
      );
      assert!(
         !check_key(
            &session,
            &[dir.path().join("missing")],
            "example.com",
            22,
            b"key"
         )
         .unwrap()
      );
   }

   #[test]
   fn matches_hashed_hosts_and_checks_every_key_for_the_same_host() {
      let home = tempfile::tempdir().unwrap();
      let hashed = home.path().join("hashed");
      fs::write(
         &hashed,
         "|1|YXRoYXMtZml4dHVyZS1zYWx0MTI=|6JeBbosw1UH063Hmky1WhuN7MsM= ssh-rsa Zmlyc3Qta2V5\n",
      )
      .unwrap();
      let session = Session::new().unwrap();
      assert!(check_key(&session, &[hashed], "example.com", 2222, b"first-key").unwrap());
      let multiple = known_file(home.path(), "multiple", "example.com", b"first-key");
      let extra = known_file(home.path(), "extra", "example.com", b"other-key");
      let content = format!(
         "{}{}",
         fs::read_to_string(&multiple).unwrap(),
         fs::read_to_string(extra).unwrap()
      );
      fs::write(&multiple, content).unwrap();
      assert!(check_key(&session, &[multiple], "example.com", 22, b"other-key").unwrap());
   }

   #[test]
   fn host_patterns_preserve_negations_ports_and_ipv6_literals() {
      assert!(matches_host_patterns(
         "*.example.com,!blocked.example.com",
         "server.EXAMPLE.com",
         22
      ));
      assert!(!matches_host_patterns(
         "*.example.com,!blocked.example.com",
         "blocked.example.com",
         22
      ));
      assert!(!matches_host_patterns(
         "*.example.com",
         "server.example.com",
         2222
      ));
      assert!(matches_host_patterns(
         "[*.example.com]:2222",
         "server.example.com",
         2222
      ));
      assert!(!matches_host_patterns(
         "[*.example.com]:2222",
         "server.example.com",
         22
      ));
      assert!(matches_host_patterns("[::1]:2222", "::1", 2222));
      assert!(matches_host_patterns("one,server?,three", "server1", 22));
      assert!(!matches_host_patterns("one,server?,three", "server12", 22));
      assert!(matches_pattern("*a*b", "aaab"));
      assert!(!matches_pattern("*a*b", "aaac"));
      assert!(matches_pattern("*", ""));
      assert!(!matches_pattern("?", ""));
   }

   #[test]
   fn certificate_authorities_fail_closed_only_for_matching_hosts() {
      let home = tempfile::tempdir().unwrap();
      let path = home.path().join("certificate");
      fs::write(
         &path,
         "@cert-authority *.example.com ssh-rsa Zmlyc3Qta2V5\n",
      )
      .unwrap();
      let session = Session::new().unwrap();
      assert!(
         check_key(
            &session,
            std::slice::from_ref(&path),
            "server.example.com",
            22,
            b"key"
         )
         .unwrap_err()
         .contains("certificate authorities")
      );
      assert!(!check_key(&session, &[path], "other.com", 22, b"key").unwrap());
   }

   #[test]
   fn never_ignores_revoked_host_key_markers() {
      let home = tempfile::tempdir().unwrap();
      let path = home.path().join("revoked");
      fs::write(&path, "@revoked example.com ssh-rsa Zmlyc3Qta2V5\n").unwrap();
      assert!(
         check_key(
            &Session::new().unwrap(),
            &[path],
            "example.com",
            22,
            b"first-key"
         )
         .is_err()
      );
   }

   #[test]
   fn rejects_endpoint_injection_and_relative_trust_paths() {
      for host in ["", "a\0b", "a\nb", "a,b", "[a]", "a b"] {
         assert!(validate_endpoint(host, 22).is_err());
      }
      assert!(validate_endpoint("::1", 2222).is_ok());
      assert!(validate_endpoint("host", 0).is_err());
      assert!(trust_paths(Path::new("")).is_err());
      assert!(trust_paths(Path::new("relative")).is_err());
      assert_eq!(
         fingerprint(b"hello"),
         "SHA256:LPJNul+wow4m6DsqxbninhsWHlwfp0JecwQzYpOLmCQ"
      );
   }

   #[test]
   fn approval_is_persisted_idempotently_without_editing_openssh_hosts() {
      let home = tempfile::tempdir().unwrap();
      fs::create_dir(home.path().join(".ssh")).unwrap();
      let original = "# My OpenSSH hosts\n";
      fs::write(home.path().join(".ssh/known_hosts"), original).unwrap();
      let session = Session::new().unwrap();
      let key = b"approved-server-key";
      for _ in 0..2 {
         trust_key(
            &session,
            "example.com",
            2222,
            home.path(),
            key,
            KnownHostKeyFormat::SshRsa,
            &fingerprint(key),
         )
         .unwrap();
      }
      let target = home.path().join(".ssh/athas_known_hosts");
      assert_eq!(fs::read_to_string(&target).unwrap().lines().count(), 1);
      assert_eq!(
         fs::read_to_string(home.path().join(".ssh/known_hosts")).unwrap(),
         original
      );
      assert!(check_key(&session, &[target], "example.com", 2222, key).unwrap());
   }

   #[test]
   fn changed_keys_and_failed_persistence_leave_no_trusted_entry() {
      let home = tempfile::tempdir().unwrap();
      let session = Session::new().unwrap();
      let key = b"server-key";
      let target = home.path().join(".ssh/athas_known_hosts");
      assert!(
         trust_key(
            &session,
            "host",
            22,
            home.path(),
            key,
            KnownHostKeyFormat::SshRsa,
            &fingerprint(b"other-key")
         )
         .unwrap_err()
         .contains("changed after review")
      );
      assert!(!target.exists());
      fs::write(home.path().join(".ssh"), "not a directory").unwrap();
      assert!(
         trust_key(
            &session,
            "host",
            22,
            home.path(),
            key,
            KnownHostKeyFormat::SshRsa,
            &fingerprint(key)
         )
         .is_err()
      );
      assert!(!target.exists());
   }

   #[test]
   fn simultaneous_approvals_preserve_every_host_and_refuse_key_rotation() {
      let home = tempfile::tempdir().unwrap();
      let results = std::thread::scope(|scope| {
         (0..8)
            .map(|index| {
               let home = home.path();
               scope.spawn(move || {
                  trust_key(
                     &Session::new().unwrap(),
                     &format!("host-{index}"),
                     22,
                     home,
                     b"server-key",
                     KnownHostKeyFormat::SshRsa,
                     &fingerprint(b"server-key"),
                  )
               })
            })
            .collect::<Vec<_>>()
            .into_iter()
            .map(|thread| thread.join().unwrap())
            .collect::<Vec<_>>()
      });
      assert!(results.into_iter().all(|result| result.is_ok()));
      let target = home.path().join(".ssh/athas_known_hosts");
      let before = fs::read_to_string(&target).unwrap();
      assert_eq!(before.lines().count(), 8);
      assert!(
         trust_key(
            &Session::new().unwrap(),
            "host-0",
            22,
            home.path(),
            b"rotated-key",
            KnownHostKeyFormat::SshRsa,
            &fingerprint(b"rotated-key")
         )
         .unwrap_err()
         .contains("server key changed")
      );
      assert_eq!(fs::read_to_string(&target).unwrap(), before);
   }

   #[cfg(unix)]
   #[test]
   fn refuses_to_write_through_an_athas_trust_file_symlink() {
      let home = tempfile::tempdir().unwrap();
      fs::create_dir(home.path().join(".ssh")).unwrap();
      let other = home.path().join("other");
      fs::write(&other, "# Keep this file\n").unwrap();
      std::os::unix::fs::symlink(&other, home.path().join(".ssh/athas_known_hosts")).unwrap();
      assert!(
         trust_key(
            &Session::new().unwrap(),
            "host",
            22,
            home.path(),
            b"key",
            KnownHostKeyFormat::SshRsa,
            &fingerprint(b"key")
         )
         .unwrap_err()
         .contains("symbolic link")
      );
      assert_eq!(fs::read_to_string(other).unwrap(), "# Keep this file\n");
   }
}
