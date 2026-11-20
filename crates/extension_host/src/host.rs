//! The host side of UI extensions (`ui-extension-host.ts`): starts a worker per extension,
//! answers its host calls, turns its events into registrations, and sends it requests (render a
//! view, run a command or view action) that time out after 30 seconds.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, Weak};

use futures::channel::{mpsc, oneshot};
use serde_json::{Value, json};
use web_time::{Duration, Instant};

use crate::generated::{ContributionType, GeneratedExtension, HostManifest, generated_manifest, wrap_generated_source};
use crate::services::{HostServices, js_string};
use crate::store::{AiProvider, AiSettingsAction, Command, Dialog, ExtensionState, Registration, SidebarView, Store, ToolbarAction, ToolbarPosition};
use crate::view::{Node, parse_view};
use crate::{HostEvent, Limits, WorkerFactory, WorkerSink, WorkerTransport};

pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

struct Pending {
    sender: oneshot::Sender<Result<Value, String>>,
    deadline: Instant,
    method: String,
}

struct Loaded {
    manifest: HostManifest,
    worker: Option<Box<dyn WorkerTransport>>,
    next_request_id: u64,
    pending: HashMap<u64, Pending>,
    activation: Option<(oneshot::Sender<Result<(), String>>, Instant)>,
}

#[derive(Default)]
struct Inner {
    loaded: HashMap<String, Loaded>,
    store: Store,
}

struct Shared {
    inner: Mutex<Inner>,
    events: mpsc::UnboundedSender<HostEvent>,
    factory: Arc<dyn WorkerFactory>,
    services: Arc<HostServices>,
    limits: Limits,
    request_timeout: Duration,
}

/// The UI extension host. Cloning shares it.
#[derive(Clone)]
pub struct Host {
    shared: Arc<Shared>,
}

fn assert_namespaced(extension_id: &str, contribution_id: Option<&Value>) -> Result<String, String> {
    let id = js_string(contribution_id);
    if !id.starts_with(&format!("{extension_id}.")) {
        return Err(format!("Integration contribution ids must start with {extension_id}."));
    }
    Ok(id)
}

fn dialog_dimension(value: Option<&Value>, minimum: f64, maximum: f64) -> Option<f64> {
    value.and_then(Value::as_f64).filter(|value| value.is_finite()).map(|value| value.clamp(minimum, maximum))
}

/// The manifest's entry for `provider_id`; an extension registers only providers it contributes.
fn contributed_provider(inner: &Inner, extension_id: &str, provider_id: &str) -> Result<Value, String> {
    inner
        .loaded
        .get(extension_id)
        .and_then(|loaded| loaded.manifest.ai_providers.iter().find(|provider| provider.get("id").and_then(Value::as_str) == Some(provider_id)).cloned())
        .ok_or_else(|| format!("Integration does not contribute AI provider {provider_id}"))
}

fn payload_string(payload: &serde_json::Map<String, Value>, key: &str) -> Option<String> {
    payload.get(key).and_then(Value::as_str).map(str::to_string)
}

impl Host {
    pub fn new(factory: Arc<dyn WorkerFactory>, services: Arc<HostServices>, limits: Limits) -> (Self, mpsc::UnboundedReceiver<HostEvent>) {
        Self::with_timeout(factory, services, limits, REQUEST_TIMEOUT)
    }

    pub fn with_timeout(factory: Arc<dyn WorkerFactory>, services: Arc<HostServices>, limits: Limits, request_timeout: Duration) -> (Self, mpsc::UnboundedReceiver<HostEvent>) {
        let (events, receiver) = mpsc::unbounded();
        let shared = Arc::new(Shared { inner: Mutex::default(), events, factory, services, limits, request_timeout });
        (Self { shared }, receiver)
    }

    fn changed(&self) {
        self.shared.events.unbounded_send(HostEvent::Changed).ok();
    }

    pub fn store(&self) -> Store {
        self.shared.inner.lock().unwrap().store.clone()
    }

    pub fn with_store<T>(&self, read: impl FnOnce(&Store) -> T) -> T {
        read(&self.shared.inner.lock().unwrap().store)
    }

    pub fn is_loaded(&self, extension_id: &str) -> bool {
        self.shared.inner.lock().unwrap().loaded.contains_key(extension_id)
    }

    pub fn register_extension(&self, registration: Registration) {
        self.shared.inner.lock().unwrap().store.register_extension(registration);
        self.changed();
    }

    pub fn update_extension_state(&self, extension_id: &str, state: ExtensionState, error: Option<String>) {
        self.shared.inner.lock().unwrap().store.update_extension_state(extension_id, state, error);
        self.changed();
    }

    pub fn cleanup_extension(&self, extension_id: &str) {
        self.shared.inner.lock().unwrap().store.cleanup_extension(extension_id);
        self.changed();
    }

    pub fn close_dialog(&self, dialog_id: &str) {
        self.shared.inner.lock().unwrap().store.close_dialog(dialog_id);
        self.changed();
    }

    /// Starts `source` (an ES module exporting `activate(api)`) for `manifest`; resolves once the
    /// extension is ready or fails to activate.
    pub fn load(&self, manifest: HostManifest, source: Option<String>, generated: bool) -> impl Future<Output = Result<(), String>> + use<> {
        let extension_id = manifest.id.clone();
        let receiver = {
            let mut inner = self.shared.inner.lock().unwrap();
            if inner.loaded.contains_key(&extension_id) {
                None
            } else {
                if !inner.store.extensions.contains_key(&extension_id) {
                    inner.store.register_extension(Registration {
                        extension_id: extension_id.clone(),
                        name: Some(manifest.name.clone()),
                        description: Some(manifest.description.clone()),
                        contribution_type: None,
                        state: ExtensionState::Loading,
                        error: None,
                    });
                } else {
                    inner.store.update_extension_state(&extension_id, ExtensionState::Loading, None);
                }
                let mut loaded = Loaded { manifest, worker: None, next_request_id: 1, pending: HashMap::new(), activation: None };
                match source {
                    None => {
                        inner.loaded.insert(extension_id.clone(), loaded);
                        inner.store.update_extension_state(&extension_id, ExtensionState::Active, None);
                        None
                    }
                    Some(source) => {
                        let weak = Arc::downgrade(&self.shared);
                        let id = extension_id.clone();
                        let sink: WorkerSink = Arc::new(move |message: String| {
                            if let Some(shared) = Weak::upgrade(&weak) {
                                Host { shared }.handle_message(&id, &message);
                            }
                        });
                        match self.shared.factory.spawn(&extension_id, self.shared.limits.clone(), sink) {
                            Ok(worker) => {
                                let (sender, receiver) = oneshot::channel();
                                loaded.activation = Some((sender, Instant::now() + self.shared.request_timeout));
                                let activate = json!({
                                    "type": "activate",
                                    "extensionId": extension_id,
                                    "compatibility": if generated { Value::from("generated") } else { Value::Null },
                                    "source": source,
                                });
                                worker.post(activate.to_string());
                                loaded.worker = Some(worker);
                                inner.loaded.insert(extension_id.clone(), loaded);
                                Some(Ok(receiver))
                            }
                            Err(error) => {
                                inner.store.update_extension_state(&extension_id, ExtensionState::Error, Some(error.to_string()));
                                Some(Err(error.to_string()))
                            }
                        }
                    }
                }
            }
        };
        self.changed();
        async move {
            match receiver {
                None => Ok(()),
                Some(Err(error)) => Err(error),
                Some(Ok(receiver)) => receiver.await.unwrap_or_else(|_| Err("Integration was unloaded".into())),
            }
        }
    }

    /// Installs an AI-generated extension (`installGeneratedUIExtension`): replaces a running copy,
    /// validates its code and permissions, and starts it.
    pub fn load_generated(&self, extension: &GeneratedExtension) -> impl Future<Output = Result<String, String>> + use<> {
        let extension_id = crate::generated::normalize_generated_id(&extension.id);
        let registration = Registration {
            extension_id: extension_id.clone(),
            name: Some(extension.name.clone()),
            description: Some(extension.description.clone()),
            contribution_type: Some(extension.contribution_type),
            state: ExtensionState::Loading,
            error: None,
        };
        let unload = self.is_loaded(&extension_id).then(|| self.unload(&extension_id));
        let host = self.clone();
        let prepared = generated_manifest(extension).and_then(|manifest| Ok((manifest, wrap_generated_source(&extension.code)?)));
        async move {
            if let Some(unload) = unload {
                unload.await;
            } else {
                host.cleanup_extension(&extension_id);
            }
            host.register_extension(registration.clone());
            let result = match prepared {
                Ok((manifest, source)) => host.load(manifest, Some(source), true).await,
                Err(error) => Err(error),
            };
            match result {
                Ok(()) => {
                    host.register_extension(Registration { state: ExtensionState::Active, ..registration });
                    Ok(extension_id)
                }
                Err(error) => {
                    host.update_extension_state(&extension_id, ExtensionState::Error, Some(error.clone()));
                    Err(error)
                }
            }
        }
    }

    /// Shows a generated extension as installed but stopped.
    pub fn register_disabled(&self, extension: &GeneratedExtension) {
        self.register_extension(Registration {
            extension_id: crate::generated::normalize_generated_id(&extension.id),
            name: Some(extension.name.clone()),
            description: Some(extension.description.clone()),
            contribution_type: Some(extension.contribution_type),
            state: ExtensionState::Disabled,
            error: None,
        });
    }

    fn dispose_worker(&self, loaded: &mut Loaded, reason: &str) {
        if let Some(worker) = loaded.worker.take() {
            worker.terminate();
        }
        self.shared.services.clear_extension_state(&loaded.manifest.id);
        for (_, pending) in loaded.pending.drain() {
            pending.sender.send(Err(reason.into())).ok();
        }
        if let Some((sender, _)) = loaded.activation.take() {
            sender.send(Err(reason.into())).ok();
        }
    }

    fn handle_message(&self, extension_id: &str, message: &str) {
        let Ok(Value::Object(message)) = serde_json::from_str::<Value>(message) else {
            return;
        };
        match message.get("type").and_then(Value::as_str) {
            Some("response") => {
                let id = message.get("id").and_then(Value::as_u64).unwrap_or_default();
                let mut inner = self.shared.inner.lock().unwrap();
                if let Some(pending) = inner.loaded.get_mut(extension_id).and_then(|loaded| loaded.pending.remove(&id)) {
                    let result = match message.get("error") {
                        Some(error) if !error.is_null() && error != "" => Err(js_string(Some(error))),
                        _ => Ok(message.get("result").cloned().unwrap_or(Value::Null)),
                    };
                    pending.sender.send(result).ok();
                }
            }
            Some("host-call") => self.host_call(extension_id, message),
            Some("log") => {
                self.shared
                    .events
                    .unbounded_send(HostEvent::Log {
                        extension_id: extension_id.into(),
                        level: payload_string(&message, "level").unwrap_or_default(),
                        message: payload_string(&message, "message").unwrap_or_default(),
                    })
                    .ok();
            }
            Some("event") => {
                let event = message.get("event").and_then(Value::as_str).unwrap_or_default();
                let payload = message.get("payload").and_then(Value::as_object).cloned().unwrap_or_default();
                if let Err(error) = self.handle_event(extension_id, event, &payload) {
                    self.update_extension_state(extension_id, ExtensionState::Error, Some(error));
                }
            }
            _ => {}
        }
    }

    fn host_call(&self, extension_id: &str, message: serde_json::Map<String, Value>) {
        let id = message.get("id").cloned().unwrap_or(Value::Null);
        let method = payload_string(&message, "method").unwrap_or_default();
        let params = match message.get("params") {
            Some(Value::Array(params)) => params.clone(),
            _ => Vec::new(),
        };
        let Some(manifest) = self.shared.inner.lock().unwrap().loaded.get(extension_id).map(|loaded| loaded.manifest.clone()) else {
            return;
        };
        let host = self.clone();
        let extension_id = extension_id.to_string();
        let respond = move |result: Result<Value, String>| {
            let response = match result {
                Ok(result) => json!({ "type": "response", "id": id, "result": result }),
                Err(error) => json!({ "type": "response", "id": id, "error": error }),
            };
            if let Some(worker) = host.shared.inner.lock().unwrap().loaded.get(&extension_id).and_then(|loaded| loaded.worker.as_ref()) {
                worker.post(response.to_string());
            }
        };
        // The browser has no blocking HTTP; its requests go through `fetch`.
        #[cfg(target_family = "wasm")]
        if method == "http.request" {
            let request = crate::services::http_request(&manifest, &params);
            wasm_bindgen_futures::spawn_local(async move {
                let result = match request {
                    Ok(request) => crate::web::fetch(request).await.and_then(|response| serde_json::to_value(response).map_err(|error| error.to_string())),
                    Err(error) => Err(error),
                };
                respond(result);
            });
            return;
        }
        let services = self.shared.services.clone();
        let events = self.shared.events.clone();
        let run = move || respond(services.call(&manifest, &method, &params, &events));
        #[cfg(not(target_family = "wasm"))]
        std::thread::spawn(run);
        #[cfg(target_family = "wasm")]
        run();
    }

    fn handle_event(&self, extension_id: &str, event: &str, payload: &serde_json::Map<String, Value>) -> Result<(), String> {
        let mut inner = self.shared.inner.lock().unwrap();
        let extension_id = extension_id.to_string();
        let title_or = |id: &str| payload.get("title").map(|title| js_string(Some(title))).unwrap_or_else(|| id.to_string());
        let icon = || payload.get("icon").map(|icon| js_string(Some(icon))).unwrap_or_else(|| "puzzle-piece".into());
        match event {
            "ready" | "activation.error" => {
                let Some(loaded) = inner.loaded.get_mut(&extension_id) else {
                    return Ok(());
                };
                let activation = loaded.activation.take();
                if event == "ready" {
                    inner.store.update_extension_state(&extension_id, ExtensionState::Active, None);
                    if let Some((sender, _)) = activation {
                        sender.send(Ok(())).ok();
                    }
                } else {
                    let message = payload.get("message").map(|message| js_string(Some(message))).unwrap_or_else(|| "Integration activation failed".into());
                    if let Some(mut loaded) = inner.loaded.remove(&extension_id) {
                        self.dispose_worker(&mut loaded, "Integration was unloaded");
                    }
                    inner.store.update_extension_state(&extension_id, ExtensionState::Error, Some(message.clone()));
                    inner.store.ai_providers.retain(|provider| provider.extension_id != extension_id);
                    if let Some((sender, _)) = activation {
                        sender.send(Err(message)).ok();
                    }
                }
            }
            "worker.error" => {
                let message = payload.get("message").map(|message| js_string(Some(message))).unwrap_or_else(|| "Integration worker failed".into());
                if let Some(mut loaded) = inner.loaded.remove(&extension_id) {
                    self.dispose_worker(&mut loaded, &message);
                }
                inner.store.update_extension_state(&extension_id, ExtensionState::Error, Some(message));
            }
            "sidebar.registerView" => {
                let id = assert_namespaced(&extension_id, payload.get("id"))?;
                inner.store.register_sidebar_view(SidebarView {
                    title: title_or(&id),
                    icon: icon(),
                    order: payload.get("order").and_then(Value::as_f64),
                    extension_id,
                    id,
                });
            }
            "toolbar.registerAction" => {
                let id = assert_namespaced(&extension_id, payload.get("id"))?;
                inner.store.toolbar_actions.insert(
                    id.clone(),
                    ToolbarAction {
                        title: title_or(&id),
                        icon: icon(),
                        position: if payload.get("position").and_then(Value::as_str) == Some("left") { ToolbarPosition::Left } else { ToolbarPosition::Right },
                        extension_id,
                        id,
                    },
                );
            }
            "commands.register" => {
                let id = assert_namespaced(&extension_id, payload.get("id"))?;
                inner.store.commands.insert(id.clone(), Command { title: title_or(&id), category: payload_string(payload, "category"), extension_id, id });
            }
            "dialogs.open" => {
                let id = assert_namespaced(&extension_id, payload.get("id"))?;
                inner.store.open_dialog(Dialog {
                    title: title_or(&id),
                    width: dialog_dimension(payload.get("width"), 320.0, 960.0),
                    height: dialog_dimension(payload.get("height"), 240.0, 800.0),
                    extension_id,
                    id,
                });
            }
            "dialogs.close" => {
                let id = assert_namespaced(&extension_id, payload.get("id"))?;
                inner.store.close_dialog(&id);
            }
            "views.invalidate" => {
                let id = assert_namespaced(&extension_id, payload.get("viewId"))?;
                inner.store.invalidate_view(&id);
            }
            "ai.registerProvider" => {
                let provider_id = payload.get("providerId").map(|id| js_string(Some(id))).unwrap_or_default();
                let contribution = contributed_provider(&inner, &extension_id, &provider_id)?;
                inner.store.ai_providers.retain(|provider| provider.provider_id != provider_id);
                inner.store.ai_providers.push(AiProvider { extension_id, provider_id, contribution });
            }
            "ai.registerSettingsAction" => {
                let id = assert_namespaced(&extension_id, payload.get("id"))?;
                let command_id = assert_namespaced(&extension_id, payload.get("commandId"))?;
                let provider_id = payload.get("providerId").map(|id| js_string(Some(id))).unwrap_or_default();
                contributed_provider(&inner, &extension_id, &provider_id)?;
                inner.store.ai_settings_actions.retain(|action| action.id != id);
                inner.store.ai_settings_actions.push(AiSettingsAction {
                    provider_id,
                    label: payload_string(payload, "label").unwrap_or_else(|| "Provider settings".into()),
                    button_label: payload_string(payload, "buttonLabel").unwrap_or_else(|| "Configure".into()),
                    description: payload_string(payload, "description"),
                    icon: if payload.get("icon").and_then(Value::as_str) == Some("sparkles") { "sparkles".into() } else { "palette".into() },
                    extension_id,
                    id,
                    command_id,
                });
            }
            _ => return Ok(()),
        }
        drop(inner);
        self.changed();
        Ok(())
    }

    /// Sends `method` to the extension's worker and waits for its answer.
    pub fn request(&self, extension_id: &str, method: &str, params: Vec<Value>) -> impl Future<Output = Result<Value, String>> + use<> {
        let receiver = {
            let mut inner = self.shared.inner.lock().unwrap();
            match inner.loaded.get_mut(extension_id).filter(|loaded| loaded.worker.is_some()) {
                None => Err(format!("Integration {extension_id} is not active")),
                Some(loaded) => {
                    let id = loaded.next_request_id;
                    loaded.next_request_id += 1;
                    let (sender, receiver) = oneshot::channel();
                    loaded.pending.insert(id, Pending { sender, deadline: Instant::now() + self.shared.request_timeout, method: method.to_string() });
                    if let Some(worker) = &loaded.worker {
                        worker.post(json!({ "type": "worker-call", "id": id, "method": method, "params": params }).to_string());
                    }
                    Ok(receiver)
                }
            }
        };
        async move {
            match receiver {
                Ok(receiver) => receiver.await.unwrap_or_else(|_| Err("Integration was unloaded".into())),
                Err(error) => Err(error),
            }
        }
    }

    /// Fails requests and activations that have waited past their deadline.
    pub fn expire_requests(&self) {
        let now = Instant::now();
        let mut changed = false;
        {
            let mut inner = self.shared.inner.lock().unwrap();
            let mut timed_out = Vec::new();
            for (id, loaded) in inner.loaded.iter_mut() {
                let expired: Vec<u64> = loaded.pending.iter().filter(|(_, pending)| pending.deadline <= now).map(|(id, _)| *id).collect();
                for request in expired {
                    if let Some(pending) = loaded.pending.remove(&request) {
                        pending.sender.send(Err(format!("Integration request timed out: {}", pending.method))).ok();
                    }
                }
                if loaded.activation.as_ref().is_some_and(|(_, deadline)| *deadline <= now) {
                    timed_out.push(id.clone());
                }
            }
            for id in timed_out {
                if let Some(mut loaded) = inner.loaded.remove(&id) {
                    if let Some((sender, _)) = loaded.activation.take() {
                        sender.send(Err("Integration activation timed out".into())).ok();
                    }
                    self.dispose_worker(&mut loaded, "Integration was unloaded");
                }
                inner.store.update_extension_state(&id, ExtensionState::Error, Some("Integration activation timed out".into()));
                changed = true;
            }
        }
        if changed {
            self.changed();
        }
    }

    pub fn render_view(&self, extension_id: &str, view_id: &str) -> impl Future<Output = Result<Node, String>> + use<> {
        let request = self.request(extension_id, "renderView", vec![json!(view_id)]);
        async move { parse_view(&request.await?).map_err(|error| error.to_string()) }
    }

    pub fn execute_command(&self, extension_id: &str, command_id: &str, args: Vec<Value>) -> impl Future<Output = Result<Value, String>> + use<> {
        let mut params = vec![json!(command_id)];
        params.extend(args);
        self.request(extension_id, "executeCommand", params)
    }

    pub fn execute_view_action(&self, extension_id: &str, view_id: &str, command_id: &str, args: Vec<Value>) -> impl Future<Output = Result<Value, String>> + use<> {
        let mut params = vec![json!(view_id), json!(command_id)];
        params.extend(args);
        self.request(extension_id, "executeViewAction", params)
    }

    pub fn execute_toolbar_action(&self, extension_id: &str, action_id: &str) -> impl Future<Output = Result<Value, String>> + use<> {
        self.request(extension_id, "executeToolbarAction", vec![json!(action_id)])
    }

    /// Runs a registered command by id, whichever extension owns it (generated UI in agent
    /// messages may only reach these).
    pub fn run_registered_command(&self, command_id: &str, args: Vec<Value>) -> impl Future<Output = Result<Value, String>> + use<> {
        let owner = self.with_store(|store| store.commands.get(command_id).map(|command| command.extension_id.clone()));
        let request = owner.map(|owner| self.execute_command(&owner, command_id, args));
        let command_id = command_id.to_string();
        async move {
            match request {
                Some(request) => request.await,
                None => Err(format!("Generated UI command is not available: {command_id}")),
            }
        }
    }

    /// Calls `aiProvider.<method>` on the extension that registered `provider_id`, with the
    /// provider id first (`buildHeaders`, `validateApiKey`, `getModels`…).
    pub fn ai_provider_request(&self, provider_id: &str, method: &str, args: Vec<Value>) -> impl Future<Output = Result<Value, String>> + use<> {
        let owner = self.with_store(|store| store.ai_providers.iter().find(|provider| provider.provider_id == provider_id).map(|provider| provider.extension_id.clone()));
        let mut params = vec![json!(provider_id)];
        params.extend(args);
        let request = owner.map(|owner| self.request(&owner, &format!("aiProvider.{method}"), params));
        let provider_id = provider_id.to_string();
        async move {
            match request {
                Some(request) => request.await,
                None => Err(format!("AI provider {provider_id} is not registered")),
            }
        }
    }

    /// Asks the extension to deactivate, stops its worker and drops what it registered.
    pub fn unload(&self, extension_id: &str) -> impl Future<Output = ()> + use<> {
        let active = self.shared.inner.lock().unwrap().loaded.get(extension_id).map(|loaded| loaded.worker.is_some());
        let deactivate = (active == Some(true)).then(|| self.request(extension_id, "deactivate", Vec::new()));
        let host = self.clone();
        let extension_id = extension_id.to_string();
        async move {
            if active.is_none() {
                return;
            }
            if let Some(deactivate) = deactivate {
                deactivate.await.ok();
            }
            let removed = host.shared.inner.lock().unwrap().loaded.remove(&extension_id);
            if let Some(mut loaded) = removed {
                host.dispose_worker(&mut loaded, "Integration was unloaded");
            }
            host.cleanup_extension(&extension_id);
        }
    }

    pub fn contribution_type(&self, extension_id: &str) -> Option<ContributionType> {
        self.with_store(|store| store.extensions.get(extension_id).and_then(|registration| registration.contribution_type))
    }
}
