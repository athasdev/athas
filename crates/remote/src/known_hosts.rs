//! Server identity: the host key must match `/etc/ssh/ssh_known_hosts`, `~/.ssh/known_hosts` or
//! Athas's own `~/.ssh/athas_known_hosts`. An unknown server comes back as a [`HostKeyChallenge`]
//! for the trust dialog; a changed or revoked key is refused. Approvals are only ever written to
//! `athas_known_hosts`, never to the user's OpenSSH files. Ported from Athas's `ssh_host_trust.rs`.

use std::{
    fmt, fs,
    path::{Path, PathBuf},
    sync::Mutex,
};

use anyhow::{Result, anyhow, bail};
use base64::{
    Engine,
    engine::general_purpose::{STANDARD, STANDARD_NO_PAD},
};
use sha2::{Digest, Sha256};
use ssh2::{CheckResult, KnownHostFileKind, KnownHostKeyFormat, Session};

static HOST_TRUST_LOCK: Mutex<()> = Mutex::new(());

/// The server is not known yet: show its fingerprint and ask before trusting it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HostKeyChallenge {
    pub host: String,
    pub port: u16,
    /// `SHA256:<base64>`, as `ssh` prints it.
    pub fingerprint: String,
}

impl fmt::Display for HostKeyChallenge {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "The authenticity of {}:{} can't be established ({})", self.host, self.port, self.fingerprint)
    }
}

impl std::error::Error for HostKeyChallenge {}

pub fn validate_endpoint(host: &str, port: u16) -> Result<()> {
    if host.is_empty()
        || port == 0
        || host.chars().any(|c| c.is_whitespace() || c.is_control() || matches!(c, ',' | '[' | ']'))
    {
        bail!("Invalid SSH host or port.");
    }
    Ok(())
}

fn trust_paths(home: &Path) -> Result<Vec<PathBuf>> {
    if !home.is_absolute() {
        bail!("Cannot locate SSH trusted hosts: HOME must be an absolute path.");
    }
    let mut paths = Vec::new();
    if cfg!(unix) {
        paths.push(PathBuf::from("/etc/ssh/ssh_known_hosts"));
    }
    paths.push(home.join(".ssh/known_hosts"));
    paths.push(home.join(".ssh/athas_known_hosts"));
    Ok(paths)
}

pub fn fingerprint(key: &[u8]) -> String {
    format!("SHA256:{}", STANDARD_NO_PAD.encode(Sha256::digest(key)))
}

fn matches_pattern(pattern: &str, value: &str) -> bool {
    let pattern = pattern.to_ascii_lowercase();
    let value = value.to_ascii_lowercase();
    let (pattern, value) = (pattern.as_bytes(), value.as_bytes());
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
        let (negative, pattern) = pattern.strip_prefix('!').map_or((false, pattern), |pattern| (true, pattern));
        let applies = matches_pattern(pattern, &endpoint) || (port == 22 && matches_pattern(pattern, host));
        if applies && negative {
            return false;
        }
        matched |= applies;
    }
    matched
}

fn entry_name(host: &str, port: u16) -> String {
    if port == 22 { host.to_string() } else { format!("[{host}]:{port}") }
}

/// Whether `key` is trusted for `host:port` in `paths`. Unreadable or malformed stores, changed
/// keys, revoked keys and certificate authorities are errors, never "unknown".
fn check_key(session: &Session, paths: &[PathBuf], host: &str, port: u16, key: &[u8]) -> Result<bool> {
    validate_endpoint(host, port)?;
    let mut matched = false;
    for path in paths {
        let content = match fs::read_to_string(path) {
            Ok(content) => content,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => bail!("Cannot read SSH trusted hosts {}: {error}", path.display()),
        };
        let mut known = session.known_hosts()?;
        for (index, line) in content.lines().enumerate() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            let mut fields = line.split_whitespace();
            let first = fields.next().ok_or_else(|| anyhow!("Missing SSH host entry."))?;
            let (marker, names) = if first.starts_with('@') {
                (Some(first), fields.next().ok_or_else(|| anyhow!("Missing marked SSH host entry."))?)
            } else {
                (None, first)
            };
            let algorithm = fields.next().ok_or_else(|| anyhow!("Missing SSH host key algorithm."))?;
            let encoded = fields.next().ok_or_else(|| anyhow!("Missing SSH host key."))?;
            let saved_key = STANDARD.decode(encoded).map_err(|error| {
                anyhow!("Cannot read SSH trusted hosts {} at line {}: {error}", path.display(), index + 1)
            })?;
            let applies = if names.starts_with('|') {
                let mut hashed = session.known_hosts()?;
                hashed.read_str(&format!("{names} ssh-rsa {encoded}"), KnownHostFileKind::OpenSSH)?;
                match hashed.check_port(host, port, key) {
                    CheckResult::NotFound => false,
                    CheckResult::Match | CheckResult::Mismatch => true,
                    CheckResult::Failure => bail!("Host key verification failed for hashed SSH host entry."),
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
                        bail!(
                            "Host key verification failed for {host}:{port}: the server key is revoked in {}.",
                            path.display()
                        );
                    }
                    continue;
                }
                Some("@cert-authority") => bail!(
                    "Host key verification failed for {host}:{port}: SSH certificate authorities are not \
                     supported. Use a directly trusted server key."
                ),
                Some(_) => bail!("Host key verification failed: unsupported SSH trust marker in {}.", path.display()),
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
                bail!("Host key verification failed: unsupported SSH host key algorithm {algorithm}.");
            }
            known
                .read_str(&format!("{} {algorithm} {encoded}", entry_name(host, port)), KnownHostFileKind::OpenSSH)
                .map_err(|error| {
                    anyhow!("Cannot read SSH trusted hosts {} at line {}: {error}", path.display(), index + 1)
                })?;
        }
        match known.check_port(host, port, key) {
            CheckResult::Match => matched = true,
            CheckResult::NotFound => {}
            CheckResult::Mismatch => bail!(
                "Host key verification failed for {host}:{port}: the server key changed. Presented {}. Verify \
                 the server identity and repair {} before reconnecting.",
                fingerprint(key),
                path.display()
            ),
            CheckResult::Failure => bail!("Host key verification failed for {host}:{port}."),
        }
    }
    Ok(matched)
}

/// Passes when the server's key is trusted; an unknown server fails with a [`HostKeyChallenge`].
pub fn verify_session(session: &Session, host: &str, port: u16, home: &Path) -> Result<()> {
    let guard = HOST_TRUST_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let (key, _) = session.host_key().ok_or_else(|| anyhow!("The SSH server did not provide a host key."))?;
    let trusted = check_key(session, &trust_paths(home)?, host, port, key)?;
    drop(guard);
    if trusted {
        return Ok(());
    }
    Err(HostKeyChallenge { host: host.to_string(), port, fingerprint: fingerprint(key) }.into())
}

/// Saves the server's key to `athas_known_hosts`, if it is still the one the user approved.
pub fn trust_session(session: &Session, host: &str, port: u16, home: &Path, approved: &str) -> Result<()> {
    let (key, kind) = session.host_key().ok_or_else(|| anyhow!("The SSH server did not provide a host key."))?;
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
) -> Result<()> {
    let _guard = HOST_TRUST_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let paths = trust_paths(home)?;
    if approved != fingerprint(key) {
        bail!("The SSH server key changed after review. Verify its identity before reconnecting.");
    }
    if check_key(session, &paths, host, port, key)? {
        return Ok(());
    }
    let target = home.join(".ssh/athas_known_hosts");
    if fs::symlink_metadata(&target).is_ok_and(|metadata| metadata.file_type().is_symlink()) {
        bail!("Athas SSH trusted hosts must be a regular file, not a symbolic link.");
    }
    let mut known = session.known_hosts()?;
    known.add(&entry_name(host, port), key, "Athas", kind)?;
    let entry = known.iter()?.into_iter().next().ok_or_else(|| anyhow!("Could not encode SSH host key."))?;
    let line = known.write_string(&entry, KnownHostFileKind::OpenSSH)?;
    athas_project::file_mutations::mutate_text(&target, Some(4 * 1024 * 1024), |current| {
        check_key(session, &paths, host, port, key).map_err(|error| error.to_string())?;
        let mut next = current.unwrap_or_default().to_string();
        if !next.is_empty() && !next.ends_with('\n') {
            next.push('\n');
        }
        next.push_str(&line);
        Ok(Some(next))
    })
    .map_err(|error| anyhow!("Could not save SSH server trust: {error}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn known_file(directory: &Path, name: &str, host: &str, key: &[u8]) -> PathBuf {
        let session = Session::new().unwrap();
        let mut known = session.known_hosts().unwrap();
        known.add(host, key, "fixture", KnownHostKeyFormat::SshRsa).unwrap();
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
        let only = std::slice::from_ref(&first);
        assert!(check_key(&session, only, "example.com", 2222, b"first-key").unwrap());
        assert!(!check_key(&session, only, "example.com", 22, b"first-key").unwrap());
        assert!(!check_key(&session, only, "other.com", 2222, b"first-key").unwrap());
        let changed = check_key(&session, only, "example.com", 2222, b"other-key").unwrap_err();
        assert!(changed.to_string().contains("server key changed"));
        assert!(check_key(&session, &[first, other], "example.com", 2222, b"first-key").is_err());
    }

    #[test]
    fn unreadable_or_malformed_stores_never_become_unknown_hosts() {
        let dir = tempfile::tempdir().unwrap();
        let session = Session::new().unwrap();
        let malformed = dir.path().join("malformed");
        fs::write(&malformed, "example.com ssh-ed25519 invalid!\n").unwrap();
        assert!(check_key(&session, &[malformed], "example.com", 22, b"key").is_err());
        assert!(check_key(&session, &[dir.path().to_path_buf()], "example.com", 22, b"key").is_err());
        assert!(!check_key(&session, &[dir.path().join("missing")], "example.com", 22, b"key").unwrap());
    }

    #[test]
    fn matches_hashed_hosts_and_checks_every_key_for_the_same_host() {
        let home = tempfile::tempdir().unwrap();
        let hashed = home.path().join("hashed");
        fs::write(&hashed, "|1|YXRoYXMtZml4dHVyZS1zYWx0MTI=|6JeBbosw1UH063Hmky1WhuN7MsM= ssh-rsa Zmlyc3Qta2V5\n").unwrap();
        let session = Session::new().unwrap();
        assert!(check_key(&session, &[hashed], "example.com", 2222, b"first-key").unwrap());
        let multiple = known_file(home.path(), "multiple", "example.com", b"first-key");
        let extra = known_file(home.path(), "extra", "example.com", b"other-key");
        let content = format!("{}{}", fs::read_to_string(&multiple).unwrap(), fs::read_to_string(extra).unwrap());
        fs::write(&multiple, content).unwrap();
        assert!(check_key(&session, &[multiple], "example.com", 22, b"other-key").unwrap());
    }

    #[test]
    fn host_patterns_preserve_negations_ports_and_ipv6_literals() {
        assert!(matches_host_patterns("*.example.com,!blocked.example.com", "server.EXAMPLE.com", 22));
        assert!(!matches_host_patterns("*.example.com,!blocked.example.com", "blocked.example.com", 22));
        assert!(!matches_host_patterns("*.example.com", "server.example.com", 2222));
        assert!(matches_host_patterns("[*.example.com]:2222", "server.example.com", 2222));
        assert!(!matches_host_patterns("[*.example.com]:2222", "server.example.com", 22));
        assert!(matches_host_patterns("[::1]:2222", "::1", 2222));
        assert!(matches_host_patterns("one,server?,three", "server1", 22));
        assert!(!matches_host_patterns("one,server?,three", "server12", 22));
        assert!(matches_pattern("*a*b", "aaab"));
        assert!(!matches_pattern("*a*b", "aaac"));
        assert!(!matches_pattern("?", ""));
    }

    #[test]
    fn certificate_authorities_and_revoked_keys_fail_closed() {
        let home = tempfile::tempdir().unwrap();
        let session = Session::new().unwrap();
        let path = home.path().join("certificate");
        fs::write(&path, "@cert-authority *.example.com ssh-rsa Zmlyc3Qta2V5\n").unwrap();
        let error = check_key(&session, std::slice::from_ref(&path), "server.example.com", 22, b"key").unwrap_err();
        assert!(error.to_string().contains("certificate authorities"));
        assert!(!check_key(&session, &[path], "other.com", 22, b"key").unwrap());
        let revoked = home.path().join("revoked");
        fs::write(&revoked, "@revoked example.com ssh-rsa Zmlyc3Qta2V5\n").unwrap();
        assert!(check_key(&session, &[revoked], "example.com", 22, b"first-key").is_err());
    }

    #[test]
    fn rejects_endpoint_injection_and_relative_trust_paths() {
        for host in ["", "a\0b", "a\nb", "a,b", "[a]", "a b"] {
            assert!(validate_endpoint(host, 22).is_err());
        }
        assert!(validate_endpoint("::1", 2222).is_ok());
        assert!(validate_endpoint("host", 0).is_err());
        assert!(trust_paths(Path::new("relative")).is_err());
        assert_eq!(fingerprint(b"hello"), "SHA256:LPJNul+wow4m6DsqxbninhsWHlwfp0JecwQzYpOLmCQ");
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
            trust_key(&session, "example.com", 2222, home.path(), key, KnownHostKeyFormat::SshRsa, &fingerprint(key))
                .unwrap();
        }
        let target = home.path().join(".ssh/athas_known_hosts");
        assert_eq!(fs::read_to_string(&target).unwrap().lines().count(), 1);
        assert_eq!(fs::read_to_string(home.path().join(".ssh/known_hosts")).unwrap(), original);
        assert!(check_key(&session, &[target], "example.com", 2222, key).unwrap());
    }

    #[test]
    fn changed_keys_leave_no_trusted_entry() {
        let home = tempfile::tempdir().unwrap();
        let session = Session::new().unwrap();
        let key = b"server-key";
        let target = home.path().join(".ssh/athas_known_hosts");
        let error =
            trust_key(&session, "host", 22, home.path(), key, KnownHostKeyFormat::SshRsa, &fingerprint(b"other"))
                .unwrap_err();
        assert!(error.to_string().contains("changed after review"));
        assert!(!target.exists());
        trust_key(&session, "host", 22, home.path(), key, KnownHostKeyFormat::SshRsa, &fingerprint(key)).unwrap();
        let rotated = b"rotated-key";
        let error =
            trust_key(&session, "host", 22, home.path(), rotated, KnownHostKeyFormat::SshRsa, &fingerprint(rotated))
                .unwrap_err();
        assert!(error.to_string().contains("server key changed"));
        assert_eq!(fs::read_to_string(&target).unwrap().lines().count(), 1);
    }

    #[cfg(unix)]
    #[test]
    fn refuses_to_write_through_a_symlink() {
        let home = tempfile::tempdir().unwrap();
        fs::create_dir(home.path().join(".ssh")).unwrap();
        let other = home.path().join("other");
        fs::write(&other, "# Keep this file\n").unwrap();
        std::os::unix::fs::symlink(&other, home.path().join(".ssh/athas_known_hosts")).unwrap();
        let error = trust_key(&Session::new().unwrap(), "host", 22, home.path(), b"key", KnownHostKeyFormat::SshRsa, &fingerprint(b"key"))
            .unwrap_err();
        assert!(error.to_string().contains("symbolic link"));
        assert_eq!(fs::read_to_string(other).unwrap(), "# Keep this file\n");
    }
}
