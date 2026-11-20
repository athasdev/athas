//! Replacing matches in files on disk: one match at the line and column the search reported, or
//! every match in a set of files. Local files go through `athas_project`'s checked writer.

use std::{
    fs,
    path::{Path, PathBuf},
};

use anyhow::{Context as _, Result, bail};
use regex::{NoExpand, Regex};

/// Replaces the match that starts at `column` (a byte offset) on the 1-based `line`. In regex
/// mode the replacement expands `$1` and `${name}`. Returns `None` when no match starts there
/// anymore, because the file changed since the search.
pub fn replace_one(
    content: &str,
    regex: &Regex,
    replacement: &str,
    expand: bool,
    line: u32,
    column: usize,
) -> Option<String> {
    let line_start = line_offset(content, line)?;
    // The search matched within one line; so does the replacement. Over the whole file `\s+$`
    // or `[^;]*` would reach into the next lines and delete their line breaks.
    let rest = &content[line_start..];
    let line_len = rest.find('\n').map_or(rest.len(), |end| if rest[..end].ends_with('\r') { end - 1 } else { end });
    let body = &rest[..line_len];
    if column > body.len() || !body.is_char_boundary(column) {
        return None;
    }
    let captures = regex.captures_at(body, column)?;
    let found = captures.get(0)?;
    if found.start() != column {
        return None;
    }
    let (start, end) = (line_start + found.start(), line_start + found.end());
    let mut replaced = String::with_capacity(content.len() + replacement.len());
    replaced.push_str(&content[..start]);
    if expand {
        captures.expand(replacement, &mut replaced);
    } else {
        replaced.push_str(replacement);
    }
    replaced.push_str(&content[end..]);
    Some(replaced)
}

/// Replaces every match, returning the new text and how many matches were replaced. Line by line,
/// as the search found them: a match never takes a line break, so `\s+$` trims lines instead of
/// joining them.
pub fn replace_all(content: &str, regex: &Regex, replacement: &str, expand: bool) -> (String, usize) {
    let mut out = String::with_capacity(content.len());
    let mut count = 0;
    for segment in content.split_inclusive('\n') {
        let (body, ending) = match segment.strip_suffix("\r\n") {
            Some(body) => (body, "\r\n"),
            None => match segment.strip_suffix('\n') {
                Some(body) => (body, "\n"),
                None => (segment, ""),
            },
        };
        let matches = regex.find_iter(body).count();
        if matches == 0 {
            out.push_str(segment);
            continue;
        }
        count += matches;
        if expand {
            out.push_str(&regex.replace_all(body, replacement));
        } else {
            out.push_str(&regex.replace_all(body, NoExpand(replacement)));
        }
        out.push_str(ending);
    }
    if count == 0 {
        return (content.to_string(), 0);
    }
    (out, count)
}

fn line_offset(content: &str, line: u32) -> Option<usize> {
    if line == 0 {
        return None;
    }
    if line == 1 {
        return Some(0);
    }
    content.match_indices('\n').nth(line as usize - 2).map(|(index, _)| index + 1)
}

/// Writes `contents` next to `path` and renames it over the file, keeping its permissions. A
/// symlink is resolved first so the link itself survives.
#[cfg(target_family = "wasm")]
fn write_atomic(path: &Path, contents: &[u8]) -> std::io::Result<()> {
    let target = fs::canonicalize(path)?;
    let permissions = fs::metadata(&target)?.permissions();
    let directory = target.parent().ok_or_else(|| std::io::Error::other("the file has no parent folder"))?;
    let name = target.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default();
    let temp = directory.join(format!(".{name}.athas-replace-{}", std::process::id()));
    let result = fs::write(&temp, contents)
        .and_then(|()| fs::set_permissions(&temp, permissions))
        .and_then(|()| fs::rename(&temp, &target));
    if result.is_err() {
        fs::remove_file(&temp).ok();
    }
    result
}

fn read_text(path: &Path) -> Result<String> {
    #[cfg(not(target_family = "wasm"))]
    if crate::remote::is_remote(path) {
        let shell = crate::remote::shell_for(path).with_context(|| format!("{} is not reachable", path.display()))?;
        return shell.read(path).with_context(|| format!("Could not read {}", path.display()));
    }
    let bytes = fs::read(path).with_context(|| format!("reading {}", path.display()))?;
    String::from_utf8(bytes).map_err(|_| anyhow::anyhow!("{} is not UTF-8 text", path.display()))
}

/// Replaces the match at `line`/`column` in `path`.
pub fn replace_in_file(
    path: &Path,
    regex: &Regex,
    replacement: &str,
    expand: bool,
    line: u32,
    column: usize,
) -> Result<()> {
    let content = read_text(path)?;
    let Some(replaced) = replace_one(&content, regex, replacement, expand, line, column) else {
        bail!("{} changed since the search. Search again before replacing.", path.display());
    };
    write_text(path, &replaced, &content)
}

/// Writes the replaced text: on this machine through `athas_project`'s checked writer, so a file
/// changed since it was read is refused and a symlink, BOM and permissions survive
/// (`writeText(path, content, source.content)`); through the root's shell on another.
fn write_text(path: &Path, text: &str, expected: &str) -> Result<()> {
    #[cfg(not(target_family = "wasm"))]
    if crate::remote::is_remote(path) {
        let shell = crate::remote::shell_for(path).with_context(|| format!("{} is not reachable", path.display()))?;
        return shell.write(path, text).with_context(|| format!("writing {}", path.display()));
    }
    #[cfg(not(target_family = "wasm"))]
    {
        let digest = athas_project::local_fs::ExpectedFileDigest::of(expected);
        athas_project::local_fs::write_text_checked(path, Some(digest), text.to_string()).map_err(|error| anyhow::anyhow!("writing {}: {error}", path.display()))
    }
    #[cfg(target_family = "wasm")]
    {
        let _ = expected;
        write_atomic(path, text.as_bytes()).with_context(|| format!("writing {}", path.display()))
    }
}

/// What a Replace All did.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ReplaceReport {
    pub replacements: usize,
    pub files: usize,
    /// The first failure; files before it were replaced.
    pub error: Option<String>,
}

/// Replaces every match in each file, stopping at the first file that cannot be read or written.
pub fn replace_in_files(paths: &[PathBuf], regex: &Regex, replacement: &str, expand: bool) -> ReplaceReport {
    let mut report = ReplaceReport::default();
    for path in paths {
        let result = read_text(path).and_then(|content| {
            let (replaced, count) = replace_all(&content, regex, replacement, expand);
            if count > 0 {
                write_text(path, &replaced, &content)?;
            }
            Ok(count)
        });
        match result {
            Ok(0) => {}
            Ok(count) => {
                report.replacements += count;
                report.files += 1;
            }
            Err(error) => {
                report.error = Some(error.to_string());
                break;
            }
        }
    }
    report
}

#[cfg(test)]
mod tests {
    #[test]
    fn regex_replace_stays_within_lines() {
        let regex = regex::RegexBuilder::new(r"\s+$").multi_line(true).build().unwrap();
        assert_eq!(super::replace_all("a  \n  \n\nb", &regex, "", false), ("a\n\n\nb".to_string(), 2));
        assert_eq!(super::replace_one("x  \n\n", &regex, "", false, 1, 1).as_deref(), Some("x\n\n"));
        assert_eq!(super::replace_all("a \r\nb", &regex, "", false).0, "a\r\nb");
    }

    use super::*;
    use crate::query::{SearchOptions, replacement_regex};

    fn regex(query: &str, use_regex: bool) -> Regex {
        replacement_regex(query, SearchOptions { case_sensitive: true, whole_word: false, use_regex }).unwrap()
    }

    #[test]
    fn replaces_only_the_targeted_match() {
        let content = "foo foo\nbar foo\n";
        let replaced = replace_one(content, &regex("foo", false), "baz", false, 2, 4).unwrap();
        assert_eq!(replaced, "foo foo\nbar baz\n");
        let replaced = replace_one(content, &regex("foo", false), "baz", false, 1, 4).unwrap();
        assert_eq!(replaced, "foo baz\nbar foo\n");
    }

    #[test]
    fn refuses_a_target_that_moved() {
        let content = "foo\nbar\n";
        assert!(replace_one(content, &regex("foo", false), "x", false, 2, 0).is_none());
        assert!(replace_one(content, &regex("foo", false), "x", false, 9, 0).is_none());
        assert!(replace_one(content, &regex("foo", false), "x", false, 1, 1).is_none());
    }

    #[test]
    fn expands_groups_only_in_regex_mode() {
        let content = "name: athas\n";
        let (replaced, count) = replace_all(content, &regex(r"name: (\w+)", true), "id=${1}!", true);
        assert_eq!((replaced.as_str(), count), ("id=athas!\n", 1));
        let (replaced, _) = replace_all("a.b", &regex("a.b", false), "$0", false);
        assert_eq!(replaced, "$0");
    }

    #[test]
    fn counts_every_replacement() {
        let (replaced, count) = replace_all("aXbXc", &regex("X", false), "--", false);
        assert_eq!((replaced.as_str(), count), ("a--b--c", 2));
        assert_eq!(replace_all("abc", &regex("X", false), "-", false).1, 0);
    }

    #[test]
    fn rewrites_files_atomically_and_reports() {
        let dir = tempfile::tempdir().unwrap();
        let first = dir.path().join("a.txt");
        let second = dir.path().join("b.txt");
        let untouched = dir.path().join("c.txt");
        fs::write(&first, "needle needle\n").unwrap();
        fs::write(&second, "a needle\n").unwrap();
        fs::write(&untouched, "nothing\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt as _;
            fs::set_permissions(&first, fs::Permissions::from_mode(0o755)).unwrap();
        }

        let paths = vec![first.clone(), second.clone(), untouched.clone()];
        let report = replace_in_files(&paths, &regex("needle", false), "pin", false);
        assert_eq!(report, ReplaceReport { replacements: 3, files: 2, error: None });
        assert_eq!(fs::read_to_string(&first).unwrap(), "pin pin\n");
        assert_eq!(fs::read_to_string(&second).unwrap(), "a pin\n");
        assert_eq!(fs::read_to_string(&untouched).unwrap(), "nothing\n");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt as _;
            assert_eq!(fs::metadata(&first).unwrap().permissions().mode() & 0o777, 0o755);
        }
        let leftovers = fs::read_dir(dir.path()).unwrap().count();
        assert_eq!(leftovers, 3);

        replace_in_file(&second, &regex("pin", false), "needle", false, 1, 2).unwrap();
        assert_eq!(fs::read_to_string(&second).unwrap(), "a needle\n");
        assert!(replace_in_file(&second, &regex("pin", false), "x", false, 1, 2).is_err());
    }

    #[cfg(not(target_family = "wasm"))]
    #[test]
    fn replaces_in_remote_roots_through_their_shell() {
        use std::sync::Arc;
        struct Mapped(PathBuf);
        impl Mapped {
            fn local(&self, path: &Path) -> PathBuf {
                self.0.join(path.to_string_lossy().trim_start_matches("remote://box/srv/"))
            }
        }
        impl crate::RemoteShell for Mapped {
            fn directory(&self) -> &str {
                "/srv"
            }
            fn run(&self, _: &str) -> Result<Vec<u8>> {
                Ok(Vec::new())
            }
            fn read(&self, path: &Path) -> Option<String> {
                fs::read_to_string(self.local(path)).ok()
            }
            fn write(&self, path: &Path, text: &str) -> Result<()> {
                Ok(fs::write(self.local(path), text)?)
            }
        }
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("a.rs"), "let old = old;\n").unwrap();
        let root = dir.path().to_path_buf();
        crate::set_remote_shells(move |_| Some(Arc::new(Mapped(root.clone())) as Arc<dyn crate::RemoteShell>));
        let file = PathBuf::from("remote://box/srv/a.rs");
        replace_in_file(&file, &regex("old", false), "new", false, 1, 4).unwrap();
        assert_eq!(fs::read_to_string(dir.path().join("a.rs")).unwrap(), "let new = old;\n");
        let report = replace_in_files(&[file], &regex("old", false), "new", false);
        assert_eq!(report, ReplaceReport { replacements: 1, files: 1, error: None });
        assert_eq!(fs::read_to_string(dir.path().join("a.rs")).unwrap(), "let new = new;\n");
    }

    #[test]
    fn stops_at_a_file_that_is_not_text() {
        let dir = tempfile::tempdir().unwrap();
        let binary = dir.path().join("bin");
        fs::write(&binary, [0xff, 0xfe, 0x00]).unwrap();
        let report = replace_in_files(&[binary], &regex("x", false), "y", false);
        assert!(report.error.is_some());
    }
}
