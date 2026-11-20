//! Starts Athas when the command finds nothing listening.

use std::{
    io,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{Duration, Instant},
};

use crate::protocol;

const APP_BINARY: &str = if cfg!(windows) { "athas.exe" } else { "athas" };

/// How Athas gets started.
#[derive(Debug, PartialEq)]
pub enum Launcher {
    /// `open -a` on the bundle the command ships in.
    Bundle(PathBuf),
    /// The app binary itself, such as `target/debug/athas` next to `target/debug/athas-cli`.
    Binary(PathBuf),
    /// `open -b <bundle id>`: whichever Athas Launch Services knows.
    BundleId,
}

/// The `.app` that holds `exe` in `Contents/MacOS`.
fn enclosing_bundle(exe: &Path) -> Option<PathBuf> {
    let macos = exe.parent()?;
    let contents = macos.parent()?;
    let bundle = contents.parent()?;
    (macos.file_name()? == "MacOS" && contents.file_name()? == "Contents" && bundle.extension()? == "app")
        .then(|| bundle.to_path_buf())
}

/// Picks how to start Athas for the command at `exe`. `ATHAS_APP` names an app binary or bundle
/// to use instead.
pub fn launcher_for(exe: &Path, app_override: Option<PathBuf>) -> Option<Launcher> {
    if let Some(app) = app_override {
        return Some(if app.extension().is_some_and(|extension| extension == "app") {
            Launcher::Bundle(app)
        } else {
            Launcher::Binary(app)
        });
    }
    if cfg!(target_os = "macos")
        && let Some(bundle) = enclosing_bundle(exe)
    {
        return Some(Launcher::Bundle(bundle));
    }
    let sibling = exe.parent()?.join(APP_BINARY);
    if sibling.is_file() {
        return Some(Launcher::Binary(sibling));
    }
    cfg!(target_os = "macos").then_some(Launcher::BundleId)
}

fn spawn(launcher: &Launcher) -> io::Result<()> {
    let mut command = match launcher {
        Launcher::Bundle(bundle) => {
            let mut command = Command::new("open");
            command.arg("-a").arg(bundle);
            command
        }
        Launcher::BundleId => {
            let mut command = Command::new("open");
            command.args(["-b", crate::BUNDLE_ID]);
            command
        }
        Launcher::Binary(binary) => Command::new(binary),
    };
    command.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    // Ctrl+C in the terminal that ran the command must not take the new Athas down with it.
    #[cfg(unix)]
    std::os::unix::process::CommandExt::process_group(&mut command, 0);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        command.creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP);
    }
    let mut child = command.spawn()?;
    if matches!(launcher, Launcher::Bundle(_) | Launcher::BundleId) {
        // `open` returns once Launch Services has the request; it fails when no app matches.
        let status = child.wait()?;
        if !status.success() {
            return Err(io::Error::new(io::ErrorKind::NotFound, "Launch Services could not find Athas"));
        }
    }
    Ok(())
}

/// Starts Athas and waits until it listens on `socket`.
pub fn launch_and_wait(socket: &Path, timeout: Duration) -> io::Result<()> {
    let exe = std::env::current_exe().and_then(dunce::canonicalize)?;
    let launcher = launcher_for(&exe, std::env::var_os("ATHAS_APP").map(PathBuf::from))
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "could not find the Athas app"))?;
    spawn(&launcher)?;
    let started = Instant::now();
    while started.elapsed() < timeout {
        if protocol::ping(socket) {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    Err(io::Error::new(io::ErrorKind::TimedOut, "Athas did not start in time"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefers_the_override_then_the_bundle_then_the_sibling_binary() {
        let dir = tempfile::tempdir().unwrap();
        let exe = dir.path().join("athas-cli");
        assert_eq!(
            launcher_for(&exe, Some("/Applications/Athas.app".into())),
            Some(Launcher::Bundle("/Applications/Athas.app".into()))
        );
        assert_eq!(launcher_for(&exe, Some("/opt/athas".into())), Some(Launcher::Binary("/opt/athas".into())));

        std::fs::write(dir.path().join(APP_BINARY), "").unwrap();
        assert_eq!(launcher_for(&exe, None), Some(Launcher::Binary(dir.path().join(APP_BINARY))));

        if cfg!(target_os = "macos") {
            let bundled = Path::new("/Applications/Athas.app/Contents/MacOS/athas-cli");
            assert_eq!(launcher_for(bundled, None), Some(Launcher::Bundle("/Applications/Athas.app".into())));
            assert_eq!(launcher_for(Path::new("/nowhere/athas-cli"), None), Some(Launcher::BundleId));
        }
    }
}
