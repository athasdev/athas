//! Themes the user creates or imports (`theme-upload.ts`, `custom-theme-store.ts`): validated,
//! kept in `custom-themes.json`, and registered beside the built-in and extension themes.

use std::{
    path::{Path, PathBuf},
    sync::Arc,
};

use gpui::{App, Global};
use theme::{
    Theme,
    theme_file::{
        MAX_THEME_FILE_BYTES, ThemeData, ThemeFileError, load_custom_themes, merge_custom_themes, parse_theme_file_json,
        save_custom_themes, unsupported_color_issues,
    },
};

#[derive(Default)]
pub struct CustomThemes {
    path: Option<PathBuf>,
    themes: Vec<ThemeData>,
}

impl Global for CustomThemes {}

impl CustomThemes {
    pub fn themes(&self) -> &[ThemeData] {
        &self.themes
    }
}

/// Why a theme was not imported, with the problems found (`ThemeUploadResult`).
#[derive(Clone, Debug, PartialEq)]
pub struct ThemeImportError {
    pub message: String,
    pub details: Vec<String>,
}

impl ThemeImportError {
    fn invalid(error: ThemeFileError) -> Self {
        Self { message: "The theme file does not match the Athas theme format.".into(), details: error.issues }
    }

    fn other(message: impl Into<String>) -> Self {
        Self { message: message.into(), details: Vec::new() }
    }
}

impl std::fmt::Display for ThemeImportError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

/// `<data dir>/custom-themes.json`.
#[cfg(not(target_family = "wasm"))]
pub fn default_custom_themes_path() -> Option<PathBuf> {
    dirs::data_dir().map(|dir| dir.join(paths::APP_ID).join("custom-themes.json"))
}

/// Reads the custom themes kept at `path` (none without one) and registers them.
pub fn set_custom_themes_path(path: Option<PathBuf>, cx: &mut App) {
    let themes = path.as_deref().map(load_custom_themes).unwrap_or_default();
    cx.set_global(CustomThemes { path, themes });
    super::refresh_themes(cx);
}

pub fn custom_themes(cx: &App) -> &[ThemeData] {
    cx.try_global::<CustomThemes>().map_or(&[], |custom| custom.themes())
}

/// Validates and installs a theme file's themes, replacing earlier custom themes of the same
/// ids; refuses ids a built-in or extension theme already uses. Returns the installed themes.
pub fn install_theme_json(content: &str, cx: &mut App) -> Result<Vec<Arc<Theme>>, ThemeImportError> {
    let file = parse_theme_file_json(content).map_err(ThemeImportError::invalid)?;
    let color_issues = unsupported_color_issues(&file.themes);
    if !color_issues.is_empty() {
        return Err(ThemeImportError::invalid(ThemeFileError { issues: color_issues }));
    }
    let registry = theme::registry(cx);
    let conflicts: Vec<String> = file
        .themes
        .iter()
        .enumerate()
        .filter_map(|(index, theme)| {
            let registered = registry.get(&theme.id)?;
            (!registry.is_custom(&theme.id)).then(|| format!("themes[{index}].id conflicts with the existing theme \"{}\"", registered.name))
        })
        .collect();
    if !conflicts.is_empty() {
        return Err(ThemeImportError::invalid(ThemeFileError { issues: conflicts }));
    }
    let custom = cx.default_global::<CustomThemes>();
    let merged = merge_custom_themes(custom.themes.clone(), &file.themes);
    if let Some(path) = &custom.path {
        save_custom_themes(path, &merged).map_err(|error| ThemeImportError::other(format!("Failed to save the theme: {error}")))?;
    }
    custom.themes = merged;
    super::refresh_themes(cx);
    let registry = theme::registry(cx);
    Ok(file.themes.iter().filter_map(|theme| registry.get(&theme.id)).collect())
}

/// Imports a theme file picked from disk (`uploadTheme`).
pub fn import_theme_file(path: &Path, cx: &mut App) -> Result<Vec<Arc<Theme>>, ThemeImportError> {
    let name = path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default();
    if !name.to_lowercase().ends_with(".json") {
        return Err(ThemeImportError { message: "Choose an Athas theme JSON file.".into(), details: vec![format!("{name} does not use the .json extension")] });
    }
    let size = std::fs::metadata(path).map(|metadata| metadata.len()).unwrap_or(0);
    if size > MAX_THEME_FILE_BYTES {
        return Err(ThemeImportError { message: "The theme file is too large.".into(), details: vec!["Athas theme files must be 2 MB or smaller".into()] });
    }
    let content = std::fs::read_to_string(path).map_err(|error| ThemeImportError::other(format!("Failed to import the theme file: {error}")))?;
    install_theme_json(&content, cx)
}

/// Removes an imported theme; settings that named it go back to their defaults.
pub fn remove_custom_theme(id: &str, cx: &mut App) -> Result<(), ThemeImportError> {
    if !theme::registry(cx).is_custom(id) {
        return Err(ThemeImportError::other("Only imported custom themes can be removed."));
    }
    if cx.try_global::<settings::SettingsStore>().is_some() {
        let current = settings::get(cx).clone();
        let defaults = settings::Settings::default();
        if current.theme == id || current.auto_theme_light == id || current.auto_theme_dark == id {
            settings::update(cx, |settings| {
                if settings.theme == id {
                    settings.theme = defaults.theme.clone();
                }
                if settings.auto_theme_light == id {
                    settings.auto_theme_light = defaults.auto_theme_light.clone();
                }
                if settings.auto_theme_dark == id {
                    settings.auto_theme_dark = defaults.auto_theme_dark.clone();
                }
            });
        }
    }
    let custom = cx.default_global::<CustomThemes>();
    let remaining: Vec<ThemeData> = custom.themes.iter().filter(|theme| theme.id != id).cloned().collect();
    if let Some(path) = &custom.path {
        save_custom_themes(path, &remaining).map_err(|error| ThemeImportError::other(format!("Failed to remove the theme: {error}")))?;
    }
    custom.themes = remaining;
    super::refresh_themes(cx);
    Ok(())
}

/// Picks an imported theme: as the theme, or as the light or dark one while following the system
/// (`selectImportedTheme`).
pub fn select_theme(id: &str, cx: &mut App) {
    let Some(theme) = theme::registry(cx).get(id) else { return };
    let id = id.to_string();
    settings::update(cx, |settings| {
        if !settings.sync_system_theme {
            settings.theme = id;
        } else if theme.appearance.is_dark() {
            settings.auto_theme_dark = id;
        } else {
            settings.auto_theme_light = id;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use gpui::TestAppContext;
    use theme::Appearance;

    fn theme_json(id: &str, primary: &str) -> String {
        format!(
            r##"{{"name": "Mine", "themes": [{{"id": "{id}", "name": "Mine {id}", "appearance": "light",
            "colors": {{"background": "#ffffff", "surface": "#f4f4f4", "foreground": "#111111",
            "muted-foreground": "#555555", "subtle-foreground": "#777777", "border": "#dddddd",
            "accent": "#eeeeee", "selected": "#e4e4e4", "primary": "{primary}"}}}}]}}"##
        )
    }

    #[gpui::test]
    fn imported_themes_register_persist_and_go_away(cx: &mut TestAppContext) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("custom-themes.json");
        cx.update(|cx| {
            settings::init(cx, settings::Settings::default(), None);
            theme::init(cx, None, Appearance::Dark, false);
            crate::init_with(cx, None, None);
            set_custom_themes_path(Some(path.clone()), cx);

            let installed = install_theme_json(&theme_json("mine", "#ff0000"), cx).unwrap();
            assert_eq!(installed[0].family, theme::CUSTOM_THEME_FAMILY);
            assert!(theme::registry(cx).is_custom("mine"));
            assert!(theme::registry(cx).get("athas-dark").is_some());

            select_theme("mine", cx);
            if settings::get(cx).sync_system_theme {
                assert_eq!(settings::get(cx).auto_theme_light, "mine", "a light theme while following the system");
                settings::update(cx, |settings| settings.sync_system_theme = false);
                select_theme("mine", cx);
            }
            assert_eq!(settings::get(cx).theme, "mine");

            install_theme_json(&theme_json("mine", "#00ff00"), cx).unwrap();
            assert_eq!(custom_themes(cx).len(), 1, "a theme of the same id is replaced");

            let conflict = install_theme_json(&theme_json("athas-dark", "#00ff00"), cx).unwrap_err();
            assert!(conflict.details[0].contains("conflicts with the existing theme"));
            let invalid = install_theme_json("{}", cx).unwrap_err();
            assert_eq!(invalid.message, "The theme file does not match the Athas theme format.");

            set_custom_themes_path(Some(path.clone()), cx);
            assert_eq!(custom_themes(cx)[0].colors["primary"], "#00ff00", "kept on disk");

            remove_custom_theme("mine", cx).unwrap();
            assert!(theme::registry(cx).get("mine").is_none());
            assert_eq!(settings::get(cx).theme, settings::Settings::default().theme);
            assert!(remove_custom_theme("athas-dark", cx).is_err());
        });
        let not_json = dir.path().join("theme.txt");
        std::fs::write(&not_json, "{}").unwrap();
        cx.update(|cx| assert_eq!(import_theme_file(&not_json, cx).unwrap_err().message, "Choose an Athas theme JSON file."));
    }
}
