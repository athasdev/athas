//! Which entries the project's `.gitignore` files ignore, so the tree can dim or hide them
//! (`services/file-tree-gitignore.ts`). Only the ignore files of folders that are loaded count,
//! as in the web tree.

use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
};

use ignore::gitignore::{Gitignore, GitignoreBuilder};

pub const GITIGNORE: &str = ".gitignore";

#[derive(Clone)]
pub struct GitignoreRules {
    root: PathBuf,
    /// One matcher per folder whose `.gitignore` was read.
    matchers: BTreeMap<PathBuf, Gitignore>,
}

impl GitignoreRules {
    pub fn new(root: PathBuf) -> Self {
        Self { root, matchers: BTreeMap::new() }
    }

    /// Sets the rules of `dir`'s `.gitignore`; `None` when it has none.
    pub fn set(&mut self, dir: &Path, contents: Option<&str>) {
        let Some(contents) = contents else {
            self.matchers.remove(dir);
            return;
        };
        let mut builder = GitignoreBuilder::new(dir);
        for line in contents.lines() {
            // A malformed pattern leaves the rest of the file usable.
            let _ = builder.add_line(None, line);
        }
        match builder.build() {
            Ok(matcher) if !matcher.is_empty() => {
                self.matchers.insert(dir.to_path_buf(), matcher);
            }
            _ => {
                self.matchers.remove(dir);
            }
        }
    }

    pub fn forget(&mut self, path: &Path) {
        self.matchers.retain(|dir, _| !dir.starts_with(path));
    }

    /// Whether `path` or a folder above it (below the root) is ignored.
    pub fn is_ignored(&self, path: &Path, is_dir: bool) -> bool {
        if self.matchers.is_empty() {
            return false;
        }
        let Ok(relative) = path.strip_prefix(&self.root) else { return false };
        if relative == Path::new(".git") {
            return false;
        }
        let mut ancestor = self.root.clone();
        let components: Vec<_> = relative.components().collect();
        for component in &components[..components.len().saturating_sub(1)] {
            ancestor.push(component);
            if self.ignored_by_own_rules(&ancestor, true) {
                return true;
            }
        }
        self.ignored_by_own_rules(path, is_dir)
    }

    /// Applies every ignore file above `path`, shallowest first, so deeper files win.
    fn ignored_by_own_rules(&self, path: &Path, is_dir: bool) -> bool {
        let mut matchers: Vec<(&PathBuf, &Gitignore)> =
            self.matchers.iter().filter(|(dir, _)| path.starts_with(dir) && path != dir.as_path()).collect();
        matchers.sort_by_key(|(dir, _)| dir.components().count());
        let mut ignored = false;
        for (_, matcher) in matchers {
            let matched = matcher.matched(path, is_dir);
            if matched.is_ignore() {
                ignored = true;
            } else if matched.is_whitelist() {
                ignored = false;
            }
        }
        ignored
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn root_and_nested_rules() {
        let mut rules = GitignoreRules::new("/p".into());
        rules.set(Path::new("/p"), Some("target/\n*.log\n!keep.log\n"));
        rules.set(Path::new("/p/web"), Some("dist\n"));
        assert!(rules.is_ignored(Path::new("/p/target"), true));
        assert!(!rules.is_ignored(Path::new("/p/target"), false));
        assert!(rules.is_ignored(Path::new("/p/target/debug/x"), false));
        assert!(rules.is_ignored(Path::new("/p/a/b.log"), false));
        assert!(!rules.is_ignored(Path::new("/p/keep.log"), false));
        assert!(rules.is_ignored(Path::new("/p/web/dist"), true));
        assert!(!rules.is_ignored(Path::new("/p/dist"), true));
        assert!(!rules.is_ignored(Path::new("/p/src/main.rs"), false));
    }

    #[test]
    fn git_dir_is_never_dimmed_and_rules_can_go() {
        let mut rules = GitignoreRules::new("/p".into());
        rules.set(Path::new("/p"), Some(".git\nnode_modules\n"));
        assert!(!rules.is_ignored(Path::new("/p/.git"), true));
        assert!(rules.is_ignored(Path::new("/p/node_modules"), true));
        rules.set(Path::new("/p"), None);
        assert!(!rules.is_ignored(Path::new("/p/node_modules"), true));
    }
}
