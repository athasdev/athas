//! The app's UI extension host: AI-generated extensions kept in `generated-ui-extensions.json`
//! (`localStorage` in the browser), started at launch, created from a prompt, paused, resumed and
//! removed; and installed extensions with a `main` script, started while they are enabled. Host
//! events become toasts, clipboard writes and opened links.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::rc::Rc;
use std::sync::Arc;
use std::time::Duration;

use extension_host::generate::{ExtensionGenerator, generate_extension};
use extension_host::generated::{GENERATED_STORE_FILE, normalize_generated_id};
pub use extension_host::SidebarView as SidebarViewInfo;
pub use extension_host::store::ToolbarPosition;
use extension_host::{
    AiProvider, AiSettingsAction, Command, Dialog, ExtensionState, GeneratedExtension, GeneratedStore, Host, HostEvent, HostManifest, HostServices, Limits,
    Permissions, PlatformWorkers, Registration, SidebarView, ToolbarAction,
};
use futures::StreamExt as _;
use gpui::{App, AppContext as _, AsyncApp, BorrowAppContext, ClipboardItem, Global, SharedString, Task};
use notifications::{NotificationCategory, NotificationKind};

pub struct UiExtensions {
    host: Host,
    store: GeneratedStore,
    generator: Option<Rc<dyn ExtensionGenerator>>,
    generating: bool,
    generate_error: Option<SharedString>,
    /// Installed extensions whose `main` script the host was asked to start, with the version
    /// it runs: an update (a new version) unloads the old script and loads the new one.
    installed: std::collections::HashMap<String, String>,
}

impl Global for UiExtensions {}

/// Where generated extensions and their storage live: the app's data folder on the desktop,
/// memory in the browser.
fn default_data_dir() -> Option<PathBuf> {
    #[cfg(not(target_family = "wasm"))]
    return extensions::default_dir().and_then(|dir| dir.parent().map(|parent| parent.to_path_buf()));
    #[cfg(target_family = "wasm")]
    return None;
}

pub(crate) fn init(cx: &mut App) {
    if cx.has_global::<UiExtensions>() {
        return;
    }
    init_with(cx, default_data_dir());
}

/// Sets up the host with its data in `data_dir` (memory only without one) and starts the stored
/// extensions that are not paused.
pub fn init_with(cx: &mut App, data_dir: Option<PathBuf>) {
    let services = Arc::new(HostServices::new(data_dir.as_ref().map(|dir| dir.join("ui-extension-storage")), bridge(), http()));
    let (host, mut events) = Host::new(Arc::new(PlatformWorkers), services, Limits::default());
    let store = match data_dir {
        Some(dir) => GeneratedStore::at(Some(dir.join(GENERATED_STORE_FILE))),
        None => GeneratedStore::local_storage(),
    };
    let stored = store.read();
    cx.set_global(UiExtensions { host: host.clone(), store, generator: None, generating: false, generate_error: None, installed: Default::default() });
    #[cfg(not(target_family = "wasm"))]
    ai_providers::set_external_providers(Some(Arc::new(ProviderBridge(host.clone()))));

    cx.spawn(async move |cx: &mut AsyncApp| {
        while let Some(event) = events.next().await {
            cx.update(|cx| handle_event(event, cx));
        }
    })
    .detach();
    let expiring = host.clone();
    cx.spawn(async move |cx: &mut AsyncApp| {
        loop {
            cx.background_executor().timer(Duration::from_secs(1)).await;
            expiring.expire_requests();
        }
    })
    .detach();

    for extension in stored {
        if extension.disabled {
            host.register_disabled(&extension);
        } else {
            let task = host.load_generated(&extension);
            cx.spawn(async move |_| {
                if let Err(error) = task.await {
                    eprintln!("ui extensions: {}: {error}", extension.name);
                }
            })
            .detach();
        }
    }

    sync_installed(cx);
    cx.observe_global::<extensions::Extensions>(sync_installed).detach();
}

/// The host's manifest for an installed extension.
fn host_manifest(manifest: &extensions::manifest::ExtensionManifest) -> HostManifest {
    let permissions = manifest.permissions.clone().map(|granted| Permissions {
        network: granted.network,
        secrets: granted.secrets,
        settings: granted.settings,
        workspace: granted.workspace,
        open_external: granted.open_external,
        clipboard_write: granted.clipboard_write,
    });
    HostManifest {
        id: manifest.id.clone(),
        name: if manifest.display_name.is_empty() { manifest.name.clone() } else { manifest.display_name.clone() },
        description: manifest.description.clone(),
        permissions: permissions.unwrap_or_default(),
        ai_providers: manifest
            .ai_providers()
            .cloned()
            .map(|mut provider| {
                if let (Some(icon), Some(fields)) = (&manifest.icon, provider.as_object_mut()) {
                    fields.entry("icon").or_insert_with(|| serde_json::Value::String(icon.clone()));
                }
                provider
            })
            .collect(),
    }
}

/// Starts the `main` script of each enabled installed extension and stops those turned off or
/// removed (`activateExtensionContributions` with `manifest.main`).
fn sync_installed(cx: &mut App) {
    if !cx.has_global::<UiExtensions>() {
        return;
    }
    let wanted: Vec<(HostManifest, PathBuf, String, String)> = cx
        .try_global::<extensions::Extensions>()
        .map(|extensions| {
            extensions
                .ui_entrypoints()
                .into_iter()
                .filter_map(|(manifest, dir)| Some((host_manifest(&manifest), dir, manifest.main.clone()?, manifest.version.clone())))
                .collect()
        })
        .unwrap_or_default();
    let wanted_ids: HashSet<String> = wanted.iter().map(|(manifest, ..)| manifest.id.clone()).collect();
    let (start, stop) = cx.update_global::<UiExtensions, _>(|state, _| {
        let stop: Vec<String> = state.installed.keys().filter(|id| !wanted_ids.contains(*id)).cloned().collect();
        state.installed.retain(|id, _| wanted_ids.contains(id));
        // New, or a different version than the one running (updated): (re)loaded, the old
        // script unloaded first.
        let start: Vec<_> = wanted
            .into_iter()
            .filter_map(|(manifest, dir, main, version)| {
                let previous = state.installed.insert(manifest.id.clone(), version.clone());
                (previous.as_ref() != Some(&version)).then_some((manifest, dir, main, previous.is_some()))
            })
            .collect();
        (start, stop)
    });
    let host = host(cx);
    for id in stop {
        cx.background_executor().spawn(host.unload(&id)).detach();
    }
    for (manifest, dir, main, reload) in start {
        let read = cx.background_spawn(async move { read_entrypoint(&dir, &main) });
        let host = host.clone();
        cx.spawn(async move |_| {
            let id = manifest.id.clone();
            if reload {
                host.unload(&id).await;
            }
            let result = match read.await {
                Ok(source) => host.load(manifest, Some(source), false).await,
                Err(error) => {
                    host.register_extension(Registration {
                        extension_id: id.clone(),
                        name: Some(manifest.name.clone()),
                        description: Some(manifest.description.clone()),
                        contribution_type: None,
                        state: ExtensionState::Error,
                        error: Some(error.clone()),
                    });
                    Err(error)
                }
            };
            if let Err(error) = result {
                eprintln!("ui extensions: {id}: {error}");
            }
        })
        .detach();
    }
}

/// Reads an extension's `main` script (`read_extension_entrypoint`): a file of at most 2 MB inside
/// its folder.
#[cfg(not(target_family = "wasm"))]
fn read_entrypoint(dir: &Path, entrypoint: &str) -> Result<String, String> {
    let folder = dir.canonicalize().map_err(|error| format!("Failed to resolve integration directory: {error}"))?;
    let path = dir.join(entrypoint).canonicalize().map_err(|error| format!("Failed to resolve integration entrypoint: {error}"))?;
    if !path.starts_with(&folder) {
        return Err("Integration entrypoint escaped its installation directory".into());
    }
    let metadata = std::fs::metadata(&path).map_err(|error| format!("Failed to inspect integration entrypoint: {error}"))?;
    if !metadata.is_file() || metadata.len() > 2 * 1024 * 1024 {
        return Err("Integration entrypoint must be a file no larger than 2 MB".into());
    }
    std::fs::read_to_string(path).map_err(|error| format!("Failed to read integration entrypoint: {error}"))
}

#[cfg(target_family = "wasm")]
fn read_entrypoint(_: &Path, _: &str) -> Result<String, String> {
    Err("Installed integrations do not run in the browser".into())
}

#[cfg(not(target_family = "wasm"))]
fn http() -> Option<Arc<dyn extension_host::services::HttpClient>> {
    Some(Arc::new(extension_host::services::UreqClient))
}

#[cfg(target_family = "wasm")]
fn http() -> Option<Arc<dyn extension_host::services::HttpClient>> {
    None
}

/// Extension secrets in the keychain, as `extension_<id>_<key>`.
#[cfg(not(target_family = "wasm"))]
struct KeychainBridge;

#[cfg(not(target_family = "wasm"))]
impl extension_host::AppBridge for KeychainBridge {
    fn secret(&self, extension_id: &str, key: &str) -> Result<Option<String>, String> {
        use ai_providers::SecretStore as _;
        Ok(ai_providers::Keychain::shared().get(&format!("extension_{extension_id}_{key}")))
    }

    fn set_secret(&self, extension_id: &str, key: &str, value: &str) -> Result<(), String> {
        use ai_providers::SecretStore as _;
        ai_providers::Keychain::shared().set(&format!("extension_{extension_id}_{key}"), value)
    }

    fn delete_secret(&self, extension_id: &str, key: &str) -> Result<(), String> {
        use ai_providers::SecretStore as _;
        ai_providers::Keychain::shared().delete(&format!("extension_{extension_id}_{key}"))
    }
}

/// Chat and completion requests to the AI providers extensions register.
#[cfg(not(target_family = "wasm"))]
struct ProviderBridge(Host);

#[cfg(not(target_family = "wasm"))]
impl ai_providers::ExternalProviders for ProviderBridge {
    fn providers(&self) -> Vec<ai_providers::ExternalProvider> {
        self.0.with_store(|store| {
            store
                .ai_providers
                .iter()
                .map(|provider| ai_providers::ExternalProvider {
                    id: provider.provider_id.clone(),
                    name: provider.name(),
                    requires_api_key: provider.requires_api_key(),
                    models: provider.models(),
                    icon: provider.contribution.get("icon").and_then(serde_json::Value::as_str).filter(|icon| !icon.trim().is_empty()).map(str::to_string),
                })
                .collect()
        })
    }

    fn request(&self, provider_id: &str, method: &str, args: Vec<serde_json::Value>) -> futures::future::BoxFuture<'static, Result<serde_json::Value, String>> {
        Box::pin(self.0.ai_provider_request(provider_id, method, args))
    }
}

fn bridge() -> Arc<dyn extension_host::AppBridge> {
    #[cfg(not(target_family = "wasm"))]
    return Arc::new(KeychainBridge);
    #[cfg(target_family = "wasm")]
    return Arc::new(extension_host::services::NoBridge);
}

fn handle_event(event: HostEvent, cx: &mut App) {
    match event {
        HostEvent::Changed => cx.update_global::<UiExtensions, _>(|_, _| {}),
        HostEvent::Notification { title, description, tone, .. } => {
            let kind = match tone.as_str() {
                "success" => NotificationKind::Success,
                "warning" => NotificationKind::Warning,
                "error" => NotificationKind::Error,
                _ => NotificationKind::Info,
            };
            notifications::notify(cx, kind, NotificationCategory::Athas, title, description.map(SharedString::from), None);
        }
        HostEvent::Clipboard(text) => cx.write_to_clipboard(ClipboardItem::new_string(text)),
        HostEvent::OpenExternal(url) => cx.open_url(&url),
        HostEvent::EditorSettings(value) => settings::set_editor_overrides(cx, settings::EditorOverrides::from_json(&value)),
        HostEvent::ClearEditorSettings => settings::clear_editor_overrides(cx),
        HostEvent::Log { extension_id, level, message } => {
            if level == "error" || level == "warn" {
                eprintln!("ui extension {extension_id}: {message}");
            }
        }
    }
}

pub fn host(cx: &App) -> Host {
    cx.global::<UiExtensions>().host.clone()
}

fn read_store<T: Default>(cx: &App, read: impl FnOnce(&extension_host::Store) -> T) -> T {
    cx.try_global::<UiExtensions>().map(|state| state.host.with_store(read)).unwrap_or_default()
}

/// Sidebar views the running extensions registered, in their order.
pub fn sidebar_views(cx: &App) -> Vec<SidebarView> {
    read_store(cx, |store| store.ordered_sidebar_views())
}

pub fn toolbar_actions(position: ToolbarPosition, cx: &App) -> Vec<ToolbarAction> {
    read_store(cx, |store| store.toolbar_actions_at(position))
}

/// Commands the extensions offer in the command palette.
pub fn commands(cx: &App) -> Vec<Command> {
    read_store(cx, |store| store.commands.values().cloned().collect())
}

/// Dialogs the extensions have open, the newest last.
pub fn dialogs(cx: &App) -> Vec<Dialog> {
    read_store(cx, |store| store.dialogs.clone())
}

pub fn close_dialog(dialog_id: &str, cx: &App) {
    if cx.has_global::<UiExtensions>() {
        host(cx).close_dialog(dialog_id);
    }
}

/// AI providers the extensions registered, as their manifests describe them.
pub fn ai_providers(cx: &App) -> Vec<AiProvider> {
    read_store(cx, |store| store.ai_providers.clone())
}

/// The buttons extensions add to Settings > AI ("From extensions").
pub fn ai_settings_actions(cx: &App) -> Vec<AiSettingsAction> {
    read_store(cx, |store| store.ai_settings_actions.clone())
}

/// Runs a palette command; a failure shows as an error toast.
pub fn run_command(command_id: &str, cx: &mut App) {
    let task = host(cx).run_registered_command(command_id, Vec::new());
    cx.spawn(async move |cx| {
        if let Err(error) = task.await {
            cx.update(|cx| notifications::error(cx, error, None));
        }
    })
    .detach();
}

/// Runs the command behind an AI settings action.
pub fn run_ai_settings_action(action: &AiSettingsAction, cx: &mut App) {
    let task = host(cx).execute_command(&action.extension_id, &action.command_id, Vec::new());
    cx.spawn(async move |cx| {
        if let Err(error) = task.await {
            cx.update(|cx| notifications::error(cx, error, None));
        }
    })
    .detach();
}

/// Clicks a toolbar action; a failure marks the extension as errored.
pub fn run_toolbar_action(action: &ToolbarAction, cx: &mut App) {
    let host = host(cx);
    let task = host.execute_toolbar_action(&action.extension_id, &action.id);
    let extension_id = action.extension_id.clone();
    cx.background_executor()
        .spawn(async move {
            if let Err(error) = task.await {
                host.update_extension_state(&extension_id, ExtensionState::Error, Some(error));
            }
        })
        .detach();
}

/// The icon an extension names in kebab case (`puzzle-piece`), the puzzle piece when unknown.
pub fn icon(name: &str) -> ui::IconName {
    let key: String = name
        .split('-')
        .map(|part| {
            let mut chars = part.chars();
            chars.next().map(|first| first.to_uppercase().chain(chars).collect::<String>()).unwrap_or_default()
        })
        .collect();
    ui::IconName::from_name(&key).unwrap_or(ui::IconName::PuzzlePiece)
}

/// Replaces how prompts reach a model (the AI settings' model by default).
pub fn set_generator(generator: Rc<dyn ExtensionGenerator>, cx: &mut App) {
    cx.global_mut::<UiExtensions>().generator = Some(generator);
}

/// Each stored generated extension with what the host knows of it.
pub fn generated(cx: &App) -> Vec<(GeneratedExtension, Option<Registration>)> {
    let state = cx.global::<UiExtensions>();
    let registrations = state.host.store().extensions;
    state.store.read().into_iter().map(|extension| {
        let registration = registrations.get(&normalize_generated_id(&extension.id)).cloned();
        (extension, registration)
    }).collect()
}

pub fn is_generating(cx: &App) -> bool {
    cx.global::<UiExtensions>().generating
}

pub fn generate_error(cx: &App) -> Option<SharedString> {
    cx.global::<UiExtensions>().generate_error.clone()
}

/// Installs a generated record: starts it and, once it runs, keeps it.
pub fn install(extension: GeneratedExtension, cx: &mut App) -> Task<Result<String, String>> {
    let task = host(cx).load_generated(&extension);
    cx.spawn(async move |cx| {
        let id = task.await?;
        cx.update(|cx| cx.update_global::<UiExtensions, _>(|state, _| state.store.store(&extension)))?;
        Ok(id)
    })
}

/// Asks the model for an extension that does what `prompt` describes, then installs it.
pub fn generate(prompt: String, cx: &mut App) -> Task<Result<String, String>> {
    let generator = cx.global::<UiExtensions>().generator.clone().or_else(|| default_generator(cx));
    let Some(generator) = generator else {
        return Task::ready(Err("Creating extensions with AI is not available here".into()));
    };
    cx.update_global::<UiExtensions, _>(|state, _| {
        state.generating = true;
        state.generate_error = None;
    });
    cx.spawn(async move |cx| {
        let result = match generate_extension(generator.as_ref(), &prompt).await {
            Ok(extension) => cx.update(|cx| install(extension, cx)).await,
            Err(error) => Err(error),
        };
        cx.update(|cx| {
            cx.update_global::<UiExtensions, _>(|state, _| {
                state.generating = false;
                state.generate_error = result.as_ref().err().map(|error| SharedString::from(error.clone()));
            })
        });
        result
    })
}

pub fn set_enabled(extension_id: &str, enabled: bool, cx: &mut App) -> Task<Result<(), String>> {
    let found = cx.update_global::<UiExtensions, _>(|state, _| state.store.set_disabled(extension_id, !enabled));
    let extension = match found {
        Ok(Some(extension)) => extension,
        Ok(None) => return Task::ready(Err(format!("No generated extension {extension_id}"))),
        Err(error) => return Task::ready(Err(error)),
    };
    let host = host(cx);
    cx.spawn(async move |_| {
        if enabled {
            host.load_generated(&extension).await.map(|_| ())
        } else {
            host.unload(&normalize_generated_id(&extension.id)).await;
            host.register_disabled(&extension);
            Ok(())
        }
    })
}

pub fn remove(extension_id: &str, cx: &mut App) -> Task<Result<(), String>> {
    let removed = cx.update_global::<UiExtensions, _>(|state, _| state.store.remove(extension_id));
    let host = host(cx);
    let extension_id = extension_id.to_string();
    cx.spawn(async move |_| {
        removed?;
        host.unload(&extension_id).await;
        host.cleanup_extension(&extension_id);
        Ok(())
    })
}

/// The AI settings' model (Settings > AI), through `ai_providers`.
#[cfg(not(target_family = "wasm"))]
fn default_generator(cx: &App) -> Option<Rc<dyn ExtensionGenerator>> {
    let settings = settings::get(cx);
    Some(Rc::new(ModelGenerator(ai_providers::ProviderSettings {
        provider_id: settings.ai_provider_id.clone(),
        model_id: settings.ai_model_id.clone(),
        custom_base_url: settings.ai_custombase_url.clone(),
        custom_model_id: settings.ai_custom_model_id.clone(),
        ollama_base_url: settings.ollama_base_url.clone(),
    })))
}

#[cfg(target_family = "wasm")]
fn default_generator(_: &App) -> Option<Rc<dyn ExtensionGenerator>> {
    None
}

#[cfg(not(target_family = "wasm"))]
struct ModelGenerator(ai_providers::ProviderSettings);

#[cfg(not(target_family = "wasm"))]
impl ExtensionGenerator for ModelGenerator {
    fn complete(&self, system: String, prompt: String) -> futures::future::LocalBoxFuture<'static, Result<String, String>> {
        let settings = self.0.clone();
        Box::pin(async move {
            let connection = ai_providers::Connection::resolve(&settings, ai_providers::Keychain::shared()).map_err(|error| error.to_string())?;
            let request = ai_providers::Request {
                system,
                messages: vec![ai_providers::Message::user(prompt)],
                max_tokens: connection.default_max_tokens().min(16_000),
                ..Default::default()
            };
            let mut stream = connection.stream(&request).await.map_err(|error| error.to_string())?;
            let mut text = String::new();
            while let Some(event) = stream.next().await {
                if let ai_providers::Event::Text(chunk) = event.map_err(|error| error.to_string())? {
                    text.push_str(&chunk);
                }
            }
            Ok(text)
        })
    }
}

#[cfg(test)]
mod tests {
    use gpui::TestAppContext;

    use super::*;

    #[test]
    fn names_icons_in_kebab_case() {
        assert_eq!(icon("check-circle"), ui::IconName::CheckCircle);
        assert_eq!(icon("list-checks"), ui::IconName::ListChecks);
        assert_eq!(icon("no-such-icon"), ui::IconName::PuzzlePiece);
    }

    /// An installed extension's `main` script is found, read from its folder and started by the
    /// host; a script outside the folder is refused.
    #[gpui::test]
    fn finds_and_starts_installed_main_scripts(cx: &mut TestAppContext) {
        let folder = tempfile::tempdir().unwrap();
        let extensions_dir = folder.path().join("extensions");
        let package = extensions_dir.join("acme.panel");
        std::fs::create_dir_all(&package).unwrap();
        std::fs::write(extensions_dir.join("installed.json"), r#"{ "acme.panel": { "version": "1.0.0", "enabled": true, "installedAt": 0 } }"#).unwrap();
        std::fs::write(
            package.join("extension.json"),
            format!(
                r#"{{ "$schema": "{}", "id": "acme.panel", "name": "panel", "displayName": "Acme Panel", "description": "A panel", "version": "1.0.0",
                "publisher": "Acme", "categories": ["UI"], "main": "main.js", "permissions": {{ "secrets": true }} }}"#,
                extensions::manifest::SCHEMA_URL
            ),
        )
        .unwrap();
        std::fs::write(
            package.join("main.js"),
            r#"export function activate(api) {
  api.sidebar.registerView({ id: "acme.panel.view", title: "Acme", render: () => api.ui.screen({}, api.ui.text("hi")) });
}"#,
        )
        .unwrap();
        std::fs::write(folder.path().join("outside.js"), "export function activate() {}").unwrap();
        let entrypoints = cx.update(|cx| {
            settings::init(cx, settings::Settings::default(), None);
            extensions::init_with(cx, Some(extensions_dir.clone()), None);
            extensions::get(cx).ui_entrypoints()
        });
        assert_eq!(entrypoints.len(), 1);
        let (manifest, dir) = &entrypoints[0];
        let host_manifest = host_manifest(manifest);
        assert_eq!((host_manifest.name.as_str(), host_manifest.permissions.secrets), ("Acme Panel", true));
        let source = read_entrypoint(dir, manifest.main.as_deref().unwrap()).unwrap();
        assert_eq!(read_entrypoint(dir, "../../outside.js").unwrap_err(), "Integration entrypoint escaped its installation directory");

        let services = Arc::new(HostServices::detached());
        let (host, _events) = Host::new(Arc::new(PlatformWorkers), services, Limits::default());
        futures::executor::block_on(host.load(host_manifest, Some(source), false)).unwrap();
        assert_eq!(host.store().sidebar_views["acme.panel.view"].title, "Acme");

        cx.update(|cx| extensions::set_enabled("acme.panel", false, cx).unwrap());
        assert!(cx.update(|cx| extensions::get(cx).ui_entrypoints().is_empty()), "a turned-off extension is not started");
    }
}
