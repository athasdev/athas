//! File and folder icons from Athas's default icon theme, Pierre Icons (Complete). The SVGs are
//! coloured, so they render through `img()`; each has a variant for light themes.

#[path = "icon_table.rs"]
mod table;

use table::{DEFAULT_FILE, DEFAULT_FOLDER, DEFAULT_FOLDER_OPEN, DEFINITIONS, FILE_EXTENSIONS, FILE_NAMES};

/// The badge drawn over a symlink's icon, tinted like an icon.
pub const SYMLINK_BADGE: &str = "file-icons/symlink-badge.svg";

fn lookup<'a>(table: &'a [(&'a str, &'a str)], key: &str) -> Option<&'a str> {
    table.binary_search_by(|(candidate, _)| (*candidate).cmp(key)).ok().map(|index| table[index].1)
}

/// The theme's icon key for an entry: a whole-name match, then the longest extension.
pub fn icon_key(name: &str, is_dir: bool, expanded: bool) -> &'static str {
    if is_dir {
        return if expanded { DEFAULT_FOLDER_OPEN } else { DEFAULT_FOLDER };
    }
    let name = name.to_lowercase();
    if let Some(key) = lookup(FILE_NAMES, &name) {
        return key;
    }
    // `a.test.ts` tries `.a.test.ts`, `.test.ts`, then `.ts`; a dotfile has no extension.
    if name.starts_with('.') || !name.contains('.') {
        return DEFAULT_FILE;
    }
    lookup(FILE_EXTENSIONS, &format!(".{name}"))
        .or_else(|| name.match_indices('.').find_map(|(index, _)| lookup(FILE_EXTENSIONS, &name[index..])))
        .unwrap_or(DEFAULT_FILE)
}

/// The asset path of an entry's icon.
pub fn icon_path(name: &str, is_dir: bool, expanded: bool, dark: bool) -> String {
    let key = icon_key(name, is_dir, expanded);
    let (dark_file, light_file) = DEFINITIONS
        .iter()
        .find(|(candidate, _, _)| *candidate == key)
        .map(|(_, dark, light)| (*dark, *light))
        .unwrap_or(("file-duo", "file-duo-light"));
    format!("file-icons/{}.svg", if dark { dark_file } else { light_file })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tables_are_sorted_for_lookup() {
        assert!(FILE_NAMES.windows(2).all(|pair| pair[0].0 < pair[1].0));
        assert!(FILE_EXTENSIONS.windows(2).all(|pair| pair[0].0 < pair[1].0));
    }

    #[test]
    fn resolves_names_extensions_and_folders() {
        assert_eq!(icon_key("main.rs", false, false), "lang-rust");
        assert_eq!(icon_key("App.TSX", false, false), "react");
        assert_eq!(icon_key("package.json", false, false), "npm");
        assert_eq!(icon_key("data.json", false, false), "braces");
        assert_eq!(icon_key("Dockerfile", false, false), "docker");
        assert_eq!(icon_key("CLAUDE.md", false, false), "claude");
        assert_eq!(icon_key(".gitignore", false, false), "git");
        assert_eq!(icon_key(".envrc", false, false), "file-duo");
        assert_eq!(icon_key("archive.tar.gz", false, false), "file-zip-duo");
        assert_eq!(icon_key("Cargo.toml", false, false), "file-duo");
        assert_eq!(icon_key("src", true, false), "folder-duo");
        assert_eq!(icon_key("src", true, true), "folder-open-duo");
    }

    #[test]
    fn every_icon_has_an_asset() {
        let assets = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../assets");
        for (key, dark, light) in DEFINITIONS {
            for file in [dark, light] {
                assert!(assets.join(format!("file-icons/{file}.svg")).is_file(), "{key}: {file}");
            }
        }
        assert!(assets.join(SYMLINK_BADGE).is_file());
    }
}
