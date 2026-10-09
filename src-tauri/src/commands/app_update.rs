use tauri::command;

/// Package managers that update Athas themselves, such as Scoop, put a file
/// with this name next to the executable to turn the in-app updater off.
const PACKAGE_MANAGER_MARKER: &str = "managed-by-package-manager";

/// Whether the in-app updater can replace this installation. On Linux only
/// AppImage, deb and rpm installs can update themselves: Flatpak builds are
/// updated by Flatpak, and the tarball (including the Nix package) by whoever
/// installed it.
#[command]
#[specta::specta]
pub fn self_update_supported() -> bool {
   let managed = std::env::current_exe()
      .ok()
      .and_then(|exe| {
         exe.parent()
            .map(|dir| dir.join(PACKAGE_MANAGER_MARKER).exists())
      })
      .unwrap_or(false);
   if managed {
      return false;
   }

   if cfg!(target_os = "linux") {
      return tauri::utils::platform::bundle_type().is_some()
         && !std::path::Path::new("/.flatpak-info").exists();
   }

   true
}
