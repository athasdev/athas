//! How an HTML preview reaches the files next to it. The page is served from a private scheme
//! rooted at the project, so relative links resolve beside the file and root-relative ones (`/x`)
//! from the project root, as the old preview's rewritten `asset:` links did.

use std::path::{Component, Path, PathBuf};

pub const SCHEME: &str = "athas-preview";

/// The folder an HTML file's preview is served from: the project when the file is inside it,
/// else the file's own folder.
/// Text of previewed files open in an editor with changes not saved yet: requests for them are
/// answered with it rather than the file on disk, so the preview follows typing.
static UNSAVED: std::sync::LazyLock<std::sync::Mutex<std::collections::HashMap<PathBuf, Vec<u8>>>> = std::sync::LazyLock::new(Default::default);

/// Sets (or with `None` clears) the text a previewed file is served with.
pub fn set_unsaved(path: &Path, text: Option<Vec<u8>>) {
    if let Ok(mut unsaved) = UNSAVED.lock() {
        match text {
            Some(text) => {
                unsaved.insert(path.to_path_buf(), text);
            }
            None => {
                unsaved.remove(path);
            }
        }
    }
}

/// What a request for `file` is answered with: its unsaved text, else the file.
pub fn read_served(file: &Path) -> Option<Vec<u8>> {
    if let Some(text) = UNSAVED.lock().ok().and_then(|unsaved| unsaved.get(file).cloned()) {
        return Some(text);
    }
    std::fs::read(file).ok()
}

pub fn preview_root(file: &Path, project: Option<&Path>) -> Option<PathBuf> {
    match project {
        Some(project) if file.starts_with(project) => Some(project.to_path_buf()),
        _ => file.parent().map(Path::to_path_buf),
    }
}

fn origin() -> String {
    if cfg!(target_os = "windows") { format!("http://{SCHEME}.localhost") } else { format!("{SCHEME}://localhost") }
}

fn encode_segment(segment: &str) -> String {
    let mut out = String::new();
    for byte in segment.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(byte as char),
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

fn decode(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let hex = std::str::from_utf8(bytes.get(index + 1..index + 3)?).ok()?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            index += 3;
        } else {
            out.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// The address the preview of `file` loads, or `None` when it is outside `root`.
pub fn preview_url(root: &Path, file: &Path) -> Option<String> {
    let relative = file.strip_prefix(root).ok()?;
    let path: Vec<String> = relative
        .components()
        .map(|component| match component {
            Component::Normal(part) => Some(encode_segment(&part.to_string_lossy())),
            _ => None,
        })
        .collect::<Option<_>>()?;
    Some(format!("{}/{}", origin(), path.join("/")))
}

/// Whether a navigation inside the preview stays on its own scheme.
pub fn is_preview_url(url: &str) -> bool {
    url.starts_with(&format!("{}/", origin()))
}

/// The file a request of the preview asks for, kept inside `root`: `..`, absolute parts and links
/// that lead out of it are refused.
pub fn resolve_request(root: &Path, request_path: &str) -> Option<PathBuf> {
    let path = request_path.split(['?', '#']).next().unwrap_or_default();
    let decoded = decode(path.trim_start_matches('/'))?;
    let mut file = root.to_path_buf();
    for segment in decoded.split('/') {
        match segment {
            "" | "." => {}
            ".." => return None,
            part if part.contains('\\') || part.contains(':') => return None,
            part => file.push(part),
        }
    }
    if file.is_dir() {
        file.push("index.html");
    }
    let canonical_root = root.canonicalize().ok()?;
    let canonical = file.canonicalize().ok()?;
    canonical.starts_with(&canonical_root).then_some(canonical)
}

/// The content type a preview file is served with.
pub fn mime_type(path: &Path) -> &'static str {
    let extension = path.extension().and_then(|extension| extension.to_str()).unwrap_or_default().to_ascii_lowercase();
    match extension.as_str() {
        "html" | "htm" => "text/html; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "js" | "mjs" | "cjs" => "text/javascript; charset=utf-8",
        "json" | "map" => "application/json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "ico" => "image/x-icon",
        "bmp" => "image/bmp",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "ogg" => "audio/ogg",
        "wasm" => "application/wasm",
        "txt" | "md" => "text/plain; charset=utf-8",
        "xml" => "application/xml",
        "pdf" => "application/pdf",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serves_from_the_project_or_the_file_folder() {
        let project = Path::new("/work/site");
        assert_eq!(preview_root(Path::new("/work/site/pages/a.html"), Some(project)), Some(project.to_path_buf()));
        assert_eq!(preview_root(Path::new("/tmp/b.html"), Some(project)), Some(PathBuf::from("/tmp")));
        assert_eq!(preview_root(Path::new("/tmp/b.html"), None), Some(PathBuf::from("/tmp")));
    }

    #[test]
    fn addresses_files_under_the_root() {
        let url = preview_url(Path::new("/work/site"), Path::new("/work/site/my pages/index.html")).unwrap();
        assert!(url.ends_with("/my%20pages/index.html"), "{url}");
        assert!(is_preview_url(&url));
        assert!(!is_preview_url("https://athas.dev/"));
        assert_eq!(preview_url(Path::new("/work/site"), Path::new("/etc/hosts")), None);
    }

    #[test]
    fn answers_requests_only_inside_the_root() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("site");
        std::fs::create_dir_all(root.join("css")).unwrap();
        std::fs::write(root.join("index.html"), "<h1>hi</h1>").unwrap();
        std::fs::write(root.join("css/a b.css"), "h1{}").unwrap();
        std::fs::write(dir.path().join("secret.txt"), "no").unwrap();

        assert!(resolve_request(&root, "/css/a%20b.css?v=2").unwrap().ends_with("css/a b.css"));
        assert!(resolve_request(&root, "/").unwrap().ends_with("index.html"));
        assert_eq!(resolve_request(&root, "/../secret.txt"), None);
        assert_eq!(resolve_request(&root, "/%2E%2E/secret.txt"), None);
        assert_eq!(resolve_request(&root, "/missing.html"), None);
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(dir.path().join("secret.txt"), root.join("link.txt")).unwrap();
            assert_eq!(resolve_request(&root, "/link.txt"), None);
        }
    }

    #[test]
    fn serves_web_content_types() {
        assert_eq!(mime_type(Path::new("a.HTML")), "text/html; charset=utf-8");
        assert_eq!(mime_type(Path::new("app.mjs")), "text/javascript; charset=utf-8");
        assert_eq!(mime_type(Path::new("logo.svg")), "image/svg+xml");
        assert_eq!(mime_type(Path::new("blob")), "application/octet-stream");
    }
}
