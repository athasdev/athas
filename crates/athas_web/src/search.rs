//! Project search on the server, shaped as the search panel's pages. The server counts match
//! offsets in UTF-16 units, as the editor's ranges do; the panel wants bytes.

use std::path::{Path, PathBuf};

use anyhow::Result;
use search_panel::{FileMatches, GrepPattern, LineMatch, Page, PathFilter};
use serde_json::json;
use web_protocol::MAX_SEARCH_MATCHES;

use crate::{Transport, absolute, failed};

fn byte_offset(text: &str, utf16: u64) -> u32 {
    let mut units = 0;
    for (byte, character) in text.char_indices() {
        if units >= utf16 {
            return byte as u32;
        }
        units += character.len_utf16() as u64;
    }
    text.len() as u32
}

/// Searches the workspace at `root`; the whole result comes back as one page.
pub fn grep(transport: &dyn Transport, root: &Path, roots: &[PathBuf], pattern: &GrepPattern, filter: &PathFilter) -> Result<Page> {
    if !roots.iter().any(|searched| searched.starts_with(root) || root.starts_with(searched)) {
        return Ok(Page::default());
    }
    let found = transport
        .call(
            "search.content",
            json!({ "query": pattern.pattern, "regex": pattern.is_regex, "caseSensitive": true, "maxResults": MAX_SEARCH_MATCHES }),
        )
        .map_err(failed)?;
    let mut files = Vec::new();
    for result in found["results"].as_array().into_iter().flatten() {
        let Some(relative) = result["path"].as_str() else { continue };
        let path = absolute(root, relative);
        if !roots.iter().any(|searched| path.starts_with(searched)) || (!filter.is_empty() && !filter.matches(relative)) {
            continue;
        }
        let matches: Vec<LineMatch> = result["matches"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|found| {
                let text = found["text"].as_str().unwrap_or_default().to_string();
                let ranges: Vec<(u32, u32)> = found["ranges"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .map(|range| {
                        let offset = |key: &str| byte_offset(&text, range[key].as_u64().unwrap_or(0));
                        (offset("start"), offset("end"))
                    })
                    .collect();
                LineMatch {
                    line: found["line"].as_u64().unwrap_or(1) as u32,
                    column: ranges.first().map_or(0, |(start, _)| *start as usize),
                    text,
                    ranges,
                }
            })
            .collect();
        if !matches.is_empty() {
            files.push(FileMatches { path, relative: relative.to_string(), matches });
        }
    }
    Ok(Page { searched_files: files.len(), searchable_files: files.len(), files, next_offset: 0, regex_error: None })
}
