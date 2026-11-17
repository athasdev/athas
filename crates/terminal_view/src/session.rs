//! Terminals kept across launches (`terminal-session-storage.ts`, the project session's
//! `terminals` and `terminalLayouts`): per project, each terminal's name when the user gave one,
//! the folder it started in, whether it is pinned and its shell, plus the split groups. Restoring
//! starts new shells there; scrollback and running programs are not kept, as in the original.

use std::{collections::BTreeMap, path::PathBuf};

use serde::{Deserialize, Serialize};

use crate::layout::{PaneNode, SplitAxis};

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub(crate) struct PersistedTerminal {
    /// The name the user gave the tab (`customName`); others are named live again.
    pub name: Option<String>,
    pub current_directory: Option<PathBuf>,
    pub is_pinned: bool,
    pub shell: Option<String>,
}

/// A split group with terminals as indices into [`PersistedSession::terminals`].
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub(crate) enum PersistedPane {
    Terminal { index: usize },
    Split { direction: String, sizes: [f32; 2], children: Vec<PersistedPane> },
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub(crate) struct PersistedSession {
    pub terminals: Vec<PersistedTerminal>,
    pub layouts: Vec<PersistedPane>,
    pub active: Option<usize>,
}

impl PersistedPane {
    /// The tree with terminal ids mapped to their indices; `None` when one is not listed.
    pub fn from_node(node: &PaneNode, index_of: &impl Fn(usize) -> Option<usize>) -> Option<Self> {
        Some(match node {
            PaneNode::Leaf(id) => PersistedPane::Terminal { index: index_of(*id)? },
            PaneNode::Split { axis, sizes, children, .. } => PersistedPane::Split {
                direction: match axis {
                    SplitAxis::Horizontal => "right".into(),
                    SplitAxis::Vertical => "down".into(),
                },
                sizes: *sizes,
                children: vec![Self::from_node(&children[0], index_of)?, Self::from_node(&children[1], index_of)?],
            },
        })
    }

    /// The tree for restored terminals (`ids[index]`), split ids left at 0 for the layouts to
    /// number. `None` when it names a terminal that did not come back or is malformed.
    pub fn to_node(&self, ids: &[usize]) -> Option<PaneNode> {
        Some(match self {
            PersistedPane::Terminal { index } => PaneNode::Leaf(*ids.get(*index)?),
            PersistedPane::Split { direction, sizes, children } => {
                let [first, second] = children.as_slice() else { return None };
                let axis = if direction == "down" { SplitAxis::Vertical } else { SplitAxis::Horizontal };
                PaneNode::Split { id: 0, axis, sizes: *sizes, children: Box::new([first.to_node(ids)?, second.to_node(ids)?]) }
            }
        })
    }
}

/// Where the sessions are kept: one JSON file of sessions by project path.
#[derive(Clone, Debug, PartialEq)]
pub struct TerminalSessions {
    path: PathBuf,
}

impl TerminalSessions {
    pub fn new(path: impl Into<PathBuf>) -> Self {
        Self { path: path.into() }
    }

    /// `terminal-sessions.json` beside the workspace state.
    #[cfg(not(target_family = "wasm"))]
    pub fn default_location() -> Option<Self> {
        dirs::data_dir().map(|dir| Self::new(dir.join(paths::APP_ID).join("terminal-sessions.json")))
    }

    fn read_all(&self) -> BTreeMap<String, PersistedSession> {
        std::fs::read_to_string(&self.path).ok().and_then(|text| serde_json::from_str(&text).ok()).unwrap_or_default()
    }

    pub(crate) fn load(&self, project: &str) -> Option<PersistedSession> {
        self.read_all().remove(project).filter(|session| !session.terminals.is_empty())
    }

    pub(crate) fn save(&self, project: &str, session: &PersistedSession) {
        let mut all = self.read_all();
        if session.terminals.is_empty() {
            all.remove(project);
        } else {
            all.insert(project.to_string(), session.clone());
        }
        let Ok(text) = serde_json::to_string_pretty(&all) else { return };
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent).ok();
        }
        let temp = self.path.with_extension("json.tmp");
        if std::fs::write(&temp, text).is_ok() {
            std::fs::rename(&temp, &self.path).ok();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn layouts_round_trip_through_indices() {
        let tree = PaneNode::Split {
            id: 4,
            axis: SplitAxis::Horizontal,
            sizes: [30., 70.],
            children: Box::new([
                PaneNode::Leaf(7),
                PaneNode::Split { id: 5, axis: SplitAxis::Vertical, sizes: [50., 50.], children: Box::new([PaneNode::Leaf(9), PaneNode::Leaf(8)]) },
            ]),
        };
        let order = [7, 8, 9];
        let persisted = PersistedPane::from_node(&tree, &|id| order.iter().position(|other| *other == id)).unwrap();
        assert_eq!(
            serde_json::to_value(&persisted).unwrap()["children"][1]["children"][0],
            serde_json::json!({ "type": "terminal", "index": 2 })
        );
        let restored = persisted.to_node(&[20, 21, 22]).unwrap();
        assert_eq!(restored.terminal_ids(), vec![20, 22, 21]);
        assert!(persisted.to_node(&[20, 21]).is_none());
        assert!(PersistedPane::from_node(&tree, &|id| (id != 9).then_some(0)).is_none());
    }

    #[test]
    fn sessions_are_kept_per_project() {
        let dir = tempfile::tempdir().unwrap();
        let sessions = TerminalSessions::new(dir.path().join("nested/terminal-sessions.json"));
        assert_eq!(sessions.load("/a"), None);
        let session = PersistedSession {
            terminals: vec![
                PersistedTerminal { name: Some("server".into()), current_directory: Some("/a/web".into()), is_pinned: true, shell: Some("/bin/zsh".into()) },
                PersistedTerminal::default(),
            ],
            layouts: vec![PersistedPane::Split {
                direction: "down".into(),
                sizes: [50., 50.],
                children: vec![PersistedPane::Terminal { index: 0 }, PersistedPane::Terminal { index: 1 }],
            }],
            active: Some(1),
        };
        sessions.save("/a", &session);
        sessions.save("/b", &PersistedSession { terminals: vec![PersistedTerminal::default()], ..Default::default() });
        assert_eq!(sessions.load("/a"), Some(session));
        sessions.save("/a", &PersistedSession::default());
        assert_eq!(sessions.load("/a"), None);
        assert!(sessions.load("/b").is_some());
        std::fs::write(dir.path().join("nested/terminal-sessions.json"), "not json").unwrap();
        assert_eq!(sessions.load("/b"), None);
    }
}
