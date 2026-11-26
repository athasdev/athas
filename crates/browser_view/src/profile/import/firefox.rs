//! Firefox and Zen: the profiles `profiles.ini` lists and each one's `cookies.sqlite`, which keeps
//! values in the clear.

use std::path::{Path, PathBuf};

use super::{Browser, Cookie, ImportError, SameSite, Source, Store};

/// Expiry values beyond this are milliseconds, as newer Firefox writes them.
const MILLISECONDS_FROM: i64 = 100_000_000_000;

fn installs() -> Vec<(Browser, PathBuf)> {
    let Some(base) = dirs::data_dir() else { return Vec::new() };
    #[cfg(target_os = "macos")]
    return vec![(Browser::Firefox, base.join("Firefox")), (Browser::Zen, base.join("zen"))];
    #[cfg(target_os = "windows")]
    return vec![(Browser::Firefox, base.join("Mozilla").join("Firefox")), (Browser::Zen, base.join("zen"))];
}

pub(super) fn sources() -> Vec<Source> {
    let mut sources = Vec::new();
    for (browser, folder) in installs() {
        let Ok(text) = std::fs::read_to_string(folder.join("profiles.ini")) else { continue };
        for (name, path) in profiles(&text, &folder) {
            let cookies = path.join("cookies.sqlite");
            if cookies.is_file() {
                sources.push(Source { browser, profile: name, account: None, store: Store::Firefox { cookies } });
            }
        }
    }
    sources
}

/// `(name, folder)` of each `[Profile…]` section, the default first.
fn profiles(ini: &str, base: &Path) -> Vec<(String, PathBuf)> {
    let mut profiles: Vec<(String, PathBuf, bool)> = Vec::new();
    let mut section: Option<(Option<String>, Option<String>, bool, bool)> = None;
    let finish = |section: Option<(Option<String>, Option<String>, bool, bool)>, profiles: &mut Vec<(String, PathBuf, bool)>| {
        if let Some((name, Some(path), relative, default)) = section {
            let folder = if relative { base.join(&path) } else { PathBuf::from(&path) };
            let name = display_name(&name.unwrap_or_else(|| path.rsplit(['/', '\\']).next().unwrap_or(&path).to_string()));
            profiles.push((name, folder, default));
        }
    };
    for line in ini.lines().map(str::trim) {
        if line.starts_with('[') {
            finish(section.take(), &mut profiles);
            if line.starts_with("[Profile") {
                section = Some((None, None, true, false));
            }
            continue;
        }
        let Some((key, value)) = line.split_once('=') else { continue };
        let Some(section) = section.as_mut() else { continue };
        match key.trim() {
            "Name" => section.0 = Some(value.trim().to_string()),
            "Path" => section.1 = Some(value.trim().to_string()),
            "IsRelative" => section.2 = value.trim() == "1",
            "Default" => section.3 = value.trim() == "1",
            _ => {}
        }
    }
    finish(section.take(), &mut profiles);
    profiles.sort_by_key(|(_, _, default)| !default);
    profiles.into_iter().map(|(name, folder, _)| (name, folder)).collect()
}

/// Firefox names its own profiles after their channel: "default-release" reads as "Default",
/// "dev-edition-default" as "Developer Edition".
fn display_name(name: &str) -> String {
    let name = name.trim().strip_suffix(" (release)").unwrap_or(name.trim());
    let channel = name.strip_prefix("default-").or_else(|| name.trim().strip_suffix("-default")).unwrap_or(name.trim());
    match channel {
        "" | "default" | "release" => "Default".to_string(),
        "dev-edition" => "Developer Edition".to_string(),
        "nightly" => "Nightly".to_string(),
        "beta" => "Beta".to_string(),
        "esr" => "ESR".to_string(),
        _ => name.trim().to_string(),
    }
}

pub(super) fn read(browser: Browser, database: &Path) -> Result<Vec<Cookie>, ImportError> {
    let (_folder, copy) = super::snapshot(database, browser)?;
    let connection = super::open_database(&copy)?;
    let error = |error: rusqlite::Error| ImportError::Other(format!("Failed to read {}'s cookies: {error}", browser.name()));
    let mut statement = connection
        .prepare("SELECT host, name, value, path, expiry, isSecure, isHttpOnly, sameSite, originAttributes FROM moz_cookies")
        .map_err(error)?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, i64>(4)?,
                row.get::<_, bool>(5)?,
                row.get::<_, bool>(6)?,
                row.get::<_, i64>(7)?,
                row.get::<_, String>(8)?,
            ))
        })
        .map_err(error)?;
    Ok(rows
        .filter_map(Result::ok)
        // Container tabs and partitioned storage keep cookies of their own; the plain profile's
        // are the ones a user means.
        .filter(|row| row.8.is_empty())
        .map(|(domain, name, value, path, expiry, secure, http_only, same_site, _)| Cookie {
            name,
            value,
            domain,
            path: if path.is_empty() { "/".to_string() } else { path },
            expires: (expiry > 0).then(|| if expiry >= MILLISECONDS_FROM { expiry / 1000 } else { expiry }),
            secure,
            http_only,
            same_site: match same_site {
                1 => Some(SameSite::Lax),
                2 => Some(SameSite::Strict),
                _ => None,
            },
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_firefox_channels() {
        assert_eq!(display_name("default-release"), "Default");
        assert_eq!(display_name("dev-edition-default"), "Developer Edition");
        assert_eq!(display_name("default-nightly"), "Nightly");
        assert_eq!(display_name("Work"), "Work");
        assert_eq!(display_name("Default (release)"), "Default");
    }

    #[test]
    fn reads_profiles_ini() {
        let ini = "[General]\nStartWithLastProfile=1\n\n[Profile1]\nName=work\nIsRelative=1\nPath=Profiles/abc.work\n\n[Profile0]\nName=default-release\nIsRelative=1\nPath=Profiles/xyz.default-release\nDefault=1\n\n[Install4F96]\nDefault=Profiles/xyz.default-release\n";
        let base = Path::new("/ff");
        assert_eq!(
            profiles(ini, base),
            [
                ("Default".to_string(), base.join("Profiles/xyz.default-release")),
                ("work".to_string(), base.join("Profiles/abc.work")),
            ]
        );
    }
}
