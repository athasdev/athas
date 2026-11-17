//! The address and zoom of each browser tab, kept across restarts. A tab names its page by id;
//! the page's address changes as it navigates.

use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    sync::{
        Mutex,
        atomic::{AtomicU64, Ordering},
    },
};

use serde::{Deserialize, Serialize};
use web_time::{SystemTime, UNIX_EPOCH};

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct SavedPage {
    pub url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub zoom: Option<f64>,
}

#[derive(Default)]
pub struct PageStore {
    path: Option<PathBuf>,
    pages: BTreeMap<String, SavedPage>,
}

impl PageStore {
    pub fn load(path: Option<PathBuf>) -> Self {
        let pages = path
            .as_deref()
            .and_then(|path| std::fs::read_to_string(path).ok())
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_default();
        Self { path, pages }
    }

    pub fn get(&self, id: &str) -> Option<&SavedPage> {
        self.pages.get(id)
    }

    pub fn update(&mut self, id: &str, change: impl FnOnce(&mut SavedPage)) {
        let page = self.pages.entry(id.to_string()).or_default();
        let before = page.clone();
        change(page);
        if *page != before {
            self.save();
        }
    }

    pub fn forget(&mut self, id: &str) {
        if self.pages.remove(id).is_some() {
            self.save();
        }
    }

    fn save(&self) {
        let Some(path) = &self.path else { return };
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Ok(text) = serde_json::to_string_pretty(&self.pages) {
            let _ = std::fs::write(path, text);
        }
    }
}

#[cfg(not(target_family = "wasm"))]
fn default_path() -> Option<PathBuf> {
    dirs::data_dir().map(|dir| dir.join(paths::APP_ID).join("browser-pages.json"))
}

/// The web build keeps its tabs' pages for the session only.
#[cfg(target_family = "wasm")]
fn default_path() -> Option<PathBuf> {
    None
}

static STORE: Mutex<Option<PageStore>> = Mutex::new(None);

/// Runs `f` with the saved pages, read from disk the first time.
pub fn with_store<T>(f: impl FnOnce(&mut PageStore) -> T) -> T {
    let mut store = STORE.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    f(store.get_or_insert_with(|| PageStore::load(default_path())))
}

/// Uses `path` for the saved pages instead of the app's data folder (tests, snapshots).
pub fn use_store_at(path: Option<&Path>) {
    let mut store = STORE.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    *store = Some(PageStore::load(path.map(Path::to_path_buf)));
}

static NEXT_ID: AtomicU64 = AtomicU64::new(0);

/// An id for a new browser tab, unique across restarts.
pub fn new_page_id() -> String {
    let millis = SystemTime::now().duration_since(UNIX_EPOCH).map(|elapsed| elapsed.as_millis()).unwrap_or_default();
    format!("{millis}-{}", NEXT_ID.fetch_add(1, Ordering::Relaxed))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_each_tab_address_and_zoom_across_restarts() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("browser-pages.json");
        let mut store = PageStore::load(Some(path.clone()));
        store.update("a", |page| page.url = "https://athas.dev/".into());
        store.update("b", |page| {
            page.url = "http://localhost:5173/".into();
            page.zoom = Some(1.25);
        });
        let reloaded = PageStore::load(Some(path.clone()));
        assert_eq!(reloaded.get("a").map(|page| page.url.as_str()), Some("https://athas.dev/"));
        assert_eq!(reloaded.get("b").and_then(|page| page.zoom), Some(1.25));

        let mut store = reloaded;
        store.forget("a");
        assert_eq!(PageStore::load(Some(path)).get("a"), None);
    }

    #[test]
    fn page_ids_do_not_repeat() {
        assert_ne!(new_page_id(), new_page_id());
    }
}
