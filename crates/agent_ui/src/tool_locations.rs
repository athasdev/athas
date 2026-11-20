//! The files a tool call touches, as a folder tree once there are several.
//!
//! Ported from Athas's `lib/acp-tool-location-tree.ts`.

use std::path::PathBuf;

use crate::thread::Location;

const MAX_LOCATION_ITEMS: usize = 20;
const MAX_PATH_SEGMENTS: usize = 10;

#[derive(Clone, Debug, PartialEq)]
pub enum TreeRow {
    Folder { depth: usize, name: String },
    File { depth: usize, name: String, path: PathBuf, line: Option<u32> },
}

fn segments(path: &str) -> Vec<String> {
    let segments: Vec<String> = path.replace('\\', "/").split('/').filter(|segment| !segment.is_empty()).map(str::to_string).collect();
    if segments.len() <= MAX_PATH_SEGMENTS {
        return segments;
    }
    let mut kept = segments[..4].to_vec();
    kept.push("…".into());
    kept.extend_from_slice(&segments[segments.len() - (MAX_PATH_SEGMENTS - 5)..]);
    kept
}

#[derive(Default)]
struct Branch {
    name: String,
    folders: Vec<Branch>,
    files: Vec<(String, PathBuf, Option<u32>)>,
    /// Folders and files in the order they first appeared.
    order: Vec<(bool, usize)>,
}

impl Branch {
    fn flatten(&self, depth: usize, rows: &mut Vec<TreeRow>) {
        for &(folder, index) in &self.order {
            if folder {
                let branch = &self.folders[index];
                rows.push(TreeRow::Folder { depth, name: branch.name.clone() });
                branch.flatten(depth + 1, rows);
            } else {
                let (name, path, line) = self.files[index].clone();
                rows.push(TreeRow::File { depth, name, path, line });
            }
        }
    }
}

/// The rows of the tree in the order paths first appear, inside `root` relative to it; `None`
/// for fewer than two distinct locations, which read better as one link. At most 20 locations
/// are shown.
pub fn location_tree(locations: &[Location], project: Option<&std::path::Path>) -> Option<Vec<TreeRow>> {
    let mut unique: Vec<&Location> = Vec::new();
    for location in locations {
        if !unique.iter().any(|seen| seen.path == location.path && seen.line == location.line) {
            unique.push(location);
        }
    }
    unique.truncate(MAX_LOCATION_ITEMS);
    if unique.len() < 2 {
        return None;
    }
    let mut root = Branch::default();
    for location in unique {
        let shown = project.and_then(|project| location.path.strip_prefix(project).ok()).unwrap_or(&location.path);
        let parts = segments(&shown.to_string_lossy());
        let Some((file, folders)) = parts.split_last() else { continue };
        let mut branch = &mut root;
        for folder in folders {
            let index = match branch.folders.iter().position(|candidate| candidate.name == *folder) {
                Some(index) => index,
                None => {
                    branch.folders.push(Branch { name: folder.clone(), ..Default::default() });
                    branch.order.push((true, branch.folders.len() - 1));
                    branch.folders.len() - 1
                }
            };
            branch = &mut branch.folders[index];
        }
        branch.files.push((file.clone(), location.path.clone(), location.line));
        branch.order.push((false, branch.files.len() - 1));
    }
    let mut rows = Vec::new();
    root.flatten(0, &mut rows);
    (!rows.is_empty()).then_some(rows)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn location(path: &str, line: Option<u32>) -> Location {
        Location { path: path.into(), line }
    }

    #[test]
    fn several_locations_become_a_tree() {
        assert_eq!(location_tree(&[location("src/a.rs", Some(1)), location("src/a.rs", Some(1))], None), None);
        let root = std::path::Path::new("/p");
        let rows = location_tree(&[location("/p/src/a.rs", Some(3)), location("src/ui/b.rs", None), location("/p/README.md", None), location("src/c.rs", None)], Some(root)).unwrap();
        let shown: Vec<String> = rows
            .iter()
            .map(|row| match row {
                TreeRow::Folder { depth, name } => format!("{depth} {name}/"),
                TreeRow::File { depth, name, line, .. } => format!("{depth} {name}{}", line.map(|line| format!(":{line}")).unwrap_or_default()),
            })
            .collect();
        assert_eq!(shown, ["0 src/", "1 a.rs:3", "1 ui/", "2 b.rs", "1 c.rs", "0 README.md"]);
    }

    #[test]
    fn deep_paths_are_shortened() {
        let parts = segments("/a/b/c/d/e/f/g/h/i/j/k/l.rs");
        assert_eq!(parts.len(), MAX_PATH_SEGMENTS);
        assert_eq!(parts[4], "…");
        assert_eq!(parts.last().map(String::as_str), Some("l.rs"));
    }
}
