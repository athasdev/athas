//! Downloads, verifies and unpacks extension packages (`crates/extensions/src/installer.rs` in
//! Athas, without Tauri). Everything here blocks; run it off the main thread.
//!
//! An installed extension is `<dir>/<id>/` holding its `extension.json` and package files. A
//! data-only extension (a language, an MCP server, a skill) gets just the manifest.

use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

use anyhow::{Context as _, Result, bail};
use sha2::{Digest, Sha256};

use crate::manifest::{ExtensionManifest, Package};

/// The most a package may weigh, so a compromised CDN cannot exhaust memory.
const MAX_DOWNLOAD_BYTES: u64 = 512 * 1024 * 1024;
const MANIFEST_FILE: &str = "extension.json";

static STAGING_COUNTER: AtomicU64 = AtomicU64::new(0);

/// How far an install has got.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum InstallStage {
    /// The fraction downloaded, 0 to 1.
    Downloading(f32),
    Verifying,
    Extracting,
}

impl InstallStage {
    /// The overall fraction done, for a progress bar.
    pub fn fraction(self) -> f32 {
        match self {
            InstallStage::Downloading(fraction) => fraction * 0.85,
            InstallStage::Verifying => 0.9,
            InstallStage::Extracting => 0.95,
        }
    }
}

/// The platform key packages are published under: `darwin-arm64`, `linux-x64`, `win32-x64`.
pub fn platform() -> String {
    let os = match std::env::consts::OS {
        "macos" => "darwin",
        "windows" => "win32",
        os => os,
    };
    let arch = match std::env::consts::ARCH {
        "aarch64" => "arm64",
        "x86_64" => "x64",
        arch => arch,
    };
    format!("{os}-{arch}")
}

/// An id is a folder name: no separators, no leading dot, nothing outside `[A-Za-z0-9._-]`.
pub fn validate_extension_id(id: &str) -> Result<()> {
    if id.is_empty() || id.len() > 128 {
        bail!("invalid extension id length");
    }
    if id.starts_with('.') || id.contains("..") {
        bail!("invalid extension id `{id}`");
    }
    if !id.chars().all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-')) {
        bail!("invalid characters in extension id `{id}`");
    }
    Ok(())
}

/// Debug builds may install from a local CDN (`extensions/tooling/serve-cdn.ts`).
fn is_local_dev_url(url: &str) -> bool {
    cfg!(debug_assertions) && (url.starts_with("http://localhost:") || url.starts_with("http://127.0.0.1:"))
}

fn check_package(id: &str, package: &Package) -> Result<()> {
    if !(package.download_url.starts_with("https://") || is_local_dev_url(&package.download_url)) {
        bail!("{id}: packages must download over HTTPS");
    }
    if package.checksum.is_empty() && !is_local_dev_url(&package.download_url) {
        bail!("{id}: refusing to install a package without a checksum");
    }
    if package.size > MAX_DOWNLOAD_BYTES {
        bail!("{id}: the package declares {} bytes, above the limit", package.size);
    }
    Ok(())
}

/// Reads a small text resource, such as the catalog.
pub fn get_text(url: &str) -> Result<String> {
    let mut response = ureq::get(url).call()?;
    Ok(response.body_mut().with_config().limit(32 * 1024 * 1024).read_to_string()?)
}

/// Downloads a package and checks its size and SHA-256.
pub fn download(id: &str, package: &Package, progress: &mut dyn FnMut(InstallStage)) -> Result<Vec<u8>> {
    check_package(id, package)?;
    progress(InstallStage::Downloading(0.));
    let mut response = match ureq::get(&package.download_url).call() {
        Ok(response) => response,
        Err(ureq::Error::StatusCode(404)) => {
            bail!("{id}: the package is missing from the extensions CDN ({})", package.download_url)
        }
        Err(error) => return Err(error).with_context(|| format!("{id}: downloading {}", package.download_url)),
    };
    let limit = if package.size > 0 { package.size } else { MAX_DOWNLOAD_BYTES };
    let advertised = response
        .headers()
        .get("content-length")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok());
    if advertised.is_some_and(|advertised| advertised > limit) {
        bail!("{id}: the server sends more than the {limit} bytes the package declares");
    }
    let expected = advertised.unwrap_or(package.size).max(1);

    let mut reader = response.body_mut().with_config().limit(limit + 1).reader();
    let mut bytes = Vec::with_capacity(package.size.min(64 * 1024 * 1024) as usize);
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = reader.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        bytes.extend_from_slice(&buffer[..read]);
        if bytes.len() as u64 > limit {
            bail!("{id}: the download exceeded the {limit} byte limit");
        }
        progress(InstallStage::Downloading((bytes.len() as f32 / expected as f32).min(1.)));
    }
    if package.size > 0 && bytes.len() as u64 != package.size {
        bail!("{id}: expected {} bytes, downloaded {}", package.size, bytes.len());
    }

    progress(InstallStage::Verifying);
    if !package.checksum.is_empty() {
        let checksum = hex::encode(Sha256::digest(&bytes));
        if !checksum.eq_ignore_ascii_case(&package.checksum) {
            bail!("{id}: checksum mismatch (expected {}, got {checksum})", package.checksum);
        }
    }
    Ok(bytes)
}

/// Unpacks a `.tar.gz` into a staging folder inside `dir`, refusing entries that leave it.
fn extract(dir: &Path, id: &str, archive: &[u8]) -> Result<PathBuf> {
    let unique = STAGING_COUNTER.fetch_add(1, Ordering::Relaxed);
    let staging = dir.join(format!(".installing-{id}-{}-{unique}", std::process::id()));
    if staging.exists() {
        fs::remove_dir_all(&staging)?;
    }
    fs::create_dir_all(&staging)?;
    let unpack = || -> Result<()> {
        let mut archive = tar::Archive::new(flate2::read::GzDecoder::new(archive));
        for entry in archive.entries()? {
            let mut entry = entry?;
            if !entry.unpack_in(&staging)? {
                bail!("{id}: an archive entry tried to leave the extension folder");
            }
        }
        Ok(())
    };
    if let Err(error) = unpack() {
        let _ = fs::remove_dir_all(&staging);
        return Err(error);
    }
    Ok(staging)
}

/// Reads and checks the manifest of a staged package.
fn staged_manifest(staging: &Path, id: &str) -> Result<ExtensionManifest> {
    let path = staging.join(MANIFEST_FILE);
    let canonical = path.canonicalize().with_context(|| format!("{id}: the package has no {MANIFEST_FILE}"))?;
    if !canonical.starts_with(staging.canonicalize()?) {
        bail!("{id}: the manifest points outside the package");
    }
    let manifest = ExtensionManifest::from_json(&fs::read_to_string(&canonical)?)
        .with_context(|| format!("{id}: the package's manifest is invalid"))?;
    if manifest.id != id {
        bail!("{id}: the package is for `{}`", manifest.id);
    }
    Ok(manifest)
}

/// Moves a staged folder into place, keeping the previous version until the move succeeds.
fn commit(dir: &Path, id: &str, staging: &Path) -> Result<()> {
    let target = dir.join(id);
    let backup = dir.join(format!(".previous-{id}"));
    // A backup without its extension is what an interrupted install left: it is put back first.
    if !target.exists() && backup.exists() {
        fs::rename(&backup, &target)?;
    } else if backup.exists() {
        fs::remove_dir_all(&backup)?;
    }
    if target.exists() {
        fs::rename(&target, &backup)?;
    }
    if let Err(error) = fs::rename(staging, &target) {
        if backup.exists() {
            let _ = fs::rename(&backup, &target);
        }
        return Err(error.into());
    }
    if backup.exists() {
        fs::remove_dir_all(&backup)?;
    }
    Ok(())
}

/// Downloads, verifies and unpacks a package into `<dir>/<id>/`, returning its manifest.
pub fn install_package(
    dir: &Path,
    id: &str,
    package: &Package,
    progress: &mut dyn FnMut(InstallStage),
) -> Result<ExtensionManifest> {
    validate_extension_id(id)?;
    fs::create_dir_all(dir)?;
    let bytes = download(id, package, progress)?;
    progress(InstallStage::Extracting);
    let staging = extract(dir, id, &bytes)?;
    let manifest = match staged_manifest(&staging, id) {
        Ok(manifest) => manifest,
        Err(error) => {
            let _ = fs::remove_dir_all(&staging);
            return Err(error);
        }
    };
    commit(dir, id, &staging)?;
    Ok(manifest)
}

/// Installs an extension that has no package: its manifest is all there is.
pub fn install_manifest(dir: &Path, manifest: &ExtensionManifest) -> Result<()> {
    validate_extension_id(&manifest.id)?;
    let target = dir.join(&manifest.id);
    fs::create_dir_all(&target)?;
    let temporary = target.join(format!("{MANIFEST_FILE}.tmp"));
    fs::write(&temporary, serde_json::to_string_pretty(manifest)?)?;
    fs::rename(&temporary, target.join(MANIFEST_FILE))?;
    Ok(())
}

pub fn uninstall(dir: &Path, id: &str) -> Result<()> {
    validate_extension_id(id)?;
    let target = dir.join(id);
    if target.exists() {
        fs::remove_dir_all(target)?;
    }
    // Installs of the Tauri app kept their metadata beside the folder.
    let metadata = dir.join(format!("{id}.json"));
    if metadata.exists() {
        fs::remove_file(metadata)?;
    }
    Ok(())
}

/// The manifest of an installed extension.
pub fn read_installed_manifest(dir: &Path, id: &str) -> Result<ExtensionManifest> {
    validate_extension_id(id)?;
    ExtensionManifest::from_json(&fs::read_to_string(dir.join(id).join(MANIFEST_FILE))?)
}

#[cfg(test)]
pub(crate) mod tests {
    use std::{
        io::{BufRead, BufReader, Write},
        net::TcpListener,
        sync::Arc,
    };

    use super::*;

    /// A local HTTP server that answers every request for `path` with `body`, and 404 otherwise.
    pub(crate) fn serve(files: Vec<(&'static str, Vec<u8>)>) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let files = Arc::new(files);
        std::thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                let files = files.clone();
                std::thread::spawn(move || {
                    let mut reader = BufReader::new(&stream);
                    let mut request = String::new();
                    if reader.read_line(&mut request).is_err() {
                        return;
                    }
                    let mut line = String::new();
                    while reader.read_line(&mut line).is_ok_and(|read| read > 2) {
                        line.clear();
                    }
                    let path = request.split_whitespace().nth(1).unwrap_or_default().to_string();
                    let mut stream = &stream;
                    match files.iter().find(|(candidate, _)| *candidate == path) {
                        Some((_, body)) => {
                            let _ = write!(stream, "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len());
                            let _ = stream.write_all(body);
                        }
                        None => {
                            let _ = write!(stream, "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                        }
                    }
                });
            }
        });
        format!("http://{address}")
    }

    /// A `.tar.gz` holding `files`.
    pub(crate) fn tarball(files: &[(&str, &[u8])]) -> Vec<u8> {
        let mut builder = tar::Builder::new(flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast()));
        for (path, contents) in files {
            let mut header = tar::Header::new_gnu();
            header.set_size(contents.len() as u64);
            header.set_mode(0o644);
            header.set_cksum();
            builder.append_data(&mut header, path, *contents).unwrap();
        }
        builder.into_inner().unwrap().finish().unwrap()
    }

    pub(crate) fn theme_manifest(id: &str) -> String {
        format!(
            r##"{{"$schema": "https://athas.dev/schemas/extension.json", "id": "{id}", "name": "test",
            "displayName": "Test Theme", "description": "A test theme", "version": "1.2.0", "publisher": "Athas",
            "categories": ["Theme"], "themes": [{{"id": "test-dark", "name": "Test Dark", "appearance": "dark",
            "colors": {{"background": "#101010", "foreground": "#eeeeee", "primary": "#ff0088"}}}}]}}"##
        )
    }

    pub(crate) fn package_for(base: &str, path: &str, bytes: &[u8]) -> Package {
        Package {
            download_url: format!("{base}{path}"),
            size: bytes.len() as u64,
            checksum: hex::encode(Sha256::digest(bytes)),
        }
    }

    #[test]
    fn installs_from_a_server_when_the_checksum_matches() {
        let archive = tarball(&[("extension.json", theme_manifest("athas.theme.test").as_bytes()), ("icon.svg", b"<svg/>")]);
        let base = serve(vec![("/theme.tar.gz", archive.clone())]);
        let dir = tempfile::tempdir().unwrap();
        let mut stages = Vec::new();
        let manifest = install_package(dir.path(), "athas.theme.test", &package_for(&base, "/theme.tar.gz", &archive), &mut |stage| {
            stages.push(stage)
        })
        .unwrap();
        assert_eq!(manifest.version, "1.2.0");
        assert!(dir.path().join("athas.theme.test/icon.svg").is_file());
        assert!(stages.contains(&InstallStage::Verifying) && stages.contains(&InstallStage::Extracting));
        // Nothing staged is left behind.
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[test]
    fn refuses_a_package_whose_checksum_differs() {
        let archive = tarball(&[("extension.json", theme_manifest("athas.theme.test").as_bytes())]);
        let base = serve(vec![("/theme.tar.gz", archive.clone())]);
        let dir = tempfile::tempdir().unwrap();
        let mut package = package_for(&base, "/theme.tar.gz", &archive);
        package.checksum = "0".repeat(64);
        let error = install_package(dir.path(), "athas.theme.test", &package, &mut |_| {}).unwrap_err();
        assert!(format!("{error:#}").contains("checksum mismatch"), "{error:#}");
        assert!(!dir.path().join("athas.theme.test").exists());
    }

    #[test]
    fn refuses_wrong_sizes_ids_and_missing_packages() {
        let archive = tarball(&[("extension.json", theme_manifest("athas.theme.other").as_bytes())]);
        let base = serve(vec![("/theme.tar.gz", archive.clone())]);
        let dir = tempfile::tempdir().unwrap();
        let package = package_for(&base, "/theme.tar.gz", &archive);

        let error = install_package(dir.path(), "athas.theme.test", &package, &mut |_| {}).unwrap_err();
        assert!(format!("{error:#}").contains("is for `athas.theme.other`"), "{error:#}");

        let mut short = package.clone();
        short.size -= 1;
        assert!(install_package(dir.path(), "athas.theme.other", &short, &mut |_| {}).is_err());

        let missing = Package { download_url: format!("{base}/missing.tar.gz"), ..package.clone() };
        let error = install_package(dir.path(), "athas.theme.other", &missing, &mut |_| {}).unwrap_err();
        assert!(format!("{error:#}").contains("missing from the extensions CDN"), "{error:#}");

        let insecure = Package { download_url: "http://athas.dev/x.tar.gz".into(), ..package };
        assert!(install_package(dir.path(), "athas.theme.other", &insecure, &mut |_| {}).is_err());
    }

    #[test]
    fn refuses_archives_that_escape() {
        let mut builder = tar::Builder::new(flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast()));
        let mut header = tar::Header::new_gnu();
        header.set_size(1);
        header.set_mode(0o644);
        let name = b"../escape.txt";
        header.as_old_mut().name[..name.len()].copy_from_slice(name);
        header.set_cksum();
        builder.append(&header, &b"x"[..]).unwrap();
        let archive = builder.into_inner().unwrap().finish().unwrap();
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("extensions");
        fs::create_dir_all(&root).unwrap();
        assert!(extract(&root, "athas.bad", &archive).is_err());
        assert!(!dir.path().join("escape.txt").exists());
    }

    #[test]
    fn ids_are_folder_names() {
        for id in ["athas.rust", "theme-dark_01"] {
            assert!(validate_extension_id(id).is_ok(), "{id}");
        }
        for id in ["", ".", "..", "../evil", "a/b", "a\\b", ".installing-x", "a..b", "with space", "café"] {
            assert!(validate_extension_id(id).is_err(), "{id}");
        }
    }

    #[test]
    fn an_interrupted_install_is_recovered_and_uninstall_clears_old_metadata() {
        let dir = tempfile::tempdir().unwrap();
        let backup = dir.path().join(".previous-athas.theme.test");
        fs::create_dir_all(&backup).unwrap();
        fs::write(backup.join("old.txt"), "previous").unwrap();
        let staging = dir.path().join(".installing-athas.theme.test");
        fs::create_dir_all(&staging).unwrap();
        fs::write(staging.join("new.txt"), "new").unwrap();
        commit(dir.path(), "athas.theme.test", &staging).unwrap();
        assert!(dir.path().join("athas.theme.test/new.txt").is_file());
        assert!(!backup.exists());
        fs::write(dir.path().join("athas.theme.test.json"), "{}").unwrap();
        uninstall(dir.path(), "athas.theme.test").unwrap();
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 0);
    }

    #[test]
    fn platform_keys() {
        let platform = platform();
        assert!(["darwin-", "linux-", "win32-"].iter().any(|prefix| platform.starts_with(prefix)), "{platform}");
    }
}
