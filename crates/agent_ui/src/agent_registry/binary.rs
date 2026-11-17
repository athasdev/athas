//! Download builds of agents: fetched over HTTPS, checked against the registry's SHA-256 before
//! anything is unpacked, and unpacked into a versioned directory without letting the archive
//! write outside it.
//!
//! Layout, for an agent `<id>`: `agents/<id>/<version>-<key>/` holds one complete install per
//! version. Directories are built under a `.staging-*` name and renamed into place, so a version
//! directory that exists is complete.
//!
//! Ported from Athas's `crates/ai/src/acp/registry/{install,archive}.rs`.

use std::{
    fs::{self, File},
    io::{self, Read, Write},
    path::{Component, Path, PathBuf},
};

use sha2::{Digest, Sha256};

/// Agent builds larger than this are refused.
const MAX_DOWNLOAD_BYTES: u64 = 2 * 1024 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ArchiveKind {
    Zip,
    TarGz,
    TarBz2,
    /// The download is the executable itself.
    Raw,
}

/// The registry platform key for this machine (`darwin-aarch64`, `windows-x86_64`, ...).
pub fn registry_platform() -> Option<&'static str> {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "aarch64") => Some("darwin-aarch64"),
        ("macos", "x86_64") => Some("darwin-x86_64"),
        ("linux", "aarch64") => Some("linux-aarch64"),
        ("linux", "x86_64") => Some("linux-x86_64"),
        ("windows", "aarch64") => Some("windows-aarch64"),
        ("windows", "x86_64") => Some("windows-x86_64"),
        _ => None,
    }
}

/// The platform key Athas's extension manifests use for this machine (`darwin-arm64`, ...).
pub fn manifest_platform() -> Option<&'static str> {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "aarch64") => Some("darwin-arm64"),
        ("macos", "x86_64") => Some("darwin-x64"),
        ("linux", "aarch64") => Some("linux-arm64"),
        ("linux", "x86_64") => Some("linux-x64"),
        ("windows", "aarch64") => Some("win32-arm64"),
        ("windows", "x86_64") => Some("win32-x64"),
        _ => None,
    }
}

/// The archive format named by a download URL's path. Anything that is not a supported archive
/// is treated as the executable itself.
pub fn archive_kind(url: &str) -> ArchiveKind {
    let path = url.split(['?', '#']).next().unwrap_or(url).to_ascii_lowercase();
    if path.ends_with(".zip") {
        ArchiveKind::Zip
    } else if path.ends_with(".tar.gz") || path.ends_with(".tgz") {
        ArchiveKind::TarGz
    } else if path.ends_with(".tar.bz2") || path.ends_with(".tbz2") {
        ArchiveKind::TarBz2
    } else {
        ArchiveKind::Raw
    }
}

/// A relative path that stays inside the directory it is joined to: no root, drive prefix or
/// `..`. Backslashes count as separators, since Windows archives and registry commands use them.
pub fn safe_relative_path(path: &str) -> Option<PathBuf> {
    let normalized = path.replace('\\', "/");
    let mut result = PathBuf::new();
    for component in Path::new(&normalized).components() {
        match component {
            Component::Normal(part) => result.push(part),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => return None,
        }
    }
    (!result.as_os_str().is_empty()).then_some(result)
}

/// Whether a link at `link` (relative to the archive root) pointing at `target` resolves inside
/// the archive root.
fn link_stays_inside(link: &Path, target: &Path) -> bool {
    if target.is_absolute() || target.has_root() {
        return false;
    }
    let mut depth: usize = link.parent().map_or(0, |parent| parent.components().filter(|component| matches!(component, Component::Normal(_))).count());
    for component in target.components() {
        match component {
            Component::Normal(_) => depth += 1,
            Component::CurDir => {}
            Component::ParentDir => {
                if depth == 0 {
                    return false;
                }
                depth -= 1;
            }
            Component::RootDir | Component::Prefix(_) => return false,
        }
    }
    true
}

fn unsafe_entry(name: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, format!("Archive entry {name:?} would be written outside the install directory"))
}

/// Unpacks `archive` into `destination`, which must already exist. `raw_name` names the file a
/// raw download is saved as.
pub fn extract(archive: &Path, kind: ArchiveKind, destination: &Path, raw_name: &str) -> io::Result<()> {
    match kind {
        ArchiveKind::Zip => extract_zip(archive, destination),
        ArchiveKind::TarGz => extract_tar(flate2::read::GzDecoder::new(File::open(archive)?), destination),
        ArchiveKind::TarBz2 => extract_tar(bzip2::read::BzDecoder::new(File::open(archive)?), destination),
        ArchiveKind::Raw => {
            let name = safe_relative_path(raw_name).ok_or_else(|| unsafe_entry(raw_name))?;
            let target = destination.join(name);
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::copy(archive, target).map(|_| ())
        }
    }
}

fn extract_tar(reader: impl Read, destination: &Path) -> io::Result<()> {
    let mut archive = tar::Archive::new(reader);
    archive.set_preserve_permissions(true);
    archive.set_overwrite(true);
    for entry in archive.entries()? {
        let mut entry = entry?;
        let raw_path = entry.path()?.to_string_lossy().into_owned();
        let path = match safe_relative_path(&raw_path) {
            Some(path) => path,
            // The archive root itself (`./`).
            None if matches!(raw_path.trim_end_matches('/'), "" | ".") => continue,
            None => return Err(unsafe_entry(&raw_path)),
        };
        let entry_type = entry.header().entry_type();
        if entry_type.is_symlink() || entry_type.is_hard_link() {
            let target = entry.link_name()?.map(|target| target.into_owned()).unwrap_or_default();
            let inside = if entry_type.is_hard_link() { safe_relative_path(&target.to_string_lossy()).is_some() } else { link_stays_inside(&path, &target) };
            if !inside {
                return Err(unsafe_entry(&format!("{raw_path} -> {}", target.display())));
            }
        } else if !(entry_type.is_file() || entry_type.is_dir()) {
            // Devices, FIFOs and other special files are never needed to run an agent.
            continue;
        }
        if !entry.unpack_in(destination)? {
            return Err(unsafe_entry(&raw_path));
        }
    }
    Ok(())
}

fn extract_zip(archive: &Path, destination: &Path) -> io::Result<()> {
    let mut zip = zip::ZipArchive::new(File::open(archive)?).map_err(io::Error::other)?;
    for index in 0..zip.len() {
        let mut file = zip.by_index(index).map_err(io::Error::other)?;
        let name = file.name().map_err(io::Error::other)?.to_string();
        let path = safe_relative_path(&name).filter(|_| file.enclosed_name().is_some()).ok_or_else(|| unsafe_entry(&name))?;
        let target = destination.join(&path);
        if file.is_dir() {
            fs::create_dir_all(&target)?;
            continue;
        }
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)?;
        }
        if file.is_symlink() {
            let mut link = String::new();
            file.read_to_string(&mut link)?;
            if !link_stays_inside(&path, Path::new(&link)) {
                return Err(unsafe_entry(&format!("{name} -> {link}")));
            }
            create_symlink(Path::new(&link), &target)?;
            continue;
        }
        let mut output = File::create(&target)?;
        io::copy(&mut file, &mut output)?;
        #[cfg(unix)]
        if let Some(mode) = file.unix_mode() {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&target, fs::Permissions::from_mode(mode & 0o755))?;
        }
    }
    Ok(())
}

#[cfg(unix)]
fn create_symlink(target: &Path, link: &Path) -> io::Result<()> {
    std::os::unix::fs::symlink(target, link)
}

#[cfg(windows)]
fn create_symlink(target: &Path, link: &Path) -> io::Result<()> {
    std::os::windows::fs::symlink_file(target, link)
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// A version directory name: the version, made safe for a path, and a short hash of what was
/// installed (the archive URL and checksum), so a re-published version with a new checksum gets
/// its own directory.
pub fn version_dir_name(version: &str, key: &str) -> String {
    let version: String = version.chars().map(|c| if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '+') { c } else { '_' }).collect();
    let digest = Sha256::digest(key.as_bytes());
    format!("{}-{}", version.trim_start_matches('.'), hex(&digest[..6]))
}

fn sha256_file(path: &Path) -> io::Result<String> {
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hex(&hasher.finalize()))
}

/// Fails unless the file's SHA-256 is `expected` (hex, any case).
pub fn verify_sha256(path: &Path, expected: &str) -> Result<(), String> {
    let actual = sha256_file(path).map_err(|error| format!("Failed to hash the download: {error}"))?;
    if actual.eq_ignore_ascii_case(expected.trim()) {
        Ok(())
    } else {
        Err(format!("The download does not match the registry checksum (expected {expected}, got {actual})"))
    }
}

/// A well-formed registry checksum, lowercased.
pub fn checked_sha256(sha256: Option<&str>) -> Result<String, String> {
    let sha256 = sha256.map(str::trim).filter(|sha| !sha.is_empty()).ok_or("The registry publishes no checksum for this platform's build")?;
    if sha256.len() != 64 || !sha256.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("The registry checksum for this build is malformed".into());
    }
    Ok(sha256.to_ascii_lowercase())
}

/// Resolves `cmd` inside an install directory, refusing paths and links that leave it.
pub fn resolve_command(install_dir: &Path, cmd: &str) -> Result<PathBuf, String> {
    let relative = safe_relative_path(cmd).ok_or_else(|| format!("The command {cmd:?} points outside the install"))?;
    let path = install_dir.join(relative);
    if !path.is_file() {
        return Err(format!("The command {cmd:?} is missing from the download"));
    }
    // A symlink inside the archive may still point elsewhere once resolved.
    let canonical_dir = install_dir.canonicalize().map_err(|error| error.to_string())?;
    let canonical = path.canonicalize().map_err(|error| error.to_string())?;
    if !canonical.starts_with(&canonical_dir) {
        return Err(format!("The command {cmd:?} points outside the install"));
    }
    Ok(path)
}

/// Like [`resolve_command`], also finding a bare program name in an archive's top folder (as in
/// `kimi-1.50.0/kimi`), since extension manifests name only the program.
fn locate_command(install_dir: &Path, cmd: &str) -> Result<PathBuf, String> {
    let direct = resolve_command(install_dir, cmd);
    if direct.is_ok() || cmd.contains(['/', '\\']) {
        return direct;
    }
    let mut names = vec![cmd.to_string()];
    if cfg!(windows) && !cmd.contains('.') {
        names.push(format!("{cmd}.exe"));
    }
    let nested = fs::read_dir(install_dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir()))
        .flat_map(|entry| names.iter().map(move |name| format!("{}/{name}", entry.file_name().to_string_lossy())))
        .find_map(|candidate| resolve_command(install_dir, &candidate).ok());
    nested.ok_or_else(|| direct.unwrap_err())
}

pub fn make_executable(path: &Path) -> io::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = fs::metadata(path)?.permissions();
        permissions.set_mode(permissions.mode() | 0o755);
        fs::set_permissions(path, permissions)?;
    }
    #[cfg(not(unix))]
    let _ = path;
    Ok(())
}

fn unique_suffix() -> String {
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|elapsed| elapsed.as_nanos()).unwrap_or_default();
    format!("{}-{nanos}", std::process::id())
}

/// Removes every version directory and leftover staging file in `agent_dir` except `keep`.
/// Files still in use (a running agent on Windows) are left for the next update.
pub fn remove_stale_versions(agent_dir: &Path, keep: &[&str]) -> Vec<PathBuf> {
    let Ok(entries) = fs::read_dir(agent_dir) else { return Vec::new() };
    entries
        .filter_map(Result::ok)
        .filter(|entry| !keep.iter().any(|keep| entry.file_name() == *keep))
        .filter_map(|entry| {
            let path = entry.path();
            let result = if path.is_dir() { fs::remove_dir_all(&path) } else { fs::remove_file(&path) };
            result.ok().map(|()| path)
        })
        .collect()
}

/// Moves a finished staging directory to `final_dir`. When another install already produced
/// `final_dir`, that one is kept.
fn promote(staging: &Path, final_dir: &Path) -> Result<(), String> {
    match fs::rename(staging, final_dir) {
        Ok(()) => Ok(()),
        Err(_) if final_dir.is_dir() => {
            let _ = fs::remove_dir_all(staging);
            Ok(())
        }
        Err(error) => {
            let _ = fs::remove_dir_all(staging);
            Err(format!("Failed to move the install into place: {error}"))
        }
    }
}

/// Saves `url` to `destination` over HTTPS, refusing builds over [`MAX_DOWNLOAD_BYTES`].
pub fn download_https(url: &str, destination: &Path) -> Result<(), String> {
    if !url.starts_with("https://") {
        return Err("Agent downloads must use HTTPS".into());
    }
    let mut response = ureq::get(url).call().map_err(|error| format!("Download failed: {error}"))?;
    let advertised = response.headers().get("content-length").and_then(|value| value.to_str().ok()).and_then(|value| value.parse::<u64>().ok());
    if advertised.is_some_and(|length| length > MAX_DOWNLOAD_BYTES) {
        return Err("The download is too large".into());
    }
    let mut reader = response.body_mut().with_config().limit(MAX_DOWNLOAD_BYTES).reader();
    let mut file = File::create(destination).map_err(|error| format!("Failed to save the download: {error}"))?;
    let mut buffer = vec![0u8; 64 * 1024];
    loop {
        let read = reader.read(&mut buffer).map_err(|error| format!("Download failed: {error}"))?;
        if read == 0 {
            break;
        }
        file.write_all(&buffer[..read]).map_err(|error| format!("Failed to save the download: {error}"))?;
    }
    file.sync_all().map_err(|error| format!("Failed to save the download: {error}"))
}

pub type Download = fn(&str, &Path) -> Result<(), String>;

/// Downloads, verifies (when the registry gave a checksum) and unpacks a build into its version
/// directory under `agent_dir`, reusing it when it is already there. Returns the version
/// directory's name and the executable.
pub fn install(download: Download, agent_dir: &Path, version: &str, archive_url: &str, sha256: Option<&str>, cmd: &str) -> Result<(String, PathBuf), String> {
    let dir_name = version_dir_name(version, &format!("{archive_url}\n{}", sha256.unwrap_or_default()));
    let final_dir = agent_dir.join(&dir_name);
    if final_dir.is_dir()
        && let Ok(executable) = locate_command(&final_dir, cmd)
    {
        return Ok((dir_name, executable));
    }
    fs::create_dir_all(agent_dir).map_err(|error| format!("Failed to create {}: {error}", agent_dir.display()))?;
    let suffix = unique_suffix();
    let download_path = agent_dir.join(format!(".download-{suffix}"));
    let staging = agent_dir.join(format!(".staging-{suffix}"));
    let result = (|| {
        download(archive_url, &download_path)?;
        if let Some(sha256) = sha256 {
            verify_sha256(&download_path, sha256)?;
        }
        fs::create_dir_all(&staging).map_err(|error| error.to_string())?;
        extract(&download_path, archive_kind(archive_url), &staging, cmd).map_err(|error| format!("Failed to unpack the download: {error}"))?;
        let executable = locate_command(&staging, cmd)?;
        make_executable(&executable).map_err(|error| error.to_string())
    })();
    let _ = fs::remove_file(&download_path);
    if let Err(error) = result {
        let _ = fs::remove_dir_all(&staging);
        return Err(error);
    }
    promote(&staging, &final_dir)?;
    let executable = locate_command(&final_dir, cmd)?;
    Ok((dir_name, executable))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tar_gz(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut builder = tar::Builder::new(flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast()));
        for (name, data) in entries {
            let mut header = tar::Header::new_gnu();
            header.set_size(data.len() as u64);
            header.set_mode(0o755);
            header.set_cksum();
            builder.append_data(&mut header, name, *data).unwrap();
        }
        builder.into_inner().unwrap().finish().unwrap()
    }

    #[test]
    fn archive_kinds_and_safe_paths() {
        assert_eq!(archive_kind("https://x/a.tar.gz?x=1"), ArchiveKind::TarGz);
        assert_eq!(archive_kind("https://x/a.ZIP"), ArchiveKind::Zip);
        assert_eq!(archive_kind("https://x/agent"), ArchiveKind::Raw);
        assert_eq!(safe_relative_path("./bin\\agent"), Some(PathBuf::from("bin/agent")));
        assert_eq!(safe_relative_path("../evil"), None);
        assert_eq!(safe_relative_path("/etc/passwd"), None);
        assert!(link_stays_inside(Path::new("a/b"), Path::new("../c")));
        assert!(!link_stays_inside(Path::new("a"), Path::new("../../c")));
    }

    #[test]
    fn checksums_are_checked_before_unpacking() {
        assert!(checked_sha256(None).is_err());
        assert!(checked_sha256(Some("abc")).is_err());
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("f");
        fs::write(&file, b"hello").unwrap();
        let sum = "2CF24DBA5FB0A30E26E83B2AC5B9E29E1B161E5C1FA7425E73043362938B9824";
        assert_eq!(checked_sha256(Some(sum)).unwrap(), sum.to_ascii_lowercase());
        assert!(verify_sha256(&file, sum).is_ok());
        assert!(verify_sha256(&file, &"0".repeat(64)).is_err());
    }

    #[test]
    fn installs_a_verified_build_and_finds_a_nested_program() {
        thread_local!(static ARCHIVE: std::cell::RefCell<Vec<u8>> = const { std::cell::RefCell::new(Vec::new()) });
        ARCHIVE.with(|archive| *archive.borrow_mut() = tar_gz(&[("kimi-1.0.0/kimi", b"#!/bin/sh\necho hi\n")]));
        fn fake(_: &str, destination: &Path) -> Result<(), String> {
            ARCHIVE.with(|archive| fs::write(destination, &*archive.borrow())).map_err(|error| error.to_string())
        }
        let bytes = ARCHIVE.with(|archive| archive.borrow().clone());
        let sum = hex(&Sha256::digest(&bytes));
        let dir = tempfile::tempdir().unwrap();
        let agent_dir = dir.path().join("kimi");
        let (name, executable) = install(fake, &agent_dir, "1.0.0", "https://x/kimi.tar.gz", Some(&sum), "kimi").unwrap();
        assert!(name.starts_with("1.0.0-"));
        assert!(executable.ends_with("kimi-1.0.0/kimi"));
        assert!(install(fake, &dir.path().join("bad"), "1.0.0", "https://x/kimi.tar.gz", Some(&"0".repeat(64)), "kimi").is_err());
        assert_eq!(fs::read_dir(dir.path().join("bad")).unwrap().count(), 0);
    }

    #[test]
    fn archives_cannot_escape_the_install() {
        let dir = tempfile::tempdir().unwrap();
        let mut builder = tar::Builder::new(flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast()));
        let mut header = tar::Header::new_gnu();
        header.set_entry_type(tar::EntryType::Symlink);
        header.set_size(0);
        header.set_cksum();
        builder.append_link(&mut header, "link", "../../outside").unwrap();
        let bytes = builder.into_inner().unwrap().finish().unwrap();
        let archive = dir.path().join("a.tar.gz");
        fs::write(&archive, bytes).unwrap();
        let out = dir.path().join("out");
        fs::create_dir_all(&out).unwrap();
        assert!(extract(&archive, ArchiveKind::TarGz, &out, "x").is_err());
    }
}
