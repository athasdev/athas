pub mod file_mutations;
pub mod ide_recents;
pub mod ignored_entries;
pub mod local_fs;
pub mod path_guard;
pub mod shell_file_mutations;
mod watcher;

pub use watcher::*;
