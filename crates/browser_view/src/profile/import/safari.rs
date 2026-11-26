//! Safari's `Cookies.binarycookies`: pages of little-endian records behind a big-endian header.
//! macOS keeps the file inside Safari's container, readable only with Full Disk Access.

use std::path::{Path, PathBuf};

use super::{Browser, Cookie, ImportError, Source, Store};

/// Safari counts time from 2001-01-01.
const MAC_TO_UNIX_EPOCH_SECONDS: f64 = 978_307_200.0;

const FLAG_SECURE: u32 = 0x1;
const FLAG_HTTP_ONLY: u32 = 0x4;

fn cookie_file() -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    Some(home.join("Library/Containers/com.apple.Safari/Data/Library/Cookies/Cookies.binarycookies"))
}

pub(super) fn sources() -> Vec<Source> {
    // The container's folder can be listed without Full Disk Access only to the point of a
    // refusal, so Safari is offered wherever it is installed and the read explains the rest.
    if !Path::new("/Applications/Safari.app").exists() {
        return Vec::new();
    }
    cookie_file()
        .map(|cookies| Source { browser: Browser::Safari, profile: "Default".to_string(), account: None, store: Store::Safari { cookies } })
        .into_iter()
        .collect()
}

pub(super) fn read(path: &Path) -> Result<Vec<Cookie>, ImportError> {
    let bytes = std::fs::read(path).map_err(|error| match error.kind() {
        std::io::ErrorKind::PermissionDenied => ImportError::NeedsFullDiskAccess,
        // An operation the sandbox refuses reads as "not permitted" (EPERM).
        _ if error.raw_os_error() == Some(1) => ImportError::NeedsFullDiskAccess,
        std::io::ErrorKind::NotFound => ImportError::Other("Safari has no saved cookies yet.".to_string()),
        _ => ImportError::Other(format!("Failed to read Safari's cookies: {error}")),
    })?;
    parse(&bytes).ok_or_else(|| ImportError::Other("Safari's cookie file is in a format Athas doesn't know.".to_string()))
}

fn be_u32(bytes: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_be_bytes(bytes.get(at..at + 4)?.try_into().ok()?))
}

fn le_u32(bytes: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_le_bytes(bytes.get(at..at + 4)?.try_into().ok()?))
}

fn le_f64(bytes: &[u8], at: usize) -> Option<f64> {
    Some(f64::from_le_bytes(bytes.get(at..at + 8)?.try_into().ok()?))
}

fn c_string(bytes: &[u8], at: usize) -> Option<String> {
    let tail = bytes.get(at..)?;
    let end = tail.iter().position(|byte| *byte == 0)?;
    String::from_utf8(tail[..end].to_vec()).ok()
}

fn parse(bytes: &[u8]) -> Option<Vec<Cookie>> {
    if bytes.get(..4)? != b"cook" {
        return None;
    }
    let pages = be_u32(bytes, 4)? as usize;
    let mut offset = 8 + pages * 4;
    let mut cookies = Vec::new();
    for index in 0..pages {
        let size = be_u32(bytes, 8 + index * 4)? as usize;
        let page = bytes.get(offset..offset + size)?;
        offset += size;
        let count = le_u32(page, 4)? as usize;
        for record in 0..count {
            let start = le_u32(page, 8 + record * 4)? as usize;
            let length = le_u32(page, start)? as usize;
            let Some(record) = page.get(start..start + length) else { continue };
            if let Some(cookie) = parse_record(record) {
                cookies.push(cookie);
            }
        }
    }
    Some(cookies)
}

fn parse_record(record: &[u8]) -> Option<Cookie> {
    let flags = le_u32(record, 8)?;
    let domain = c_string(record, le_u32(record, 16)? as usize)?;
    let name = c_string(record, le_u32(record, 20)? as usize)?;
    let path = c_string(record, le_u32(record, 24)? as usize)?;
    let value = c_string(record, le_u32(record, 28)? as usize)?;
    let expires = le_f64(record, 40)?;
    Some(Cookie {
        name,
        value,
        domain,
        path: if path.is_empty() { "/".to_string() } else { path },
        expires: (expires > 0.0).then(|| (expires + MAC_TO_UNIX_EPOCH_SECONDS) as i64),
        secure: flags & FLAG_SECURE != 0,
        http_only: flags & FLAG_HTTP_ONLY != 0,
        same_site: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record(domain: &str, name: &str, path: &str, value: &str, flags: u32, expires: f64) -> Vec<u8> {
        let mut strings = Vec::new();
        let mut offsets = Vec::new();
        for text in [domain, name, path, value] {
            offsets.push(56 + strings.len() as u32);
            strings.extend(text.as_bytes());
            strings.push(0);
        }
        let mut record = Vec::new();
        record.extend((56 + strings.len() as u32).to_le_bytes());
        record.extend(1u32.to_le_bytes());
        record.extend(flags.to_le_bytes());
        record.extend(0u32.to_le_bytes());
        for offset in offsets {
            record.extend(offset.to_le_bytes());
        }
        record.extend([0u8; 8]);
        record.extend(expires.to_le_bytes());
        record.extend(0f64.to_le_bytes());
        record.extend(strings);
        record
    }

    #[test]
    fn reads_a_binarycookies_file() {
        let records = [record(".github.com", "user_session", "/", "abc", FLAG_SECURE | FLAG_HTTP_ONLY, 800_000_000.0), record("athas.dev", "theme", "", "dark", 0, 0.0)];
        let mut page = vec![0, 0, 1, 0];
        page.extend((records.len() as u32).to_le_bytes());
        let mut at = 8 + records.len() * 4 + 4;
        for record in &records {
            page.extend((at as u32).to_le_bytes());
            at += record.len();
        }
        page.extend([0u8; 4]);
        for record in &records {
            page.extend(record);
        }
        let mut file = b"cook".to_vec();
        file.extend(1u32.to_be_bytes());
        file.extend((page.len() as u32).to_be_bytes());
        file.extend(page);

        let cookies = parse(&file).unwrap();
        assert_eq!(cookies.len(), 2);
        assert_eq!(cookies[0].domain, ".github.com");
        assert_eq!(cookies[0].value, "abc");
        assert!(cookies[0].secure && cookies[0].http_only);
        assert_eq!(cookies[0].expires, Some(800_000_000 + 978_307_200));
        assert_eq!(cookies[1].path, "/");
        assert_eq!(cookies[1].expires, None);
        assert!(parse(b"nope").is_none());
    }
}
