//! Binary files (`binary/lib/binary-metadata.ts`): sniffing, the type name an extension reads as,
//! WebAssembly sections, and the short hex preview.

use std::{fs::File, io::Read as _, path::Path};

/// Bytes shown per hex dump row.
pub const BYTES_PER_ROW: usize = 16;

/// Extensions that are binary whatever their content.
const BINARY_EXTENSIONS: &[&str] = &[
    "wasm", "exe", "dll", "so", "dylib", "bin", "o", "obj", "a", "lib", "class", "pyc", "pyo", "woff", "woff2", "ttf",
    "otf", "eot", "zip", "tar", "gz", "tgz", "bz2", "xz", "zst", "7z", "rar", "jar", "war", "ear", "iso", "dmg", "msi",
    "dat", "db", "sqlite", "sqlite3", "node", "rlib", "pdb", "wav", "mp3", "mp4", "mov", "ogg", "flac", "avi", "mkv",
    "webm", "psd", "heic", "avif",
];

/// Whether the file reads as binary: a known binary extension, or a NUL byte in its first 8 KiB.
pub fn is_binary(path: &Path) -> bool {
    let extension = path.extension().and_then(|ext| ext.to_str()).unwrap_or_default().to_ascii_lowercase();
    if BINARY_EXTENSIONS.contains(&extension.as_str()) {
        return true;
    }
    let Ok(mut file) = File::open(path) else { return false };
    let mut head = [0u8; 8192];
    let mut read = 0;
    while read < head.len() {
        match file.read(&mut head[read..]) {
            Ok(0) => break,
            Ok(count) => read += count,
            Err(_) => return false,
        }
    }
    looks_binary(&head[..read])
}

/// A NUL byte means binary, except in UTF-16 text, which starts with a byte order mark.
pub fn looks_binary(head: &[u8]) -> bool {
    if head.starts_with(&[0xff, 0xfe]) || head.starts_with(&[0xfe, 0xff]) {
        return false;
    }
    head.contains(&0)
}

pub fn file_type(path: &Path) -> &'static str {
    let extension = path.extension().and_then(|ext| ext.to_str()).unwrap_or_default().to_ascii_lowercase();
    match extension.as_str() {
        "wasm" => "WebAssembly Binary",
        "exe" => "Windows Executable",
        "dll" => "Dynamic Link Library",
        "so" => "Shared Object",
        "dylib" => "Dynamic Library",
        "bin" => "Binary Data",
        "o" | "obj" => "Object File",
        "a" | "lib" | "rlib" => "Static Library",
        "class" => "Java Class File",
        "pyc" => "Python Bytecode",
        "pyo" => "Python Optimized Bytecode",
        "woff" => "Web Open Font Format",
        "woff2" => "Web Open Font Format 2",
        "ttf" => "TrueType Font",
        "otf" => "OpenType Font",
        "eot" => "Embedded OpenType Font",
        "zip" => "ZIP Archive",
        "tar" => "Tape Archive",
        "gz" | "tgz" => "Gzip Compressed",
        "bz2" => "Bzip2 Compressed",
        "xz" => "XZ Compressed",
        "zst" => "Zstandard Compressed",
        "7z" => "7-Zip Archive",
        "rar" => "RAR Archive",
        "jar" => "Java Archive",
        "war" => "Web Application Archive",
        "ear" => "Enterprise Archive",
        "iso" => "Disk Image",
        "dmg" => "macOS Disk Image",
        "msi" => "Windows Installer",
        "db" | "sqlite" | "sqlite3" => "Database",
        _ => "Binary File",
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WasmSection {
    pub id: u8,
    pub name: String,
    pub size: usize,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WasmModule {
    pub version: u32,
    pub sections: Vec<WasmSection>,
}

/// Reads a WebAssembly module's version and section table, or `None` when it is not one.
pub fn parse_wasm(data: &[u8]) -> Option<WasmModule> {
    if data.len() < 8 || &data[..4] != b"\0asm" {
        return None;
    }
    let version = u32::from_le_bytes([data[4], data[5], data[6], data[7]]);
    let mut sections = Vec::new();
    let mut offset = 8;
    while offset < data.len() {
        let id = data[offset];
        offset += 1;
        let mut size = 0usize;
        let mut shift = 0;
        loop {
            let Some(byte) = data.get(offset) else { break };
            offset += 1;
            if shift < usize::BITS {
                size |= ((byte & 0x7f) as usize) << shift;
            }
            shift += 7;
            if byte & 0x80 == 0 {
                break;
            }
        }
        let name = match id {
            0 => "Custom",
            1 => "Type",
            2 => "Import",
            3 => "Function",
            4 => "Table",
            5 => "Memory",
            6 => "Global",
            7 => "Export",
            8 => "Start",
            9 => "Element",
            10 => "Code",
            11 => "Data",
            12 => "Data Count",
            _ => "",
        };
        let name = if name.is_empty() { format!("Unknown ({id})") } else { name.to_string() };
        sections.push(WasmSection { id, name, size });
        offset = offset.saturating_add(size);
    }
    Some(WasmModule { version, sections })
}

/// One hex dump row: the offset, the bytes in two groups of eight, and their printable ASCII.
pub fn hex_row(data: &[u8], row: usize) -> (String, String, String) {
    let start = row * BYTES_PER_ROW;
    let bytes = data.get(start..(start + BYTES_PER_ROW).min(data.len())).unwrap_or_default();
    let mut hex = String::with_capacity(BYTES_PER_ROW * 3 + 1);
    for index in 0..BYTES_PER_ROW {
        if index == 8 {
            hex.push(' ');
        }
        match bytes.get(index) {
            Some(byte) => hex.push_str(&format!("{byte:02x}")),
            None => hex.push_str("  "),
        }
        if index + 1 < BYTES_PER_ROW {
            hex.push(' ');
        }
    }
    let ascii = bytes.iter().map(|&byte| if (0x20..=0x7e).contains(&byte) { byte as char } else { '.' }).collect();
    (format!("{start:08x}"), hex, ascii)
}

pub fn row_count(len: usize) -> usize {
    len.div_ceil(BYTES_PER_ROW)
}

/// Bytes the hex preview shows (`formatHexPreview`'s `maxBytes`).
pub const PREVIEW_BYTES: usize = 256;

/// `formatHexPreview`: the first 256 bytes as `00000000  xx … xx  xx … xx  |ascii|` rows, then
/// "... 1.2 KB more" when the file (`total` bytes) is longer.
pub fn hex_preview(data: &[u8], total: u64) -> String {
    let data = &data[..data.len().min(PREVIEW_BYTES)];
    let mut lines: Vec<String> = (0..row_count(data.len()))
        .map(|row| {
            let (offset, hex, ascii) = hex_row(data, row);
            format!("{offset}  {hex}  |{ascii:<width$}|", width = BYTES_PER_ROW)
        })
        .collect();
    if total > PREVIEW_BYTES as u64 {
        lines.push(format!("... {} more", format_size(total - PREVIEW_BYTES as u64)));
    }
    lines.join("\n")
}

/// "512 B", "1.5 KB", "12.3 MB".
pub fn format_size(bytes: u64) -> String {
    const UNITS: [&str; 4] = ["KB", "MB", "GB", "TB"];
    if bytes < 1024 {
        return format!("{bytes} B");
    }
    let mut value = bytes as f64 / 1024.;
    let mut unit = 0;
    while value >= 1024. && unit + 1 < UNITS.len() {
        value /= 1024.;
        unit += 1;
    }
    let value = format!("{value:.1}");
    format!("{} {}", value.strip_suffix(".0").unwrap_or(&value), UNITS[unit])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_full_and_partial_rows() {
        let data: Vec<u8> = (0x41..0x41 + 20).collect();
        let (offset, hex, ascii) = hex_row(&data, 0);
        assert_eq!(offset, "00000000");
        assert_eq!(hex, "41 42 43 44 45 46 47 48  49 4a 4b 4c 4d 4e 4f 50");
        assert_eq!(ascii, "ABCDEFGHIJKLMNOP");
        let (offset, hex, ascii) = hex_row(&data, 1);
        assert_eq!(offset, "00000010");
        assert_eq!(hex.trim_end(), "51 52 53 54");
        assert_eq!(hex.len(), 48);
        assert_eq!(ascii, "QRST");
        assert_eq!(hex_row(&[0, 0x7f, b' '], 0).2, ".. ");
        assert_eq!(row_count(0), 0);
        assert_eq!(row_count(16), 1);
        assert_eq!(row_count(17), 2);
    }

    #[test]
    fn previews_the_first_256_bytes() {
        let data: Vec<u8> = (0..300u32).map(|byte| (byte % 256) as u8).collect();
        let preview = hex_preview(&data, 300);
        let lines: Vec<&str> = preview.lines().collect();
        assert_eq!(lines.len(), 17);
        assert_eq!(lines[0], "00000000  00 01 02 03 04 05 06 07  08 09 0a 0b 0c 0d 0e 0f  |................|");
        assert_eq!(lines[16], "... 44 B more");
        assert_eq!(hex_preview(b"AB", 2), format!("00000000  41 42{}|AB{}|", " ".repeat(45), " ".repeat(14)));
        assert_eq!(hex_preview(&[], 0), "");
    }

    #[test]
    fn sniffs_nul_bytes_but_not_utf16() {
        assert!(looks_binary(b"ab\0cd"));
        assert!(!looks_binary(b"plain text"));
        assert!(!looks_binary(&[0xff, 0xfe, b'a', 0]));
    }

    #[test]
    fn reads_wasm_sections() {
        let module = [0, b'a', b's', b'm', 1, 0, 0, 0, 1, 2, 0xaa, 0xbb, 10, 0x81, 0x01];
        let parsed = parse_wasm(&module).unwrap();
        assert_eq!(parsed.version, 1);
        assert_eq!(parsed.sections[0], WasmSection { id: 1, name: "Type".into(), size: 2 });
        assert_eq!(parsed.sections[1].name, "Code");
        assert_eq!(parsed.sections[1].size, 129);
        assert!(parse_wasm(b"not wasm").is_none());
    }

    #[test]
    fn names_types_and_sizes() {
        assert_eq!(file_type(Path::new("a/b.WASM")), "WebAssembly Binary");
        assert_eq!(file_type(Path::new("blob")), "Binary File");
        assert_eq!(format_size(512), "512 B");
        assert_eq!(format_size(1536), "1.5 KB");
        assert_eq!(format_size(1024 * 1024), "1 MB");
    }
}
