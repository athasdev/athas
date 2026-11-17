//! Which extensions are installed and enabled: `installed.json` next to the extension folders.

use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
};

use anyhow::Result;
use serde::{Deserialize, Serialize};

const STATE_FILE: &str = "installed.json";

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledRecord {
    pub version: String,
    pub enabled: bool,
    /// Seconds since the Unix epoch.
    pub installed_at: u64,
}

#[derive(Clone, Debug, Default)]
pub struct InstalledStore {
    dir: Option<PathBuf>,
    records: BTreeMap<String, InstalledRecord>,
}

impl InstalledStore {
    /// The store under `dir`; a store without a folder keeps its state in memory.
    pub fn load(dir: Option<PathBuf>) -> Self {
        let records = dir
            .as_ref()
            .and_then(|dir| fs::read_to_string(dir.join(STATE_FILE)).ok())
            .and_then(|json| match serde_json::from_str(&json) {
                Ok(records) => Some(records),
                Err(error) => {
                    eprintln!("extensions: could not read {STATE_FILE}: {error}");
                    None
                }
            })
            .unwrap_or_default();
        Self { dir, records }
    }

    pub fn dir(&self) -> Option<&Path> {
        self.dir.as_deref()
    }

    pub fn get(&self, id: &str) -> Option<&InstalledRecord> {
        self.records.get(id)
    }

    pub fn records(&self) -> impl Iterator<Item = (&String, &InstalledRecord)> {
        self.records.iter()
    }

    pub fn is_installed(&self, id: &str) -> bool {
        self.records.contains_key(id)
    }

    pub fn is_enabled(&self, id: &str) -> bool {
        self.records.get(id).is_some_and(|record| record.enabled)
    }

    pub fn insert(&mut self, id: &str, version: &str) -> Result<()> {
        let installed_at = web_time::SystemTime::now()
            .duration_since(web_time::UNIX_EPOCH)
            .map_or(0, |elapsed| elapsed.as_secs());
        self.records.insert(id.to_string(), InstalledRecord { version: version.to_string(), enabled: true, installed_at });
        self.save()
    }

    pub fn remove(&mut self, id: &str) -> Result<()> {
        self.records.remove(id);
        self.save()
    }

    pub fn set_enabled(&mut self, id: &str, enabled: bool) -> Result<()> {
        if let Some(record) = self.records.get_mut(id) {
            record.enabled = enabled;
        }
        self.save()
    }

    fn save(&self) -> Result<()> {
        let Some(dir) = &self.dir else { return Ok(()) };
        fs::create_dir_all(dir)?;
        let temporary = dir.join(format!("{STATE_FILE}.tmp"));
        fs::write(&temporary, serde_json::to_string_pretty(&self.records)?)?;
        fs::rename(&temporary, dir.join(STATE_FILE))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn enable_and_disable_survive_a_reload() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = InstalledStore::load(Some(dir.path().to_path_buf()));
        store.insert("athas.rust", "1.0.0").unwrap();
        store.insert("athas.theme.vercel", "1.0.0").unwrap();
        assert!(store.is_enabled("athas.rust"));

        store.set_enabled("athas.rust", false).unwrap();
        let store = InstalledStore::load(Some(dir.path().to_path_buf()));
        assert!(store.is_installed("athas.rust"));
        assert!(!store.is_enabled("athas.rust"));
        assert!(store.is_enabled("athas.theme.vercel"));

        let mut store = store;
        store.set_enabled("athas.rust", true).unwrap();
        store.remove("athas.theme.vercel").unwrap();
        let store = InstalledStore::load(Some(dir.path().to_path_buf()));
        assert!(store.is_enabled("athas.rust"));
        assert!(!store.is_installed("athas.theme.vercel"));
    }
}
