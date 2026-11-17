//! Athas extensions: the catalog of official extensions, what is installed and enabled, the
//! installer, and what enabled extensions contribute (themes, icon themes, languages with
//! their tools, MCP servers, agents, skills and database providers).
//!
//! Everything lives in the [`Extensions`] global; observe it to redraw when something is
//! installed, removed, enabled or disabled.

pub mod catalog;
mod custom_themes;
pub mod icon_theme;
#[cfg(not(target_family = "wasm"))]
pub mod installer;
pub mod languages;
pub mod manifest;
pub mod store;
pub mod tools;

use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::Arc,
};

use anyhow::{Result, anyhow};
#[cfg(not(target_family = "wasm"))]
use gpui::AppContext as _;
use gpui::{App, BorrowAppContext as _, Global, ImageSource, SharedString, Task};
use theme::{ActiveTheme, Appearance, GlobalTheme, GlobalThemeRegistry, ThemeRegistry};

pub use custom_themes::*;
pub use catalog::{CDN_BASE_URL, Catalog, CatalogEntry, ExtensionIcon, ExtensionKind};
pub use icon_theme::{DEFAULT_ICON_THEME, IconTheme};
pub use languages::{LanguageDefinition, LanguageTools};
pub use manifest::{
    AgentContribution, DatabaseContribution, ExtensionManifest, McpServerConfig, McpServerContribution,
    SkillContribution, ToolDescriptor,
};
use store::InstalledStore;
pub use tools::{ToolKind, ToolState, ToolStatuses};

/// Where the catalog in use came from.
#[derive(Clone, Debug, PartialEq)]
pub enum CatalogSource {
    /// The copy built into the app.
    Bundled,
    Loading,
    /// The CDN's current catalog.
    Remote,
    /// The CDN could not be reached; the bundled copy stays in use.
    Failed(SharedString),
}

/// An install, update or uninstall in progress.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Operation {
    /// The fraction done, 0 to 1.
    Installing(f32),
    Uninstalling,
}

/// An extension's state, as the extension manager shows it.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ExtensionStatus {
    pub installed: bool,
    pub enabled: bool,
    pub installed_version: Option<String>,
    pub update_available: bool,
    pub operation: Option<Operation>,
    pub error: Option<SharedString>,
    /// Why the enterprise policy blocks installing it.
    pub blocked: bool,
}

pub struct Extensions {
    bundled: Catalog,
    catalog: Catalog,
    source: CatalogSource,
    /// `None` keeps the bundled catalog (tests, snapshots).
    cdn_base_url: Option<String>,
    store: InstalledStore,
    /// Manifests of installed extensions, read from their folders.
    installed: HashMap<String, Arc<ExtensionManifest>>,
    operations: HashMap<String, Operation>,
    errors: HashMap<String, SharedString>,
    icon_themes: Vec<Arc<IconTheme>>,
    /// The icon theme a picker is previewing, drawn instead of the chosen one.
    previewed_icon_theme: Option<String>,
    languages: Arc<[LanguageDefinition]>,
    /// Where language tools install (`<data dir>/tools`); `None` installs none (tests, snapshots).
    tool_data_dir: Option<PathBuf>,
    /// The tools of language extensions, by extension id.
    tools: HashMap<String, ToolStatuses>,
    /// Extensions whose missing tools were installed on demand this session.
    #[cfg_attr(target_family = "wasm", allow(dead_code))]
    tool_repairs: HashSet<String>,
    /// Counts tool installs that finished, so language servers can be looked for again.
    tools_generation: u64,
}

impl Global for Extensions {}

impl Extensions {
    fn new(dir: Option<PathBuf>, cdn_base_url: Option<String>) -> Self {
        let bundled = Catalog::bundled();
        let mut extensions = Self {
            catalog: bundled.clone(),
            bundled,
            source: CatalogSource::Bundled,
            cdn_base_url,
            store: InstalledStore::load(dir),
            installed: HashMap::new(),
            operations: HashMap::new(),
            errors: HashMap::new(),
            icon_themes: Vec::new(),
            previewed_icon_theme: None,
            languages: Arc::from([]),
            tool_data_dir: None,
            tools: HashMap::new(),
            tool_repairs: HashSet::new(),
            tools_generation: 0,
        };
        extensions.read_installed_manifests();
        extensions.rebuild();
        extensions
    }

    fn read_installed_manifests(&mut self) {
        self.installed.clear();
        let ids: Vec<String> = self.store.records().map(|(id, _)| id.clone()).collect();
        for id in ids {
            if let Some(manifest) = self.read_installed_manifest(&id) {
                self.installed.insert(id, Arc::new(manifest));
            }
        }
    }

    #[cfg(not(target_family = "wasm"))]
    fn read_installed_manifest(&self, id: &str) -> Option<ExtensionManifest> {
        let dir = self.store.dir()?;
        match installer::read_installed_manifest(dir, id) {
            Ok(manifest) => Some(manifest),
            Err(error) => {
                eprintln!("extensions: {id}: {error:#}");
                None
            }
        }
    }

    #[cfg(target_family = "wasm")]
    fn read_installed_manifest(&self, _: &str) -> Option<ExtensionManifest> {
        None
    }

    /// The manifest that applies: the installed one, otherwise the catalog's.
    fn manifest(&self, id: &str) -> Option<Arc<ExtensionManifest>> {
        self.installed.get(id).cloned().or_else(|| self.catalog.get(id).map(|entry| entry.manifest.clone()))
    }

    /// The extensions whose contributions are on: installed and enabled.
    fn active_manifests(&self) -> impl Iterator<Item = (&str, Arc<ExtensionManifest>)> {
        self.store
            .records()
            .filter(|(_, record)| record.enabled)
            .filter_map(|(id, _)| Some((id.as_str(), self.manifest(id)?)))
    }

    /// Recomputes what the extensions contribute after a change.
    fn rebuild(&mut self) {
        let mut icon_themes: Vec<Arc<IconTheme>> = IconTheme::bundled().into_iter().map(Arc::new).collect();
        for (id, manifest) in self.active_manifests() {
            let folder = self.store.dir().map(|dir| dir.join(id));
            for contribution in manifest.icon_themes() {
                let root = match &folder {
                    Some(folder) => icon_theme::IconRoot::Folder(folder),
                    None => icon_theme::IconRoot::Embedded,
                };
                icon_themes.push(Arc::new(IconTheme::from_contribution(id, contribution, root, false)));
            }
        }
        self.icon_themes = icon_themes;

        // Languages are known before their tools are installed, so every catalog language maps
        // files unless the user turned its extension off.
        let mut languages = Vec::new();
        for entry in self.catalog.entries() {
            let id = &entry.manifest.id;
            if self.store.is_installed(id) && !self.store.is_enabled(id) {
                continue;
            }
            let manifest = self.manifest(id).unwrap_or_else(|| entry.manifest.clone());
            languages.extend(LanguageDefinition::from_manifest(&manifest));
        }
        for (id, manifest) in self.active_manifests() {
            if self.catalog.get(id).is_none() {
                languages.extend(LanguageDefinition::from_manifest(&manifest));
            }
        }
        self.languages = languages.into();
    }

    pub fn catalog(&self) -> &Catalog {
        &self.catalog
    }

    pub fn catalog_source(&self) -> &CatalogSource {
        &self.source
    }

    /// Where the catalog and extension assets are read from, when online.
    pub fn cdn_base_url(&self) -> Option<&str> {
        self.cdn_base_url.as_deref()
    }

    /// Whether the catalog can be loaded from the CDN.
    pub fn is_online(&self) -> bool {
        self.cdn_base_url.is_some()
    }

    /// Catalog entries and installed extensions the catalog no longer lists.
    pub fn entries(&self) -> Vec<CatalogEntry> {
        let mut entries = self.catalog.entries().to_vec();
        for (id, manifest) in &self.installed {
            if self.catalog.get(id).is_none() {
                entries.push(CatalogEntry {
                    path: id.clone(),
                    kind: ExtensionKind::of(manifest),
                    manifest: manifest.clone(),
                    icon: self.bundled.get(id).and_then(|entry| entry.icon.clone()),
                });
            }
        }
        entries
    }

    pub fn entry(&self, id: &str) -> Option<CatalogEntry> {
        self.entries().into_iter().find(|entry| entry.manifest.id == id)
    }

    /// The language extension a file needs that is not installed yet, as its id and display
    /// name (`getExtensionForFile` without `isInstalled`).
    pub fn extension_needing_install(&self, path: &Path) -> Option<(String, String)> {
        let language = languages::language_for_path(&self.languages, path)?;
        let entry = self.catalog.get(&language.extension_id)?;
        if entry.kind != ExtensionKind::Language || self.store.is_installed(&entry.manifest.id) {
            return None;
        }
        Some((entry.manifest.id.clone(), entry.manifest.display_name.clone()))
    }

    pub fn status(&self, id: &str, settings: &settings::Settings) -> ExtensionStatus {
        let record = self.store.get(id);
        let available = self.catalog.get(id).map(|entry| entry.manifest.version.as_str());
        ExtensionStatus {
            installed: record.is_some(),
            enabled: record.is_some_and(|record| record.enabled),
            installed_version: record.map(|record| record.version.clone()),
            update_available: record
                .zip(available)
                .is_some_and(|(record, available)| manifest::is_newer(available, &record.version)),
            operation: self.operations.get(id).copied(),
            error: self.errors.get(id).cloned(),
            blocked: !allowed_by_policy(id, settings),
        }
    }

    pub fn installed_count(&self) -> usize {
        self.store.records().count()
    }

    pub fn icon_themes(&self) -> &[Arc<IconTheme>] {
        &self.icon_themes
    }

    pub fn icon_theme(&self, id: &str) -> Option<&Arc<IconTheme>> {
        self.icon_themes.iter().find(|theme| theme.id == id)
    }

    pub fn languages(&self) -> Arc<[LanguageDefinition]> {
        self.languages.clone()
    }

    /// The theme files of enabled theme extensions, for `ThemeRegistry::load_json`.
    pub fn theme_files(&self) -> Vec<String> {
        self.active_manifests().filter_map(|(_, manifest)| manifest.theme_file_json()).collect()
    }

    /// The MCP servers of enabled extensions, with the extension each comes from.
    pub fn mcp_servers(&self) -> Vec<(String, McpServerContribution)> {
        self.active_manifests()
            .flat_map(|(id, manifest)| manifest.mcp_servers().map(|server| (id.to_string(), server.clone())).collect::<Vec<_>>())
            .collect()
    }

    /// Every MCP server the catalog offers, installed or not.
    pub fn catalog_mcp_servers(&self) -> Vec<(String, McpServerContribution)> {
        self.catalog
            .entries()
            .iter()
            .flat_map(|entry| entry.manifest.mcp_servers().map(|server| (entry.manifest.id.clone(), server.clone())).collect::<Vec<_>>())
            .collect()
    }

    pub fn agents(&self) -> Vec<(String, AgentContribution)> {
        self.active_manifests()
            .flat_map(|(id, manifest)| manifest.agents().map(|agent| (id.to_string(), agent.clone())).collect::<Vec<_>>())
            .collect()
    }

    /// Every ACP agent the catalog offers; the agent host decides which it can run.
    pub fn catalog_agents(&self) -> Vec<(String, AgentContribution)> {
        self.catalog
            .entries()
            .iter()
            .flat_map(|entry| entry.manifest.agents().map(|agent| (entry.manifest.id.clone(), agent.clone())).collect::<Vec<_>>())
            .collect()
    }

    /// Enabled skills, with the folder their Markdown is in when the extension has one.
    pub fn skills(&self) -> Vec<(String, SkillContribution, Option<PathBuf>)> {
        self.active_manifests()
            .flat_map(|(id, manifest)| {
                let folder = self.store.dir().map(|dir| dir.join(id));
                manifest.skills().map(|skill| (id.to_string(), skill.clone(), folder.clone())).collect::<Vec<_>>()
            })
            .collect()
    }

    /// Enabled database providers, with the folder holding their sidecar binaries.
    pub fn databases(&self) -> Vec<(String, DatabaseContribution, Option<PathBuf>)> {
        self.active_manifests()
            .flat_map(|(id, manifest)| {
                let folder = self.store.dir().map(|dir| dir.join(id));
                manifest.databases().map(|database| (id.to_string(), database.clone(), folder.clone())).collect::<Vec<_>>()
            })
            .collect()
    }

    /// The state of each tool a language extension declares; `None` when it declares none.
    pub fn tool_statuses(&self, id: &str) -> Option<ToolStatuses> {
        let manifest = self.manifest(id)?;
        if ToolKind::ALL.iter().all(|kind| kind.descriptor(&manifest).is_none()) {
            return None;
        }
        Some(self.tools.get(id).cloned().unwrap_or_else(|| ToolStatuses::declared(&manifest, ToolState::Unknown)))
    }

    /// Language extensions whose tools were checked or installed, with their states.
    pub fn tracked_tools(&self) -> impl Iterator<Item = (&str, &ToolStatuses)> {
        self.tools.iter().map(|(id, statuses)| (id.as_str(), statuses))
    }

    /// Goes up each time tools finish installing.
    pub fn tools_generation(&self) -> u64 {
        self.tools_generation
    }

    pub fn tool_data_dir(&self) -> Option<&Path> {
        self.tool_data_dir.as_deref()
    }

    /// The enabled extension whose language server is `server` (a name in `servers.json`).
    pub fn extension_for_server(&self, server: &str) -> Option<String> {
        self.active_manifests()
            .find(|(_, manifest)| manifest.capabilities.lsp.as_ref().is_some_and(|lsp| lsp.name == server))
            .map(|(id, _)| id.to_string())
    }

    /// Enabled installed extensions with a `main` script, with their folders: the UI extension
    /// host starts these.
    pub fn ui_entrypoints(&self) -> Vec<(Arc<ExtensionManifest>, PathBuf)> {
        let Some(dir) = self.store.dir() else { return Vec::new() };
        self.active_manifests()
            .filter(|(id, manifest)| manifest.main.is_some() && self.installed.contains_key(*id))
            .map(|(id, manifest)| (manifest, dir.join(id)))
            .collect()
    }

    /// The folder of an installed extension.
    pub fn extension_dir(&self, id: &str) -> Option<PathBuf> {
        self.store.is_installed(id).then(|| self.store.dir().map(|dir| dir.join(id))).flatten()
    }
}

/// The folder extensions install into: `<data dir>/dev.athas.gpui/extensions`.
#[cfg(not(target_family = "wasm"))]
pub fn default_dir() -> Option<PathBuf> {
    dirs::data_dir().map(|dir| dir.join(paths::APP_ID).join("extensions"))
}

/// Sets up extensions with the default folder and CDN.
pub fn init(cx: &mut App) {
    #[cfg(not(target_family = "wasm"))]
    let dir = default_dir();
    #[cfg(target_family = "wasm")]
    let dir = None;
    init_with(cx, dir, Some(CDN_BASE_URL));
    #[cfg(not(target_family = "wasm"))]
    {
        set_tool_data_dir(tooling::default_data_dir(), cx);
        set_custom_themes_path(default_custom_themes_path(), cx);
    }
}

/// Sets up extensions installed in `dir` (in memory without one), from the CDN at
/// `cdn_base_url` (only the bundled catalog without one).
pub fn init_with(cx: &mut App, dir: Option<PathBuf>, cdn_base_url: Option<&str>) {
    cx.set_global(Extensions::new(dir, cdn_base_url.map(str::to_string)));
    refresh_themes(cx);
    let installed = installed_versions(get(cx));
    telemetry::record_extension_registry_sync(cx, &installed);
}

/// Sets the folder language tools install into: `tools/` and `runtimes/` inside it. `init`
/// uses the app's data folder.
pub fn set_tool_data_dir(dir: Option<PathBuf>, cx: &mut App) {
    cx.update_global::<Extensions, _>(|extensions, _| {
        extensions.tool_data_dir = dir;
        extensions.tools.clear();
    });
}

pub fn get(cx: &App) -> &Extensions {
    cx.global::<Extensions>()
}

/// Whether the enterprise policy lets the user install `id`: a managed install that requires
/// the allowlist only allows the ids on it.
pub fn allowed_by_policy(id: &str, settings: &settings::Settings) -> bool {
    if !(settings.enterprise_managed_mode && settings.enterprise_require_extension_allowlist) {
        return true;
    }
    let id = id.trim().to_lowercase();
    settings.enterprise_allowed_extension_ids.iter().any(|allowed| allowed.trim().to_lowercase() == id)
}

/// Installed extensions with their versions, for telemetry.
fn installed_versions(extensions: &Extensions) -> Vec<(String, Option<String>)> {
    let mut installed: Vec<(String, Option<String>)> =
        extensions.installed.iter().map(|(id, manifest)| (id.clone(), Some(manifest.version.clone()))).collect();
    installed.sort();
    installed
}

/// Loads the CDN's catalog in the background; the bundled one stays in use if that fails.
#[cfg(not(target_family = "wasm"))]
pub fn refresh_catalog(cx: &mut App) -> Task<()> {
    let extensions = get(cx);
    let Some(base_url) = extensions.cdn_base_url.clone() else { return Task::ready(()) };
    if extensions.source == CatalogSource::Loading {
        return Task::ready(());
    }
    let bundled = extensions.bundled.clone();
    cx.update_global::<Extensions, _>(|extensions, _| extensions.source = CatalogSource::Loading);
    let fetch = cx.background_spawn(async move { catalog::fetch(&base_url, &bundled) });
    cx.spawn(async move |cx| {
        let result = fetch.await;
        let loaded = result.is_ok();
        cx.update_global::<Extensions, _>(|extensions, _| match result {
            Ok(catalog) => {
                extensions.catalog = catalog;
                extensions.source = CatalogSource::Remote;
                extensions.rebuild();
            }
            Err(error) => extensions.source = CatalogSource::Failed(format!("{error:#}").into()),
        });
        if loaded {
            cx.update(|cx| {
                if !cx.has_global::<settings::SettingsStore>() {
                    return;
                }
                let extensions = get(cx);
                let settings = settings::get(cx);
                let installed = installed_versions(extensions);
                let updates: Vec<String> = installed.iter().map(|(id, _)| id.clone()).filter(|id| extensions.status(id, settings).update_available).collect();
                telemetry::record_extension_update_check(cx, &installed, &updates);
            });
        }
    })
}

/// Installs `id`, or updates it to the catalog's version. Packages download with progress;
/// data-only extensions install at once.
#[cfg(not(target_family = "wasm"))]
pub fn install(id: &str, cx: &mut App) -> Task<Result<()>> {
    let id = id.to_string();
    let extensions = get(cx);
    if !allowed_by_policy(&id, settings::get(cx)) {
        let error = anyhow!("Installing {id} is blocked: it is not on your organization's extension allowlist.");
        cx.update_global::<Extensions, _>(|extensions, _| {
            extensions.errors.insert(id.clone(), error.to_string().into());
        });
        return Task::ready(Err(error));
    }
    if extensions.operations.contains_key(&id) {
        return Task::ready(Ok(()));
    }
    let Some(entry) = extensions.catalog.get(&id).cloned() else {
        return Task::ready(Err(anyhow!("{id} is not in the extension catalog")));
    };
    let dir = extensions.store.dir().map(Path::to_path_buf);
    let was_installed = extensions.store.is_installed(&id);
    cx.update_global::<Extensions, _>(|extensions, _| {
        extensions.operations.insert(id.clone(), Operation::Installing(0.));
        extensions.errors.remove(&id);
    });

    let (progress_tx, mut progress_rx) = futures::channel::mpsc::unbounded::<f32>();
    let manifest = entry.manifest.clone();
    let task_id = id.clone();
    let work = cx.background_spawn(async move {
        let package = if manifest.has_package() {
            Some(manifest.package_for(&installer::platform()).ok_or_else(|| {
                anyhow!("{} has no package for {}", manifest.display_name, installer::platform())
            })?)
        } else {
            None
        };
        match (&dir, package) {
            (Some(dir), Some(package)) => installer::install_package(dir, &task_id, &package, &mut |stage| {
                let _ = progress_tx.unbounded_send(stage.fraction());
            }),
            (Some(dir), None) => installer::install_manifest(dir, &manifest).map(|()| manifest.as_ref().clone()),
            // Without a folder (tests, the web build) the catalog's manifest is all there is.
            (None, _) => Ok(manifest.as_ref().clone()),
        }
    });
    cx.spawn(async move |cx| {
        use futures::StreamExt as _;
        while let Some(fraction) = progress_rx.next().await {
            let id = id.clone();
            cx.update_global::<Extensions, _>(move |extensions, _| {
                extensions.operations.insert(id, Operation::Installing(fraction));
            });
        }
        let mut result = work.await;
        // A language extension installs its tools; without its language server it is not installed.
        if let Ok(manifest) = &result
            && tools::config_set(manifest).is_some()
            && cx.update(|cx| get(cx).tool_data_dir.is_some())
        {
            let manifest = Arc::new(manifest.clone());
            let task = cx.update(|cx| install_tools_for(&id, manifest, cx));
            if let Some(ToolState::Failed(message)) = task.await.lsp {
                result = Err(anyhow!("{message}"));
            }
        }
        let outcome = cx.update(|cx| {
            let outcome = cx.update_global::<Extensions, _>(|extensions, _| {
                extensions.operations.remove(&id);
                let manifest = result?;
                extensions.store.insert(&id, &manifest.version)?;
                let version = manifest.version.clone();
                extensions.installed.insert(id.clone(), Arc::new(manifest));
                extensions.rebuild();
                Ok(version)
            });
            if let Ok(version) = &outcome {
                let lifecycle = if was_installed { telemetry::ExtensionLifecycle::Update } else { telemetry::ExtensionLifecycle::Install };
                telemetry::record_extension_lifecycle(cx, lifecycle, &id, Some(version));
            }
            let outcome = outcome.map(|_| ());
            if let Err(error) = &outcome {
                let message: SharedString = format!("{error:#}").into();
                cx.update_global::<Extensions, _>(|extensions, _| {
                    extensions.errors.insert(id.clone(), message);
                });
            }
            refresh_themes(cx);
            outcome
        });
        outcome
    })
}

/// Removes `id` and its files; a theme or icon theme in use falls back to the default.
#[cfg(not(target_family = "wasm"))]
pub fn uninstall(id: &str, cx: &mut App) -> Task<Result<()>> {
    let id = id.to_string();
    let extensions = get(cx);
    if !extensions.store.is_installed(&id) || extensions.operations.contains_key(&id) {
        return Task::ready(Ok(()));
    }
    let dir = extensions.store.dir().map(Path::to_path_buf);
    let manifest = extensions.manifest(&id);
    cx.update_global::<Extensions, _>(|extensions, _| {
        extensions.operations.insert(id.clone(), Operation::Uninstalling);
        extensions.errors.remove(&id);
    });
    let task_id = id.clone();
    let work = cx.background_spawn(async move {
        match dir {
            Some(dir) => installer::uninstall(&dir, &task_id),
            None => Ok(()),
        }
    });
    cx.spawn(async move |cx| {
        let result = work.await;
        cx.update(|cx| {
            let outcome = cx.update_global::<Extensions, _>(|extensions, _| {
                extensions.operations.remove(&id);
                result?;
                extensions.store.remove(&id)?;
                extensions.installed.remove(&id);
                extensions.rebuild();
                Ok(())
            });
            match &outcome {
                Ok(()) => {
                    telemetry::record_extension_lifecycle(cx, telemetry::ExtensionLifecycle::Uninstall, &id, manifest.as_ref().map(|manifest| manifest.version.as_str()));
                    if let Some(manifest) = manifest {
                        fall_back_from(&manifest, cx);
                    }
                }
                Err(error) => {
                    let message: SharedString = format!("{error:#}").into();
                    cx.update_global::<Extensions, _>(|extensions, _| {
                        extensions.errors.insert(id.clone(), message);
                    });
                }
            }
            refresh_themes(cx);
            outcome
        })
    })
}

/// Turns an installed extension's contributions on or off.
pub fn set_enabled(id: &str, enabled: bool, cx: &mut App) -> Result<()> {
    let manifest = get(cx).manifest(id);
    cx.update_global::<Extensions, _>(|extensions, _| -> Result<()> {
        extensions.store.set_enabled(id, enabled)?;
        extensions.rebuild();
        Ok(())
    })?;
    if !enabled && let Some(manifest) = manifest {
        fall_back_from(&manifest, cx);
    }
    refresh_themes(cx);
    Ok(())
}

/// Checks which of a language extension's tools are installed (on PATH, in known toolchain
/// folders, or under the tools folder).
#[cfg(not(target_family = "wasm"))]
pub fn refresh_tool_status(id: &str, cx: &mut App) -> Task<()> {
    let extensions = get(cx);
    let Some(manifest) = extensions.manifest(id) else { return Task::ready(()) };
    let Some(set) = tools::config_set(&manifest) else { return Task::ready(()) };
    if extensions.tools.get(id).is_some_and(ToolStatuses::is_installing) {
        return Task::ready(());
    }
    let data_dir = extensions.tool_data_dir.clone();
    let language = primary_language(&manifest);
    let check = cx.background_spawn(async move {
        match data_dir {
            Some(dir) => tools::statuses_of(&tooling::language_tool_status(&dir, &language, Some(set))),
            None => ToolStatuses::declared(&manifest, ToolState::NotInstalled),
        }
    });
    let id = id.to_string();
    cx.spawn(async move |cx| {
        let statuses = check.await;
        cx.update_global::<Extensions, _>(|extensions, _| {
            if !extensions.tools.get(&id).is_some_and(ToolStatuses::is_installing) {
                extensions.tools.insert(id, statuses);
            }
        });
    })
}

/// Installs (or reinstalls) every tool a language extension declares, one after another, with
/// download progress. Each failure is kept in the tool's state instead of stopping the rest.
#[cfg(not(target_family = "wasm"))]
pub fn install_tools(id: &str, cx: &mut App) -> Task<ToolStatuses> {
    let Some(manifest) = get(cx).manifest(id) else { return Task::ready(ToolStatuses::default()) };
    install_tools_for(id, manifest, cx)
}

/// Installs a language extension's tools once a session, when its language server turned out
/// to be missing (the old app's language server repair).
#[cfg(not(target_family = "wasm"))]
pub fn repair_tools(id: &str, cx: &mut App) -> Option<Task<ToolStatuses>> {
    let extensions = get(cx);
    if extensions.tool_data_dir.is_none() || extensions.tool_repairs.contains(id) || !extensions.store.is_enabled(id) {
        return None;
    }
    cx.update_global::<Extensions, _>(|extensions, _| extensions.tool_repairs.insert(id.to_string()));
    Some(install_tools(id, cx))
}

#[cfg(not(target_family = "wasm"))]
fn install_tools_for(id: &str, manifest: Arc<ExtensionManifest>, cx: &mut App) -> Task<ToolStatuses> {
    let extensions = get(cx);
    let Some(set) = tools::config_set(&manifest) else { return Task::ready(ToolStatuses::default()) };
    if extensions.tools.get(id).is_some_and(ToolStatuses::is_installing) {
        return Task::ready(extensions.tools[id].clone());
    }
    let Some(data_dir) = extensions.tool_data_dir.clone() else {
        return Task::ready(ToolStatuses::declared(&manifest, ToolState::Failed("No folder to install tools into".into())));
    };
    let language = primary_language(&manifest);
    let id = id.to_string();
    let mut statuses = extensions.tools.get(&id).cloned().unwrap_or_else(|| ToolStatuses::declared(&manifest, ToolState::Unknown));
    for kind in ToolKind::ALL {
        if kind.descriptor(&manifest).is_some() {
            statuses.set(kind, ToolState::Installing(0.));
        }
    }
    cx.update_global::<Extensions, _>(|extensions, _| extensions.tools.insert(id.clone(), statuses.clone()));
    cx.spawn(async move |cx| {
        use futures::StreamExt as _;
        let set_state = |kind: ToolKind, state: ToolState, cx: &mut gpui::AsyncApp| {
            let id = id.clone();
            cx.update_global::<Extensions, _>(move |extensions, _| {
                if let Some(statuses) = extensions.tools.get_mut(&id) {
                    statuses.set(kind, state);
                }
            });
        };
        let mut installed_any = false;
        for kind in ToolKind::ALL {
            if kind.descriptor(&manifest).is_none() {
                continue;
            }
            let (progress_tx, mut progress_rx) = futures::channel::mpsc::unbounded::<f32>();
            let install = tooling::spawn({
                let (data_dir, language, set) = (data_dir.clone(), language.clone(), set.clone());
                async move {
                    let sink = move |fraction| {
                        let _ = progress_tx.unbounded_send(fraction);
                    };
                    tooling::with_progress(sink, tooling::install_tool(&data_dir, &language, kind.id(), Some(set))).await
                }
            });
            while let Some(fraction) = progress_rx.next().await {
                set_state(kind, ToolState::Installing(fraction), cx);
            }
            let state = match install.await {
                Ok(status) => tools::state_of(&status),
                Err(error) => ToolState::Failed(error.into()),
            };
            installed_any |= state == ToolState::Installed;
            statuses.set(kind, state.clone());
            set_state(kind, state, cx);
        }
        if installed_any {
            cx.update_global::<Extensions, _>(|extensions, _| extensions.tools_generation += 1);
        }
        statuses
    })
}

#[cfg(not(target_family = "wasm"))]
fn primary_language(manifest: &ExtensionManifest) -> String {
    manifest.languages().next().map_or_else(|| manifest.id.clone(), |language| language.id.clone())
}

/// Installs every installed extension the catalog has a newer version of.
#[cfg(not(target_family = "wasm"))]
pub fn update_all(cx: &mut App) -> Task<Result<()>> {
    let extensions = get(cx);
    let settings = settings::get(cx);
    let ids: Vec<String> = extensions
        .entries()
        .iter()
        .map(|entry| entry.manifest.id.clone())
        .filter(|id| extensions.status(id, settings).update_available)
        .collect();
    let tasks: Vec<Task<Result<()>>> = ids.iter().map(|id| install(id, cx)).collect();
    cx.spawn(async move |_| {
        let mut first_error = None;
        for task in tasks {
            if let Err(error) = task.await {
                first_error.get_or_insert(error);
            }
        }
        first_error.map_or(Ok(()), Err)
    })
}

/// Loads the CDN's catalog a few seconds after start and every six hours, so updates show
/// (`scheduleExtensionUpdateChecks`).
#[cfg(not(target_family = "wasm"))]
pub fn schedule_update_checks(cx: &mut App) {
    cx.spawn(async move |cx| {
        let mut delay = std::time::Duration::from_secs(5);
        loop {
            cx.background_executor().timer(delay).await;
            let task = cx.update(refresh_catalog);
            task.await;
            delay = std::time::Duration::from_secs(6 * 60 * 60);
        }
    })
    .detach();
}

pub fn dismiss_error(id: &str, cx: &mut App) {
    cx.update_global::<Extensions, _>(|extensions, _| {
        extensions.errors.remove(id);
    });
}

/// When the theme or icon theme in use goes away, the defaults take over.
fn fall_back_from(manifest: &ExtensionManifest, cx: &mut App) {
    let current = settings::get(cx);
    let defaults = settings::Settings::default();
    let theme_gone = manifest.themes().any(|theme| theme.id == current.theme);
    let icon_theme_gone = manifest.icon_themes().any(|theme| theme.id == current.icon_theme);
    if theme_gone || icon_theme_gone {
        settings::update(cx, |settings| {
            if theme_gone {
                settings.theme = defaults.theme.clone();
            }
            if icon_theme_gone {
                settings.icon_theme = defaults.icon_theme.clone();
            }
        });
    }
}

/// Builds the theme registry with the built-in themes and those of enabled extensions, and
/// picks `id` (or the Athas theme of `appearance`). Use it in place of `theme::init`.
pub fn init_theme(cx: &mut App, id: Option<&str>, appearance: Appearance, system_accent: bool) {
    let accent = system_accent.then(|| theme::macos_default_accent(appearance));
    let options = theme::options(accent, cx);
    let mut registry = ThemeRegistry::builtin(options);
    if let Some(extensions) = cx.try_global::<Extensions>() {
        for file in extensions.theme_files() {
            if let Err(error) = registry.load_json(&file, options) {
                eprintln!("extensions: a theme did not load: {error:#}");
            }
        }
    }
    registry.load_custom(custom_themes(cx), options);
    let fallback = match appearance {
        Appearance::Dark => "athas-dark",
        Appearance::Light => "athas-light",
    };
    let theme = id
        .and_then(|id| registry.get(id))
        .or_else(|| registry.get(fallback))
        .expect("the Athas theme is built in");
    theme::activate(theme, cx);
    cx.set_global(GlobalThemeRegistry(Arc::new(registry)));
}

/// Rebuilds the theme registry after extensions change, keeping the theme in use (or the
/// theme the settings name, once its extension is installed).
fn refresh_themes(cx: &mut App) {
    if !cx.has_global::<GlobalTheme>() {
        return;
    }
    let current = cx.theme().clone();
    let settings = settings::get(cx);
    let wanted = if settings.sync_system_theme {
        match current.appearance {
            Appearance::Dark => settings.auto_theme_dark.clone(),
            Appearance::Light => settings.auto_theme_light.clone(),
        }
    } else {
        settings.theme.clone()
    };
    let accent = settings.system_accent_color && cfg!(target_os = "macos");
    init_theme(cx, Some(&wanted), current.appearance, accent);
    cx.refresh_windows();
}

/// Picks the icon theme the file tree draws with.
pub fn set_icon_theme(id: &str, cx: &mut App) {
    let id = id.to_string();
    settings::update(cx, |settings| settings.icon_theme = id);
    cx.refresh_windows();
}

/// Draws with icon theme `id` until the preview ends (`None`), without saving it.
pub fn preview_icon_theme(id: Option<&str>, cx: &mut App) {
    cx.update_global::<Extensions, _>(|extensions, _| extensions.previewed_icon_theme = id.map(str::to_string));
    cx.refresh_windows();
}

/// The id of the icon theme in use (or being previewed).
pub fn active_icon_theme_id(cx: &App) -> String {
    cx.try_global::<Extensions>()
        .and_then(|extensions| extensions.previewed_icon_theme.clone())
        .or_else(|| cx.try_global::<settings::SettingsStore>().map(|_| settings::get(cx).icon_theme.clone()))
        .unwrap_or_else(|| DEFAULT_ICON_THEME.to_string())
}

/// The icon for a file tree entry from the icon theme in use, on the active theme's
/// appearance. `None` when the theme is not available (its extension was removed); draw the
/// built-in icon then.
pub fn icon_for(name: &str, is_dir: bool, expanded: bool, cx: &App) -> Option<ImageSource> {
    let extensions = cx.try_global::<Extensions>()?;
    let id = active_icon_theme_id(cx);
    let theme = extensions.icon_theme(&id).or_else(|| extensions.icon_theme(DEFAULT_ICON_THEME))?;
    let dark = cx.try_global::<GlobalTheme>().is_none_or(|theme| theme.0.appearance.is_dark());
    theme.icon(name, is_dir, expanded, dark)
}

/// The language a file is in, from the languages extensions define.
pub fn language_for_path(path: &Path, cx: &App) -> Option<LanguageDefinition> {
    let languages = cx.try_global::<Extensions>()?.languages();
    languages::language_for_path(&languages, path).cloned()
}

/// How to run the linter a file's language extension declares (`getLinterForFile`).
#[cfg(not(target_family = "wasm"))]
pub fn linter_for_path(path: &Path, cx: &App) -> Option<LinterPlan> {
    let extensions = cx.try_global::<Extensions>()?;
    let languages = extensions.languages();
    let language = languages::language_for_path(&languages, path)?;
    let descriptor = language.tools.linter.clone()?;
    let manifest = extensions.manifest(&language.extension_id)?;
    Some(LinterPlan {
        language: language.id.clone(),
        data_dir: extensions.tool_data_dir.clone(),
        tools: tools::config_set(&manifest),
        descriptor,
    })
}

#[cfg(not(target_family = "wasm"))]
#[derive(Clone, Debug)]
pub struct LinterPlan {
    language: String,
    data_dir: Option<PathBuf>,
    tools: Option<tooling::LanguageToolConfigSet>,
    descriptor: ToolDescriptor,
}

#[cfg(not(target_family = "wasm"))]
impl LinterPlan {
    /// Lints `content` with the installed linter, or the one on PATH. Blocks: run it in the
    /// background.
    pub fn run(&self, path: &Path, content: &str, workspace: Option<&Path>) -> tooling::LintResponse {
        let installed = self
            .data_dir
            .as_deref()
            .and_then(|dir| tooling::tool_path(dir, &self.language, "linter", self.tools.clone()).ok().flatten());
        let config = tooling::LinterConfig {
            command: installed.unwrap_or_else(|| self.descriptor.name.trim().to_string()),
            args: Some(self.descriptor.args.clone()),
            env: Some(self.descriptor.env.iter().map(|(key, value)| (key.clone(), value.clone())).collect()),
            input_method: None,
            diagnostic_format: None,
            diagnostic_pattern: None,
        };
        tooling::lint_code(&tooling::LintRequest {
            content: content.to_string(),
            language: self.language.clone(),
            linter: "generic".into(),
            linter_config: Some(config),
            file_path: Some(path.to_string_lossy().into_owned()),
            workspace_folder: workspace.map(|folder| folder.to_string_lossy().into_owned()),
        })
    }
}

/// How to run the formatter a file's language extension declares (`getFormatterForFile`).
#[cfg(not(target_family = "wasm"))]
pub fn formatter_for_path(path: &Path, cx: &App) -> Option<FormatterPlan> {
    let extensions = cx.try_global::<Extensions>()?;
    let languages = extensions.languages();
    let language = languages::language_for_path(&languages, path)?;
    let descriptor = language.tools.formatter.clone()?;
    let manifest = extensions.manifest(&language.extension_id)?;
    Some(FormatterPlan {
        language: language.id.clone(),
        data_dir: extensions.tool_data_dir.clone(),
        tools: tools::config_set(&manifest),
        descriptor,
    })
}

#[cfg(not(target_family = "wasm"))]
#[derive(Clone, Debug)]
pub struct FormatterPlan {
    language: String,
    data_dir: Option<PathBuf>,
    tools: Option<tooling::LanguageToolConfigSet>,
    descriptor: ToolDescriptor,
}

#[cfg(not(target_family = "wasm"))]
impl FormatterPlan {
    /// Formats `content` through stdin and stdout with the installed formatter, or the one on
    /// PATH. Blocks: run it in the background.
    pub fn run(&self, path: &Path, content: &str, workspace: Option<&Path>) -> tooling::FormatResponse {
        let installed = self
            .data_dir
            .as_deref()
            .and_then(|dir| tooling::tool_path(dir, &self.language, "formatter", self.tools.clone()).ok().flatten());
        let config = tooling::FormatterConfig {
            command: installed.unwrap_or_else(|| self.descriptor.name.trim().to_string()),
            args: Some(self.descriptor.args.clone()),
            env: Some(self.descriptor.env.iter().map(|(key, value)| (key.clone(), value.clone())).collect()),
            input_method: Some("stdin".into()),
            output_method: Some("stdout".into()),
        };
        let request = tooling::FormatRequest {
            content: content.to_string(),
            language: self.language.clone(),
            formatter: self.descriptor.name.clone(),
            formatter_config: Some(config),
            file_path: Some(path.to_string_lossy().into_owned()),
            workspace_folder: workspace.map(|folder| folder.to_string_lossy().into_owned()),
        };
        tooling::format_code(&request).unwrap_or_else(|error| tooling::FormatResponse {
            formatted_content: content.to_string(),
            success: false,
            error: Some(error),
        })
    }
}

/// The language server, formatter and linter a language's extension declares.
pub fn language_tools(language_id: &str, cx: &App) -> Option<LanguageTools> {
    let languages = cx.try_global::<Extensions>()?.languages();
    languages.iter().find(|language| language.id == language_id).map(|language| language.tools.clone())
}

/// The web build has no disk of its own to install extensions or tools into: the catalog and
/// what ships in the binary are all it shows.
#[cfg(target_family = "wasm")]
mod web {
    use super::*;

    const UNSUPPORTED: &str = "Extensions are installed from the desktop app";

    pub fn refresh_catalog(_: &mut App) -> Task<()> {
        Task::ready(())
    }

    pub fn install(_: &str, _: &mut App) -> Task<Result<()>> {
        Task::ready(Err(anyhow!(UNSUPPORTED)))
    }

    pub fn uninstall(_: &str, _: &mut App) -> Task<Result<()>> {
        Task::ready(Err(anyhow!(UNSUPPORTED)))
    }

    pub fn refresh_tool_status(_: &str, _: &mut App) -> Task<()> {
        Task::ready(())
    }

    pub fn install_tools(_: &str, _: &mut App) -> Task<ToolStatuses> {
        Task::ready(ToolStatuses::default())
    }

    pub fn repair_tools(_: &str, _: &mut App) -> Option<Task<ToolStatuses>> {
        None
    }

    pub fn update_all(_: &mut App) -> Task<Result<()>> {
        Task::ready(Ok(()))
    }

    pub fn schedule_update_checks(_: &mut App) {}
}

#[cfg(target_family = "wasm")]
pub use web::*;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::installer::tests::{package_for, serve, tarball, theme_manifest};
    use gpui::TestAppContext;

    fn setup(cx: &mut TestAppContext, dir: Option<PathBuf>) {
        cx.update(|cx| {
            settings::init(cx, settings::Settings::default(), None);
            theme::init(cx, None, Appearance::Dark, false);
            init_with(cx, dir, None);
        });
    }

    /// Puts a theme extension served by a local server into the catalog.
    fn add_theme_package(cx: &mut TestAppContext) {
        let archive = tarball(&[("extension.json", theme_manifest("athas.theme.test").as_bytes())]);
        let base = serve(vec![("/theme.tar.gz", archive.clone())]);
        let mut manifest = ExtensionManifest::from_json(&theme_manifest("athas.theme.test")).unwrap();
        let package = package_for(&base, "/theme.tar.gz", &archive);
        manifest.installation = Some(manifest::Installation {
            download_url: Some(package.download_url),
            size: Some(package.size),
            checksum: Some(package.checksum),
            ..Default::default()
        });
        cx.update(|cx| {
            cx.update_global::<Extensions, _>(|extensions, _| {
                let mut catalog = extensions.catalog.entries().to_vec();
                catalog.push(CatalogEntry { path: "theme/test".into(), kind: ExtensionKind::Theme, manifest: Arc::new(manifest), icon: None });
                extensions.catalog = Catalog::from_entries(catalog);
            })
        });
    }

    #[gpui::test]
    async fn installs_a_theme_and_registers_it(cx: &mut TestAppContext) {
        let dir = tempfile::tempdir().unwrap();
        setup(cx, Some(dir.path().to_path_buf()));
        add_theme_package(cx);
        assert!(cx.update(|cx| theme::registry(cx).get("test-dark").is_none()));

        cx.executor().allow_parking();
        let task = cx.update(|cx| install("athas.theme.test", cx));
        task.await.unwrap();
        cx.update(|cx| {
            assert!(theme::registry(cx).get("test-dark").is_some());
            assert!(theme::registry(cx).get("athas-dark").is_some());
            let status = get(cx).status("athas.theme.test", settings::get(cx));
            assert!(status.installed && status.enabled && status.operation.is_none());

            settings::update(cx, |settings| {
                settings.theme = "test-dark".into();
                settings.sync_system_theme = false;
            });
            set_enabled("athas.theme.test", false, cx).unwrap();
            assert!(theme::registry(cx).get("test-dark").is_none());
            assert_eq!(settings::get(cx).theme, "athas-dark");

            set_enabled("athas.theme.test", true, cx).unwrap();
            assert!(theme::registry(cx).get("test-dark").is_some());
        });

        // The install survives a restart.
        setup(cx, Some(dir.path().to_path_buf()));
        add_theme_package(cx);
        assert!(cx.update(|cx| theme::registry(cx).get("test-dark").is_some()));

        let task = cx.update(|cx| uninstall("athas.theme.test", cx));
        task.await.unwrap();
        cx.update(|cx| {
            assert!(theme::registry(cx).get("test-dark").is_none());
            assert!(!get(cx).status("athas.theme.test", settings::get(cx)).installed);
        });
        assert!(!dir.path().join("athas.theme.test").exists());
    }

    #[gpui::test]
    async fn a_bad_checksum_leaves_an_error(cx: &mut TestAppContext) {
        let dir = tempfile::tempdir().unwrap();
        setup(cx, Some(dir.path().to_path_buf()));
        add_theme_package(cx);
        cx.update(|cx| {
            cx.update_global::<Extensions, _>(|extensions, _| {
                let mut entries = extensions.catalog.entries().to_vec();
                let entry = entries.iter_mut().find(|entry| entry.manifest.id == "athas.theme.test").unwrap();
                let mut manifest = entry.manifest.as_ref().clone();
                manifest.installation.as_mut().unwrap().checksum = Some("0".repeat(64));
                entry.manifest = Arc::new(manifest);
                extensions.catalog = Catalog::from_entries(entries);
            })
        });
        cx.executor().allow_parking();
        let task = cx.update(|cx| install("athas.theme.test", cx));
        assert!(task.await.is_err());
        cx.update(|cx| {
            let status = get(cx).status("athas.theme.test", settings::get(cx));
            assert!(!status.installed);
            assert!(status.error.unwrap().contains("checksum mismatch"));
        });
    }

    #[gpui::test]
    async fn data_only_extensions_and_contributions(cx: &mut TestAppContext) {
        let dir = tempfile::tempdir().unwrap();
        setup(cx, Some(dir.path().to_path_buf()));
        cx.executor().allow_parking();
        for id in ["athas.mcp.github", "athas.skill.debugging", "athas.agent.claude-acp"] {
            let task = cx.update(|cx| install(id, cx));
            task.await.unwrap();
        }
        cx.update(|cx| {
            let extensions = get(cx);
            assert_eq!(extensions.mcp_servers().len(), 1);
            assert_eq!(extensions.mcp_servers()[0].1.id, "github");
            assert_eq!(extensions.agents()[0].1.id, "claude-acp");
            assert_eq!(extensions.skills()[0].1.path, "SKILL.md");
            assert_eq!(extensions.catalog_mcp_servers().len(), 21);
            assert!(dir.path().join("athas.mcp.github/extension.json").is_file());

            set_enabled("athas.mcp.github", false, cx).unwrap();
            assert!(get(cx).mcp_servers().is_empty());
            assert!(get(cx).status("athas.mcp.github", settings::get(cx)).installed);
        });
    }

    /// A language extension whose language server downloads from a local server.
    fn add_language(cx: &mut TestAppContext, lsp_url: &str) {
        let json = format!(
            r##"{{"$schema": "https://athas.dev/schemas/extension.json", "id": "athas.fixture", "name": "fixture",
            "displayName": "Fixture", "description": "A test language", "version": "1.0.0", "publisher": "Athas",
            "categories": ["Language"], "languages": [{{"id": "fixture", "extensions": [".fixture"]}}],
            "capabilities": {{"lsp": {{"name": "athas-fixture-ls", "runtime": "binary", "downloadUrl": "{lsp_url}"}},
            "formatter": {{"name": "athas-fixture-fmt", "runtime": "binary", "downloadUrl": "{lsp_url}.missing"}}}}}}"##
        );
        let manifest = ExtensionManifest::from_json(&json).unwrap();
        cx.update(|cx| {
            cx.update_global::<Extensions, _>(|extensions, _| {
                let mut catalog = extensions.catalog.entries().to_vec();
                catalog.push(CatalogEntry { path: "fixture".into(), kind: ExtensionKind::Language, manifest: Arc::new(manifest), icon: None });
                extensions.catalog = Catalog::from_entries(catalog);
            })
        });
    }

    #[gpui::test]
    async fn installs_language_tools_with_the_extension(cx: &mut TestAppContext) {
        let dir = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        setup(cx, Some(dir.path().to_path_buf()));
        cx.update(|cx| set_tool_data_dir(Some(data.path().to_path_buf()), cx));
        let archive = tarball(&[("fixture-ls/bin/athas-fixture-ls", b"#!/bin/sh\n")]);
        let base = serve(vec![("/fixture-ls.tar.gz", archive)]);
        add_language(cx, &format!("{base}/fixture-ls.tar.gz"));
        cx.update(|cx| {
            let statuses = get(cx).tool_statuses("athas.fixture").unwrap();
            assert_eq!(statuses.lsp, Some(ToolState::Unknown));
            assert_eq!(statuses.linter, None);
        });

        cx.executor().allow_parking();
        let task = cx.update(|cx| install("athas.fixture", cx));
        task.await.unwrap();
        cx.update(|cx| {
            let extensions = get(cx);
            assert!(extensions.status("athas.fixture", settings::get(cx)).installed);
            let statuses = extensions.tool_statuses("athas.fixture").unwrap();
            assert_eq!(statuses.lsp, Some(ToolState::Installed));
            assert!(matches!(statuses.formatter, Some(ToolState::Failed(_))), "a formatter that fails leaves an issue");
            assert_eq!(statuses.issue().unwrap().0, ToolKind::Formatter);
            assert_eq!(extensions.tools_generation(), 1);
            assert_eq!(extensions.extension_for_server("athas-fixture-ls").as_deref(), Some("athas.fixture"));
        });
        assert!(data.path().join("tools/binary/athas-fixture-ls/fixture-ls/bin/athas-fixture-ls").is_file());

        let task = cx.update(|cx| refresh_tool_status("athas.fixture", cx));
        task.await;
        cx.update(|cx| {
            let statuses = get(cx).tool_statuses("athas.fixture").unwrap();
            assert_eq!(statuses.lsp, Some(ToolState::Installed));
            assert_eq!(statuses.formatter, Some(ToolState::NotInstalled));
            // A repair runs once a session.
            assert!(repair_tools("athas.fixture", cx).is_some());
            assert!(repair_tools("athas.fixture", cx).is_none());
        });
    }

    #[gpui::test]
    async fn a_language_server_that_cannot_install_fails_the_extension(cx: &mut TestAppContext) {
        let dir = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        setup(cx, Some(dir.path().to_path_buf()));
        cx.update(|cx| set_tool_data_dir(Some(data.path().to_path_buf()), cx));
        let base = serve(vec![]);
        add_language(cx, &format!("{base}/gone.tar.gz"));
        cx.executor().allow_parking();
        let task = cx.update(|cx| install("athas.fixture", cx));
        assert!(task.await.is_err());
        cx.update(|cx| {
            let status = get(cx).status("athas.fixture", settings::get(cx));
            assert!(!status.installed);
            assert!(status.error.unwrap().contains("404"));
        });
    }

    #[gpui::test]
    fn languages_and_icons(cx: &mut TestAppContext) {
        setup(cx, None);
        cx.update(|cx| {
            assert_eq!(language_for_path(Path::new("main.rs"), cx).unwrap().id, "rust");
            assert_eq!(language_tools("rust", cx).unwrap().lsp.unwrap().name, "rust-analyzer");
            assert!(matches!(
                icon_for("main.rs", false, false, cx),
                Some(ImageSource::Resource(gpui::Resource::Embedded(path))) if path.as_ref() == "file-icons/lang-rust-color.svg"
            ));
            set_icon_theme("pierre-icons-minimal", cx);
            assert!(matches!(
                icon_for("main.rs", false, false, cx),
                Some(ImageSource::Resource(gpui::Resource::Embedded(path))) if path.as_ref() == "file-icons/file-duo.svg"
            ));
            // An icon theme that is gone falls back to the default.
            set_icon_theme("material", cx);
            assert!(icon_for("main.rs", false, false, cx).is_some());
        });
    }

    #[gpui::test]
    fn enterprise_allowlist_blocks_installs(cx: &mut TestAppContext) {
        setup(cx, None);
        let error = cx.update(|cx| {
            settings::update(cx, |settings| {
                settings.enterprise_managed_mode = true;
                settings.enterprise_require_extension_allowlist = true;
                settings.enterprise_allowed_extension_ids = vec!["athas.rust".into()];
            });
            assert!(get(cx).status("athas.mcp.github", settings::get(cx)).blocked);
            assert!(!get(cx).status("athas.rust", settings::get(cx)).blocked);
            install("athas.mcp.github", cx)
        });
        assert!(futures::FutureExt::now_or_never(error).unwrap().is_err());
    }
}
