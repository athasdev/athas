//! Sign-ins from the browsers installed beside Athas: each browser profile's cookies, read from
//! its own store and decrypted where the browser encrypts them, so a site open in a browser tab
//! starts out signed in.
//!
//! Reading happens off the main thread; it may wait on the keychain prompt that unlocks a
//! Chromium browser's key.

mod chromium;
mod firefox;
#[cfg(target_os = "macos")]
mod safari;

use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
};

/// A browser Athas can read sign-ins from.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Browser {
    Chrome,
    Arc,
    Dia,
    Brave,
    Edge,
    Vivaldi,
    Opera,
    Chromium,
    Firefox,
    Zen,
    Safari,
}

impl Browser {
    pub fn name(self) -> &'static str {
        match self {
            Browser::Chrome => "Chrome",
            Browser::Arc => "Arc",
            Browser::Dia => "Dia",
            Browser::Brave => "Brave",
            Browser::Edge => "Edge",
            Browser::Vivaldi => "Vivaldi",
            Browser::Opera => "Opera",
            Browser::Chromium => "Chromium",
            Browser::Firefox => "Firefox",
            Browser::Zen => "Zen",
            Browser::Safari => "Safari",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum Store {
    /// A Chromium `Cookies` database, with the folder holding `Local State` and where the
    /// browser keeps its key.
    Chromium { cookies: PathBuf, user_data: PathBuf, keychain_service: &'static str },
    Firefox { cookies: PathBuf },
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    Safari { cookies: PathBuf },
}

/// One profile of one browser.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Source {
    pub browser: Browser,
    /// The profile's name, as the browser shows it.
    pub profile: String,
    /// The account signed in to the profile, when the browser records one.
    pub account: Option<String>,
    store: Store,
}

impl Source {
    pub fn id(&self) -> String {
        format!("{}:{}", self.browser.name(), self.profile)
    }

    /// Reading this source asks the system to unlock the browser's key first.
    pub fn needs_keychain(&self) -> bool {
        cfg!(target_os = "macos") && matches!(self.store, Store::Chromium { .. })
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SameSite {
    None,
    Lax,
    Strict,
}

/// A cookie as another browser kept it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Cookie {
    pub name: String,
    pub value: String,
    /// The host, with a leading dot when subdomains share the cookie.
    pub domain: String,
    pub path: String,
    /// Seconds since the Unix epoch; `None` for a cookie that ends with the session.
    pub expires: Option<i64>,
    pub secure: bool,
    pub http_only: bool,
    pub same_site: Option<SameSite>,
}

impl Cookie {
    pub fn host(&self) -> &str {
        self.domain.trim_start_matches('.')
    }

    /// The site the cookie belongs to: its registrable domain, or its host.
    pub fn site(&self) -> String {
        let host = self.host().to_ascii_lowercase();
        psl::domain_str(&host).map_or(host.clone(), str::to_string)
    }
}

/// The cookies of one site, which the user takes or leaves together.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Site {
    pub name: String,
    pub cookies: Vec<Cookie>,
}

/// What reading a source found.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Found {
    /// The sites with live cookies, most cookies first.
    pub sites: Vec<Site>,
    /// Cookies the browser locked to itself (Chrome's app-bound encryption on Windows).
    pub locked: usize,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ImportError {
    /// The keychain prompt was refused, or the key could not be read.
    KeychainDenied(Browser),
    /// macOS keeps Safari's data behind Full Disk Access.
    NeedsFullDiskAccess,
    /// The browser holds its database open (Windows locks it while the browser runs).
    InUse(Browser),
    Other(String),
}

impl ImportError {
    pub fn title(&self) -> String {
        match self {
            ImportError::KeychainDenied(browser) => format!("Athas couldn't unlock {}'s sign-ins", browser.name()),
            ImportError::NeedsFullDiskAccess => "Safari's sign-ins need Full Disk Access".to_string(),
            ImportError::InUse(browser) => format!("{} is using its sign-ins", browser.name()),
            ImportError::Other(_) => "Couldn't read the sign-ins".to_string(),
        }
    }

    pub fn message(&self) -> String {
        match self {
            ImportError::KeychainDenied(browser) => format!(
                "{} keeps the key to its cookies in your keychain. Try again and choose Allow when macOS asks.",
                browser.name()
            ),
            ImportError::NeedsFullDiskAccess => {
                "Turn on Athas in System Settings › Privacy & Security › Full Disk Access, then try again.".to_string()
            }
            ImportError::InUse(browser) => format!("Quit {} and try again.", browser.name()),
            ImportError::Other(error) => error.clone(),
        }
    }
}

/// Every browser profile on this machine with sign-ins to read.
pub fn sources() -> Vec<Source> {
    let mut sources = chromium::sources();
    sources.extend(firefox::sources());
    #[cfg(target_os = "macos")]
    sources.extend(safari::sources());
    sources
}

/// Reads the live cookies of `source`, grouped by site.
pub fn read(source: &Source) -> Result<Found, ImportError> {
    let (cookies, locked) = match &source.store {
        Store::Chromium { cookies, user_data, keychain_service } => chromium::read(source.browser, cookies, user_data, keychain_service)?,
        Store::Firefox { cookies } => (firefox::read(source.browser, cookies)?, 0),
        #[cfg(target_os = "macos")]
        Store::Safari { cookies } => (safari::read(cookies)?, 0),
        #[cfg(not(target_os = "macos"))]
        Store::Safari { .. } => (Vec::new(), 0),
    };
    let total = cookies.len();
    let sites = group_by_site(cookies, now());
    log::info!(
        "[browser-import] {} ({}): {total} cookies, {} live across {} sites",
        source.browser.name(),
        source.profile,
        sites.iter().map(|site| site.cookies.len()).sum::<usize>(),
        sites.len()
    );
    Ok(Found { sites, locked })
}

fn now() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |elapsed| elapsed.as_secs() as i64)
}

fn group_by_site(cookies: Vec<Cookie>, now: i64) -> Vec<Site> {
    let mut sites: BTreeMap<String, Vec<Cookie>> = BTreeMap::new();
    for cookie in cookies {
        if cookie.expires.is_some_and(|expires| expires <= now) || cookie.name.is_empty() && cookie.value.is_empty() || cookie.host().is_empty() {
            continue;
        }
        sites.entry(cookie.site()).or_default().push(cookie);
    }
    let mut sites: Vec<Site> = sites.into_iter().map(|(name, cookies)| Site { name, cookies }).collect();
    sites.sort_by(|a, b| b.cookies.len().cmp(&a.cookies.len()).then_with(|| a.name.cmp(&b.name)));
    sites
}

/// Copies a database and its journal next to each other in a fresh folder, so it can be read
/// while its browser has it open.
fn snapshot(database: &Path, browser: Browser) -> Result<(tempfile::TempDir, PathBuf), ImportError> {
    let folder = tempfile::tempdir().map_err(|error| ImportError::Other(error.to_string()))?;
    let name = database.file_name().unwrap_or_default();
    let copy = folder.path().join(name);
    std::fs::copy(database, &copy).map_err(|error| match error.kind() {
        std::io::ErrorKind::PermissionDenied if browser == Browser::Safari => ImportError::NeedsFullDiskAccess,
        std::io::ErrorKind::PermissionDenied => ImportError::Other(format!("Athas may not read {}: {error}", database.display())),
        _ if error.raw_os_error() == Some(32) => ImportError::InUse(browser),
        _ => ImportError::Other(format!("Failed to read {}: {error}", database.display())),
    })?;
    for suffix in ["-wal", "-shm", "-journal"] {
        let mut companion = database.as_os_str().to_owned();
        companion.push(suffix);
        let mut target = copy.as_os_str().to_owned();
        target.push(suffix);
        let _ = std::fs::copy(PathBuf::from(companion), PathBuf::from(target));
    }
    Ok((folder, copy))
}

fn open_database(path: &Path) -> Result<rusqlite::Connection, ImportError> {
    rusqlite::Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX)
        .map_err(|error| ImportError::Other(format!("Failed to open the cookie database: {error}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cookie(domain: &str, name: &str, expires: Option<i64>) -> Cookie {
        Cookie {
            name: name.to_string(),
            value: "v".to_string(),
            domain: domain.to_string(),
            path: "/".to_string(),
            expires,
            secure: true,
            http_only: false,
            same_site: None,
        }
    }

    #[test]
    fn groups_live_cookies_by_registrable_domain() {
        let sites = group_by_site(
            vec![
                cookie(".github.com", "a", Some(200)),
                cookie("gist.github.com", "b", None),
                cookie("accounts.google.co.uk", "c", Some(200)),
                cookie(".github.com", "old", Some(50)),
                cookie("localhost", "dev", None),
            ],
            100,
        );
        let names: Vec<(&str, usize)> = sites.iter().map(|site| (site.name.as_str(), site.cookies.len())).collect();
        assert_eq!(names, [("github.com", 2), ("google.co.uk", 1), ("localhost", 1)]);
    }
}
