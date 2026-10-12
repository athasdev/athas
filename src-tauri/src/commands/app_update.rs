use serde::Serialize;
use tauri::command;

/// Package managers that update Athas themselves, such as Scoop, put a file
/// with this name next to the executable to turn the in-app updater off.
const PACKAGE_MANAGER_MARKER: &str = "managed-by-package-manager";

/// The app id of the Flatpak bundle that older releases shipped. Other
/// Flatpak packages, such as community Flathub builds, are updated by Flatpak.
const RELEASE_FLATPAK_ID: &str = "com.code.athas";

/// How this installation gets new versions.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "lowercase")]
pub enum AppUpdateMode {
   /// The in-app updater downloads and installs new versions.
   #[serde(rename = "self")]
   SelfUpdate,
   /// Athas cannot replace itself, so it points to the download page instead.
   Notify,
   /// A package manager installed Athas and keeps it up to date.
   External,
}

/// How the in-app updater handles this installation. On Linux only AppImage,
/// deb and rpm installs can update themselves. The Flatpak bundle that Athas
/// no longer publishes only learns about new versions, while other Flatpak
/// packages and the tarball (including the Nix package) are updated by
/// whoever installed them.
#[command]
#[specta::specta]
pub fn app_update_mode() -> AppUpdateMode {
   let managed = std::env::current_exe()
      .ok()
      .and_then(|exe| {
         exe.parent()
            .map(|dir| dir.join(PACKAGE_MANAGER_MARKER).exists())
      })
      .unwrap_or(false);
   if managed {
      return AppUpdateMode::External;
   }

   if cfg!(target_os = "linux") {
      if std::path::Path::new("/.flatpak-info").exists() {
         return if std::env::var("FLATPAK_ID").as_deref() == Ok(RELEASE_FLATPAK_ID) {
            AppUpdateMode::Notify
         } else {
            AppUpdateMode::External
         };
      }
      if tauri::utils::platform::bundle_type().is_none() {
         return AppUpdateMode::External;
      }
   }

   AppUpdateMode::SelfUpdate
}
