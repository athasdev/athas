//! One-time hints shown the first time a feature comes up (`contextual-teaching.ts`).

use std::{
    collections::BTreeSet,
    path::{Path, PathBuf},
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ContextualTip {
    AgentQueueControls,
    GlobalSearchShortcut,
}

impl ContextualTip {
    fn id(self) -> &'static str {
        match self {
            ContextualTip::AgentQueueControls => "agent-queue-controls",
            ContextualTip::GlobalSearchShortcut => "global-search-shortcut",
        }
    }
}

#[cfg(not(target_family = "wasm"))]
fn tips_path() -> Option<PathBuf> {
    dirs::data_dir().map(|dir| dir.join(paths::APP_ID).join("contextual-tips.json"))
}

#[cfg(target_family = "wasm")]
fn tips_path() -> Option<PathBuf> {
    None
}

/// Whether to show `tip` now: true the first time only, after which it is remembered as seen.
pub fn claim_contextual_tip(tip: ContextualTip) -> bool {
    tips_path().is_some_and(|path| claim_in(&path, tip))
}

/// [`claim_contextual_tip`] against the seen list kept at `path`. A list that cannot be read or
/// written shows nothing, as the original does when storage throws.
pub fn claim_in(path: &Path, tip: ContextualTip) -> bool {
    let mut seen: BTreeSet<String> = match std::fs::read_to_string(path) {
        Ok(text) => match serde_json::from_str(&text) {
            Ok(seen) => seen,
            Err(_) => return false,
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => BTreeSet::new(),
        Err(_) => return false,
    };
    if !seen.insert(tip.id().to_string()) {
        return false;
    }
    let Ok(json) = serde_json::to_string(&seen) else { return false };
    path.parent().is_some_and(|parent| std::fs::create_dir_all(parent).is_ok()) && std::fs::write(path, json).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_tip_is_claimed_once() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("tips.json");
        assert!(claim_in(&path, ContextualTip::GlobalSearchShortcut));
        assert!(!claim_in(&path, ContextualTip::GlobalSearchShortcut));
        assert!(claim_in(&path, ContextualTip::AgentQueueControls));
        std::fs::write(&path, "not json").unwrap();
        assert!(!claim_in(&path, ContextualTip::AgentQueueControls));
    }
}
