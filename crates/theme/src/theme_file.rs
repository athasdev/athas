//! The Athas theme file format (`theme-file.ts`): validation with every issue listed, the legacy
//! colour names, a starting file made from an installed theme, and the stored custom themes
//! (`custom-theme-store.ts`).

use std::{
    collections::{BTreeMap, HashSet},
    path::Path,
};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::{Appearance, Theme, parse_color};

const REQUIRED_THEME_COLOR_KEYS: [&str; 9] =
    ["background", "surface", "foreground", "muted-foreground", "subtle-foreground", "border", "accent", "selected", "primary"];

const LEGACY_THEME_COLOR_KEYS: [(&str, &str); 9] = [
    ("primary-bg", "background"),
    ("secondary-bg", "surface"),
    ("text", "foreground"),
    ("text-light", "muted-foreground"),
    ("text-lighter", "subtle-foreground"),
    ("hover", "accent"),
    ("selection-bg", "selection"),
    ("accent", "primary"),
    ("error", "destructive"),
];

const LEGACY_THEME_SIGNATURE_KEYS: [&str; 6] = ["primary-bg", "secondary-bg", "text-light", "text-lighter", "hover", "selection-bg"];

const OPTIONAL_FILE_FIELDS: [&str; 6] = ["$schema", "author", "description", "repository", "license", "version"];

/// Theme files larger than this are refused.
pub const MAX_THEME_FILE_BYTES: u64 = 2 * 1024 * 1024;

/// One variant in a theme file.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ThemeData {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub appearance: Appearance,
    pub colors: BTreeMap<String, String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub syntax: Option<BTreeMap<String, String>>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ThemeFileData {
    #[serde(rename = "$schema", default, skip_serializing_if = "Option::is_none")]
    pub schema: Option<String>,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repository: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub license: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    pub themes: Vec<ThemeData>,
}

/// Why a theme file was refused: every problem found, one per line.
#[derive(Clone, Debug, PartialEq)]
pub struct ThemeFileError {
    pub issues: Vec<String>,
}

impl std::fmt::Display for ThemeFileError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.issues.join("\n"))
    }
}

impl std::error::Error for ThemeFileError {}

fn required_string(record: &Map<String, Value>, key: &str, path: &str, issues: &mut Vec<String>) -> String {
    match record.get(key).and_then(Value::as_str).map(str::trim) {
        Some(value) if !value.is_empty() => value.to_string(),
        _ => {
            issues.push(format!("{path}.{key} must be a non-empty string"));
            String::new()
        }
    }
}

fn optional_string(record: &Map<String, Value>, key: &str, path: &str, issues: &mut Vec<String>) -> Option<String> {
    let value = record.get(key)?;
    match value.as_str().map(str::trim) {
        Some(text) if !text.is_empty() => Some(text.to_string()),
        _ => {
            issues.push(format!("{path}.{key} must be a non-empty string when provided"));
            None
        }
    }
}

fn string_map(value: Option<&Value>, path: &str, issues: &mut Vec<String>) -> BTreeMap<String, String> {
    let Some(Value::Object(record)) = value else {
        issues.push(format!("{path} must be an object of color names and CSS color values"));
        return BTreeMap::new();
    };
    let mut result = BTreeMap::new();
    for (key, entry) in record {
        match entry.as_str().map(str::trim) {
            Some(text) if !text.is_empty() => {
                result.insert(key.clone(), text.to_string());
            }
            _ => issues.push(format!("{path}.{key} must be a non-empty CSS color string")),
        }
    }
    result
}

fn key_without_prefix(key: &str) -> &str {
    let key = key.strip_prefix("--").unwrap_or(key);
    key.strip_prefix("color-").unwrap_or(key)
}

/// Strips `--` and `color-`, and maps the legacy names of themes written for older Athas
/// versions; a canonical name wins over a legacy one for the same colour.
pub fn normalize_theme_colors<'a>(colors: impl IntoIterator<Item = (&'a String, &'a String)> + Clone) -> BTreeMap<String, String> {
    let legacy = colors.clone().into_iter().any(|(key, _)| LEGACY_THEME_SIGNATURE_KEYS.contains(&key_without_prefix(key)));
    let mut normalized = BTreeMap::new();
    for (key, value) in colors {
        let bare = key_without_prefix(key);
        let name = if legacy {
            LEGACY_THEME_COLOR_KEYS.iter().find(|(old, _)| *old == bare).map_or(bare, |(_, new)| *new)
        } else {
            bare
        };
        if !normalized.contains_key(name) || bare == name {
            normalized.insert(name.to_string(), value.clone());
        }
    }
    normalized
}

fn valid_id(id: &str) -> bool {
    let mut chars = id.chars();
    chars.next().is_some_and(|first| first.is_ascii_lowercase() || first.is_ascii_digit())
        && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '.' | '_' | '-'))
}

fn parse_theme(value: &Value, index: usize, issues: &mut Vec<String>) -> ThemeData {
    let path = format!("themes[{index}]");
    let Value::Object(record) = value else {
        issues.push(format!("{path} must be an object"));
        return ThemeData { id: String::new(), name: String::new(), description: None, appearance: Appearance::Dark, colors: BTreeMap::new(), syntax: None };
    };
    let id = required_string(record, "id", &path, issues);
    if !id.is_empty() && !valid_id(&id) {
        issues.push(format!(
            "{path}.id must start with a lowercase letter or number and contain only lowercase letters, numbers, dots, underscores, or hyphens"
        ));
    }
    let appearance = match record.get("appearance").and_then(Value::as_str) {
        Some("light") => Appearance::Light,
        Some("dark") => Appearance::Dark,
        _ => {
            issues.push(format!("{path}.appearance must be either \"dark\" or \"light\""));
            Appearance::Dark
        }
    };
    let syntax = record.get("syntax").map(|syntax| string_map(Some(syntax), &format!("{path}.syntax"), issues));
    let raw = string_map(record.get("colors"), &format!("{path}.colors"), issues);
    let colors = normalize_theme_colors(&raw);
    for key in REQUIRED_THEME_COLOR_KEYS {
        if !colors.contains_key(key) {
            issues.push(format!("{path}.colors.{key} is required"));
        }
    }
    ThemeData {
        id,
        name: required_string(record, "name", &path, issues),
        description: optional_string(record, "description", &path, issues),
        appearance,
        colors,
        syntax,
    }
}

/// Validates a theme file, listing every problem instead of stopping at the first.
pub fn parse_theme_file(value: &Value) -> Result<ThemeFileData, ThemeFileError> {
    let Value::Object(record) = value else {
        return Err(ThemeFileError { issues: vec!["Theme file must be a JSON object".into()] });
    };
    let mut issues = Vec::new();
    let name = required_string(record, "name", "themeFile", &mut issues);
    let raw_themes = record.get("themes").and_then(Value::as_array);
    if raw_themes.is_none_or(|themes| themes.is_empty()) {
        issues.push("themeFile.themes must be a non-empty array".into());
    }
    let themes: Vec<ThemeData> =
        raw_themes.into_iter().flatten().enumerate().map(|(index, theme)| parse_theme(theme, index, &mut issues)).collect();
    let mut seen = HashSet::new();
    for (index, theme) in themes.iter().enumerate() {
        if !theme.id.is_empty() && !seen.insert(theme.id.clone()) {
            issues.push(format!("themes[{index}].id duplicates \"{}\" in this file", theme.id));
        }
    }
    let mut optional: BTreeMap<&str, String> = BTreeMap::new();
    for key in OPTIONAL_FILE_FIELDS {
        if let Some(value) = optional_string(record, key, "themeFile", &mut issues) {
            optional.insert(key, value);
        }
    }
    if !issues.is_empty() {
        return Err(ThemeFileError { issues });
    }
    Ok(ThemeFileData {
        schema: optional.remove("$schema"),
        name,
        author: optional.remove("author"),
        description: optional.remove("description"),
        repository: optional.remove("repository"),
        license: optional.remove("license"),
        version: optional.remove("version"),
        themes,
    })
}

pub fn parse_theme_file_json(content: &str) -> Result<ThemeFileData, ThemeFileError> {
    let value: Value = serde_json::from_str(content).map_err(|error| ThemeFileError { issues: vec![format!("Invalid JSON: {error}")] })?;
    parse_theme_file(&value)
}

/// Colours the renderer cannot read, which the web build finds with `CSS.supports`.
pub fn unsupported_color_issues(themes: &[ThemeData]) -> Vec<String> {
    let mut issues = Vec::new();
    for (index, theme) in themes.iter().enumerate() {
        let groups = [("colors", Some(&theme.colors)), ("syntax", theme.syntax.as_ref())];
        for (group, map) in groups {
            for (key, value) in map.into_iter().flatten() {
                if parse_color(value).is_none() {
                    issues.push(format!("themes[{index}].{group}.{key} is not a supported CSS color: {value}"));
                }
            }
        }
    }
    issues
}

/// A starting theme file with `base`'s colours (`createThemeFileFromBase`).
pub fn theme_file_from_base(id: &str, name: &str, description: Option<&str>, base: &Theme) -> ThemeFileData {
    let description = description.filter(|text| !text.is_empty());
    ThemeFileData {
        schema: None,
        name: name.to_string(),
        author: Some("Your name".into()),
        description: Some(description.map_or_else(|| format!("Custom theme based on {}", base.name), str::to_string)),
        repository: None,
        license: None,
        version: Some("1.0.0".into()),
        themes: vec![ThemeData {
            id: id.to_string(),
            name: name.to_string(),
            description: description.map(str::to_string),
            appearance: base.appearance,
            colors: base.source_colors.clone(),
            syntax: Some(base.source_syntax.clone()),
        }],
    }
}

/// Pretty JSON with a final newline (`formatThemeFile`).
pub fn format_theme_file(file: &ThemeFileData) -> String {
    format!("{}\n", serde_json::to_string_pretty(file).unwrap_or_default())
}

/// The id a theme name suggests (`themeIdFromName`).
pub fn theme_id_from_name(name: &str) -> String {
    let mut id = String::new();
    for c in name.trim().to_lowercase().chars() {
        if c.is_ascii_lowercase() || c.is_ascii_digit() {
            id.push(c);
        } else if !id.ends_with('-') {
            id.push('-');
        }
    }
    id.trim_matches('-').to_string()
}

/// `merged` keeps the stored order, with each incoming theme replacing the one of its id.
pub fn merge_custom_themes(current: Vec<ThemeData>, incoming: &[ThemeData]) -> Vec<ThemeData> {
    let mut merged = current;
    for theme in incoming {
        match merged.iter_mut().find(|existing| existing.id == theme.id) {
            Some(existing) => *existing = theme.clone(),
            None => merged.push(theme.clone()),
        }
    }
    merged
}

/// The custom themes kept in `custom-themes.json` under `themes`; none when the file is
/// missing or no longer valid.
pub fn load_custom_themes(path: &Path) -> Vec<ThemeData> {
    let Ok(text) = std::fs::read_to_string(path) else { return Vec::new() };
    let Ok(Value::Object(store)) = serde_json::from_str::<Value>(&text) else { return Vec::new() };
    let Some(themes) = store.get("themes").filter(|themes| !themes.is_null()) else { return Vec::new() };
    let file = serde_json::json!({ "name": "Custom themes", "themes": themes });
    parse_theme_file(&file).map(|file| file.themes).unwrap_or_default()
}

pub fn save_custom_themes(path: &Path, themes: &[ThemeData]) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let mut store = match std::fs::read_to_string(path).ok().and_then(|text| serde_json::from_str::<Value>(&text).ok()) {
        Some(Value::Object(store)) => store,
        _ => Map::new(),
    };
    store.insert("themes".into(), serde_json::to_value(themes).unwrap_or_default());
    std::fs::write(path, serde_json::to_string_pretty(&Value::Object(store)).unwrap_or_default())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{ThemeOptions, ThemeRegistry};

    const VALID: &str = r##"{
        "name": "Mine",
        "author": "Me",
        "themes": [{
            "id": "mine-dark", "name": "Mine Dark", "appearance": "dark",
            "colors": {"background": "#101010", "surface": "#181818", "foreground": "#eeeeee",
                "muted-foreground": "#aaaaaa", "subtle-foreground": "#888888", "border": "#333333",
                "accent": "#222222", "selected": "#2a2a2a", "primary": "#4a9eff"},
            "syntax": {"keyword": "#ff79c6"}
        }]
    }"##;

    #[test]
    fn a_valid_file_parses_and_round_trips() {
        let file = parse_theme_file_json(VALID).unwrap();
        assert_eq!(file.name, "Mine");
        assert_eq!(file.author.as_deref(), Some("Me"));
        assert_eq!(file.themes[0].colors["primary"], "#4a9eff");
        let again = parse_theme_file_json(&format_theme_file(&file)).unwrap();
        assert_eq!(again, file);
    }

    #[test]
    fn every_issue_is_listed() {
        let error = parse_theme_file_json(r#"{"themes": [{"id": "Bad Id", "name": "", "appearance": "dim", "colors": {"background": 3}}, {"id": "x"}]}"#).unwrap_err();
        let issues = error.issues.join("\n");
        assert!(issues.contains("themeFile.name must be a non-empty string"));
        assert!(issues.contains("themes[0].id must start with a lowercase letter"));
        assert!(issues.contains("themes[0].appearance must be either"));
        assert!(issues.contains("themes[0].colors.background must be a non-empty CSS color string"));
        assert!(issues.contains("themes[0].colors.primary is required"));
        assert!(issues.contains("themes[1].colors must be an object"));
        assert_eq!(parse_theme_file_json("{").unwrap_err().issues.len(), 1);
        assert!(parse_theme_file_json("[]").unwrap_err().issues[0].contains("JSON object"));
    }

    #[test]
    fn legacy_names_and_prefixes_are_normalized() {
        let colors: BTreeMap<String, String> = [("--primary-bg", "#000"), ("secondary-bg", "#111"), ("--color-text", "#fff"), ("accent", "#f00"), ("primary", "#0f0")]
            .into_iter()
            .map(|(key, value)| (key.to_string(), value.to_string()))
            .collect();
        let normalized = normalize_theme_colors(&colors);
        assert_eq!(normalized["background"], "#000");
        assert_eq!(normalized["surface"], "#111");
        assert_eq!(normalized["foreground"], "#fff");
        assert_eq!(normalized["primary"], "#0f0", "the canonical name wins");
    }

    #[test]
    fn a_file_from_a_base_theme_installs_as_written() {
        let registry = ThemeRegistry::builtin(ThemeOptions::default());
        let base = registry.get("athas-dark").unwrap();
        let file = theme_file_from_base("my-theme", "My Theme", None, &base);
        assert_eq!(file.description.as_deref(), Some(format!("Custom theme based on {}", base.name).as_str()));
        let parsed = parse_theme_file_json(&format_theme_file(&file)).unwrap();
        assert_eq!(parsed.themes[0].appearance, Appearance::Dark);
        assert!(unsupported_color_issues(&parsed.themes).is_empty());
        assert_eq!(theme_id_from_name("  My Athas Theme! "), "my-athas-theme");
    }

    #[test]
    fn unsupported_colors_are_reported() {
        let mut file = parse_theme_file_json(VALID).unwrap();
        file.themes[0].colors.insert("primary".into(), "notacolor".into());
        assert_eq!(unsupported_color_issues(&file.themes), vec!["themes[0].colors.primary is not a supported CSS color: notacolor".to_string()]);
    }

    #[test]
    fn the_store_merges_and_removes() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("custom-themes.json");
        assert!(load_custom_themes(&path).is_empty());
        let file = parse_theme_file_json(VALID).unwrap();
        save_custom_themes(&path, &merge_custom_themes(load_custom_themes(&path), &file.themes)).unwrap();
        let mut changed = file.themes[0].clone();
        changed.name = "Renamed".into();
        let merged = merge_custom_themes(load_custom_themes(&path), &[changed]);
        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].name, "Renamed");
        save_custom_themes(&path, &merged).unwrap();
        assert_eq!(load_custom_themes(&path)[0].name, "Renamed");
        save_custom_themes(&path, &[]).unwrap();
        assert!(load_custom_themes(&path).is_empty());
    }
}
