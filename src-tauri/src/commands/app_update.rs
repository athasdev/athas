use tauri::command;

/// Whether the in-app updater can replace this installation. On Linux only
/// AppImage, deb and rpm installs can update themselves: Flatpak builds are
/// updated by Flatpak, and the tarball (including the Nix package) by whoever
/// installed it.
#[command]
pub fn self_update_supported() -> bool {
   if cfg!(target_os = "linux") {
      return tauri::utils::platform::bundle_type().is_some()
         && !std::path::Path::new("/.flatpak-info").exists();
   }

   true
}
