//! Where a remote file lives: `remote://<connection-id>/<absolute path>` (`services/remote-path.ts`
//! in Athas). Remote hosts use POSIX paths whatever this machine uses, so the path part is always
//! kept with forward slashes.

use std::{
    fmt,
    path::{Path, PathBuf},
};

pub const SCHEME: &str = "remote://";

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct RemotePath {
    pub connection_id: String,
    /// Absolute, `/`-separated, without `.`, `..` or repeated slashes.
    pub path: String,
}

impl RemotePath {
    pub fn new(connection_id: impl Into<String>, path: &str) -> Self {
        Self { connection_id: connection_id.into(), path: normalize(path) }
    }

    /// Reads a `remote://` string. `PathBuf`s made from one come back too: joining on Windows adds
    /// backslashes, and `Path` components drop one of the two slashes after the scheme.
    pub fn parse(value: &str) -> Option<Self> {
        let rest = value.strip_prefix("remote:")?;
        let rest = rest.trim_start_matches(['/', '\\']);
        let end = rest.find(['/', '\\']).unwrap_or(rest.len());
        let (connection_id, path) = rest.split_at(end);
        if connection_id.is_empty() {
            return None;
        }
        Some(Self::new(connection_id, path))
    }

    pub fn from_path(path: &Path) -> Option<Self> {
        Self::parse(path.to_str()?)
    }

    pub fn join(&self, name: &str) -> Self {
        Self::new(self.connection_id.clone(), &format!("{}/{name}", self.path))
    }

    pub fn parent(&self) -> Option<Self> {
        if self.path == "/" {
            return None;
        }
        let end = self.path.rfind('/').unwrap_or(0);
        Some(Self::new(self.connection_id.clone(), &self.path[..end]))
    }

    pub fn file_name(&self) -> Option<&str> {
        self.path.rsplit('/').next().filter(|name| !name.is_empty())
    }

    pub fn to_path_buf(&self) -> PathBuf {
        PathBuf::from(self.to_string())
    }

    /// What a title or a recent-projects row shows: `name:/home/me/app`.
    pub fn display(&self, connection_name: &str) -> String {
        format!("{connection_name}:{}", self.path)
    }
}

impl fmt::Display for RemotePath {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{SCHEME}{}{}", self.connection_id, self.path)
    }
}

pub fn is_remote(path: &str) -> bool {
    path.starts_with("remote:")
}

/// The root of a connection: `remote://<id>/`.
pub fn root(connection_id: &str) -> String {
    format!("{SCHEME}{connection_id}/")
}

/// Makes a remote path absolute and canonical: `\` becomes `/`, empty and `.` parts go, `..` goes
/// up (never above `/`).
pub fn normalize(path: &str) -> String {
    let mut parts: Vec<&str> = Vec::new();
    for part in path.split(['/', '\\']) {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            part => parts.push(part),
        }
    }
    format!("/{}", parts.join("/"))
}

/// Quotes a value for a POSIX shell so it reaches the command verbatim.
pub fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_and_formats() {
        let path = RemotePath::parse("remote://box/home/me/app").unwrap();
        assert_eq!(path.connection_id, "box");
        assert_eq!(path.path, "/home/me/app");
        assert_eq!(path.to_string(), "remote://box/home/me/app");
        assert_eq!(RemotePath::parse("remote://box").unwrap().path, "/");
        assert_eq!(RemotePath::parse("remote://box/").unwrap().to_string(), "remote://box/");
        assert_eq!(root("box"), "remote://box/");
        assert!(RemotePath::parse("remote://").is_none());
        assert!(RemotePath::parse("/home/me").is_none());
        assert!(RemotePath::parse("wsl://Ubuntu/home").is_none());
    }

    #[test]
    fn reads_paths_that_went_through_pathbuf() {
        let joined = PathBuf::from("remote://box/home").join("me");
        assert_eq!(RemotePath::from_path(&joined).unwrap().path, "/home/me");
        assert_eq!(RemotePath::parse("remote:/box/home/me").unwrap(), RemotePath::new("box", "/home/me"));
        assert_eq!(RemotePath::parse(r"remote://box/home\me\src").unwrap().path, "/home/me/src");
        let parent = PathBuf::from("remote://box/home/me");
        assert_eq!(RemotePath::from_path(parent.parent().unwrap()).unwrap().path, "/home");
    }

    #[test]
    fn normalizes() {
        assert_eq!(normalize(""), "/");
        assert_eq!(normalize("home//me/./app/../lib/"), "/home/me/lib");
        assert_eq!(normalize("/../.."), "/");
        let path = RemotePath::new("box", "/srv");
        assert_eq!(path.join("app").path, "/srv/app");
        assert_eq!(path.join("app").parent().unwrap(), path);
        assert_eq!(path.parent().unwrap().path, "/");
        assert!(path.parent().unwrap().parent().is_none());
        assert_eq!(path.file_name(), Some("srv"));
        assert_eq!(path.parent().unwrap().file_name(), None);
        assert_eq!(path.display("Build box"), "Build box:/srv");
    }

    #[test]
    fn shell_quotes() {
        assert_eq!(shell_quote(""), "''");
        assert_eq!(shell_quote("it's"), "'it'\\''s'");
    }

    #[cfg(unix)]
    #[test]
    fn shell_quoted_values_reach_the_shell_verbatim() {
        for value in ["plain", "it's a 'quoted' name", "$(touch /tmp/x) `id` $HOME", "a; rm -rf / && echo"] {
            let output = std::process::Command::new("sh")
                .arg("-c")
                .arg(format!("printf %s {}", shell_quote(value)))
                .output()
                .unwrap();
            assert_eq!(String::from_utf8(output.stdout).unwrap(), value);
        }
    }
}
