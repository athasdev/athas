//! The command surfaces: a fuzzy picker in a floating panel, and what it picks from — files and
//! sessions (quick open), commands (the command palette) and themes.

mod command_labels;
mod command_order;
mod command_palette;
mod fuzzy;
mod picker;
mod quick_open;
mod quick_open_sources;
mod recent_files;
#[cfg(not(target_family = "wasm"))]
mod remote_files;
mod row;
mod theme_picker;

pub use command_labels::{palette_label, with_category};
pub use command_order::COMMAND_ORDER;
pub use command_palette::{
    CommandEntry, CommandPaletteDelegate, RecentCommands, SettingEntry, category_filter, recent_commands_path,
};
pub use fuzzy::{FuzzyMatch, fuzzy_match};
pub use picker::{Picker, PickerDelegate, init, modal_layer, shortcut_text};
pub use quick_open::{FileIndexHit, index_files_changed, recent_workspace_files, search_file_index, search_project_files, track_file_access, QuickOpenAgent, QuickOpenDelegate, QuickOpenItem, QuickOpenSession, QuickOpenTab, Section as QuickOpenSection};
pub use quick_open_sources::{
    QuickOpenCommit, QuickOpenGit, QuickOpenGitChange, QuickOpenGitHub, QuickOpenIssue, QuickOpenPullRequest,
};
#[cfg(target_family = "wasm")]
pub use quick_open::set_file_lister;
#[cfg(not(target_family = "wasm"))]
pub use quick_open::{fff_changes, frecency_store_path, use_frecency_store};
#[cfg(not(target_family = "wasm"))]
pub use remote_files::{RemoteFileLister, ignored_entry as quick_open_ignored, set_remote_file_lister};
pub use recent_files::{RecentFile, RecentFiles, recent_files_path};
pub use row::PaletteRow;
pub use theme_picker::{ThemePickerDelegate, theme_preview};
