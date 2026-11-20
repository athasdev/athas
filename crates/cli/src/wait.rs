//! `athas --wait`: the CLI creates an empty marker file and sends its path with the files; Athas
//! deletes the marker once the files it opened are closed (or it quits), and the CLI returns.

use std::{
    io,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

const MARKER_DIR: &str = "athas-cli-wait";

/// Creates a fresh marker in `<temp>/athas-cli-wait/<pid>-<nanos>`.
pub fn create_marker() -> io::Result<PathBuf> {
    let dir = std::env::temp_dir().join(MARKER_DIR);
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|elapsed| elapsed.as_nanos()).unwrap_or_default();
    let marker = dir.join(format!("{}-{nanos}", std::process::id()));
    std::fs::create_dir_all(&dir)?;
    std::fs::write(&marker, b"")?;
    Ok(marker)
}

/// Only files named `<digits>-<digits>` in an `athas-cli-wait` folder are markers, so a request
/// cannot make Athas delete anything else. The CLI and the app can see different temporary
/// folders, so the folder's name is checked rather than its location.
pub fn is_marker_path(path: &Path) -> bool {
    path.is_absolute()
        && path.parent().and_then(Path::file_name).is_some_and(|name| name == MARKER_DIR)
        && path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| !name.is_empty() && name.chars().all(|c| c.is_ascii_digit() || c == '-'))
}

/// Deletes a marker, which lets the waiting CLI return. Paths that are not markers are left alone.
pub fn release_marker(marker: &str) -> io::Result<()> {
    let path = Path::new(marker);
    if !is_marker_path(path) {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, format!("not a wait marker: {marker}")));
    }
    match std::fs::remove_file(path) {
        Err(error) if error.kind() != io::ErrorKind::NotFound => Err(error),
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_marker_files() {
        assert!(is_marker_path(Path::new("/tmp/athas-cli-wait/123-456")));
        assert!(!is_marker_path(Path::new("/tmp/athas-cli-wait/../notes.txt")));
        assert!(!is_marker_path(Path::new("/tmp/other/123-456")));
        assert!(!is_marker_path(Path::new("athas-cli-wait/123-456")));
    }

    #[test]
    fn markers_are_created_and_released() {
        let marker = create_marker().unwrap();
        assert!(is_marker_path(&marker));
        assert!(marker.exists());
        release_marker(&marker.to_string_lossy()).unwrap();
        assert!(!marker.exists());
        release_marker(&marker.to_string_lossy()).unwrap();
        assert!(release_marker("/etc/hosts").is_err());
    }
}
