//! Links in terminal output: web addresses (xterm's web links addon) and file paths with an
//! optional line and column (Athas's `terminal-file-links.ts`), opened with cmd-click.

use std::path::{Path, PathBuf};

const EXTENSIONLESS_FILENAMES: &[&str] =
    &["AGENTS", "Brewfile", "Dockerfile", "Gemfile", "Justfile", "LICENSE", "Makefile", "Procfile", "Rakefile", "README"];

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum LinkTarget {
    Url(String),
    File { path: PathBuf, line: Option<u32>, column: Option<u32> },
}

/// A link on one line of text, by character columns (`end` exclusive).
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Link {
    pub start: usize,
    pub end: usize,
    pub text: String,
    pub target: LinkTarget,
}

impl Link {
    /// What the hover tooltip names: the address, or the file it opens.
    pub fn label(&self) -> String {
        match &self.target {
            LinkTarget::Url(url) => url.clone(),
            LinkTarget::File { .. } => self.text.clone(),
        }
    }

    /// `describeTerminalLinkHint`.
    pub fn hint(&self) -> &'static str {
        match (&self.target, cfg!(target_os = "macos")) {
            (LinkTarget::Url(_), true) => "⌘+click to open link",
            (LinkTarget::Url(_), false) => "Ctrl+click to open link",
            (LinkTarget::File { .. }, true) => "⌘+click to open in editor",
            (LinkTarget::File { .. }, false) => "Ctrl+click to open in editor",
        }
    }
}

/// The links on a line, web addresses first; a file link never overlaps a web one.
pub(crate) fn find_links(line: &str, root: Option<&Path>) -> Vec<Link> {
    let mut links = find_urls(line);
    for link in parse_file_links(line, root) {
        if !links.iter().any(|url| link.start < url.end && url.start < link.end) {
            links.push(link);
        }
    }
    links
}

/// The web addresses xterm's addon underlines: `(https?|HTTPS?)://` up to whitespace or a
/// quote, minus trailing punctuation.
fn find_urls(line: &str) -> Vec<Link> {
    const INNER_STOP: &[char] = &['"', '\'', '!', '*', '(', ')', '{', '}', '|', '\\', '^', '<', '>', '`'];
    const LAST_STOP: &[char] = &['"', '\'', ':', ',', '.', '!', '?', '{', '}', '|', '\\', '^', '~', '[', ']', '`', '(', ')', '<', '>'];
    let chars: Vec<char> = line.chars().collect();
    let mut links = Vec::new();
    let mut index = 0;
    while index < chars.len() {
        let rest: String = chars[index..chars.len().min(index + 8)].iter().collect();
        let scheme = ["https://", "http://", "HTTPS://", "HTTP://"].into_iter().find(|scheme| rest.starts_with(scheme));
        let at_boundary = index == 0 || !chars[index - 1].is_alphanumeric();
        let Some(scheme) = scheme.filter(|_| at_boundary) else {
            index += 1;
            continue;
        };
        let mut end = index + scheme.len();
        while end < chars.len() && !chars[end].is_whitespace() && !INNER_STOP.contains(&chars[end]) {
            end += 1;
        }
        while end > index + scheme.len() && LAST_STOP.contains(&chars[end - 1]) {
            end -= 1;
        }
        if end > index + scheme.len() {
            let text: String = chars[index..end].iter().collect();
            links.push(Link { start: index, end, text: text.clone(), target: LinkTarget::Url(text) });
        }
        index = end.max(index + 1);
    }
    links
}

/// `parseTerminalFileLinks`: every whitespace-separated token that looks like a file path.
pub(crate) fn parse_file_links(line: &str, root: Option<&Path>) -> Vec<Link> {
    let chars: Vec<char> = line.chars().collect();
    let mut links = Vec::new();
    let mut index = 0;
    while index < chars.len() {
        if chars[index].is_whitespace() {
            index += 1;
            continue;
        }
        let token_start = index;
        while index < chars.len() && !chars[index].is_whitespace() {
            index += 1;
        }
        let mut start = token_start;
        let mut end = index;
        while start < end && "`\"'(<[{".contains(chars[start]) {
            start += 1;
        }
        while end > start && "`\"')>]},.;!:".contains(chars[end - 1]) {
            end -= 1;
        }
        if start == end {
            continue;
        }
        let text: String = chars[start..end].iter().collect();
        let (path, line_number, column) = extract_line_column(&text);
        let Some(resolved) = resolve_candidate_path(path, root) else { continue };
        links.push(Link { start, end, text, target: LinkTarget::File { path: resolved, line: line_number, column } });
    }
    links
}

/// `path:line` or `path:line:column` at the end of a token.
fn extract_line_column(text: &str) -> (&str, Option<u32>, Option<u32>) {
    fn trailing_number(text: &str) -> Option<(&str, u32)> {
        let digits = text.len() - text.trim_end_matches(|c: char| c.is_ascii_digit()).len();
        if digits == 0 {
            return None;
        }
        let (rest, number) = text.split_at(text.len() - digits);
        let rest = rest.strip_suffix(':')?;
        Some((rest, number.parse().ok()?))
    }
    match trailing_number(text) {
        Some((rest, last)) => match trailing_number(rest) {
            Some((path, line)) => (path, Some(line), Some(last)),
            None => (rest, Some(last), None),
        },
        None => (text, None, None),
    }
}

fn has_scheme(path: &str) -> Option<&str> {
    let (scheme, _) = path.split_once("://")?;
    let mut chars = scheme.chars();
    let valid = chars.next().is_some_and(|c| c.is_ascii_alphabetic())
        && chars.all(|c| c.is_ascii_alphanumeric() || "+.-".contains(c));
    valid.then_some(scheme)
}

fn is_supported_scheme(scheme: &str) -> bool {
    ["file", "remote", "wsl"].iter().any(|supported| scheme.eq_ignore_ascii_case(supported))
}

fn is_windows_absolute(path: &str) -> bool {
    let bytes = path.as_bytes();
    bytes.len() >= 3 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' && (bytes[2] == b'\\' || bytes[2] == b'/')
}

fn decode_file_uri(path: &str) -> String {
    if !path.get(..7).is_some_and(|scheme| scheme.eq_ignore_ascii_case("file://")) {
        return path.to_string();
    }
    let rest = &path[7..];
    let path_part = match rest.find('/') {
        Some(slash) => &rest[slash..],
        None => return rest.to_string(),
    };
    let decoded = percent_decode(path_part).unwrap_or_else(|| path_part.to_string());
    let bytes = decoded.as_bytes();
    if bytes.len() > 3 && bytes[0] == b'/' && is_windows_absolute(&decoded[1..]) {
        return decoded[1..].to_string();
    }
    decoded
}

fn percent_decode(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let hex = std::str::from_utf8(bytes.get(index + 1..index + 3)?).ok()?;
            decoded.push(u8::from_str_radix(hex, 16).ok()?);
            index += 3;
        } else {
            decoded.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(decoded).ok()
}

fn base_name(path: &str) -> &str {
    path.trim_end_matches(['/', '\\']).rsplit(['/', '\\']).find(|part| !part.is_empty()).unwrap_or("")
}

fn has_path_shape(path: &str) -> bool {
    if has_scheme(path).is_some_and(is_supported_scheme) {
        return true;
    }
    path.starts_with('/') || is_windows_absolute(path) || path.starts_with("./") || path.starts_with("../") || path.contains('/') || path.contains('\\')
}

fn has_file_name_shape(path: &str) -> bool {
    let name = base_name(path);
    if name.is_empty() || name == "." || name == ".." {
        return false;
    }
    name.contains('.') || EXTENSIONLESS_FILENAMES.contains(&name)
}

fn resolve_candidate_path(path: &str, root: Option<&Path>) -> Option<PathBuf> {
    if has_scheme(path).is_some_and(|scheme| !is_supported_scheme(scheme)) {
        return None;
    }
    let decoded = decode_file_uri(path);
    if !has_path_shape(&decoded) || !has_file_name_shape(&decoded) {
        return None;
    }
    let absolute = decoded.starts_with('/') || is_windows_absolute(&decoded) || has_scheme(&decoded).is_some_and(is_supported_scheme);
    if absolute {
        return Some(PathBuf::from(decoded));
    }
    let relative = decoded.strip_prefix("./").unwrap_or(&decoded);
    root.map(|root| root.join(relative))
}

#[cfg(test)]
mod tests {
    #[test]
    fn non_ascii_words_are_not_cut_mid_character() {
        assert_eq!(super::decode_file_uri("çalışıyor"), "çalışıyor");
        assert_eq!(super::decode_file_uri("日本語テキスト"), "日本語テキスト");
    }

    use super::*;

    fn file(path: &str, line: Option<u32>, column: Option<u32>) -> LinkTarget {
        LinkTarget::File { path: path.into(), line, column }
    }

    #[test]
    fn finds_file_links_with_positions() {
        let root = Path::new("/repo");
        let links = parse_file_links("error at src/main.rs:12:5: oops", Some(root));
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].target, file("/repo/src/main.rs", Some(12), Some(5)));
        assert_eq!((links[0].start, links[0].end), (9, 25));

        let links = parse_file_links("(./lib/a.ts:3) and /abs/Makefile, README", Some(root));
        assert_eq!(links[0].target, file("/repo/lib/a.ts", Some(3), None));
        assert_eq!(links[1].target, file("/abs/Makefile", None, None));
        assert_eq!(links.len(), 2);

        assert!(parse_file_links("see notes/todo and 1.5", Some(root)).is_empty());
        assert!(parse_file_links("relative/a.rs", None).is_empty());
        assert!(parse_file_links("ssh://host/a.rs", Some(root)).is_empty());
        assert_eq!(
            parse_file_links("file:///Users/me/My%20File.txt:4", None)[0].target,
            file("/Users/me/My File.txt", Some(4), None)
        );
        assert_eq!(parse_file_links("C:\\src\\app.cs:10", None)[0].target, file("C:\\src\\app.cs", Some(10), None));
    }

    #[test]
    fn finds_web_links() {
        let links = find_links("open https://athas.dev/docs. or (http://x.io/a?b=1) then src/a.rs", Some(Path::new("/r")));
        assert_eq!(links[0].target, LinkTarget::Url("https://athas.dev/docs".into()));
        assert_eq!(links[1].target, LinkTarget::Url("http://x.io/a?b=1".into()));
        assert_eq!(links[2].target, file("/r/src/a.rs", None, None));
        assert_eq!(links.len(), 3);
        assert_eq!(&"open https://athas.dev/docs."[links[0].start..links[0].end], "https://athas.dev/docs");
    }
}
