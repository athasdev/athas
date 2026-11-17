//! `file:` URIs and paths. `url` converts them only on targets with a native path type; the web
//! build's paths live on the server, which is POSIX, so they are converted by hand there.

use std::path::{Path, PathBuf};

use lsp_types::Url;

pub fn to_path(url: &Url) -> Option<PathBuf> {
    #[cfg(not(target_family = "wasm"))]
    {
        url.to_file_path().ok()
    }
    #[cfg(target_family = "wasm")]
    {
        if url.scheme() != "file" {
            return None;
        }
        let path = percent_encoding::percent_decode_str(url.path()).decode_utf8().ok()?;
        Some(PathBuf::from(path.into_owned()))
    }
}

pub fn from_path(path: &Path) -> Option<Url> {
    #[cfg(not(target_family = "wasm"))]
    {
        Url::from_file_path(path).ok()
    }
    #[cfg(target_family = "wasm")]
    {
        let text = path.to_str()?;
        if !text.starts_with('/') {
            return None;
        }
        let mut url = Url::parse("file:///").ok()?;
        url.set_path(text);
        Some(url)
    }
}

pub fn from_directory(path: &Path) -> Option<Url> {
    #[cfg(not(target_family = "wasm"))]
    {
        Url::from_directory_path(path).ok()
    }
    #[cfg(target_family = "wasm")]
    {
        let mut url = from_path(path)?;
        if !url.path().ends_with('/') {
            let with_slash = format!("{}/", url.path());
            url.set_path(&with_slash);
        }
        Some(url)
    }
}
