//! Project search in SSH and WSL roots (`provider-content-search.ts`): the project index only
//! sees local folders, so these roots are searched on their own machine with `rg` (or `grep`
//! where ripgrep is missing) through the remote crates' command runners.

use std::{
    path::{Path, PathBuf},
    sync::{Arc, OnceLock},
};

use anyhow::{Result, bail};
use regex::Regex;

use crate::{
    engine::{FileMatches, LineMatch},
    query::{GrepPattern, PathFilter},
};

/// Matches read per file, and lines kept, so a huge result does not flood the view.
const PER_FILE_MATCHES: usize = 200;
const MAX_LINES: usize = 5000;
/// Longer lines are cut, as the local index does.
const MAX_LINE_BYTES: usize = 2000;

/// A root on another machine.
pub trait RemoteShell: Send + Sync {
    /// The root's folder on that machine.
    fn directory(&self) -> &str;
    /// Runs `script` with `sh` there and returns its output.
    fn run(&self, script: &str) -> Result<Vec<u8>>;
    /// A file's text, for the lines around a match and for replacing.
    fn read(&self, path: &Path) -> Option<String>;
    /// Writes a file's new text there (Replace), atomically where the machine allows.
    fn write(&self, path: &Path, _text: &str) -> Result<()> {
        bail!("Replacing is not supported in {}", path.display())
    }
}

type Resolver = Box<dyn Fn(&Path) -> Option<Arc<dyn RemoteShell>> + Send + Sync>;

static RESOLVER: OnceLock<Resolver> = OnceLock::new();

/// How a root on another machine is reached; the workbench sets it from the `remote` and `wsl`
/// crates.
pub fn set_remote_shells(resolver: impl Fn(&Path) -> Option<Arc<dyn RemoteShell>> + Send + Sync + 'static) {
    let _ = RESOLVER.set(Box::new(resolver));
}

pub(crate) fn shell_for(path: &Path) -> Option<Arc<dyn RemoteShell>> {
    let path_text = path.to_string_lossy();
    if !(path_text.starts_with("remote://") || path_text.starts_with("wsl://")) {
        return None;
    }
    RESOLVER.get().and_then(|resolve| resolve(path))
}

pub(crate) fn is_remote(path: &Path) -> bool {
    let path = path.to_string_lossy();
    path.starts_with("remote://") || path.starts_with("wsl://")
}

fn quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

/// The search run in `directory`, with ripgrep where the machine has it, else grep. No matches is
/// not a failure.
///
/// The query goes as typed, with the toggles as flags (`-F`, `-i`, `-w`), not as the index's
/// pattern: that one is shaped for the index's query parser (`\x20`, `(?i:…)`), which only GNU
/// grep's `-P` reads, and BSD or BusyBox grep have no `-P`. A regex search uses `-P` where grep
/// has it, else `-E`.
pub(crate) fn script(directory: &str, pattern: &GrepPattern) -> String {
    let (query, regex, flags) = match &pattern.typed {
        Some((query, options)) => {
            let mut flags = String::new();
            if !options.case_sensitive {
                flags.push_str(" -i");
            }
            if options.whole_word {
                flags.push_str(" -w");
            }
            (query.as_str(), options.use_regex, flags)
        }
        None => (pattern.pattern.as_str(), pattern.is_regex, String::new()),
    };
    let quoted = quote(query);
    let rg_mode = if regex { "" } else { " -F" };
    let grep_mode = if regex { "$mode" } else { "-F" };
    format!(
        "cd {dir} || exit 2\n\
         if command -v rg >/dev/null 2>&1; then\n  \
         rg --null --line-number --no-heading --color never --no-messages --max-count {PER_FILE_MATCHES}{rg_mode}{flags} -e {quoted} .\n\
         else\n  \
         mode=-E\n  \
         echo x | grep -qP x 2>/dev/null && mode=-P\n  \
         grep -rIHn --null --exclude-dir=.git --exclude-dir=node_modules --max-count={PER_FILE_MATCHES} {grep_mode}{flags} -e {quoted} .\n\
         fi\n\
         status=$?\n\
         [ $status -le 1 ] || exit $status\n",
        dir = quote(directory),
    )
}

/// `path\0line:text` lines, as both tools print them with `--null`.
pub(crate) fn parse(output: &[u8], root: &Path, pattern: &GrepPattern, filter: &PathFilter) -> Vec<FileMatches> {
    let matcher = if pattern.is_regex { Regex::new(&pattern.pattern) } else { Regex::new(&regex::escape(&pattern.pattern)) }.ok();
    let mut files: Vec<FileMatches> = Vec::new();
    for line in output.split(|byte| *byte == b'\n').take(MAX_LINES) {
        let Some(split) = line.iter().position(|byte| *byte == 0) else { continue };
        let relative = String::from_utf8_lossy(&line[..split]);
        let relative = relative.strip_prefix("./").unwrap_or(&relative).to_string();
        let rest = String::from_utf8_lossy(&line[split + 1..]);
        let Some((number, text)) = rest.split_once(':') else { continue };
        let Ok(number) = number.parse::<u32>() else { continue };
        if relative.is_empty() || (!filter.is_empty() && !filter.matches(&relative)) {
            continue;
        }
        let mut text = text.trim_end_matches('\r').to_string();
        if text.len() > MAX_LINE_BYTES {
            text.truncate(text.floor_char_boundary(MAX_LINE_BYTES));
        }
        let ranges: Vec<(u32, u32)> = matcher
            .as_ref()
            .map(|matcher| matcher.find_iter(&text).filter(|found| !found.is_empty()).map(|found| (found.start() as u32, found.end() as u32)).collect())
            .unwrap_or_default();
        let found = LineMatch { line: number, column: ranges.first().map_or(0, |range| range.0 as usize), text, ranges };
        let path = root.join(&relative);
        match files.last_mut() {
            Some(file) if file.path == path => file.matches.push(found),
            _ => files.push(FileMatches { path, relative, matches: vec![found] }),
        }
    }
    files
}

/// Searches every root on another machine; the first failure is the result when nothing matched.
pub(crate) fn grep(roots: &[PathBuf], pattern: &GrepPattern, filter: &PathFilter) -> Result<Vec<FileMatches>> {
    let mut files = Vec::new();
    let mut failure = None;
    for root in roots.iter().filter(|root| is_remote(root)) {
        let Some(shell) = shell_for(root) else {
            failure = Some(anyhow::anyhow!("{} is not connected", root.display()));
            continue;
        };
        match shell.run(&script(shell.directory(), pattern)) {
            Ok(output) => files.extend(parse(&output, root, pattern, filter)),
            Err(error) => failure = Some(error),
        }
    }
    match failure {
        Some(error) if files.is_empty() => bail!("Search failed: {error:#}"),
        _ => Ok(files),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::query::{SearchOptions, grep_pattern};

    #[test]
    fn parses_tool_output_into_files() {
        let pattern = grep_pattern("needle", SearchOptions::default());
        let output = b"./src/a.rs\x003:let needle = Needle;\r\n./src/a.rs\x009:none\n./b.txt\x001:a needle\nnoise\n";
        let files = parse(output, Path::new("remote://box/srv/app"), &pattern, &PathFilter::new("", ""));
        assert_eq!(files.len(), 2);
        assert_eq!(files[0].path, PathBuf::from("remote://box/srv/app/src/a.rs"));
        assert_eq!(files[0].relative, "src/a.rs");
        assert_eq!(files[0].matches[0], LineMatch { line: 3, column: 4, text: "let needle = Needle;".into(), ranges: vec![(4, 10), (13, 19)] });
        assert_eq!(files[0].matches[1].line, 9);
        let filtered = parse(output, Path::new("remote://box/srv/app"), &pattern, &PathFilter::new("src/**", ""));
        assert_eq!(filtered.len(), 1);
    }

    #[test]
    fn quotes_the_pattern_and_folder() {
        let literal = GrepPattern { pattern: "it's".into(), is_regex: false, typed: None };
        let script = script("/srv/my app", &literal);
        assert!(script.starts_with("cd '/srv/my app' || exit 2\n"));
        assert!(script.contains("rg --null") && script.contains(" -F -e 'it'\\''s' ."));
        assert!(script.contains("grep -rIHn --null") && script.contains("-F -e 'it'\\''s' ."));
        let regex = GrepPattern { pattern: "(?i:a+)".into(), is_regex: true, typed: None };
        assert!(script_contains(&regex, "$mode -e '(?i:a+)'"));
    }

    #[test]
    fn sends_the_query_as_typed_with_the_toggles_as_flags() {
        // Plain text with spaces, case-insensitive: fixed strings and `-i`, not `\x20` or `(?i:…)`.
        let plain = grep_pattern("a  b", SearchOptions::default());
        assert!(script_contains(&plain, " -F -i -e 'a  b' ."));
        assert!(!script_contains(&plain, "\\x20"));
        let word = grep_pattern("foo", SearchOptions { case_sensitive: true, whole_word: true, use_regex: false });
        assert!(script_contains(&word, " -F -w -e 'foo' ."));
        let regex = grep_pattern("fo+", SearchOptions { case_sensitive: true, whole_word: false, use_regex: true });
        assert!(script_contains(&regex, "$mode -e 'fo+' ."));
    }

    fn script_contains(pattern: &GrepPattern, needle: &str) -> bool {
        script("/srv", pattern).contains(needle)
    }

    #[cfg(unix)]
    #[test]
    fn runs_against_a_local_shell() {
        struct Local(String);
        impl RemoteShell for Local {
            fn directory(&self) -> &str {
                &self.0
            }
            fn run(&self, script: &str) -> Result<Vec<u8>> {
                let output = std::process::Command::new("sh").arg("-c").arg(script).output()?;
                if !output.status.success() {
                    bail!("{}", String::from_utf8_lossy(&output.stderr));
                }
                Ok(output.stdout)
            }
            fn read(&self, _: &Path) -> Option<String> {
                None
            }
        }
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("src")).unwrap();
        std::fs::write(dir.path().join("src/a.txt"), "one\nfind me\n").unwrap();
        std::fs::write(dir.path().join("b.txt"), "nothing\n").unwrap();
        let shell = Local(dir.path().to_string_lossy().into_owned());
        let pattern = grep_pattern("find", SearchOptions { case_sensitive: true, ..Default::default() });
        let output = shell.run(&script(shell.directory(), &pattern)).unwrap();
        let files = parse(&output, Path::new("wsl://Ubuntu/home/me"), &pattern, &PathFilter::new("", ""));
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].relative, "src/a.txt");
        assert_eq!(files[0].matches[0].line, 2);
        let none = shell.run(&script(shell.directory(), &grep_pattern("absent", SearchOptions { case_sensitive: true, ..Default::default() }))).unwrap();
        assert!(none.is_empty());
    }
}
