//! The composer's completions: `@` mentions of files and sessions, and `/` commands the agent
//! offers. Finds what is being typed at the cursor and ranks candidates for it.
//!
//! Ported from Athas's `lib/file-mentions.ts`, `lib/composer-slash-commands.ts` and
//! `components/mentions/ai-file-selector.tsx`.

use std::{ops::Range, path::PathBuf};

/// What the text at the cursor asks to complete.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Trigger {
    /// `@query`: the range covers the `@` and the query.
    Mention { range: Range<usize>, query: String },
    /// `/query` at the start of the prompt or after a space.
    Slash { range: Range<usize>, query: String },
}

impl Trigger {
    pub fn range(&self) -> Range<usize> {
        match self {
            Trigger::Mention { range, .. } | Trigger::Slash { range, .. } => range.clone(),
        }
    }
}

pub fn trigger(text: &str, cursor: usize) -> Option<Trigger> {
    if cursor > text.len() || !text.is_char_boundary(cursor) {
        return None;
    }
    let before = &text[..cursor];
    let start = before.rfind(char::is_whitespace).map_or(0, |index| index + before[index..].chars().next().map_or(1, char::len_utf8));
    let token = &before[start..];
    // Athas looks no further than 500 characters of text for a mention, and stops at 50 typed
    // after the `@` or `/` (`handleInputChange`, `debouncedMentionDetection`).
    if let Some(query) = token.strip_prefix('@')
        && text.chars().count() < 500
        && query.chars().count() < 50
        && !query.contains(']')
    {
        return Some(Trigger::Mention { range: start..cursor, query: query.to_string() });
    }
    // `(?:^|\s)\/([^\s/]*)$`: a command may follow any space, but a second `/` makes it a path.
    if let Some(query) = token.strip_prefix('/')
        && !query.contains('/')
        && query.chars().count() < 50
    {
        return Some(Trigger::Slash { range: start..cursor, query: query.to_string() });
    }
    None
}

/// How well `query` matches `candidate` as a fuzzy subsequence, higher being better; `None` when
/// it does not match. Letters at word starts, runs of letters and matches in the file name count
/// most, and shorter candidates win ties.
pub fn score(query: &str, candidate: &str) -> Option<i64> {
    if query.is_empty() {
        return Some(-(candidate.len() as i64));
    }
    let query: Vec<char> = query.to_lowercase().chars().collect();
    let chars: Vec<char> = candidate.chars().collect();
    let lowered: Vec<char> = candidate.to_lowercase().chars().collect();
    if lowered.len() != chars.len() {
        return None;
    }
    let name_start = chars.iter().rposition(|ch| *ch == '/' || *ch == '\\').map_or(0, |index| index + 1);
    let greedy = |from: usize| -> Option<i64> {
        let mut score = 0i64;
        let mut position = from;
        let mut previous: Option<usize> = None;
        for wanted in &query {
            let found = (position..lowered.len()).find(|index| lowered[*index] == *wanted)?;
            score += 1;
            if previous.is_some_and(|previous| previous + 1 == found) {
                score += 5;
            }
            let boundary = found == 0
                || matches!(chars[found - 1], '/' | '\\' | '.' | '_' | '-' | ' ')
                || (chars[found].is_uppercase() && chars[found - 1].is_lowercase());
            if boundary {
                score += 8;
            }
            previous = Some(found);
            position = found + 1;
        }
        Some(score)
    };
    // A match inside the file name beats one spread over the folders.
    let score = greedy(name_start).map(|score| score + 10 * query.len() as i64).or_else(|| greedy(0))?;
    Some(score * 100 - chars.len() as i64)
}

/// The best `limit` of `candidates` for `query`, best first.
pub fn rank<'a, T>(query: &str, candidates: impl IntoIterator<Item = (&'a str, T)>, limit: usize) -> Vec<T> {
    let mut scored: Vec<(i64, T)> = candidates.into_iter().filter_map(|(text, item)| score(query, text).map(|score| (score, item))).collect();
    scored.sort_by(|a, b| b.0.cmp(&a.0));
    scored.into_iter().take(limit).map(|(_, item)| item).collect()
}

/// Recent files listed before anything is typed, at most (`MAX_RECENT_FILES_NO_QUERY`).
const RECENT_WITHOUT_QUERY: usize = 10;

/// The group of the @-mention menu a file falls in (`FileCategory`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FileGroup {
    Open,
    Recent,
    Files,
}

impl FileGroup {
    /// The heading above the group; the rest of the project has none.
    pub fn heading(self) -> Option<&'static str> {
        match self {
            FileGroup::Open => Some("Open"),
            FileGroup::Recent => Some("Recent"),
            FileGroup::Files => None,
        }
    }
}

/// Project files for an @-mention (`ai-file-selector.tsx`, `use-file-search.ts`): files open in
/// tabs first, then recently opened ones, then the rest, each group ranked for `query`. Before
/// anything is typed recent files keep their frecency order and the rest go by name.
pub fn rank_files<'a>(query: &str, files: &'a [String], open: &[String], recent: &[String], limit: usize) -> Vec<(&'a String, FileGroup)> {
    let group = |file: &String| {
        if open.contains(file) {
            FileGroup::Open
        } else if recent.contains(file) {
            FileGroup::Recent
        } else {
            FileGroup::Files
        }
    };
    let mut ranked = Vec::new();
    for wanted in [FileGroup::Open, FileGroup::Recent, FileGroup::Files] {
        let left = limit.saturating_sub(ranked.len());
        if left == 0 {
            break;
        }
        let members = files.iter().filter(|file| group(file) == wanted);
        let picked: Vec<&String> = if !query.trim().is_empty() {
            rank(query, members.map(|file| (file.as_str(), file)), left)
        } else {
            let mut members: Vec<&String> = members.collect();
            match wanted {
                FileGroup::Open => {}
                FileGroup::Recent => members.sort_by_key(|file| recent.iter().position(|candidate| candidate == *file)),
                FileGroup::Files => members.sort_by_cached_key(|file| file.rsplit('/').next().unwrap_or(file).to_lowercase()),
            }
            members.truncate(if wanted == FileGroup::Recent { left.min(RECENT_WITHOUT_QUERY) } else { left });
            members
        };
        ranked.extend(picked.into_iter().map(|file| (file, wanted)));
    }
    ranked
}

/// Something attached to the next prompt.
#[derive(Clone, Debug, PartialEq)]
pub enum Attachment {
    File(PathBuf),
    /// An earlier session, sent as a summary of its transcript.
    Session { id: String, title: String },
    /// A pasted or dropped image, base64.
    Image { name: String, media_type: String, data: String },
    /// A skill's instructions (`/skill-name`).
    Skill { title: String, content: String },
    /// A folder, Git diff, the Problems list or an editor selection, read into `content`.
    Context { reference: crate::context_refs::ContextRef, label: String, content: String },
}

impl Attachment {
    pub fn label(&self) -> String {
        match self {
            Attachment::File(path) => path.file_name().map_or_else(|| path.display().to_string(), |name| name.to_string_lossy().into_owned()),
            Attachment::Session { title, .. } => title.clone(),
            Attachment::Image { name, .. } => name.clone(),
            Attachment::Skill { title, .. } => title.clone(),
            Attachment::Context { reference, .. } => reference.describe(None).0,
        }
    }
}

/// The media type of an image file, by extension.
pub fn image_media_type(path: &std::path::Path) -> Option<&'static str> {
    let extension = path.extension()?.to_str()?.to_ascii_lowercase();
    Some(match extension.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        _ => return None,
    })
}

/// The MIME type ACP content should carry for the file at `path`, from its extension
/// (`getAcpMimeType`); `None` when the extension says nothing, so the field is left out.
pub fn acp_mime_type(path: &std::path::Path) -> Option<&'static str> {
    let name = path.file_name()?.to_str()?;
    let dot = name.rfind('.')?;
    if dot == 0 {
        return None;
    }
    let extension = name[dot + 1..].to_ascii_lowercase();
    Some(match extension.as_str() {
        "apng" => "image/apng",
        "avif" => "image/avif",
        "bmp" => "image/bmp",
        "gif" => "image/gif",
        "heic" => "image/heic",
        "heif" => "image/heif",
        "ico" => "image/vnd.microsoft.icon",
        "jfif" | "jpeg" | "jpg" | "pjp" | "pjpeg" => "image/jpeg",
        "png" => "image/png",
        "svg" => "image/svg+xml",
        "tif" | "tiff" => "image/tiff",
        "webp" => "image/webp",
        "c" | "h" => "text/x-c",
        "cc" | "cpp" | "hpp" => "text/x-c++",
        "cs" => "text/x-csharp",
        "css" => "text/css",
        "csv" => "text/csv",
        "go" => "text/x-go",
        "htm" | "html" => "text/html",
        "java" => "text/x-java",
        "js" | "jsx" | "mjs" | "cjs" => "text/javascript",
        "json" => "application/json",
        "kt" => "text/x-kotlin",
        "md" | "mdx" => "text/markdown",
        "php" => "text/x-php",
        "py" => "text/x-python",
        "rb" => "text/x-ruby",
        "rs" => "text/x-rust",
        "scss" => "text/x-scss",
        "sh" => "text/x-shellscript",
        "sql" => "text/x-sql",
        "swift" => "text/x-swift",
        "toml" => "application/toml",
        "ts" | "tsx" => "text/x-typescript",
        "txt" => "text/plain",
        "xml" => "application/xml",
        "yaml" | "yml" => "application/yaml",
        "pdf" => "application/pdf",
        "zip" => "application/zip",
        "gz" => "application/gzip",
        "tar" => "application/x-tar",
        "wasm" => "application/wasm",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn acp_mime_types_come_from_the_extension() {
        let mime = |path: &str| acp_mime_type(std::path::Path::new(path));
        assert_eq!(mime("/a/logo.PNG"), Some("image/png"));
        assert_eq!(mime("/a/report.pdf"), Some("application/pdf"));
        assert_eq!(mime("/a/main.rs"), Some("text/x-rust"));
        assert_eq!(mime("/a/Makefile"), None);
        assert_eq!(mime("/a/.env"), None);
        assert_eq!(mime("/a/data.unknownext"), None);
        assert_eq!(mime("/a.dir/file"), None);
    }

    #[test]
    fn finds_what_is_typed_at_the_cursor() {
        assert_eq!(trigger("look at @src/ma", 15), Some(Trigger::Mention { range: 8..15, query: "src/ma".into() }));
        assert_eq!(trigger("@", 1), Some(Trigger::Mention { range: 0..1, query: String::new() }));
        assert_eq!(trigger("mail@example", 12), None);
        assert_eq!(trigger("/rev", 4), Some(Trigger::Slash { range: 0..4, query: "rev".into() }));
        assert_eq!(trigger("say /rev", 8), Some(Trigger::Slash { range: 4..8, query: "rev".into() }));
        assert_eq!(trigger("see /usr/bin", 12), None);
        assert_eq!(trigger("look @a]", 8), None);
        assert_eq!(trigger("é @x", 5), Some(Trigger::Mention { range: 3..5, query: "x".into() }));
    }

    #[test]
    fn ranks_file_names_and_word_starts_first() {
        let files = ["src/session_view.rs", "docs/sessions.md", "src/very/long/path/session_view_tests.rs", "src/view.rs"];
        let ranked = rank("sv", files.iter().map(|file| (*file, *file)), 10);
        assert_eq!(ranked[0], "src/session_view.rs");
        assert!(!ranked.contains(&"docs/sessions.md"));
        assert_eq!(rank("", files.iter().map(|file| (*file, *file)), 1), ["src/view.rs"]);
        assert_eq!(score("xyz", "src/view.rs"), None);
    }

    #[test]
    fn open_files_come_first_then_recent_ones() {
        let files: Vec<String> = ["src/main.rs", "src/lib.rs", "README.md", "a/zeta.rs"].map(String::from).to_vec();
        let open = ["README.md".to_string()];
        let recent = ["src/main.rs".to_string()];
        let ranked = rank_files("", &files, &open, &recent, 3);
        assert_eq!(ranked, [(&files[2], FileGroup::Open), (&files[0], FileGroup::Recent), (&files[1], FileGroup::Files)]);
        let ranked = rank_files("lib", &files, &open, &recent, 8);
        assert_eq!(ranked, [(&files[1], FileGroup::Files)]);
        let ranked = rank_files("rs", &files, &open, &recent, 8);
        assert_eq!(ranked[0], (&files[0], FileGroup::Recent));
        assert_eq!(FileGroup::Recent.heading(), Some("Recent"));
    }

    #[test]
    fn image_files_are_recognized() {
        assert_eq!(image_media_type(std::path::Path::new("/a/shot.PNG")), Some("image/png"));
        assert_eq!(image_media_type(std::path::Path::new("/a/notes.txt")), None);
    }
}
