//! The extensions on offer: the official ones built into the app (`assets/extensions/catalog.json`,
//! written by `scripts/generate_extensions_catalog.py`), replaced by the CDN's `manifests.json`
//! once that loads.

use std::{collections::BTreeMap, sync::Arc};

use anyhow::{Context as _, Result};
use serde::Deserialize;

use crate::manifest::ExtensionManifest;

/// Where Athas publishes extensions (`src/config/services.json`, `extensionsCdnBaseUrl`).
pub const CDN_BASE_URL: &str = "https://athas.dev/extensions";

const BUNDLED_CATALOG: &str = include_str!("../../../assets/extensions/catalog.json");

/// What an extension adds, as the extension manager groups it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum ExtensionKind {
    Language,
    Theme,
    IconTheme,
    Ai,
    Integration,
    Mcp,
    Skill,
    Agent,
}

impl ExtensionKind {
    pub const ALL: [ExtensionKind; 8] = [
        ExtensionKind::Language,
        ExtensionKind::Theme,
        ExtensionKind::IconTheme,
        ExtensionKind::Ai,
        ExtensionKind::Integration,
        ExtensionKind::Mcp,
        ExtensionKind::Skill,
        ExtensionKind::Agent,
    ];

    /// The id `extensionsActiveTab` stores.
    pub fn id(self) -> &'static str {
        match self {
            ExtensionKind::Language => "language",
            ExtensionKind::Theme => "theme",
            ExtensionKind::IconTheme => "icon-theme",
            ExtensionKind::Ai => "ai",
            ExtensionKind::Integration => "integration",
            ExtensionKind::Mcp => "mcp",
            ExtensionKind::Skill => "skill",
            ExtensionKind::Agent => "agent",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            ExtensionKind::Language => "Languages",
            ExtensionKind::Theme => "Themes",
            ExtensionKind::IconTheme => "Icons",
            ExtensionKind::Ai => "AI",
            ExtensionKind::Integration => "Apps",
            ExtensionKind::Mcp => "MCP",
            ExtensionKind::Skill => "Skills",
            ExtensionKind::Agent => "Agents",
        }
    }

    pub fn from_id(id: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|kind| kind.id() == id)
    }

    /// The kind of an extension, from the first thing it contributes.
    pub fn of(manifest: &ExtensionManifest) -> Self {
        use crate::manifest::Category;
        if manifest.agents().next().is_some() {
            ExtensionKind::Agent
        } else if manifest.languages().next().is_some() {
            ExtensionKind::Language
        } else if manifest.themes().next().is_some() {
            ExtensionKind::Theme
        } else if manifest.icon_themes().next().is_some() {
            ExtensionKind::IconTheme
        } else if manifest.ai_providers().next().is_some() {
            ExtensionKind::Ai
        } else if manifest.mcp_servers().next().is_some() {
            ExtensionKind::Mcp
        } else if manifest.skills().next().is_some() {
            ExtensionKind::Skill
        } else {
            match manifest.categories.first() {
                Some(Category::Theme) => ExtensionKind::Theme,
                Some(Category::IconTheme) => ExtensionKind::IconTheme,
                Some(Category::Language | Category::Linter | Category::Formatter) => ExtensionKind::Language,
                Some(Category::Ai) => ExtensionKind::Ai,
                Some(Category::Agent) => ExtensionKind::Agent,
                Some(Category::Skill) => ExtensionKind::Skill,
                _ => ExtensionKind::Integration,
            }
        }
    }
}

/// Where an extension's icon comes from.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ExtensionIcon {
    /// An SVG built into the app (`extensions/icons/<id>.svg`).
    Embedded { path: String, monochrome: bool },
    /// An icon on the CDN, for extensions this build does not know.
    Remote(String),
}

#[derive(Clone, Debug)]
pub struct CatalogEntry {
    /// The extension's folder on the CDN (`language/rust`).
    pub path: String,
    pub manifest: Arc<ExtensionManifest>,
    pub icon: Option<ExtensionIcon>,
    pub kind: ExtensionKind,
}

#[derive(Clone, Debug, Default)]
pub struct Catalog {
    entries: Vec<CatalogEntry>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BundledFile {
    extensions: Vec<BundledEntry>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BundledEntry {
    path: String,
    manifest: serde_json::Value,
    icon: Option<String>,
    #[serde(default)]
    monochrome_icon: bool,
}

impl Catalog {
    /// The official extensions this build ships with.
    pub fn bundled() -> Self {
        Self::from_bundled_json(BUNDLED_CATALOG).expect("the bundled extension catalog parses")
    }

    fn from_bundled_json(json: &str) -> Result<Self> {
        let file: BundledFile = serde_json::from_str(json)?;
        let mut entries = Vec::new();
        for entry in file.extensions {
            let manifest: ExtensionManifest = serde_json::from_value(entry.manifest)
                .with_context(|| format!("extension {}", entry.path))?;
            manifest.validate()?;
            let icon = entry.icon.map(|path| ExtensionIcon::Embedded { path, monochrome: entry.monochrome_icon });
            entries.push(CatalogEntry { path: entry.path, kind: ExtensionKind::of(&manifest), manifest: Arc::new(manifest), icon });
        }
        Ok(Self { entries })
    }

    /// Reads the CDN's `manifests.json` (`{ "<folder>": manifest }`). Manifests that do not
    /// match the schema are left out; icons come from the bundled catalog when it knows the
    /// extension, otherwise from the CDN. The bundled extensions the CDN does not list are
    /// kept: a CDN that lags behind this build must not make built-in extensions disappear.
    pub fn from_cdn_json(json: &str, base_url: &str, bundled: &Catalog) -> Result<Self> {
        let manifests: BTreeMap<String, serde_json::Value> = serde_json::from_str(json)?;
        let mut entries = Vec::new();
        let mut listed = std::collections::HashSet::new();
        for (path, value) in manifests {
            let manifest = match serde_json::from_value::<ExtensionManifest>(value) {
                Ok(manifest) if manifest.validate().is_ok() => manifest,
                Ok(_) | Err(_) => {
                    eprintln!("extensions: skipping the invalid manifest {path}");
                    continue;
                }
            };
            let icon = bundled.get(&manifest.id).and_then(|entry| entry.icon.clone()).or_else(|| {
                let icon = manifest.icon.as_deref().filter(|icon| !icon.trim().is_empty()).unwrap_or("icon.svg");
                Some(ExtensionIcon::Remote(if icon.contains("://") {
                    icon.to_string()
                } else {
                    format!("{}/{path}/{}", base_url.trim_end_matches('/'), icon.trim_start_matches("./"))
                }))
            });
            listed.insert(manifest.id.clone());
            entries.push(CatalogEntry { path, kind: ExtensionKind::of(&manifest), manifest: Arc::new(manifest), icon });
        }
        entries.extend(bundled.entries().iter().filter(|entry| !listed.contains(&entry.manifest.id)).cloned());
        Ok(Self { entries })
    }

    pub fn from_entries(entries: Vec<CatalogEntry>) -> Self {
        Self { entries }
    }

    pub fn entries(&self) -> &[CatalogEntry] {
        &self.entries
    }

    pub fn get(&self, id: &str) -> Option<&CatalogEntry> {
        self.entries.iter().find(|entry| entry.manifest.id == id)
    }
}

/// Downloads the catalog from the CDN. Blocking; run it off the main thread.
#[cfg(not(target_family = "wasm"))]
pub fn fetch(base_url: &str, bundled: &Catalog) -> Result<Catalog> {
    let url = format!("{}/manifests.json", base_url.trim_end_matches('/'));
    let body = crate::installer::get_text(&url).with_context(|| format!("loading {url}"))?;
    Catalog::from_cdn_json(&body, base_url, bundled)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_official_manifest_parses() {
        let catalog = Catalog::bundled();
        assert_eq!(catalog.entries().len(), 84);
        let count = |kind| catalog.entries().iter().filter(|entry| entry.kind == kind).count();
        assert_eq!(count(ExtensionKind::Language), 47);
        assert_eq!(count(ExtensionKind::Mcp), 21);
        assert_eq!(count(ExtensionKind::Agent), 7);
        assert_eq!(count(ExtensionKind::Skill), 3);
        assert_eq!(count(ExtensionKind::IconTheme), 2);
        assert_eq!(count(ExtensionKind::Theme), 1);
        assert_eq!(count(ExtensionKind::Ai), 1);
        assert_eq!(count(ExtensionKind::Integration), 2);
        assert!(catalog.entries().iter().all(|entry| entry.icon.is_some()));
        let theme = catalog.get("athas.theme.vercel").unwrap();
        assert_eq!(theme.path, "theme/vercel");
        assert!(theme.manifest.package_for("darwin-arm64").is_some());
    }

    /// Every theme a theme extension carries loads: the registry reads the same file the
    /// extension hands it on install. The theme extensions are published, not bundled, so the
    /// source folders are what is checked.
    #[test]
    fn every_official_theme_loads() {
        let official = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../extensions/official");
        let Ok(folders) = std::fs::read_dir(&official) else { return };
        let mut themes = 0;
        for folder in folders.flatten() {
            let path = folder.path().join("extension.json");
            let Ok(json) = std::fs::read_to_string(&path) else { continue };
            let manifest = ExtensionManifest::from_json(&json).unwrap_or_else(|error| panic!("{}: {error:#}", path.display()));
            let Some(file) = manifest.theme_file_json() else { continue };
            let mut registry = theme::ThemeRegistry::default();
            registry
                .load_json(&file, theme::ThemeOptions::default())
                .unwrap_or_else(|error| panic!("{}: {error:#}", path.display()));
            themes += registry.themes().len();
        }
        assert_eq!(themes, 14, "the themes of the official theme extensions");
    }

    /// The source manifests, not the generated copy. There are more of them than the bundled
    /// catalog holds: the theme extensions ported from other projects are published to the
    /// extension registry rather than built into the app.
    #[test]
    fn every_official_manifest_matches_the_schema_on_disk() {
        let official = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../extensions/official");
        let Ok(folders) = std::fs::read_dir(&official) else { return };
        let mut count = 0;
        for folder in folders.flatten() {
            let path = folder.path().join("extension.json");
            let Ok(json) = std::fs::read_to_string(&path) else { continue };
            ExtensionManifest::from_json(&json).unwrap_or_else(|error| panic!("{}: {error:#}", path.display()));
            count += 1;
        }
        assert_eq!(count, 90);
    }

    #[test]
    fn reads_the_cdn_catalog() {
        let bundled = Catalog::bundled();
        let rust = &bundled.get("athas.rust").unwrap().manifest;
        let mut new = serde_json::to_value(rust.as_ref()).unwrap();
        new["id"] = "athas.newlang".into();
        let json = serde_json::json!({
            "rust": rust.as_ref(),
            "newlang": new,
            "broken": {"id": "x"},
        });
        let catalog = Catalog::from_cdn_json(&json.to_string(), "https://cdn.test/ext/", &bundled).unwrap();
        // The CDN's two manifests, and every bundled extension it does not list.
        assert_eq!(catalog.entries().len(), bundled.entries().len() + 1);
        assert!(matches!(catalog.get("athas.rust").unwrap().icon, Some(ExtensionIcon::Embedded { .. })));
        assert_eq!(
            catalog.get("athas.newlang").unwrap().icon,
            Some(ExtensionIcon::Remote("https://cdn.test/ext/newlang/icon.svg".into()))
        );
    }

    /// A CDN that lags behind this build used to replace the catalog outright, which dropped
    /// every bundled extension it had not published yet (the MCP servers, most of all).
    #[test]
    fn the_cdn_catalog_keeps_the_bundled_extensions_it_does_not_list() {
        let bundled = Catalog::bundled();
        let rust = &bundled.get("athas.rust").unwrap().manifest;
        let catalog = Catalog::from_cdn_json(&serde_json::json!({ "rust": rust.as_ref() }).to_string(), "https://cdn.test/ext/", &bundled).unwrap();
        assert_eq!(catalog.entries().len(), bundled.entries().len());
        let mcp = |catalog: &Catalog| catalog.entries().iter().filter(|entry| entry.kind == ExtensionKind::Mcp).count();
        assert_eq!(mcp(&catalog), mcp(&bundled));
        assert!(catalog.get("athas.mcp.github").is_some());
    }
}
