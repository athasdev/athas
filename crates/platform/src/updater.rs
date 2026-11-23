//! Update checks against the endpoint the Tauri app polls (`https://athas.dev/api/update/stable`,
//! with the `X-Athas-Update-Channel` header choosing stable or beta). A newer version is announced
//! with a notification; "Download Update" (Install in Settings) downloads the archive for this
//! platform with progress, checks its minisign signature against the updater key of
//! `tauri.conf.json`, installs it as the Tauri updater does (the app bundle swapped in place on
//! macOS, the AppImage replaced on Linux, the setup run on Windows) and restarts once every window
//! agrees to close (`use-updater.ts`). Where Athas cannot replace itself, the download page opens.
//! "Download later" hides a version from background checks for a day and "Skip this version"
//! until a newer one ships (`update-preferences.ts`).

use std::{
    collections::HashMap,
    io::Read,
    path::{Path, PathBuf},
    time::Duration,
};

use gpui::{App, Global, SharedString};
use notifications::{NotificationCategory, NotificationKind};
use serde::{Deserialize, Serialize};

const UPDATE_URL: &str = "https://athas.dev/api/update/stable";
const CHANNEL_HEADER: &str = "X-Athas-Update-Channel";
const RELEASES_URL: &str = "https://github.com/athasdev/athas/releases";
const DOWNLOAD_PAGE_URL: &str = "https://athas.dev/download";
/// The updater key of `athas/src-tauri/tauri.conf.json`.
const UPDATER_PUBLIC_KEY: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEJBNDk0QjI4NkVDNDQwRUUKUldUdVFNUnVLRXRKdXV2elJZL3RsOWkvRDJueUwvQjh1UzdMbFBHZmZjV01Ec3lXZ1hFY3V6RkYK";
const RELEASE_FLATPAK_ID: &str = "com.code.athas";
const NOTIFICATION_ID: &str = "athas-update";
const FIRST_CHECK_DELAY: Duration = Duration::from_secs(10);
/// How often the app looks for a newer one. It was twelve hours, which is most of a working day:
/// a beta published in the morning reached an app left running since the night before only that
/// evening. The check is one small JSON fetch, so it costs nothing to ask more often.
const CHECK_INTERVAL: Duration = Duration::from_secs(60 * 60);
const MAX_DOWNLOAD_BYTES: u64 = 1024 * 1024 * 1024;
/// Package managers that update Athas themselves put a file with this name next to the binary.
const PACKAGE_MANAGER_MARKER: &str = "managed-by-package-manager";
const REMIND_LATER_MS: u64 = 24 * 60 * 60 * 1000;
const PREFERENCES_FILE: &str = "update-preferences.json";

/// A version the user put off or skipped (`athas-update-preferences`).
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct UpdatePreferences {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skipped_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remind_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remind_after: Option<u64>,
}

impl UpdatePreferences {
    /// Whether a background check keeps quiet about `version` at `now` (milliseconds).
    pub fn suppresses(&self, version: &str, now: u64) -> bool {
        self.skipped_version.as_deref() == Some(version)
            || (self.remind_version.as_deref() == Some(version) && self.remind_after.is_some_and(|after| after > now))
    }

    /// Forgets choices about other versions once `version` is offered.
    pub fn for_new_version(&self, version: &str) -> Self {
        let mut next = self.clone();
        if next.skipped_version.as_deref().is_some_and(|skipped| skipped != version) {
            next.skipped_version = None;
        }
        if next.remind_version.as_deref().is_some_and(|remind| remind != version) {
            next.remind_version = None;
            next.remind_after = None;
        }
        next
    }

    pub fn remind_later(version: &str, now: u64) -> Self {
        Self { skipped_version: None, remind_version: Some(version.to_string()), remind_after: Some(now + REMIND_LATER_MS) }
    }

    pub fn skip(version: &str) -> Self {
        Self { skipped_version: Some(version.to_string()), ..Self::default() }
    }

    fn is_empty(&self) -> bool {
        self.skipped_version.is_none() && self.remind_version.is_none() && self.remind_after.is_none()
    }
}

pub fn read_preferences(dir: &Path) -> UpdatePreferences {
    std::fs::read_to_string(dir.join(PREFERENCES_FILE)).ok().and_then(|text| serde_json::from_str(&text).ok()).unwrap_or_default()
}

pub fn write_preferences(dir: &Path, preferences: &UpdatePreferences) {
    let path = dir.join(PREFERENCES_FILE);
    if preferences.is_empty() {
        std::fs::remove_file(path).ok();
    } else if let Ok(json) = serde_json::to_string(preferences) {
        std::fs::create_dir_all(dir).ok();
        std::fs::write(path, json).ok();
    }
}

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|elapsed| elapsed.as_millis() as u64).unwrap_or(0)
}

/// The updater manifest the endpoint serves (Tauri's format).
#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct Manifest {
    pub version: String,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub pub_date: Option<String>,
    #[serde(default)]
    pub platforms: HashMap<String, PlatformAsset>,
}

#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct PlatformAsset {
    pub url: String,
    #[serde(default)]
    pub signature: Option<String>,
}

impl Manifest {
    pub fn asset(&self) -> Option<&PlatformAsset> {
        self.platforms.get(&platform_key())
    }

    pub fn release_page(&self) -> String {
        format!("{RELEASES_URL}/tag/v{}", self.version.trim_start_matches('v'))
    }
}

/// The manifest's key for this build, such as `darwin-aarch64`.
pub fn platform_key() -> String {
    let os = match std::env::consts::OS {
        "macos" => "darwin",
        os => os,
    };
    format!("{os}-{}", std::env::consts::ARCH)
}

/// Whether `remote` is a later version than `current`; prereleases order as semver says
/// (`0.18.0-beta.10` after `0.18.0-beta.2`, both before `0.18.0`). Unreadable versions are never newer.
pub fn is_newer(remote: &str, current: &str) -> bool {
    let parse = |version: &str| semver::Version::parse(version.trim().trim_start_matches('v')).ok();
    match (parse(remote), parse(current)) {
        (Some(remote), Some(current)) => remote > current,
        _ => false,
    }
}

pub fn parse_manifest(json: &str) -> anyhow::Result<Manifest> {
    Ok(serde_json::from_str(json)?)
}

/// Fetches the manifest for `channel`; `None` when the server has no update (204).
pub fn fetch(channel: &str) -> anyhow::Result<Option<Manifest>> {
    let url = std::env::var("ATHAS_UPDATE_URL").unwrap_or_else(|_| UPDATE_URL.to_string());
    let mut response = ureq::get(&url).header(CHANNEL_HEADER, channel).call()?;
    if response.status().as_u16() == 204 {
        return Ok(None);
    }
    let body = response.body_mut().with_config().limit(1024 * 1024).read_to_string()?;
    parse_manifest(&body).map(Some)
}

/// Whether a package manager keeps this installation up to date.
pub fn managed_externally() -> bool {
    std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|dir| dir.join(PACKAGE_MANAGER_MARKER).exists()))
        .unwrap_or(false)
}

/// The file name a download is saved under: the URL's last segment, without a query.
fn file_name(url: &str) -> String {
    let name = url.split(['?', '#']).next().unwrap_or("").rsplit('/').next().unwrap_or("");
    let safe = !name.is_empty() && name != "." && name != ".." && !name.contains('\\');
    if safe { name.to_string() } else { "athas-update".to_string() }
}

#[derive(Default)]
struct UpdaterState {
    available: Option<Manifest>,
    checking: bool,
    downloading: bool,
}

impl Global for UpdaterState {}

/// The version the server offers, once a check found one.
pub fn available_version(cx: &App) -> Option<String> {
    cx.try_global::<UpdaterState>()?.available.as_ref().map(|manifest| manifest.version.clone())
}

fn announce(cx: &mut App, message: impl Into<SharedString>, description: Option<SharedString>, kind: NotificationKind) {
    notifications::notify(cx, kind, NotificationCategory::Athas, message, description, Some(NOTIFICATION_ID.into()));
}

/// Checks for an update. `manual` checks also report "up to date" and errors.
pub fn check(manual: bool, cx: &mut App) {
    if update_mode() == UpdateMode::External {
        return;
    }
    let state = cx.default_global::<UpdaterState>();
    if state.checking {
        return;
    }
    state.checking = true;
    workbench_api::set_update_status(cx, |status| {
        status.checking = true;
        status.error = None;
    });
    let channel = settings::get(cx).update_channel.clone();
    let task = cx.background_executor().spawn(async move { fetch(&channel) });
    cx.spawn(async move |cx| {
        let result = task.await;
        cx.update(|cx| finish_check(result, manual, cx));
    })
    .detach();
}

fn finish_check(result: anyhow::Result<Option<Manifest>>, manual: bool, cx: &mut App) {
    cx.default_global::<UpdaterState>().checking = false;
    let current = env!("CARGO_PKG_VERSION");
    match &result {
        Ok(Some(manifest)) if is_newer(&manifest.version, current) => {
            telemetry::record_update_check(cx, telemetry::UpdateCheckStatus::Available, current, Some(&manifest.version))
        }
        Ok(_) => telemetry::record_update_check(cx, telemetry::UpdateCheckStatus::UpToDate, current, None),
        Err(_) => telemetry::record_update_check(cx, telemetry::UpdateCheckStatus::Failed, current, None),
    };
    let download_only = update_mode() == UpdateMode::Notify;
    let result = match result {
        Ok(Some(manifest)) if is_newer(&manifest.version, current) => {
            let suppressed = cli::data_dir().is_some_and(|dir| {
                let preferences = read_preferences(&dir);
                let next = preferences.for_new_version(&manifest.version);
                if next != preferences {
                    write_preferences(&dir, &next);
                }
                !manual && next.suppresses(&manifest.version, now_ms())
            });
            if suppressed { Ok(None) } else { Ok(Some(manifest)) }
        }
        result => result,
    };
    workbench_api::set_update_status(cx, |status| {
        status.checking = false;
        status.download_only = download_only;
        match &result {
            Ok(Some(manifest)) if is_newer(&manifest.version, current) => status.available = Some(manifest.version.clone()),
            Ok(_) => status.available = None,
            Err(error) => status.error = Some(error.to_string()),
        }
    });
    match result {
        Ok(Some(manifest)) if is_newer(&manifest.version, current) => {
            let version = manifest.version.clone();
            let already_announced =
                cx.default_global::<UpdaterState>().available.as_ref().is_some_and(|known| known.version == version);
            cx.default_global::<UpdaterState>().available = Some(manifest);
            if manual || !already_announced {
                announce(
                    cx,
                    format!("Athas {version} is available"),
                    Some(if download_only { "Run Download Update to get it, or View Release Notes to read what changed." } else { "Run Download Update to install it, or View Release Notes to read what changed." }.into()),
                    NotificationKind::Info,
                );
            }
        }
        Ok(_) => {
            if manual {
                announce(cx, format!("Athas {current} is up to date"), None, NotificationKind::Success);
            }
        }
        Err(error) => {
            if manual {
                announce(cx, "Could not check for updates", Some(error.to_string().into()), NotificationKind::Error);
            } else {
                eprintln!("athas: update check failed: {error:#}");
            }
        }
    }
}

/// How this installation is updated (`app_update_mode`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum UpdateMode {
    /// Athas downloads and installs new versions itself.
    SelfUpdate,
    /// Athas cannot replace itself, so the download page opens instead.
    Notify,
    /// A package manager installed Athas and keeps it up to date.
    External,
}

pub fn update_mode() -> UpdateMode {
    if managed_externally() {
        return UpdateMode::External;
    }
    let exe = std::env::current_exe().ok();
    let flatpak_id = std::env::var("FLATPAK_ID").ok();
    mode_for(
        exe.as_deref(),
        Path::new("/.flatpak-info").exists(),
        flatpak_id.as_deref(),
        std::env::var_os("APPIMAGE").is_some(),
    )
}

/// On macOS only an app bundle can be swapped; a bare binary (a development build) cannot. On
/// Linux the AppImage updates itself, the release Flatpak only learns about new versions, and
/// other packages are updated by whoever installed them.
fn mode_for(exe: Option<&Path>, flatpak: bool, flatpak_id: Option<&str>, appimage: bool) -> UpdateMode {
    if cfg!(target_os = "macos") {
        if exe.and_then(app_bundle).is_some() { UpdateMode::SelfUpdate } else { UpdateMode::Notify }
    } else if cfg!(target_os = "linux") {
        if flatpak {
            if flatpak_id == Some(RELEASE_FLATPAK_ID) { UpdateMode::Notify } else { UpdateMode::External }
        } else if appimage {
            UpdateMode::SelfUpdate
        } else {
            UpdateMode::External
        }
    } else {
        UpdateMode::SelfUpdate
    }
}

/// The `.app` bundle `exe` runs from (`Athas.app/Contents/MacOS/athas`).
pub fn app_bundle(exe: &Path) -> Option<PathBuf> {
    let macos = exe.parent()?;
    let contents = macos.parent()?;
    let bundle = contents.parent()?;
    let is_bundle = macos.file_name()? == "MacOS"
        && contents.file_name()? == "Contents"
        && bundle.extension().is_some_and(|extension| extension == "app");
    is_bundle.then(|| bundle.to_path_buf())
}

/// Checks a download against a minisign signature, both as the manifest and `tauri.conf.json`
/// give them: base64 of the signature file and of the public key file.
/// Returns the signature's trusted comment.
pub fn verify_signature(data: &[u8], signature: &str, public_key: &str) -> anyhow::Result<String> {
    use base64::Engine as _;
    let decode = |value: &str| -> anyhow::Result<String> {
        Ok(String::from_utf8(base64::engine::general_purpose::STANDARD.decode(value.trim())?)?)
    };
    let key = minisign_verify::PublicKey::decode(&decode(public_key)?).map_err(|error| anyhow::anyhow!("bad updater key: {error}"))?;
    let signature = minisign_verify::Signature::decode(&decode(signature)?).map_err(|error| anyhow::anyhow!("bad update signature: {error}"))?;
    key.verify(data, &signature, true).map_err(|_| anyhow::anyhow!("The update's signature does not match."))?;
    Ok(signature.trusted_comment().to_string())
}

/// The version a signature's trusted comment was signed for (`version:` among its tab-separated
/// fields, which newer `tauri signer` releases write).
fn signed_version(trusted_comment: &str) -> Option<&str> {
    trusted_comment.split('\t').find_map(|field| field.strip_prefix("version:"))
}

/// As tauri-plugin-updater 2.14 checks: a signature that names a version must name the one the
/// manifest announced, so an unsigned manifest cannot pair a new version with an old archive.
pub fn check_signed_version(trusted_comment: &str, announced: &str) -> anyhow::Result<()> {
    let Some(signed) = signed_version(trusted_comment) else { return Ok(()) };
    let parse = |version: &str| semver::Version::parse(version.trim().trim_start_matches('v')).ok();
    let matches = match (parse(signed), parse(announced)) {
        (Some(signed), Some(announced)) => signed == announced,
        _ => signed == announced,
    };
    if matches { Ok(()) } else { Err(anyhow::anyhow!("The update was signed for {signed}, not {announced}.")) }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum InstallProgress {
    Downloaded(u8),
    Installing,
}

fn download_bytes(url: &str, progress: &dyn Fn(u8)) -> anyhow::Result<Vec<u8>> {
    let mut response = ureq::get(url).call()?;
    let total = response
        .headers()
        .get("content-length")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|total| *total > 0);
    let mut reader = response.body_mut().with_config().limit(MAX_DOWNLOAD_BYTES).reader();
    let mut data = Vec::new();
    let mut buffer = vec![0u8; 64 * 1024];
    let mut reported = None;
    loop {
        let read = reader.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        data.extend_from_slice(&buffer[..read]);
        if let Some(total) = total {
            let percent = (data.len() as u64 * 100 / total).min(100) as u8;
            if reported != Some(percent) {
                reported = Some(percent);
                progress(percent);
            }
        }
    }
    Ok(data)
}

fn is_gzip(data: &[u8]) -> bool {
    data.starts_with(&[0x1f, 0x8b])
}

/// Unpacks the `.app.tar.gz` next to `bundle` and swaps it in, putting the old bundle back when
/// the swap fails.
pub fn install_app_bundle(archive: &[u8], bundle: &Path) -> anyhow::Result<()> {
    let parent = bundle.parent().ok_or_else(|| anyhow::anyhow!("The app has no folder."))?;
    let staging = parent.join(format!(".athas-update-{}", std::process::id()));
    std::fs::remove_dir_all(&staging).ok();
    std::fs::create_dir_all(&staging)?;
    let result = (|| -> anyhow::Result<()> {
        let mut unpacked = tar::Archive::new(flate2::read::GzDecoder::new(archive));
        unpacked.set_preserve_permissions(true);
        unpacked.unpack(&staging)?;
        let new_app = std::fs::read_dir(&staging)?
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .find(|path| path.is_dir() && path.extension().is_some_and(|extension| extension == "app"))
            .ok_or_else(|| anyhow::anyhow!("The update has no app bundle."))?;
        let backup = staging.join("previous.app");
        std::fs::rename(bundle, &backup)?;
        if let Err(error) = std::fs::rename(&new_app, bundle) {
            std::fs::rename(&backup, bundle).ok();
            return Err(error.into());
        }
        Ok(())
    })();
    std::fs::remove_dir_all(&staging).ok();
    result
}

/// Replaces the AppImage with the new one (sent bare or in a `.tar.gz`).
pub fn install_appimage(download: &[u8], appimage: &Path) -> anyhow::Result<()> {
    let image = if is_gzip(download) {
        let mut unpacked = tar::Archive::new(flate2::read::GzDecoder::new(download));
        let mut found = None;
        for entry in unpacked.entries()? {
            let mut entry = entry?;
            if entry.path()?.extension().is_some_and(|extension| extension == "AppImage") {
                let mut bytes = Vec::new();
                entry.read_to_end(&mut bytes)?;
                found = Some(bytes);
                break;
            }
        }
        found.ok_or_else(|| anyhow::anyhow!("The update has no AppImage."))?
    } else {
        download.to_vec()
    };
    let staged = appimage.with_extension("update");
    std::fs::write(&staged, image)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        std::fs::set_permissions(&staged, std::fs::Permissions::from_mode(0o755))?;
    }
    std::fs::rename(&staged, appimage).inspect_err(|_| {
        std::fs::remove_file(&staged).ok();
    })?;
    Ok(())
}

/// Downloads, checks and installs the update; true when Athas restarts itself afterwards (the
/// Windows setup starts it again on its own).
fn install_update(asset: &PlatformAsset, version: &str, progress: &dyn Fn(InstallProgress)) -> anyhow::Result<bool> {
    let signature = asset.signature.as_deref().filter(|signature| !signature.trim().is_empty());
    let signature = signature.ok_or_else(|| anyhow::anyhow!("The update is not signed."))?;
    let data = download_bytes(&asset.url, &|percent| progress(InstallProgress::Downloaded(percent)))?;
    progress(InstallProgress::Installing);
    let trusted_comment = verify_signature(&data, signature, UPDATER_PUBLIC_KEY)?;
    check_signed_version(&trusted_comment, version)?;
    let exe = std::env::current_exe()?;
    if cfg!(target_os = "macos") {
        let bundle = app_bundle(&exe).ok_or_else(|| anyhow::anyhow!("Athas is not running from an app bundle."))?;
        install_app_bundle(&data, &bundle)?;
        Ok(true)
    } else if cfg!(target_os = "linux") {
        let appimage = std::env::var_os("APPIMAGE").map(PathBuf::from).ok_or_else(|| anyhow::anyhow!("Athas is not running from an AppImage."))?;
        install_appimage(&data, &appimage)?;
        Ok(true)
    } else {
        let setup = std::env::temp_dir().join(file_name(&asset.url));
        std::fs::write(&setup, &data)?;
        std::process::Command::new(&setup).args(["/P", "/R", "/UPDATE"]).spawn()?;
        Ok(false)
    }
}

/// Installs the update (`downloadAndInstall`): downloads it with progress, checks its signature,
/// installs it and restarts once every window agrees to close. Where Athas cannot replace itself
/// the download page opens; with no asset for this platform, the release page.
pub fn download_available(cx: &mut App) {
    match update_mode() {
        UpdateMode::External => return,
        UpdateMode::Notify => {
            cx.open_url(DOWNLOAD_PAGE_URL);
            return;
        }
        UpdateMode::SelfUpdate => {}
    }
    let state = cx.default_global::<UpdaterState>();
    let Some(manifest) = state.available.clone() else {
        check(true, cx);
        return;
    };
    if state.downloading {
        return;
    }
    let Some(asset) = manifest.asset().cloned() else {
        cx.open_url(&manifest.release_page());
        return;
    };
    state.downloading = true;
    workbench_api::set_update_status(cx, |status| {
        status.downloading = true;
        status.progress = Some(0);
        status.error = None;
    });
    let (sender, mut receiver) = futures::channel::mpsc::unbounded::<InstallProgress>();
    let version = manifest.version.clone();
    let task = cx.background_executor().spawn(async move {
        let progress = move |event: InstallProgress| {
            sender.unbounded_send(event).ok();
        };
        install_update(&asset, &version, &progress)
    });
    cx.spawn(async move |cx| {
        use futures::StreamExt as _;
        while let Some(event) = receiver.next().await {
            cx.update(|cx| {
                workbench_api::set_update_status(cx, |status| match event {
                    InstallProgress::Downloaded(percent) => status.progress = Some(percent),
                    InstallProgress::Installing => {
                        status.downloading = false;
                        status.installing = true;
                    }
                });
                cx.refresh_windows();
            });
        }
        let result = task.await;
        cx.update(|cx| finish_install(result, manifest, cx));
    })
    .detach();
}

fn finish_install(result: anyhow::Result<bool>, manifest: Manifest, cx: &mut App) {
    cx.default_global::<UpdaterState>().downloading = false;
    workbench_api::set_update_status(cx, |status| {
        status.downloading = false;
        status.progress = None;
        status.installing = result.is_ok();
        if let Err(error) = &result {
            status.error = Some(error.to_string());
        }
    });
    cx.refresh_windows();
    let restart = match result {
        Ok(restart) => restart,
        Err(error) => {
            announce(cx, "Could not install the update", Some(error.to_string().into()), NotificationKind::Error);
            return;
        }
    };
    onboarding::whats_new::WhatsNewStore::default_location().queue_pending(onboarding::whats_new::WhatsNewInfo {
        version: manifest.version.clone(),
        previous_version: Some(env!("CARGO_PKG_VERSION").to_string()),
        body: manifest.notes.clone(),
        date: manifest.pub_date.clone(),
    });
    announce(cx, format!("Athas {} is installed", manifest.version), Some("Restarting to finish updating.".into()), NotificationKind::Success);
    cx.set_global(workbench_api::RestartAfterQuit(restart));
    match crate::target_window(cx) {
        Some(handle) => {
            handle.update(cx, |_, window, cx| window.dispatch_action(Box::new(workbench::Quit), cx)).ok();
        }
        None if restart => cx.restart(),
        None => cx.quit(),
    }
}

pub fn view_release_notes(cx: &mut App) {
    let page = cx
        .try_global::<UpdaterState>()
        .and_then(|state| state.available.as_ref())
        .map(Manifest::release_page)
        .unwrap_or_else(|| RELEASES_URL.to_string());
    cx.open_url(&page);
}

/// Hides the offered version until a day has passed (`remindLater`, the title bar's "Download later").
pub fn download_later(cx: &mut App) {
    put_off(cx, |version| UpdatePreferences::remind_later(version, now_ms()));
}

/// Hides the offered version until a newer one ships (`skipVersion`).
pub fn skip_version(cx: &mut App) {
    put_off(cx, UpdatePreferences::skip);
}

fn put_off(cx: &mut App, preferences: impl FnOnce(&str) -> UpdatePreferences) {
    let Some(manifest) = cx.default_global::<UpdaterState>().available.take() else { return };
    if let Some(dir) = cli::data_dir() {
        write_preferences(&dir, &preferences(&manifest.version));
    }
    workbench_api::set_update_status(cx, |status| status.available = None);
    notifications::close_toast(cx, &NOTIFICATION_ID.into());
}

/// Checks shortly after launch and then hourly while `autoCheckForUpdates` is on. Debug builds
/// and package-managed installs never check on their own — a build you are working on should not
/// offer to replace itself, and a package manager owns the version it installed.
pub fn start_background_checks(cx: &mut App) {
    if cfg!(debug_assertions) || managed_externally() {
        return;
    }
    cx.spawn(async move |cx| {
        let mut delay = FIRST_CHECK_DELAY;
        loop {
            cx.background_executor().timer(delay).await;
            delay = CHECK_INTERVAL;
            cx.update(|cx| {
                if settings::get(cx).auto_check_for_updates {
                    check(false, cx);
                }
            });
        }
    })
    .detach();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn update_preferences() {
        let later = UpdatePreferences::remind_later("0.19.0", 1_000);
        assert!(later.suppresses("0.19.0", 1_000 + REMIND_LATER_MS - 1));
        assert!(!later.suppresses("0.19.0", 1_000 + REMIND_LATER_MS));
        assert!(!later.suppresses("0.19.1", 1_000));
        assert_eq!(later.for_new_version("0.19.1"), UpdatePreferences::default());
        assert_eq!(later.for_new_version("0.19.0"), later);
        let skipped = UpdatePreferences::skip("0.19.0");
        assert!(skipped.suppresses("0.19.0", u64::MAX));
        assert!(!skipped.for_new_version("0.20.0").suppresses("0.20.0", 0));

        let dir = tempfile::tempdir().unwrap();
        assert_eq!(read_preferences(dir.path()), UpdatePreferences::default());
        write_preferences(dir.path(), &later);
        assert_eq!(read_preferences(dir.path()), later);
        assert_eq!(std::fs::read_to_string(dir.path().join(PREFERENCES_FILE)).unwrap(), r#"{"remindVersion":"0.19.0","remindAfter":86401000}"#);
        write_preferences(dir.path(), &UpdatePreferences::default());
        assert!(!dir.path().join(PREFERENCES_FILE).exists());
    }

    #[test]
    fn compares_versions() {
        assert!(is_newer("0.19.0", "0.18.0"));
        assert!(is_newer("v0.18.1", "0.18.0"));
        assert!(is_newer("0.18.0", "0.18.0-beta.2"));
        assert!(is_newer("0.18.0-beta.10", "0.18.0-beta.2"));
        assert!(!is_newer("0.18.0-beta.2", "0.18.0"));
        assert!(!is_newer("0.18.0", "0.18.0"));
        assert!(!is_newer("0.17.9", "0.18.0"));
        assert!(!is_newer("latest", "0.18.0"));
    }

    #[test]
    fn reads_the_tauri_manifest() {
        let manifest = parse_manifest(
            r#"{
                "version": "0.19.0",
                "notes": "Faster",
                "pub_date": "2026-11-01T00:00:00Z",
                "platforms": {
                    "darwin-aarch64": { "signature": "sig", "url": "https://example.com/Athas_aarch64.app.tar.gz" },
                    "windows-x86_64": { "signature": "sig", "url": "https://example.com/Athas_x64-setup.exe" }
                }
            }"#,
        )
        .unwrap();
        assert_eq!(manifest.version, "0.19.0");
        assert_eq!(manifest.release_page(), "https://github.com/athasdev/athas/releases/tag/v0.19.0");
        assert_eq!(manifest.platforms.len(), 2);
        assert!(parse_manifest(r#"{"notes":"no version"}"#).is_err());
    }

    #[test]
    fn names_downloads_after_the_url() {
        assert_eq!(file_name("https://example.com/v1/Athas_aarch64.app.tar.gz?x=1"), "Athas_aarch64.app.tar.gz");
        assert_eq!(file_name("https://example.com/"), "athas-update");
        assert_eq!(file_name("https://example.com/.."), "athas-update");
    }

    /// A minisign key and a signer for `data`, as `tauri signer` writes them (base64 of the files).
    fn minisign(data: &[u8]) -> (String, String) {
        use base64::Engine as _;
        use ring::signature::{Ed25519KeyPair, KeyPair as _};
        let b64 = |bytes: &[u8]| base64::engine::general_purpose::STANDARD.encode(bytes);
        let pair = Ed25519KeyPair::from_seed_unchecked(&[7u8; 32]).unwrap();
        let key_id = [1u8, 2, 3, 4, 5, 6, 7, 8];
        let mut public = b"Ed".to_vec();
        public.extend_from_slice(&key_id);
        public.extend_from_slice(pair.public_key().as_ref());
        let public_file = format!("untrusted comment: minisign public key: 0807060504030201\n{}\n", b64(&public));
        let signature = pair.sign(data);
        let mut line = b"Ed".to_vec();
        line.extend_from_slice(&key_id);
        line.extend_from_slice(signature.as_ref());
        let trusted = "timestamp:1700000000\tfile:Athas.app.tar.gz";
        let mut global = signature.as_ref().to_vec();
        global.extend_from_slice(trusted.as_bytes());
        let signature_file = format!(
            "untrusted comment: signature from tauri secret key\n{}\ntrusted comment: {trusted}\n{}\n",
            b64(&line),
            b64(pair.sign(&global).as_ref())
        );
        (b64(public_file.as_bytes()), b64(signature_file.as_bytes()))
    }

    #[test]
    fn checks_update_signatures() {
        let (key, signature) = minisign(b"the update");
        assert_eq!(verify_signature(b"the update", &signature, &key).unwrap(), "timestamp:1700000000\tfile:Athas.app.tar.gz");
        assert!(verify_signature(b"another update", &signature, &key).is_err());
        assert!(verify_signature(b"the update", &signature, UPDATER_PUBLIC_KEY).is_err());
        assert!(verify_signature(b"the update", "not base64", &key).is_err());
    }

    #[test]
    fn checks_the_signed_version() {
        check_signed_version("timestamp:1700000000\tfile:Athas.app.tar.gz", "0.19.0").unwrap();
        check_signed_version("timestamp:1\tfile:a\tversion:0.19.0", "v0.19.0").unwrap();
        assert!(check_signed_version("timestamp:1\tfile:a\tversion:0.18.0", "0.19.0").is_err());
    }

    #[test]
    fn reads_the_updater_key() {
        use base64::Engine as _;
        let text = String::from_utf8(base64::engine::general_purpose::STANDARD.decode(UPDATER_PUBLIC_KEY).unwrap()).unwrap();
        assert!(minisign_verify::PublicKey::decode(&text).is_ok());
    }

    fn tar_gz(entries: &[(&str, &[u8], u32)]) -> Vec<u8> {
        let mut builder = tar::Builder::new(flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast()));
        for (path, data, mode) in entries {
            let mut header = tar::Header::new_gnu();
            header.set_size(data.len() as u64);
            header.set_mode(*mode);
            header.set_cksum();
            builder.append_data(&mut header, path, *data).unwrap();
        }
        builder.into_inner().unwrap().finish().unwrap()
    }

    #[test]
    fn swaps_the_app_bundle() {
        let dir = tempfile::tempdir().unwrap();
        let bundle = dir.path().join("Athas.app");
        std::fs::create_dir_all(bundle.join("Contents/MacOS")).unwrap();
        std::fs::write(bundle.join("Contents/MacOS/athas"), "old").unwrap();
        let archive = tar_gz(&[("Athas.app/Contents/MacOS/athas", b"new", 0o755), ("Athas.app/Contents/Info.plist", b"plist", 0o644)]);
        install_app_bundle(&archive, &bundle).unwrap();
        assert_eq!(std::fs::read_to_string(bundle.join("Contents/MacOS/athas")).unwrap(), "new");
        assert!(bundle.join("Contents/Info.plist").exists());
        let left: Vec<_> = std::fs::read_dir(dir.path()).unwrap().filter_map(Result::ok).map(|entry| entry.file_name()).collect();
        assert_eq!(left, vec![std::ffi::OsString::from("Athas.app")]);

        let empty = tar_gz(&[("README", b"no app", 0o644)]);
        assert!(install_app_bundle(&empty, &bundle).is_err());
        assert_eq!(std::fs::read_to_string(bundle.join("Contents/MacOS/athas")).unwrap(), "new");
    }

    #[test]
    fn replaces_the_appimage() {
        let dir = tempfile::tempdir().unwrap();
        let appimage = dir.path().join("Athas.AppImage");
        std::fs::write(&appimage, "old").unwrap();
        install_appimage(b"bare", &appimage).unwrap();
        assert_eq!(std::fs::read(&appimage).unwrap(), b"bare");
        install_appimage(&tar_gz(&[("Athas_1.0_amd64.AppImage", b"packed", 0o755)]), &appimage).unwrap();
        assert_eq!(std::fs::read(&appimage).unwrap(), b"packed");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt as _;
            assert_eq!(std::fs::metadata(&appimage).unwrap().permissions().mode() & 0o777, 0o755);
        }
    }

    #[test]
    fn finds_the_app_bundle() {
        assert_eq!(app_bundle(Path::new("/Applications/Athas.app/Contents/MacOS/athas")), Some(PathBuf::from("/Applications/Athas.app")));
        assert_eq!(app_bundle(Path::new("/Users/me/athas-gpui/target/debug/athas")), None);
        if cfg!(target_os = "macos") {
            assert_eq!(mode_for(Some(Path::new("/Applications/Athas.app/Contents/MacOS/athas")), false, None, false), UpdateMode::SelfUpdate);
            assert_eq!(mode_for(Some(Path::new("/tmp/target/debug/athas")), false, None, false), UpdateMode::Notify);
        }
    }

    #[test]
    fn names_this_platform() {
        let key = platform_key();
        assert!(key.ends_with(std::env::consts::ARCH));
        if cfg!(target_os = "macos") {
            assert!(key.starts_with("darwin-"));
        }
    }
}
