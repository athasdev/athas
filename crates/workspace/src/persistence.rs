use std::cell::RefCell;

/// Where the workspace state is kept between runs.
pub trait StateStore {
    fn load(&self) -> Option<String>;
    fn save(&self, json: &str) -> anyhow::Result<()>;
}

/// Keeps the state in memory only: tests, previews and the web build until it has storage.
#[derive(Default)]
pub struct MemoryStore(RefCell<Option<String>>);

impl StateStore for MemoryStore {
    fn load(&self) -> Option<String> {
        self.0.borrow().clone()
    }

    fn save(&self, json: &str) -> anyhow::Result<()> {
        *self.0.borrow_mut() = Some(json.to_string());
        Ok(())
    }
}

/// A JSON file in the app's data folder.
pub struct FileStore {
    path: std::path::PathBuf,
}

impl FileStore {
    pub fn new(path: impl Into<std::path::PathBuf>) -> Self {
        Self { path: path.into() }
    }

    /// `~/Library/Application Support/Athas/workspace.json` and its Windows and Linux equivalents.
    #[cfg(not(target_family = "wasm"))]
    pub fn default_location() -> Option<Self> {
        Self::window_location(MAIN_WINDOW)
    }

    /// Where one window keeps its projects, sessions and tabs, next to `workspace.json`, which
    /// the first window keeps (`workspace-tabs-storage.ts` keys them by window label the same way).
    #[cfg(not(target_family = "wasm"))]
    pub fn window_location(window: &str) -> Option<Self> {
        dirs::data_dir().map(|dir| Self::new(dir.join(paths::APP_ID).join(window_file_name(window))))
    }

    /// Where every window keeps the tabs of the projects it closed.
    #[cfg(not(target_family = "wasm"))]
    pub fn closed_project_tabs_location() -> Option<std::path::PathBuf> {
        dirs::data_dir().map(|dir| dir.join(paths::APP_ID).join("closed-project-tabs.json"))
    }

    /// Forgets the state, for a window closed for good.
    pub fn remove(&self) {
        if let Err(error) = std::fs::remove_file(&self.path)
            && error.kind() != std::io::ErrorKind::NotFound
        {
            eprintln!("workspace: could not remove {}: {error}", self.path.display());
        }
    }
}

/// The window Athas always has; it keeps `workspace.json` from before there were several.
pub const MAIN_WINDOW: &str = "main";

pub fn window_file_name(window: &str) -> String {
    if window == MAIN_WINDOW { "workspace.json".to_string() } else { format!("workspace-{window}.json") }
}

impl StateStore for FileStore {
    fn load(&self) -> Option<String> {
        std::fs::read_to_string(&self.path).ok()
    }

    fn save(&self, json: &str) -> anyhow::Result<()> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let temporary = self.path.with_extension("json.tmp");
        std::fs::write(&temporary, json)?;
        std::fs::rename(&temporary, &self.path)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_window_keeps_a_file_of_its_own() {
        assert_eq!(window_file_name(MAIN_WINDOW), "workspace.json");
        assert_eq!(window_file_name("window-2"), "workspace-window-2.json");
        let dir = tempfile::tempdir().unwrap();
        let store = FileStore::new(dir.path().join(window_file_name("window-2")));
        store.save("{}").unwrap();
        assert_eq!(store.load().as_deref(), Some("{}"));
        store.remove();
        assert_eq!(store.load(), None);
        store.remove();
    }
}
