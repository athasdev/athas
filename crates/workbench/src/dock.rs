use std::collections::HashSet;

use gpui::{Context, Entity, Subscription, Window};

use crate::Workbench;

/// The servers a session's browser lists as started in it.
const MAX_SERVERS_PER_SESSION: usize = 8;

/// A session's tools. Its details are the boxes in the session view's side column; its changes,
/// terminal and browser open in tabs (`session-panel/components/session-dock-panes.tsx`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub(crate) enum SessionPane {
    Details,
    Changes,
    Terminal,
    Browser,
}

/// What a session keeps besides its view: the dev servers its commands started, and the
/// tools it held open.
pub(crate) struct SessionPanes {
    pub active: SessionPane,
    terminal: Option<(Entity<terminal_view::TerminalPanel>, Subscription)>,
    browser: Option<Entity<browser_view::BrowserPage>>,
    #[cfg(not(target_family = "wasm"))]
    browser_tools: Option<Entity<crate::session_browser::SessionBrowser>>,
    changes: Option<Entity<agent_ui::ReviewView>>,
    /// Tools with something new the user has not looked at.
    attention: HashSet<SessionPane>,
    /// The dev server the session's commands started, while it answers.
    pub server: Option<String>,
    /// Every dev server the session's commands started, newest first.
    servers: Vec<String>,
}

impl SessionPanes {
    pub(crate) fn terminal_panel(&self) -> Option<Entity<terminal_view::TerminalPanel>> {
        self.terminal.as_ref().map(|(terminal, _)| terminal.clone())
    }

    /// Whether the session holds a shell, a native page or a review that closing its tab lets go of.
    pub(crate) fn holds_tools(&self) -> bool {
        #[cfg(not(target_family = "wasm"))]
        if self.browser_tools.is_some() {
            return true;
        }
        self.terminal.is_some() || self.browser.is_some() || self.changes.is_some()
    }

    /// Lets go of the session's tools once its tab closes (`releaseSessionPanelResources`); its
    /// servers stay for when the session opens again.
    pub(crate) fn release_tools(&mut self) {
        self.terminal = None;
        self.browser = None;
        #[cfg(not(target_family = "wasm"))]
        {
            self.browser_tools = None;
        }
        self.changes = None;
    }
}

impl Default for SessionPanes {
    fn default() -> Self {
        Self {
            active: SessionPane::Details,
            terminal: None,
            browser: None,
            #[cfg(not(target_family = "wasm"))]
            browser_tools: None,
            changes: None,
            attention: HashSet::new(),
            server: None,
            servers: Vec::new(),
        }
    }
}

impl Workbench {
    /// More actions > Plan: the side column shows with the Plan box unfolded.
    pub(crate) fn open_session_plan(&mut self, _id: &str, cx: &mut Context<Self>) {
        agent_ui::reveal_session_box("plan", cx);
        cx.notify();
    }

    fn front_session_cwd(&self) -> Option<std::path::PathBuf> {
        let session = self.state.focused_session()?;
        session.workspace_path.clone().or_else(|| session.project.as_ref().and_then(|id| self.state.project(id)).map(|project| project.path.clone())).map(std::path::PathBuf::from)
    }

    /// The session's tool commands: Details shows or hides the side column, and the changes, a terminal in the session's folder and its browser open in tabs.
    pub(crate) fn toggle_session_pane(&mut self, pane: SessionPane, window: &mut Window, cx: &mut Context<Self>) {
        let Some(id) = self.state.focused_session().map(|session| session.id.0.clone()) else {
            notifications::info(cx, "Open an agent session first.");
            return;
        };
        match pane {
            SessionPane::Details => agent_ui::toggle_session_side_panel(cx),
            SessionPane::Changes => window.dispatch_action(Box::new(agent_ui::review::ReviewAgentChanges), cx),
            SessionPane::Terminal => self.open_session_terminal(cx),
            SessionPane::Browser => self.open_session_browser(None, true, window, cx),
        }
        if let Some(panes) = self.session_panes.get_mut(&id) {
            panes.attention.remove(&pane);
        }
    }

    /// A terminal in the session's folder, in a tab ("Agent Terminal").
    pub(crate) fn open_session_terminal(&mut self, cx: &mut Context<Self>) {
        let cwd = self.front_session_cwd();
        self.open_terminal_tab(crate::centre_views::PendingTerminal::In(cwd), "Agent Terminal", cx);
        cx.notify();
    }

    /// Opens the session's browser at `url` (its dev server when `None`).
    pub(crate) fn open_session_browser(&mut self, url: Option<String>, show: bool, window: &mut Window, cx: &mut Context<Self>) {
        let Some(id) = self.state.focused_session().map(|session| session.id.0.clone()) else { return };
        self.open_session_browser_for(&id, url, show, window, cx);
    }

    /// Remembers the page the session serves; `show` opens it in a browser tab, otherwise the
    /// session's browser is marked as having something new.
    pub(crate) fn open_session_browser_for(&mut self, id: &str, url: Option<String>, show: bool, _window: &mut Window, cx: &mut Context<Self>) {
        let panes = self.session_panes.entry(id.to_string()).or_default();
        if let Some(url) = &url {
            panes.server.get_or_insert_with(|| url.clone());
        }
        if show {
            panes.attention.remove(&SessionPane::Browser);
            let url = url.or_else(|| panes.server.clone());
            browser_view::open_browser_tab(url.as_deref(), cx);
        } else {
            panes.attention.insert(SessionPane::Browser);
        }
        cx.notify();
    }


    /// A session's commands started a dev server: it is kept for the session's browser and its
    /// tool is marked (`dev-server-auto-open.ts` opened it beside the session; tabs are not opened
    /// on their own).
    pub(crate) fn session_dev_server(&mut self, id: &str, url: String, open: bool, window: &mut Window, cx: &mut Context<Self>) {
        let panes = self.session_panes.entry(id.to_string()).or_default();
        panes.server = Some(url.clone());
        if panes.servers.first() != Some(&url) {
            panes.servers.retain(|server| *server != url);
            panes.servers.insert(0, url.clone());
            panes.servers.truncate(MAX_SERVERS_PER_SESSION);
        }
        #[cfg(not(target_family = "wasm"))]
        if let Some(tools) = &panes.browser_tools {
            let servers = panes.servers.clone();
            tools.update(cx, |tools, cx| tools.set_servers(servers, cx));
        }
        // The session's first server is remembered, not opened: its Running box and More actions
        // open it in a tab.
        self.open_session_browser_for(id, open.then_some(url), false, window, cx);
    }

    /// A web link clicked in a session (`session-links.ts`): a server the session runs opens in
    /// the session's browser, any other page in a browser tab.
    pub(crate) fn route_session_link(&mut self, session: &str, url: &str, window: &mut Window, cx: &mut Context<Self>) {
        if is_session_server_url(url, cx) {
            self.open_session_browser_for(session, Some(url.to_string()), true, window, cx);
        } else {
            browser_view::open_browser_tab(Some(url), cx);
        }
    }

    /// An agent started browsing on the hosted browser: its session's Browser tool is marked
    /// unless it is in front (`session-panel-runtime.ts`).
    pub(crate) fn watch_hosted_browser_runs(cx: &mut Context<Self>) {
        let mut seen: HashSet<String> = HashSet::new();
        cx.observe_global::<browser_view::browser_use::HostedBrowserRuns>(move |this, cx| {
            let runs: HashSet<String> = cx.global::<browser_view::browser_use::HostedBrowserRuns>().0.keys().cloned().collect();
            let front = this.state.focused_session().map(|session| session.id.0.clone());
            let mut changed = false;
            for chat in runs.difference(&seen) {
                let panes = this.session_panes.entry(chat.clone()).or_default();
                let showing = panes.active == SessionPane::Browser && front.as_deref() == Some(chat.as_str());
                changed |= !showing && panes.attention.insert(SessionPane::Browser);
            }
            seen = runs;
            if changed {
                cx.notify();
            }
        })
        .detach();
    }

    pub(crate) fn session_dev_server_stopped(&mut self, id: &str, url: &str, cx: &mut Context<Self>) {
        if let Some(panes) = self.session_panes.get_mut(id)
            && panes.server.as_deref() == Some(url)
        {
            panes.server = None;
            cx.notify();
        }
    }
}

/// The scheme, host and port of an address.
fn origin(url: &str) -> Option<&str> {
    let start = url.find("://")? + 3;
    let end = url[start..].find(['/', '?', '#']).map_or(url.len(), |end| start + end);
    Some(&url[..end]).filter(|_| end > start)
}

/// Whether a link is a server the session runs: one on this computer, or a preview link to one.
fn is_session_server_url(url: &str, cx: &gpui::App) -> bool {
    if agent_ui::dev_servers::local_server_port(url).is_some() {
        return true;
    }
    let Some(origin) = origin(url) else { return false };
    let host = origin.rsplit("://").next().unwrap_or(origin).split(':').next().unwrap_or_default();
    if host.ends_with(".athas.run") {
        return true;
    }
    #[cfg(not(target_family = "wasm"))]
    if let Some(previews) = cx.try_global::<previews::Previews>() {
        return previews.shared.values().any(|entry| self::origin(&entry.preview.url) == Some(origin));
    }
    let _ = cx;
    false
}

#[cfg(test)]
mod tests {
    #[test]
    fn origins_stop_at_the_path() {
        assert_eq!(super::origin("https://abc.athas.run/docs?x=1"), Some("https://abc.athas.run"));
        assert_eq!(super::origin("http://localhost:5173"), Some("http://localhost:5173"));
        assert_eq!(super::origin("nonsense"), None);
    }
}
