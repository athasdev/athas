//! `wsl://<distro>/<linux path>` and the Windows share paths (`\\wsl$\<distro>\…`,
//! `\\wsl.localhost\<distro>\…`) that reach the same files. Built on Athas's translation helpers;
//! this adds tolerance for paths that went through `PathBuf` (backslash joins, one slash dropped).

use std::path::Path;

pub use athas_wsl::WslPath;
use athas_wsl::{WslUncFlavor, build_wsl_uri, parse_windows_unc_path, wsl_path_to_windows_unc};

pub fn is_wsl(path: &str) -> bool {
    path.starts_with("wsl:")
}

/// Reads a `wsl://` path, as written or after a `PathBuf` round trip, or a WSL share path.
pub fn parse(value: &str) -> Option<WslPath> {
    if let Some(rest) = value.strip_prefix("wsl:") {
        let rest = rest.trim_start_matches(['/', '\\']);
        let end = rest.find(['/', '\\']).unwrap_or(rest.len());
        let (distro, linux) = rest.split_at(end);
        let distro = distro.trim();
        if distro.is_empty() {
            return None;
        }
        return Some(WslPath { distro: distro.to_string(), linux_path: athas_wsl::normalize_linux_path(linux) });
    }
    parse_windows_unc_path(value).map(|(path, _)| path)
}

pub fn parse_path(path: &Path) -> Option<WslPath> {
    parse(path.to_str()?)
}

pub fn format(path: &WslPath) -> String {
    build_wsl_uri(&path.distro, &path.linux_path)
}

pub fn join(path: &WslPath, name: &str) -> String {
    build_wsl_uri(&path.distro, &athas_wsl::join_linux_path(&path.linux_path, name))
}

/// `wsl://Ubuntu/home/me` → `\\wsl.localhost\Ubuntu\home\me` (or `\\wsl$\…` where only that
/// share exists).
pub fn linux_to_unc(path: &str) -> Option<String> {
    let path = parse(path)?;
    Some(wsl_path_to_windows_unc(&path.distro, &path.linux_path, athas_wsl::resolve_unc_flavor(&path.distro)))
}

/// The legacy share spelling, for older Windows 10 releases.
pub fn linux_to_legacy_unc(path: &str) -> Option<String> {
    let path = parse(path)?;
    Some(wsl_path_to_windows_unc(&path.distro, &path.linux_path, WslUncFlavor::Legacy))
}

/// `\\wsl$\Ubuntu\home\me` → `wsl://Ubuntu/home/me`; `None` for any other path.
pub fn unc_to_wsl(path: &str) -> Option<String> {
    athas_wsl::windows_unc_to_wsl_uri(path)
}

/// How a title shows it: `Ubuntu:/home/me`.
pub fn display(path: &str) -> Option<String> {
    let path = parse(path)?;
    Some(format!("{}:{}", path.distro, path.linux_path))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn parses_written_and_pathbuf_spellings() {
        let path = parse("wsl://Ubuntu/home/me").unwrap();
        assert_eq!((path.distro.as_str(), path.linux_path.as_str()), ("Ubuntu", "/home/me"));
        assert_eq!(parse("wsl://Ubuntu").unwrap().linux_path, "/");
        assert_eq!(parse("wsl:/Ubuntu/home").unwrap().linux_path, "/home");
        assert_eq!(parse(r"wsl://Ubuntu/home\me\src").unwrap().linux_path, "/home/me/src");
        let joined = PathBuf::from("wsl://Ubuntu-22.04/srv").join("app");
        assert_eq!(parse_path(&joined).unwrap().linux_path, "/srv/app");
        assert!(parse("wsl://").is_none());
        assert!(parse("/home/me").is_none());
        assert!(parse("remote://box/srv").is_none());
        assert!(is_wsl("wsl://Ubuntu/"));
    }

    #[test]
    fn translates_share_paths_both_ways() {
        assert_eq!(unc_to_wsl(r"\\wsl$\Ubuntu\home\me").as_deref(), Some("wsl://Ubuntu/home/me"));
        assert_eq!(unc_to_wsl(r"\\wsl.localhost\Debian\").as_deref(), Some("wsl://Debian/"));
        assert_eq!(unc_to_wsl("//wsl$/Ubuntu/etc/hosts").as_deref(), Some("wsl://Ubuntu/etc/hosts"));
        assert_eq!(unc_to_wsl(r"\\?\UNC\wsl$\Ubuntu\srv").as_deref(), Some("wsl://Ubuntu/srv"));
        assert_eq!(unc_to_wsl(r"\\server\share\x"), None);
        assert_eq!(unc_to_wsl(r"C:\Users\me"), None);
        assert_eq!(linux_to_legacy_unc("wsl://Ubuntu/home/me").as_deref(), Some(r"\\wsl$\Ubuntu\home\me"));
        // Off Windows there is no share to probe, so the modern spelling is used.
        if !cfg!(windows) {
            assert_eq!(linux_to_unc("wsl://Ubuntu/home/me").as_deref(), Some(r"\\wsl.localhost\Ubuntu\home\me"));
        }
        assert_eq!(linux_to_unc("/home/me"), None);
        let parsed = parse(r"\\wsl.localhost\Ubuntu\home\me").unwrap();
        assert_eq!(format(&parsed), "wsl://Ubuntu/home/me");
        assert_eq!(unc_to_wsl(&linux_to_legacy_unc("wsl://Ubuntu/a b/c").unwrap()).as_deref(), Some("wsl://Ubuntu/a b/c"));
    }

    #[test]
    fn joins_and_displays() {
        let root = parse("wsl://Ubuntu/").unwrap();
        assert_eq!(join(&root, "home"), "wsl://Ubuntu/home");
        assert_eq!(join(&parse("wsl://Ubuntu/home").unwrap(), "me/"), "wsl://Ubuntu/home/me");
        assert_eq!(display("wsl://Ubuntu/home/me").as_deref(), Some("Ubuntu:/home/me"));
        assert_eq!(athas_wsl::windows_path_to_wsl_path(r"C:\Users\me").as_deref(), Some("/mnt/c/Users/me"));
    }
}
