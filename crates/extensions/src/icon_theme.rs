//! File icon themes: the built-in Pierre themes and the ones installed extensions contribute
//! (`extension-contribution-runtime.ts`, `toIconThemeDefinition`).

use std::{collections::HashMap, path::Path, sync::Arc};

use gpui::{Image, ImageFormat, ImageSource, Resource};

use crate::manifest::{ExtensionManifest, IconThemeContribution};

const PIERRE_MANIFEST: &str = include_str!("../../../assets/extensions/pierre/extension.json");

/// The icon theme Athas uses unless the user picks another (`settings.iconTheme`).
pub const DEFAULT_ICON_THEME: &str = "pierre-icons-complete";

/// Where an icon theme's relative icon paths point.
pub enum IconRoot<'a> {
    /// Asset paths built into the app.
    Embedded,
    /// An installed extension's folder.
    Folder(&'a Path),
}

pub struct IconTheme {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub extension_id: String,
    /// Built into Athas rather than installed.
    pub bundled: bool,
    /// The file (or folder, when the flag is set) the theme's picker preview shows.
    pub preview: Option<(String, bool)>,
    dark: HashMap<String, ImageSource>,
    light: HashMap<String, ImageSource>,
    file_extensions: HashMap<String, String>,
    filenames: HashMap<String, String>,
    folders: HashMap<String, String>,
    expanded_folders: HashMap<String, String>,
    default_file: Option<String>,
    default_folder: Option<String>,
    default_folder_open: Option<String>,
}

fn lowercase_keys(map: &std::collections::BTreeMap<String, String>, with_dot: bool) -> HashMap<String, String> {
    map.iter()
        .map(|(key, value)| {
            let key = if with_dot && !key.starts_with('.') { format!(".{key}") } else { key.clone() };
            (key.to_lowercase(), value.clone())
        })
        .collect()
}

/// An icon definition: inline `<svg>` markup, a URL, or a path inside the theme's root.
fn resolve(definition: &str, root: &IconRoot) -> Option<ImageSource> {
    let definition = definition.trim();
    if definition.starts_with("<svg") || definition.starts_with("<?xml") {
        return Some(ImageSource::Image(Arc::new(Image::from_bytes(ImageFormat::Svg, definition.as_bytes().to_vec()))));
    }
    if definition.starts_with("https://") || definition.starts_with("http://") {
        return Some(ImageSource::Resource(Resource::Uri(definition.to_string().into())));
    }
    let relative = definition.strip_prefix("./").unwrap_or(definition);
    if relative.split(['/', '\\']).any(|part| part == "..") || relative.starts_with('/') {
        return None;
    }
    match root {
        IconRoot::Embedded => Some(ImageSource::Resource(Resource::Embedded(relative.to_string().into()))),
        IconRoot::Folder(folder) => Some(ImageSource::Resource(Resource::Path(folder.join(relative).into()))),
    }
}

/// `a.test.ts` tries `.a.test.ts`, `.test.ts`, then `.ts`; a dotfile has no extension.
fn extension_candidates(name: &str) -> Vec<String> {
    if name.starts_with('.') || !name.contains('.') {
        return Vec::new();
    }
    std::iter::once(format!(".{name}"))
        .chain(name.match_indices('.').map(|(index, _)| name[index..].to_string()))
        .collect()
}

impl IconTheme {
    pub fn from_contribution(extension_id: &str, contribution: &IconThemeContribution, root: IconRoot, bundled: bool) -> Self {
        let definitions = |map: &std::collections::BTreeMap<String, String>| {
            map.iter().filter_map(|(key, definition)| Some((key.clone(), resolve(definition, &root)?))).collect()
        };
        Self {
            id: contribution.id.clone(),
            name: contribution.name.clone(),
            description: contribution.description.clone(),
            extension_id: extension_id.to_string(),
            bundled,
            preview: contribution.preview.as_ref().map(|preview| (preview.file_name.clone(), preview.kind == "folder")),
            dark: definitions(&contribution.icon_definitions),
            light: definitions(&contribution.light_icon_definitions),
            file_extensions: lowercase_keys(&contribution.file_extensions, true),
            filenames: lowercase_keys(&contribution.filenames, false),
            folders: lowercase_keys(&contribution.folders, false),
            expanded_folders: lowercase_keys(&contribution.expanded_folders, false),
            default_file: contribution.default_file.clone(),
            default_folder: contribution.default_folder.clone(),
            default_folder_open: contribution.default_folder_open.clone(),
        }
    }

    /// The Pierre themes (Minimal, Core, Complete) built into Athas.
    pub fn bundled() -> Vec<IconTheme> {
        let manifest: ExtensionManifest = serde_json::from_str(PIERRE_MANIFEST).expect("the Pierre icon themes parse");
        manifest
            .icon_themes()
            .map(|contribution| IconTheme::from_contribution(&manifest.id, contribution, IconRoot::Embedded, true))
            .collect()
    }

    /// The theme's key for an entry: a folder or file name match, the longest extension, then
    /// the defaults.
    pub fn icon_key(&self, name: &str, is_dir: bool, expanded: bool) -> Option<&str> {
        let name = name.rsplit(['/', '\\']).next().unwrap_or(name).to_lowercase();
        if is_dir {
            return expanded
                .then(|| self.expanded_folders.get(&name))
                .flatten()
                .or_else(|| self.folders.get(&name))
                .or(if expanded { self.default_folder_open.as_ref() } else { None })
                .or(self.default_folder.as_ref())
                .map(String::as_str);
        }
        if let Some(key) = self.filenames.get(&name) {
            return Some(key);
        }
        extension_candidates(&name)
            .iter()
            .find_map(|candidate| self.file_extensions.get(candidate))
            .or(self.default_file.as_ref())
            .map(String::as_str)
    }

    /// The icon for an entry, with the light-theme variant on light themes when there is one.
    pub fn icon(&self, name: &str, is_dir: bool, expanded: bool, dark: bool) -> Option<ImageSource> {
        let key = self.icon_key(name, is_dir, expanded)?;
        let light = (!dark).then(|| self.light.get(key)).flatten();
        light.or_else(|| self.dark.get(key)).cloned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn embedded(source: Option<ImageSource>) -> String {
        match source {
            Some(ImageSource::Resource(Resource::Embedded(path))) => path.to_string(),
            _ => String::new(),
        }
    }

    #[test]
    fn pierre_complete_matches_the_file_tree() {
        let themes = IconTheme::bundled();
        assert_eq!(themes.len(), 3);
        let complete = themes.iter().find(|theme| theme.id == DEFAULT_ICON_THEME).unwrap();
        assert_eq!(complete.icon_key("main.rs", false, false), Some("lang-rust"));
        assert_eq!(complete.icon_key("App.TSX", false, false), Some("react"));
        assert_eq!(complete.icon_key("package.json", false, false), Some("npm"));
        assert_eq!(complete.icon_key("archive.tar.gz", false, false), Some("file-zip-duo"));
        assert_eq!(complete.icon_key(".envrc", false, false), Some("file-duo"));
        assert_eq!(complete.icon_key("src", true, true), Some("folder-open-duo"));
        assert_eq!(embedded(complete.icon("main.rs", false, false, true)), "file-icons/lang-rust-color.svg");
        assert_eq!(embedded(complete.icon("main.rs", false, false, false)), "file-icons/lang-rust-color-light.svg");
    }

    #[test]
    fn every_pierre_icon_has_an_asset() {
        let assets = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../assets");
        for theme in IconTheme::bundled() {
            for source in theme.dark.values().chain(theme.light.values()) {
                let ImageSource::Resource(Resource::Embedded(path)) = source else { panic!("{}", theme.id) };
                assert!(assets.join(path.as_ref()).is_file(), "{}: {path}", theme.id);
            }
        }
    }

    #[test]
    fn installed_themes_resolve_inline_and_relative_icons() {
        let contribution: IconThemeContribution = serde_json::from_value(serde_json::json!({
            "id": "test-icons",
            "name": "Test Icons",
            "iconDefinitions": {
                "file": "<svg xmlns=\"http://www.w3.org/2000/svg\"/>",
                "rust": "./icons/rust.svg",
                "folder": "./icons/folder.svg",
                "folder-src": "./icons/folder-src.svg",
                "evil": "../../etc/passwd"
            },
            "fileExtensions": {"rs": "rust"},
            "folders": {"src": "folder-src"},
            "filenames": {"Cargo.toml": "evil"},
            "defaultFile": "file",
            "defaultFolder": "folder"
        }))
        .unwrap();
        let theme = IconTheme::from_contribution("athas.icons.test", &contribution, IconRoot::Folder(Path::new("/ext")), false);
        assert!(matches!(theme.icon("README", false, false, true), Some(ImageSource::Image(_))));
        assert!(matches!(
            theme.icon("lib.rs", false, false, false),
            Some(ImageSource::Resource(Resource::Path(path))) if path.as_ref() == Path::new("/ext/icons/rust.svg")
        ));
        assert_eq!(theme.icon_key("SRC", true, false), Some("folder-src"));
        assert_eq!(theme.icon_key("docs", true, true), Some("folder"));
        assert_eq!(theme.icon_key("cargo.toml", false, false), Some("evil"));
        assert!(theme.icon("Cargo.toml", false, false, true).is_none());
    }
}
