//! Which GitHub repository a project folder belongs to, read from its git remotes the way
//! `athas-github` resolves it: the current branch's upstream remote first, then `origin`, then the
//! rest.

use std::path::{Path, PathBuf};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RepoSlug {
    pub owner: String,
    pub name: String,
}

impl RepoSlug {
    pub fn full_name(&self) -> String {
        format!("{}/{}", self.owner, self.name)
    }

    pub fn url(&self) -> String {
        format!("https://github.com/{}/{}", self.owner, self.name)
    }
}

/// The project's repository as GitHub knows it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Repository {
    /// The working tree's root; what the API calls are given.
    pub root: PathBuf,
    pub slug: RepoSlug,
    pub branch: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RepoError {
    NotARepository,
    NoGitHubRemote,
}

impl RepoError {
    pub fn title(&self) -> &'static str {
        match self {
            RepoError::NotARepository => "Not a Git repository",
            RepoError::NoGitHubRemote => "No GitHub remote",
        }
    }

    pub fn message(&self) -> &'static str {
        match self {
            RepoError::NotARepository => "Open a folder that contains a .git repository.",
            RepoError::NoGitHubRemote => "None of this repository's remotes points at github.com.",
        }
    }
}

#[cfg(not(target_family = "wasm"))]
/// Blocking: opens the repository with libgit2.
pub fn detect(path: &Path) -> Result<Repository, RepoError> {
    let repository = git2::Repository::discover(path).map_err(|_| RepoError::NotARepository)?;
    let root = repository.workdir().map(Path::to_path_buf).unwrap_or_else(|| path.to_path_buf());
    let names: Vec<String> = repository
        .remotes()
        .map(|remotes| remotes.iter().flatten().map(str::to_string).collect())
        .unwrap_or_default();
    let head = repository.head().ok();
    let branch = head.as_ref().filter(|head| head.is_branch()).and_then(|head| head.shorthand()).map(str::to_string);
    let upstream = branch.as_ref().and_then(|branch| {
        repository.config().ok()?.get_string(&format!("branch.{branch}.remote")).ok().filter(|remote| !remote.trim().is_empty())
    });
    let slug = order_remote_names(names, upstream.as_deref())
        .into_iter()
        .find_map(|name| repository.find_remote(&name).ok()?.url().and_then(parse_github_remote_url))
        .ok_or(RepoError::NoGitHubRemote)?;
    Ok(Repository { root, slug, branch })
}

#[cfg(not(target_family = "wasm"))]
/// Blocking: the local branches, as Athas's `git_branches` lists them.
pub fn local_branches(path: &Path) -> Result<Vec<String>, String> {
    let repository = git2::Repository::discover(path).map_err(|error| format!("Failed to open repository: {error}"))?;
    let branches = repository.branches(Some(git2::BranchType::Local)).map_err(|error| format!("Failed to list branches: {error}"))?;
    Ok(branches.flatten().filter_map(|(branch, _)| branch.name().ok().flatten().map(str::to_string)).collect())
}

/// Blocking: asks the workspace server for the repository's remotes and branch.
#[cfg(target_family = "wasm")]
pub fn detect(path: &Path) -> Result<Repository, RepoError> {
    let info = crate::relay::repository(path.to_string_lossy().into_owned()).ok().flatten().ok_or(RepoError::NotARepository)?;
    let names = info.remotes.iter().map(|remote| remote.name.clone()).collect();
    let slug = order_remote_names(names, info.upstream.as_deref())
        .into_iter()
        .find_map(|name| info.remotes.iter().find(|remote| remote.name == name).and_then(|remote| parse_github_remote_url(&remote.url)))
        .ok_or(RepoError::NoGitHubRemote)?;
    Ok(Repository { root: PathBuf::from(info.root), slug, branch: info.branch })
}

/// Blocking: the workspace server's local branches.
#[cfg(target_family = "wasm")]
pub fn local_branches(_path: &Path) -> Result<Vec<String>, String> {
    let branches = crate::relay::call_method("git.branches", serde_json::json!({}))?;
    Ok(branches["local"].as_array().map(|names| names.iter().filter_map(|name| name.as_str().map(str::to_string)).collect()).unwrap_or_default())
}

/// The base a new pull request starts from: `master`, unless only `main` exists.
pub fn default_base(branches: &[String]) -> String {
    if !branches.iter().any(|branch| branch == "master") && branches.iter().any(|branch| branch == "main") { "main".into() } else { "master".into() }
}

pub fn order_remote_names(names: Vec<String>, upstream: Option<&str>) -> Vec<String> {
    let mut ordered = Vec::with_capacity(names.len());
    if let Some(upstream) = upstream.filter(|upstream| names.iter().any(|name| name == upstream)) {
        ordered.push(upstream.to_string());
    }
    if names.iter().any(|name| name == "origin") && !ordered.iter().any(|name| name == "origin") {
        ordered.push("origin".to_string());
    }
    for name in names {
        if !ordered.contains(&name) {
            ordered.push(name);
        }
    }
    ordered
}

/// `owner/name` from an https, ssh or scp-style github.com remote URL.
pub fn parse_github_remote_url(url: &str) -> Option<RepoSlug> {
    let trimmed = url.trim().trim_end_matches('/');
    let trimmed = trimmed.strip_suffix(".git").unwrap_or(trimmed);
    let path = [
        "git@github.com:",
        "ssh://git@github.com/",
        "https://github.com/",
        "http://github.com/",
        "https://www.github.com/",
        "http://www.github.com/",
    ]
    .iter()
    .find_map(|prefix| trimmed.strip_prefix(prefix))?;
    let mut parts = path.split('/');
    let owner = parts.next()?;
    let name = parts.next()?;
    if parts.next().is_some() || !is_valid_part(owner) || !is_valid_part(name) {
        return None;
    }
    Some(RepoSlug { owner: owner.to_string(), name: name.to_string() })
}

fn is_valid_part(value: &str) -> bool {
    !value.is_empty()
        && value != "."
        && value != ".."
        && value.bytes().all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn slug(owner: &str, name: &str) -> Option<RepoSlug> {
        Some(RepoSlug { owner: owner.into(), name: name.into() })
    }

    #[test]
    fn parses_github_remote_urls() {
        assert_eq!(parse_github_remote_url("https://github.com/athasdev/athas.git"), slug("athasdev", "athas"));
        assert_eq!(parse_github_remote_url("git@github.com:athasdev/athas.git"), slug("athasdev", "athas"));
        assert_eq!(parse_github_remote_url("ssh://git@github.com/athasdev/athas"), slug("athasdev", "athas"));
        assert_eq!(parse_github_remote_url("https://www.github.com/a-b/c.d/"), slug("a-b", "c.d"));
        assert_eq!(parse_github_remote_url(" https://github.com/plyght/athas-plyght \n"), slug("plyght", "athas-plyght"));
    }

    #[test]
    fn rejects_other_hosts_and_odd_paths() {
        assert_eq!(parse_github_remote_url("https://gitlab.com/athasdev/athas.git"), None);
        assert_eq!(parse_github_remote_url("https://github.com/athasdev/athas/extra"), None);
        assert_eq!(parse_github_remote_url("https://github.com/athasdev/..git"), None);
        assert_eq!(parse_github_remote_url("https://github.com/athasdev"), None);
    }

    #[test]
    fn orders_upstream_then_origin_then_the_rest() {
        let names = vec!["fork".to_string(), "origin".to_string(), "upstream".to_string()];
        assert_eq!(order_remote_names(names.clone(), Some("upstream")), ["upstream", "origin", "fork"]);
        assert_eq!(order_remote_names(names.clone(), None), ["origin", "fork", "upstream"]);
        assert_eq!(order_remote_names(names, Some("missing")), ["origin", "fork", "upstream"]);
    }

    #[test]
    fn prefers_master_then_main_as_base() {
        let branches = |names: &[&str]| names.iter().map(|name| name.to_string()).collect::<Vec<_>>();
        assert_eq!(default_base(&branches(&["main", "feature"])), "main");
        assert_eq!(default_base(&branches(&["master", "main"])), "master");
        assert_eq!(default_base(&branches(&["feature"])), "master");
    }

    #[test]
    fn builds_web_urls() {
        let repo = RepoSlug { owner: "athasdev".into(), name: "athas".into() };
        assert_eq!(repo.full_name(), "athasdev/athas");
        assert_eq!(repo.url(), "https://github.com/athasdev/athas");
    }
}
