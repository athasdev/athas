//! The app's agent catalog with each agent's install state, and the installs and uninstalls in
//! progress. Views observe [`AgentRegistry::global`].

use std::{
    collections::HashMap,
    path::PathBuf,
    sync::Arc,
    time::Duration,
};

use gpui::{App, AppContext as _, Context, Entity, Global, Task};

use super::{CatalogAgent, InstallState, Installs, Tools};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Operation {
    Installing,
    Uninstalling,
}

pub struct AgentRegistry {
    agents: Vec<CatalogAgent>,
    states: HashMap<String, InstallState>,
    tools: Tools,
    operations: HashMap<String, Operation>,
    errors: HashMap<String, String>,
    installs: Option<Arc<Installs>>,
    fetch_registry: bool,
    loading: Option<Task<()>>,
}

struct GlobalRegistry(Entity<AgentRegistry>);

impl Global for GlobalRegistry {}

/// Agents a new chat can start with (`useAgentDisplayNames`, installed and set up): Athas Agent,
/// then each installed agent, as (id, name, description).
pub fn new_chat_agents(cx: &mut App) -> Vec<(String, String, String)> {
    let mut agents = vec![(crate::builtin::AGENT_ID.to_string(), crate::builtin::NAME.to_string(), "Runs on your models, with Athas tools".to_string())];
    let registry = AgentRegistry::global(cx);
    let registry = registry.read(cx);
    for agent in registry.agents() {
        if registry.state(&agent.id).is_installed() && !agents.iter().any(|(id, ..)| *id == agent.id) {
            agents.push((agent.id.clone(), agent.name.clone(), agent.description.clone().unwrap_or_default()));
        }
    }
    agents
}

impl AgentRegistry {
    /// The app's registry; made (and its catalog loaded) on first use.
    pub fn global(cx: &mut App) -> Entity<Self> {
        if let Some(registry) = cx.try_global::<GlobalRegistry>() {
            return registry.0.clone();
        }
        let offline = std::env::var_os("ATHAS_AGENT_FIXTURE").is_some();
        let registry = cx.new(|cx| Self::new(super::agents_dir(), !offline, cx));
        cx.set_global(GlobalRegistry(registry.clone()));
        registry
    }

    /// Makes `registry` the app's, for headless renders and tests.
    pub fn set_global(registry: Entity<Self>, cx: &mut App) {
        cx.set_global(GlobalRegistry(registry));
    }

    /// A registry installing under `dir`; `fetch_registry` also downloads the ACP Registry.
    pub fn new(dir: Option<PathBuf>, fetch_registry: bool, cx: &mut Context<Self>) -> Self {
        let mut this = Self {
            agents: Vec::new(),
            states: HashMap::new(),
            tools: Tools::default(),
            operations: HashMap::new(),
            errors: HashMap::new(),
            installs: dir.map(|dir| Arc::new(Installs::new(dir))),
            fetch_registry,
            loading: None,
        };
        this.refresh(cx);
        this
    }

    pub fn agents(&self) -> &[CatalogAgent] {
        &self.agents
    }

    pub fn agent(&self, id: &str) -> Option<&CatalogAgent> {
        self.agents.iter().find(|agent| agent.id == id)
    }

    pub fn state(&self, id: &str) -> InstallState {
        self.states.get(id).cloned().unwrap_or(InstallState::NotInstalled)
    }

    pub fn operation(&self, id: &str) -> Option<Operation> {
        self.operations.get(id).copied()
    }

    pub fn error(&self, id: &str) -> Option<&str> {
        self.errors.get(id).map(String::as_str)
    }

    pub fn tools(&self) -> &Tools {
        &self.tools
    }

    pub fn is_loading(&self) -> bool {
        self.loading.is_some()
    }

    fn extension_agents(cx: &App) -> Vec<CatalogAgent> {
        let contributions = match cx.try_global::<extensions::Extensions>() {
            Some(extensions) => extensions.catalog_agents(),
            None => extensions::Catalog::bundled()
                .entries()
                .iter()
                .flat_map(|entry| entry.manifest.agents().map(|agent| (entry.manifest.id.clone(), agent.clone())).collect::<Vec<_>>())
                .collect(),
        };
        super::from_extensions(&contributions)
    }

    /// Reloads the catalog (and the ACP Registry, at most hourly) and every agent's state.
    pub fn refresh(&mut self, cx: &mut Context<Self>) {
        let catalog = Self::extension_agents(cx);
        let installs = self.installs.clone();
        let fetch = self.fetch_registry;
        self.loading = Some(cx.spawn(async move |this, cx| {
            let registry = if fetch { load_registry(installs.as_ref().map(|installs| installs.dir.clone())).await } else { Vec::new() };
            let (agents, states, tools) = cx
                .background_spawn(async move {
                    let agents = super::merge(catalog, registry);
                    let search_path = crate::acp::agents::search_path();
                    let tools = Tools::find(&search_path);
                    let latest = if fetch { latest_versions(installs.as_deref(), &agents, &tools) } else { HashMap::new() };
                    let states = agents
                        .iter()
                        .map(|agent| {
                            let state = installs
                                .as_ref()
                                .map_or(InstallState::NotInstalled, |installs| installs.state(agent, &search_path, latest.get(&agent.id).map(String::as_str)));
                            (agent.id.clone(), state)
                        })
                        .collect::<HashMap<_, _>>();
                    (agents, states, tools)
                })
                .await;
            this.update(cx, |this, cx| {
                this.agents = agents;
                this.states = states;
                this.tools = tools;
                this.loading = None;
                cx.notify();
            })
            .ok();
        }));
    }

    /// Installs or updates the agent with npm or bun, or with Athas's managed Node.js when the
    /// machine has neither.
    pub fn install(&mut self, id: &str, cx: &mut Context<Self>) {
        let (Some(agent), Some(installs)) = (self.agent(id).cloned(), self.installs.clone()) else { return };
        if self.operations.contains_key(id) {
            return;
        }
        let tools = self.tools.clone();
        self.run(id, Operation::Installing, cx, move || installs.install(&agent, &tools, &super::run_command).map(|_| ()));
    }

    pub fn uninstall(&mut self, id: &str, cx: &mut Context<Self>) {
        let Some(installs) = self.installs.clone() else { return };
        if self.operations.contains_key(id) {
            return;
        }
        let owned = id.to_string();
        self.run(id, Operation::Uninstalling, cx, move || installs.uninstall(&owned));
    }

    fn run(&mut self, id: &str, operation: Operation, cx: &mut Context<Self>, work: impl FnOnce() -> Result<(), String> + Send + 'static) {
        self.operations.insert(id.to_string(), operation);
        self.errors.remove(id);
        let id = id.to_string();
        cx.spawn(async move |this, cx| {
            let result = cx.background_spawn(async move { work() }).await;
            this.update(cx, |this, cx| {
                this.operations.remove(&id);
                if let Err(error) = result {
                    this.errors.insert(id.clone(), error);
                }
                if let (Some(agent), Some(installs)) = (this.agent(&id).cloned(), this.installs.clone()) {
                    // What just installed is the newest npm offered; the next refresh asks again.
                    let state = installs.state(&agent, &crate::acp::agents::search_path(), None);
                    this.states.insert(id, state);
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
        cx.notify();
    }
}

/// What npm offers for each installed npm agent, within the range its catalog entry allows:
/// the answers saved within the hour, else a fresh look, saved for next time. Only installed
/// agents are asked about — an agent that is not there yet resolves its version as it installs.
/// Blocking; this runs on a background thread.
fn latest_versions(installs: Option<&Installs>, agents: &[CatalogAgent], tools: &Tools) -> HashMap<String, String> {
    let Some(installs) = installs else { return HashMap::new() };
    let cache = installs.dir.join("latest.json");
    let fresh = std::fs::metadata(&cache)
        .and_then(|metadata| metadata.modified())
        .is_ok_and(|modified| modified.elapsed().unwrap_or(Duration::MAX) < Duration::from_secs(super::REFRESH_SECS));
    if fresh
        && let Ok(text) = std::fs::read_to_string(&cache)
        && let Ok(saved) = serde_json::from_str::<HashMap<String, String>>(&text)
    {
        return saved;
    }
    let Some((manager, _)) = tools.node_manager() else { return HashMap::new() };
    let mut latest = HashMap::new();
    for agent in agents {
        let Some(install) = agent.install.as_ref() else { continue };
        let Some(range) = install.range.as_deref() else { continue };
        if installs.installed(&agent.id).is_none() {
            continue;
        }
        if let Some(version) = super::npm_latest(&manager, &install.package, range, install.version.as_deref()) {
            latest.insert(agent.id.clone(), version);
        }
    }
    if let Ok(text) = serde_json::to_string(&latest) {
        let _ = std::fs::create_dir_all(&installs.dir);
        let _ = std::fs::write(&cache, text);
    }
    latest
}

/// The ACP Registry: the copy saved within the hour, else a fresh download (saved for next
/// time), else an older copy. Empty when none of them is there.
async fn load_registry(dir: Option<PathBuf>) -> Vec<CatalogAgent> {
    let cache = dir.map(|dir| dir.join("registry.json"));
    let cached = cache.as_ref().and_then(|cache| {
        let age = std::fs::metadata(cache).ok()?.modified().ok()?.elapsed().unwrap_or(Duration::MAX);
        Some((std::fs::read_to_string(cache).ok()?, age))
    });
    if let Some((body, age)) = &cached
        && *age < Duration::from_secs(super::REFRESH_SECS)
        && let Ok(agents) = super::parse_registry(body)
    {
        return agents;
    }
    let request = ai_providers::http::HttpRequest { url: super::REGISTRY_URL.into(), headers: Vec::new(), body: None };
    if let Ok((_, value)) = ai_providers::http::json(request).await {
        let body = value.to_string();
        if let Ok(agents) = super::parse_registry(&body) {
            if let Some(cache) = &cache {
                let _ = cache.parent().map(std::fs::create_dir_all);
                let _ = std::fs::write(cache, &body);
            }
            return agents;
        }
    }
    cached.and_then(|(body, _)| super::parse_registry(&body).ok()).unwrap_or_default()
}
