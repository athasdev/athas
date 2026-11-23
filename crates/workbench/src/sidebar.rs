use ui::scale::px;
use gpui::{
    Anchor, App, Context, Focusable as _, IntoElement, MouseButton, ParentElement, Pixels, Point, Styled, Window, div,
    point,
    prelude::*,
};
use theme::ActiveTheme;
use ui::{
    Button, ButtonSize, EmptyState, Icon, IconName, IconSize, MenuEntry, MenuItem, SectionLabel,
    SidebarListItem, island, metrics,
};
use workspace::{Owner, Session, SessionStatus, SidebarView, now_ms, relative_time};

use crate::{Drag, Workbench};

/// What every session row reads, gathered once for the whole list.
pub(crate) struct SessionRowContext {
    colors: theme::ThemeColors,
    /// Sessions showing in a window of their own: their rows cannot open a menu.
    detached: std::collections::HashSet<String>,
    /// Sessions whose work runs in the cloud: their rows carry the cloud mark.
    cloud: std::collections::HashSet<String>,
    /// The moment the list was drawn, for "3m" and the like.
    now: u64,
}

/// What the Sessions list is narrowed to (the sidebar's Filter menu).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) enum SessionFilter {
    #[default]
    All,
    Running,
    NeedsInput,
    ReviewReady,
    Failed,
}

impl SessionFilter {
    pub(crate) const ALL: [SessionFilter; 5] =
        [SessionFilter::All, SessionFilter::Running, SessionFilter::NeedsInput, SessionFilter::ReviewReady, SessionFilter::Failed];

    fn label(self) -> &'static str {
        match self {
            SessionFilter::All => "All sessions",
            SessionFilter::Running => "Working",
            SessionFilter::NeedsInput => "Needs input",
            SessionFilter::ReviewReady => "Ready to review",
            SessionFilter::Failed => "Failed",
        }
    }

    fn icon(self) -> IconName {
        match self {
            SessionFilter::All => IconName::ChatBubbleText,
            SessionFilter::Running => IconName::Play,
            SessionFilter::NeedsInput => IconName::WarningCircle,
            SessionFilter::ReviewReady => IconName::CheckCircle,
            SessionFilter::Failed => IconName::Xcircle,
        }
    }

    /// Whether a session's status is what the filter asks for; a filtered list leaves out the
    /// agents' own sessions, which carry no status of ours.
    fn matches(self, status: SessionStatus) -> bool {
        match self {
            SessionFilter::All => true,
            SessionFilter::Running => status == SessionStatus::Running,
            SessionFilter::NeedsInput => status == SessionStatus::NeedsInput,
            SessionFilter::ReviewReady => matches!(status, SessionStatus::ReviewReady | SessionStatus::PrOpen),
            SessionFilter::Failed => status == SessionStatus::Failed,
        }
    }
}

/// What one agent's sessions open now have spent, as the Usage menu says it.
pub(crate) struct AgentSpend {
    pub(crate) id: String,
    pub(crate) name: String,
    tokens: u64,
    /// The cost so far and its currency, when the agent reports one.
    cost: Option<(f64, String)>,
    sessions: usize,
}

impl AgentSpend {
    /// What the row ends with: the cost when the agent reports one, else the tokens.
    pub(crate) fn value(&self) -> String {
        match &self.cost {
            Some((amount, currency)) => agent_ui::context_budget::format_usage_cost(*amount, currency),
            None => format!("{} tokens", agent_ui::summary::format_token_count(self.tokens)),
        }
    }

    /// "128k tokens · 2 sessions", the part the value does not already say.
    pub(crate) fn detail(&self) -> String {
        let mut parts = Vec::new();
        if self.cost.is_some() && self.tokens > 0 {
            parts.push(format!("{} tokens", agent_ui::summary::format_token_count(self.tokens)));
        }
        parts.push(match self.sessions {
            1 => "1 session open".to_string(),
            count => format!("{count} sessions open"),
        });
        parts.join(" · ")
    }
}

/// An ACP agent this machine can run.
pub(crate) struct InstalledAgent {
    pub(crate) id: String,
    pub(crate) name: String,
    /// What runs it: the version Athas installed, or that it was found on `PATH`.
    pub(crate) source: String,
}

/// How many agents are installed, without building their rows: the footer counts them on every
/// frame.
fn installed_agent_count(cx: &mut App) -> usize {
    use agent_ui::agent_registry::AgentRegistry;
    let registry = AgentRegistry::global(cx);
    let registry = registry.read(cx);
    registry.agents().iter().filter(|agent| registry.state(&agent.id).is_installed()).count()
}

/// The agents installed here, in the registry's order.
pub(crate) fn installed_agents(cx: &mut App) -> Vec<InstalledAgent> {
    use agent_ui::agent_registry::{AgentRegistry, InstallState};
    let registry = AgentRegistry::global(cx);
    let registry = registry.read(cx);
    registry
        .agents()
        .iter()
        .filter_map(|agent| {
            let source = match registry.state(&agent.id) {
                InstallState::NotInstalled => return None,
                InstallState::Managed { version: Some(version), .. } => version,
                InstallState::Managed { version: None, .. } => "Installed".to_string(),
                InstallState::External(_) => "On PATH".to_string(),
            };
            Some(InstalledAgent { id: agent.id.clone(), name: agent.name.clone(), source })
        })
        .collect()
}

/// A provider whose API key is saved here.
#[derive(Clone)]
pub(crate) struct ProviderKey {
    pub(crate) id: String,
    pub(crate) name: String,
    /// The key as settings shows it: the last four characters.
    pub(crate) masked: String,
}

/// The saved keys, read once and kept: a keychain read is slow and the footer counts them on
/// every render. [`refresh_provider_keys`] reads them again when the Accounts menu opens.
#[derive(Default)]
struct ProviderKeys(Vec<ProviderKey>);

impl gpui::Global for ProviderKeys {}

pub(crate) fn provider_keys(cx: &mut App) -> Vec<ProviderKey> {
    if !cx.has_global::<ProviderKeys>() {
        // The first read asks the OS keychain once per provider, which is slow enough to be
        // worth keeping out of the render that asked; the count arrives with the next frame.
        cx.set_global(ProviderKeys::default());
        cx.defer(|cx| {
            refresh_provider_keys(cx);
            cx.refresh_windows();
        });
    }
    cx.global::<ProviderKeys>().0.clone()
}

pub(crate) fn refresh_provider_keys(cx: &mut App) {
    let keychain = ai_providers::secrets::Keychain::shared();
    let keys = ai_providers::catalog::PROVIDERS
        .iter()
        .filter(|provider| provider.requires_api_key)
        .chain(ai_providers::external_providers().into_iter().filter(|provider| provider.requires_api_key))
        .filter_map(|provider| {
            let key = ai_providers::secrets::api_key(keychain, provider)?;
            Some(ProviderKey { id: provider.id.to_string(), name: provider.name.to_string(), masked: ai_providers::secrets::mask(&key) })
        })
        .collect();
    cx.set_global(ProviderKeys(keys));
}

/// Sessions a project's list shows before "Show more".
const PROJECT_SESSION_LIMIT: usize = 5;
/// How many more rows each "Show more" adds. Every row of the sidebar is built on every frame,
/// so a list of hundreds is paged rather than opened whole.
const SESSION_PAGE: usize = 25;
/// How long a new rename field keeps its focus through the menu closing.
const RENAME_FOCUS_SETTLE: std::time::Duration = std::time::Duration::from_millis(300);

impl Workbench {
    /// The sidebar as a column beside the centre, with its resize edge.
    pub(crate) fn render_sidebar_column(&self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let width = px(self.state.layout.sidebar_width);
        let resizing = matches!(self.drag, Some(Drag::Sidebar { .. }));
        let line = if resizing { cx.theme().colors.primary } else { cx.theme().colors.border_strong };
        let hairline = cx.theme().colors.border;
        div()
            .relative()
            .flex()
            .flex_none()
            .h_full()
            .w(width)
            .flex_row()
            .child(div().flex().flex_col().flex_1().min_w_0().h_full().child(self.render_sidebar(false, window, cx)))
            // Inside the shell the sidebar and the centre share a surface; a hairline divides
            // them, in a gutter of its own so nothing in the sidebar sits over the grab area.
            .child(
                div()
                    .id("sidebar-resize")
                    .flex_none()
                    .h_full()
                    .w(metrics::workbench_gap())
                    .flex()
                    .justify_center()
                    .cursor_col_resize()
                    .group("sidebar-resize")
                    .child(
                        div()
                            .w(px(1.))
                            .h_full()
                            .bg(hairline)
                            .when(resizing, |this| this.bg(line))
                            .group_hover("sidebar-resize", move |style| style.bg(line)),
                    )
                    .on_mouse_down(
                        MouseButton::Left,
                        cx.listener(|this, event: &gpui::MouseDownEvent, _, cx| {
                            this.drag = Some(Drag::Sidebar {
                                start_x: event.position.x,
                                start_width: this.state.layout.sidebar_width,
                            });
                            cx.stop_propagation();
                            cx.notify();
                        }),
                    )
                    .on_click(cx.listener(|this, event: &gpui::ClickEvent, _, cx| {
                        if event.click_count() == 2 {
                            this.update_state(cx, |state| {
                                state.layout.sidebar_width = f32::from(metrics::sidebar_default_width())
                            });
                        }
                    })),
            )
    }

    /// In a narrow window the sidebar floats over the centre, below the title row.
    pub(crate) fn render_sidebar_overlay(
        &self,
        narrow: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Option<impl IntoElement> {
        if !narrow || !self.sidebar_overlay_open {
            return None;
        }
        let top = metrics::workbench_gap() + metrics::pane_header();
        Some(
            div()
                .absolute()
                .inset_0()
                .child(
                    div()
                        .id("sidebar-backdrop")
                        .absolute()
                        .inset_0()
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.sidebar_overlay_open = false;
                            cx.notify();
                        })),
                )
                .child(
                    island(cx)
                        .absolute()
                        .top(top)
                        .bottom(metrics::workbench_gap())
                        .left(metrics::workbench_gap() + metrics::rail_control())
                        .w(px(288.))
                        // Solid even with glass on: it floats over the centre, not the desktop,
                        // and a see-through surface showed the editor's text under the tool.
                        .bg(gpui::Hsla { a: 1., ..cx.theme().colors.surface })
                        .shadow(cx.theme().shadows.popover.clone())
                        .occlude()
                        .child(self.render_sidebar(false, window, cx)),
                ),
        )
    }

    /// The view the activity bar picked: the agents, or a project tool.
    fn render_sidebar(&self, title_row: bool, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let view = self.state.layout.sidebar_view;
        let extension_view = self.shown_extension_view(cx);
        // A tool's own buttons, such as refresh or collapse, sit at the end of the top row.
        let actions = match view {
            _ if extension_view.is_some() => None,
            SidebarView::Files => self
                .file_tree
                .as_ref()
                .map(|(tree, _)| tree.update(cx, |tree, cx| tree.render_header_actions(window, cx))),
            // Source Control and GitHub put their buttons in their own header, beside the
            // section switcher.
            _ => None,
        };
        // The top row belongs to the window's controls; a tool's own buttons get a row of their
        // own under it, so neither covers the other at any sidebar width. Like the original's
        // pane actions, they stay hidden until the pointer is over the sidebar.
        let header = title_row.then(|| {
            let row = div().id("sidebar-title-row").h(metrics::pane_header()).w_full().flex_none();
            self.drag_region(row, cx)
        });
        // Files gets a titled header, as the Sessions list has: its two buttons (New, More) stay
        // visible, where a hidden row of five used to leave an empty band over the tree.
        let files_header = view == SidebarView::Files && extension_view.is_none();
        let toolbar = actions.map(|actions| {
            if files_header {
                return div().flex_none().px(px(8.)).pb(px(2.)).child(SectionLabel::new("Files").trailing(actions));
            }
            div()
                .flex()
                .flex_none()
                .items_center()
                .justify_end()
                .h(metrics::chrome_control() + px(4.))
                .px(px(4.))
                .invisible()
                .group_hover("sidebar-pane", |style| style.visible())
                .child(actions)
        });
        let body = match view {
            _ if extension_view.is_some() && self.state.active_project().is_none() => self.render_project_tool(view, cx).into_any_element(),
            _ if let Some(extension_view) = &extension_view => self.render_extension_view(extension_view, cx),
            SidebarView::Agents => self.render_agents_view(window, cx).into_any_element(),
            // Settings needs no project: the sidebar lists its pages and the centre tab shows
            // the one picked.
            SidebarView::Settings => div()
                .flex()
                .flex_col()
                .flex_1()
                .min_h_0()
                .children(self.settings_nav.clone())
                .into_any_element(),
            tool => self.render_project_tool(tool, cx).into_any_element(),
        };
        div()
            .group("sidebar-pane")
            .track_focus(&self.sidebar_focus)
            // A click in the sidebar keeps focus there unless a view in it took it, as a
            // button keeps it in the original.
            .on_mouse_down(
                MouseButton::Left,
                cx.listener(|this, _: &gpui::MouseDownEvent, window, cx| {
                    if !this.sidebar_focus.contains_focused(window, cx) {
                        window.focus(&this.sidebar_focus, cx);
                    }
                }),
            )
            .flex()
            .flex_col()
            .size_full()
            .min_h_0()
            .min_w_0()
            // The window chrome has a strip of its own now, so the sidebar opens at the shell's
            // edge; it keeps the gap off the border itself.
            .when(!title_row, |this| this.pt(metrics::workbench_gap()))
            .children(header)
            .children(toolbar)
            .child(body)
    }

    fn render_project_tool(&self, tool: SidebarView, cx: &mut Context<Self>) -> impl IntoElement {
        // Source Control without a project is the panel's own "No repository selected".
        if tool == SidebarView::Git
            && self.state.active_project().is_none()
            && let Some((git, _)) = &self.git_panel
        {
            return div().flex().flex_col().flex_1().min_h_0().child(git.clone());
        }
        let message = match self.state.active_project() {
            None => EmptyState::new("No project open")
                .icon(IconName::FolderOpen)
                .message("Open a folder to use its tools here.")
                .action(
                    Button::new("tool-open-project", "Open project…")
                        .size(ButtonSize::Medium)
                        .on_click(cx.listener(|this, _, _, cx| this.prompt_open_project(cx))),
                ),
            Some(project) => {
                let view = match tool {
                    SidebarView::Files => self.file_tree.as_ref().map(|(tree, _)| tree.clone().into_any_element()),
                    SidebarView::Git => self.git_panel.as_ref().map(|(git, _)| git.clone().into_any_element()),
                    SidebarView::GitHub => self.github_panel.as_ref().map(|(github, _)| github.clone().into_any_element()),
                    _ => None,
                };
                if let Some(view) = view {
                    return div().flex().flex_col().flex_1().min_h_0().child(view);
                }
                EmptyState::new(tool.title())
                    .icon(IconName::GitPullRequest)
                    .message(format!("{} for {} arrives with its port.", tool.title(), project.name))
            }
        };
        div().flex().flex_1().min_h_0().items_center().justify_center().child(message)
    }

    fn render_agents_view(&self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = cx.theme().colors.clone();
        let lists = self.state.sidebar_sessions();
        let now = now_ms();
        let rows = self.session_row_context(now, cx);
        let focused_session = match &self.state.focus {
            Some(Owner::Session(id)) => Some(id.clone()),
            _ => None,
        };
        let emphasized = self.sidebar_focus.contains_focused(window, cx);
        let row = |session: &Session, this: &Self, cx: &mut Context<Self>| {
            this.render_session_row(session, focused_session.as_ref() == Some(&session.id), emphasized, &rows, cx)
        };
        let mut cloud = self.cloud_sidebar_groups(cx);

        let mut content = div().flex().flex_col().gap(px(12.)).px(px(8.)).pb(px(8.));

        let project = self.state.active_project().cloned();
        if project.is_none() {
            content = content.child(
                SidebarListItem::new("sidebar-open-project", "Open project…")
                    .leading(Icon::new(IconName::FolderOpen).size(IconSize::XSmall).color(colors.subtle_foreground))
                    .on_click(cx.listener(|this, _, _, cx| this.prompt_open_project(cx))),
            );
        }
        // Chats (sessions of no open project) are sessions like any other and share the list.
        let project_id = project.as_ref().map(|project| project.id.clone());
        let mut actions = div().flex().items_center().gap(px(2.)).child(self.render_session_filter(cx));
        if let Some(project_id) = project_id.clone() {
            let menu_key = format!("project-menu:{}", project_id.0);
            let menu_open = self.menu_is_open(&menu_key);
            actions = actions.child(
                Button::icon("project-actions", IconName::Dots)
                    .size(ButtonSize::Small)
                    .plane(ui::Plane::Page)
                    .active(menu_open)
                    .tooltip("Project actions")
                    .on_click(cx.listener(move |this, event: &gpui::ClickEvent, window, cx| {
                        let entries = this.project_menu_entries(&project_id, cx);
                        let position = event.position();
                        let position = point(position.x + px(8.), position.y + px(8.));
                        this.show_menu(&menu_key, entries, position, Anchor::TopRight, window, cx);
                    })),
            );
        }
        let sessions: Vec<&Session> = lists.project.iter().chain(lists.chats.iter()).copied().collect();
        let outside = project
            .as_ref()
            .map(|project| agent_ui::outside_sessions::sidebar_sessions(std::path::Path::new(&project.path), cx))
            .unwrap_or_default();
        let mut section = div().id("project-sessions").flex().flex_col().gap(px(4.));
        if let Some(project_id) = project_id.clone() {
            section = section.on_mouse_down(
                MouseButton::Right,
                cx.listener(move |this, event: &gpui::MouseDownEvent, window, cx| {
                    let entries = this.project_menu_entries(&project_id, cx);
                    this.show_menu("project-context", entries, event.position, Anchor::TopLeft, window, cx);
                }),
            );
        }
        section = section.child(SectionLabel::new("Sessions").trailing(actions));
        section = section.child(
            Button::new("project-new-session", "New session")
                .leading_icon(IconName::Plus)
                .size(ButtonSize::Small)
                .plane(ui::Plane::Page)
                .full_width()
                .align_start()
                .regular_weight()
                .on_click(cx.listener({
                    let project_id = project_id.clone();
                    move |this, _, _, cx| this.start_session(project_id.clone(), cx)
                })),
        );
        // Pinned sessions sit right under the button, over a line that divides them from the
        // project's own list.
        if !lists.pinned.is_empty() {
            section = section.child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(1.))
                    .pt(px(2.))
                    .children(lists.pinned.iter().map(|session| row(session, self, cx)))
                    .child(div().pt(px(5.)).pb(px(1.)).px(px(6.)).child(ui::Separator::horizontal())),
            );
        }
        let mut list = div().flex().flex_col().gap(px(1.));
        let filter = self.session_filter;
        if sessions.is_empty() && outside.is_empty() {
            // The New session button above says what to do; a row repeating it read as a session.
            list = list.child(
                div()
                    .px(px(6.))
                    .py(px(2.))
                    .text_size(ui::typography::text_caption())
                    .text_color(colors.subtle_foreground)
                    .child("No sessions yet"),
            );
        } else {
            let list_key = project_id.as_ref().map_or_else(|| "chats".to_string(), |id| id.0.clone());
            // How many rows the list shows: the first few, then a page more each time it is
            // asked. Two hundred rows at once made every frame of the whole window slow, and the
            // ones past the first screenful were not being read anyway.
            let shown = self.expanded_session_lists.get(&list_key).copied().unwrap_or(PROJECT_SESSION_LIMIT);
            // A filter narrows the list to the sessions in that state; the agents' own sessions
            // carry no status of ours, so they show only under All.
            let mut entries: Vec<(u64, Result<&Session, &agent_ui::outside_sessions::OutsideSession>)> = sessions
                .iter()
                .filter(|session| filter.matches(session.status))
                .map(|session| (session.last_activity_at, Ok(*session)))
                .chain(outside.iter().filter(|_| filter == SessionFilter::All).map(|session| (session.updated_ms(), Err(session))))
                .collect();
            entries.sort_by_key(|(at, _)| std::cmp::Reverse(*at));
            if entries.is_empty() {
                list = list.child(
                    div()
                        .px(px(6.))
                        .py(px(2.))
                        .text_size(ui::typography::text_caption())
                        .text_color(colors.subtle_foreground)
                        .child(format!("No session is {}", filter.label().to_lowercase())),
                );
            }
            let visible = entries.len().min(shown);
            let hidden = entries.len() - visible;
            list = list.children(entries.iter().take(visible).map(|(_, entry)| match entry {
                Ok(session) => row(session, self, cx),
                Err(session) => self.render_outside_session_row(session, now, cx),
            }));
            if hidden > 0 || shown > PROJECT_SESSION_LIMIT {
                let step = hidden.min(SESSION_PAGE);
                let label = if hidden == 0 { "Show less".to_string() } else { format!("Show {step} more") };
                list = list.child(
                    SidebarListItem::new("project-sessions-show-more", label)
                        .leading(
                            Icon::new(if hidden == 0 { IconName::ChevronUp } else { IconName::ChevronDown })
                                .size(IconSize::XSmall)
                                .color(colors.subtle_foreground),
                        )
                        .on_click(cx.listener(move |this, _, _, cx| {
                            match hidden {
                                0 => {
                                    this.expanded_session_lists.remove(&list_key);
                                }
                                _ => {
                                    let shown = this.expanded_session_lists.entry(list_key.clone()).or_insert(PROJECT_SESSION_LIMIT);
                                    *shown += SESSION_PAGE;
                                }
                            }
                            cx.notify();
                        })),
                );
            }
        }
        if let Some(project) = &project {
            let project_runs = cloud.runs_by_project.remove(&project.id.0).unwrap_or_default();
            list = list.children(project_runs.iter().map(|run| self.render_cloud_run_row(run, now, cx)));
        }
        content = content.child(section.child(list));

        if !cloud.other_runs.is_empty() {
            content = content.child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(4.))
                    .child(SectionLabel::new("Cloud"))
                    .child(div().flex().flex_col().gap(px(1.)).children(cloud.other_runs.iter().map(|run| self.render_cloud_run_row(run, now, cx)))),
            );
        }

        let scroll = window.use_keyed_state("sessions-scroll-handle", cx, |_, _| gpui::ScrollHandle::new()).read(cx).clone();
        let list = div()
            .id("sessions-scroll")
            .flex_1()
            .min_h_0()
            .overflow_y_scroll()
            .track_scroll(&scroll)
            .on_mouse_down(
                MouseButton::Right,
                cx.listener(|this, event: &gpui::MouseDownEvent, window, cx| {
                    let weak = cx.weak_entity();
                    let mut entries: Vec<ui::MenuEntry> = vec![
                        ui::MenuItem::new("New session")
                            .icon(IconName::PencilLine)
                            .on_select({
                                let weak = weak.clone();
                                move |_, cx| {
                                    weak.update(cx, |this, cx| {
                                        this.start_session(this.state.active_project.clone(), cx)
                                    })
                                    .ok();
                                }
                            })
                            .into(),
                        ui::MenuItem::new("New chat")
                            .icon(IconName::ChatBubbleText)
                            .on_select(move |_, cx| {
                                weak.update(cx, |this, cx| this.start_session(None, cx)).ok();
                            })
                            .into(),
                        ui::MenuEntry::Separator,
                    ];
                    entries.extend(this.add_project_entries(cx));
                    this.show_menu("sidebar-context", entries, event.position, Anchor::TopLeft, window, cx);
                }),
            )
            .child(content);
        div()
            .flex()
            .flex_col()
            .flex_1()
            .min_h_0()
            .child(ui::with_scrollbar(list, ui::Scrollbar::new("sessions-scrollbar", &scroll)))
            .child(self.render_sessions_footer(cx))
    }

    /// The rows under the session list: Usage and Accounts each open their menu where they were
    /// clicked, as Source Control's Stashes row does.
    fn render_sessions_footer(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = cx.theme().colors.clone();
        let usage = crate::agent_usage::rows(cx).len();
        let accounts = self.connected_accounts(cx);
        let mut rows: Vec<gpui::AnyElement> = Vec::new();
        let mut add = |id: &'static str, label: &'static str, icon: IconName, count: usize, which: fn() -> crate::secondary::Secondary| {
            let item = SidebarListItem::new(id, label)
                .leading(Icon::new(icon).size(IconSize::XSmall).color(colors.subtle_foreground))
                .trailing(count.to_string())
                .active(self.secondary_is(id))
                .on_click(cx.listener(move |this, _, window, cx| this.toggle_secondary(which(), window, cx)));
            rows.push(div().flex_none().px(px(8.)).child(item).into_any_element());
        };
        add("sessions-usage", "Usage", IconName::Activity, usage, || crate::secondary::Secondary::Usage);
        add("sessions-accounts", "Accounts", IconName::UserCircle, accounts, || crate::secondary::Secondary::Accounts);
        // Archived sits with them, counted the same way whether or not there is anything in it,
        // and opens in the same column.
        add("sessions-archived", "Archived", IconName::Archive, self.archived_count(), || crate::secondary::Secondary::Archived);
        div().flex().flex_col().flex_none().gap(px(2.)).py(px(4.)).children(rows)
    }

    /// How many accounts the agents run on are connected: the Athas account, GitHub, every ACP
    /// agent installed here and every provider with an API key.
    fn connected_accounts(&self, cx: &mut Context<Self>) -> usize {
        let athas = account::AccountStore::global(cx).is_some_and(|store| store.read(cx).is_signed_in());
        let github = account::linked_accounts::github(cx).is_some_and(|linked| linked.connected);
        usize::from(athas) + usize::from(github) + installed_agent_count(cx) + provider_keys(cx).len()
    }

    /// What the accounts the agents run on have left, and what the sessions open now have spent.
    /// Allowances come from the accounts that publish one; everything else reports its own spend,
    /// since ACP agents and the model APIs publish no quota at all.
    /// What the sessions open now have spent, by agent: the tokens and the cost each agent
    /// reports for its session (`Transcript::usage`). Agents that report neither are left out.
    pub(crate) fn session_spend(&self, cx: &App) -> Vec<AgentSpend> {
        let mut spend: Vec<AgentSpend> = Vec::new();
        for view in self.centre_views.values() {
            let Some(session) = &view.session else { continue };
            let session = session.read(cx);
            let Some(usage) = session.transcript().usage.as_ref() else { continue };
            let tokens = usage.input_tokens.unwrap_or_default() + usage.output_tokens.unwrap_or_default();
            if tokens == 0 && usage.cost.is_none() {
                continue;
            }
            let id = session.info().agent.clone();
            let agent = match spend.iter().position(|agent| agent.id == id) {
                Some(index) => &mut spend[index],
                None => {
                    spend.push(AgentSpend { name: agent_ui::acp::agents::display_name(&id), id, tokens: 0, cost: None, sessions: 0 });
                    spend.last_mut().expect("just pushed")
                }
            };
            agent.sessions += 1;
            agent.tokens += tokens;
            if let Some(cost) = &usage.cost {
                let spent = agent.cost.as_ref().map_or(0., |(amount, _)| *amount);
                agent.cost = Some((spent + cost.amount, cost.currency.clone()));
            }
        }
        spend.sort_by(|left, right| right.tokens.cmp(&left.tokens));
        spend
    }

    /// The accounts the agents sign in with: the Athas account and GitHub, the ACP agents
    /// installed here, and the providers whose API key is saved. Each row opens where it is
    /// managed; the Athas account keeps its own actions in a submenu, as a stash does.
    /// The Filter button in the Sessions header, before More actions: what the list is narrowed
    /// to, with the search over every session inside its menu. It stays filled while a filter is
    /// on, so a short list says why it is short.
    fn render_session_filter(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let filter = self.session_filter;
        let tooltip = if filter == SessionFilter::All { "Filter sessions".to_string() } else { format!("Filter: {}", filter.label()) };
        Button::icon("sessions-filter", IconName::Filter)
            .size(ButtonSize::Small)
            .plane(ui::Plane::Page)
            .active(self.menu_is_open("sessions-filter") || filter != SessionFilter::All)
            .tooltip(tooltip)
            .on_click(cx.listener(|this, event: &gpui::ClickEvent, window, cx| {
                let position = event.position();
                this.show_session_filter_menu(point(position.x + px(8.), position.y + px(8.)), window, cx)
            }))
    }

    /// The Filter menu: what the list shows, and — once something is typed in its field — every
    /// session whose title matches, so the search lives where the filter does.
    fn show_session_filter_menu(&mut self, position: Point<Pixels>, window: &mut Window, cx: &mut Context<Self>) {
        let current = self.session_filter;
        let weak = cx.weak_entity();
        let mut entries: Vec<MenuEntry> = vec![MenuEntry::Label("Show".into())];
        for filter in SessionFilter::ALL {
            entries.push(
                MenuItem::new(filter.label())
                    .icon(filter.icon())
                    .checked(current == filter)
                    .on_select({
                        let weak = weak.clone();
                        move |_, cx| {
                            weak.update(cx, |this, cx| {
                                this.session_filter = filter;
                                cx.notify();
                            })
                            .ok();
                        }
                    })
                    .into(),
            );
        }
        let lists = self.state.sidebar_sessions();
        let sessions: Vec<Session> = lists
            .pinned
            .iter()
            .chain(lists.project.iter())
            .chain(lists.chats.iter())
            .chain(lists.archived.iter())
            .map(|session| (*session).clone())
            .collect();
        self.show_menu("sessions-filter", entries, position, Anchor::TopRight, window, cx);
        self.make_menu_searchable("sessions-filter", "Search sessions…", "No matching sessions", cx);
        // What is typed searches every session, in place of the rows above (`set_query_source`),
        // so the menu stays the few filters until it is used as a search.
        let Some(menu) = self.open_menu.as_ref().filter(|menu| menu.key.as_ref() == "sessions-filter") else { return };
        let now = now_ms();
        let weak = cx.weak_entity();
        menu.menu.update(cx, move |menu, _| {
            menu.set_query_source(std::rc::Rc::new(move |query, _, _| {
                let query = query.to_lowercase();
                sessions
                    .iter()
                    .filter(|session| session.title.to_lowercase().contains(&query) || session.agent.to_lowercase().contains(&query))
                    .map(|session| {
                        let id = session.id.clone();
                        let weak = weak.clone();
                        MenuItem::new(session.title.clone())
                            .icon(agent_ui::model_vendor::provider_icon(&session.agent))
                            .trailing_text(relative_time(session.last_activity_at, now))
                            .on_select(move |window, cx| {
                                weak.update(cx, |this, cx| this.open_session(id.clone(), window, cx)).ok();
                            })
                            .into()
                    })
                    .collect()
            }))
        });
    }

    /// Opens one of the Sessions sidebar's own menus at `position`, so a headless snapshot can
    /// draw it (`ATHAS_SNAPSHOT_SIDEBAR_MENU`).
    pub fn show_sidebar_menu(&mut self, which: &str, position: Point<Pixels>, window: &mut Window, cx: &mut Context<Self>) {
        match which {
            // Usage and Accounts are panels in the secondary column now, not menus.
            "usage" => self.toggle_secondary(crate::secondary::Secondary::Usage, window, cx),
            "accounts" => self.toggle_secondary(crate::secondary::Secondary::Accounts, window, cx),
            "archived" => self.toggle_secondary(crate::secondary::Secondary::Archived, window, cx),
            "filter" => self.show_session_filter_menu(position, window, cx),
            _ => {}
        }
    }

    /// Opens a sidebar tool's command surface, so a headless snapshot can draw it
    /// (`ATHAS_SNAPSHOT_COMMAND_SURFACE`).
    pub fn show_tool_command_surface(&mut self, which: &str, cx: &mut Context<Self>) {
        let list = match (which, &self.git_panel, &self.github_panel) {
            ("releases" | "deployments", _, Some((github, _))) => github.update(cx, |panel, cx| panel.command_surface(which, cx)),
            (_, Some((git, _)), _) => git.update(cx, |panel, cx| panel.command_surface(which, cx)),
            _ => None,
        };
        let Some(list) = list else { return };
        palette::show_command_list(cx, list);
    }

    /// A search field over an open menu's rows, as the Source Control menus have.
    fn make_menu_searchable(&mut self, key: &str, placeholder: &str, empty: &str, cx: &mut Context<Self>) {
        if self.menu_is_open(key) && let Some(menu) = self.open_menu.take() {
            self.open_menu = Some(menu.searchable(placeholder.to_string(), empty.to_string(), cx));
        }
    }


    /// What every session row needs to know, read once for the whole list: the theme, the sessions
    /// in a window of their own and the ones running in the cloud. Asking per row walked the open
    /// windows and formatted a tab key for each of two hundred rows, on every frame.
    pub(crate) fn session_row_context(&self, now: u64, cx: &mut Context<Self>) -> SessionRowContext {
        let cloud = self
            .centre_views
            .iter()
            .filter_map(|(key, view)| {
                let session = view.session.as_ref()?;
                let id = key.strip_prefix("session:")?;
                session.read(cx).cloud_environment().is_some().then(|| id.to_string())
            })
            .collect();
        SessionRowContext { colors: cx.theme().colors.clone(), detached: crate::detached::detached_sessions(cx), cloud, now }
    }

    /// A sidebar session row; `emphasized` while the sidebar has focus.
    pub(crate) fn render_session_row(&self, session: &Session, active: bool, emphasized: bool, rows: &SessionRowContext, cx: &mut Context<Self>) -> gpui::AnyElement {
        self.render_session_row_in(session, active && emphasized, active, true, rows, cx)
    }

    /// A session's row; `renamable` rows turn into the rename field while it is open, so the
    /// field shows in the sidebar only, not again in the project's home.
    pub(crate) fn render_session_row_in(
        &self,
        session: &Session,
        emphasized: bool,
        active: bool,
        renamable: bool,
        rows: &SessionRowContext,
        cx: &mut Context<Self>,
    ) -> gpui::AnyElement {
        let colors = &rows.colors;
        let now = rows.now;
        // `StatusIcon` of `SessionSidebarRow`: the agent's mark while idle, a spinner while it
        // works, else the most urgent state's mark in its colour.
        let status_icon = |icon: IconName, color| Icon::new(icon).size(IconSize::XSmall).color(color).into_any_element();
        let leading = match session.status {
            SessionStatus::Idle => status_icon(agent_ui::model_vendor::provider_icon(&session.agent), colors.subtle_foreground),
            SessionStatus::Running => ui::Spinner::new(gpui::ElementId::Name(format!("session-spinner-{}", session.id.0).into())).compact().into_any_element(),
            SessionStatus::NeedsInput => status_icon(IconName::WarningCircle, colors.warning),
            SessionStatus::ReviewReady => status_icon(IconName::CheckCircle, colors.success),
            SessionStatus::PrOpen => status_icon(IconName::GitPullRequest, colors.success),
            SessionStatus::Merged => status_icon(IconName::GitMerge, colors.merged),
            SessionStatus::Failed => status_icon(IconName::Xcircle, colors.destructive),
        };
        let detached = rows.detached.contains(&session.id.0);
        let cloud = rows.cloud.contains(&session.id.0);
        if let Some((_, input, _, _)) = self.session_rename.as_ref().filter(|(id, ..)| renamable && *id == session.id) {
            return div()
                .flex()
                .w_full()
                .items_center()
                .gap(metrics::chrome_gap())
                .min_h(metrics::list_row())
                .px(px(6.))
                .py(px(2.))
                .rounded(metrics::radius_md())
                .bg(colors.selected)
                .child(Icon::new(agent_ui::model_vendor::provider_icon(&session.agent)).size(IconSize::XSmall).color(colors.subtle_foreground))
                .child(div().flex_1().min_w_0().py(px(4.)).border_b_1().border_color(colors.primary).child(input.clone()))
                .into_any_element();
        }
        let id = session.id.clone();
        let menu_id = session.id.clone();
        let more_id = session.id.clone();
        let more_key = format!("session-more:{}", session.id.0);
        let more_open = self.menu_is_open(&more_key);
        // Unread, cloud, pinned and how long ago, in the caption colour (`tabular-nums`).
        let trailing = div()
            .flex()
            .items_center()
            .gap(px(6.))
            .text_size(ui::typography::text_caption())
            .text_color(colors.subtle_foreground)
            .when(cloud, |this| this.child(Icon::new(IconName::Cloud).size(IconSize::XSmall).color(colors.subtle_foreground)))
            .when(session.pinned, |this| {
                this.child(Icon::new(IconName::Pin).size(IconSize::XSmall).color(colors.subtle_foreground))
            })
            .child(session_age(session.last_activity_at, now));

        let new_window_id = session.id.clone();
        SidebarListItem::new(gpui::ElementId::Name(format!("session-{}", session.id.0).into()), session.title.clone())
            .leading(leading)
            .indicator((session.unread && !active).then(|| {
                div().id(gpui::ElementId::Name(format!("session-unread-{}", session.id.0).into())).flex_none().size(px(6.)).rounded_full().bg(colors.primary)
            }))
            .trailing(trailing)
            .hover_trailing(
                Button::icon(gpui::ElementId::Name(format!("session-more-{}", session.id.0).into()), IconName::Dots)
                    .size(ButtonSize::Small)
                    .plane(ui::Plane::Page)
                    .active(more_open)
                    .disabled(detached)
                    .tooltip("More actions")
                    .on_click(cx.listener(move |this, event: &gpui::ClickEvent, window, cx| {
                        cx.stop_propagation();
                        let entries = this.session_menu_entries(&more_id, false, cx);
                        let position = event.position();
                        let position = point(position.x + px(8.), position.y + px(8.));
                        this.show_menu(&more_key, entries, position, Anchor::TopRight, window, cx);
                    })),
            )
            .active(active)
            .emphasized(emphasized)
            // A click opens the session; a double click moves it to a window of its own.
            .on_click(cx.listener(move |this, event: &gpui::ClickEvent, window, cx| {
                if event.click_count() == 2 {
                    this.move_session_to_new_window(&new_window_id, cx);
                } else {
                    this.open_session(id.clone(), window, cx);
                }
            }))
            .on_secondary_mouse_down(cx.listener(move |this, event: &gpui::MouseDownEvent, window, cx| {
                cx.stop_propagation();
                let entries = this.session_menu_entries(&menu_id, true, cx);
                this.show_menu("session-context", entries, event.position, Anchor::TopLeft, window, cx);
            }))
            .into_any_element()
    }

    /// Cloud runs with no session here yet (`use-cloud-sidebar-entries.ts`).
    pub(crate) fn cloud_sidebar_groups(&self, cx: &mut Context<Self>) -> agent_ui::cloud::sidebar::CloudSidebarGroups {
        use agent_ui::cloud::sidebar;
        if sidebar::runs(cx).is_empty() {
            return Default::default();
        }
        let ids: Vec<String> = self.state.sessions.iter().map(|session| session.id.0.clone()).collect();
        let mut adopted = sidebar::followed_by_sessions(ids.iter().map(String::as_str), cx);
        for view in self.centre_views.values().filter_map(|view| view.session.as_ref()) {
            if let Some(cloud) = view.read(cx).cloud_environment() {
                adopted.extend(cloud.runs.iter().filter_map(|run| run.run_id.clone()));
            }
        }
        let projects: Vec<(String, Option<String>)> =
            self.state.projects.iter().map(|project| (project.id.0.clone(), sidebar::project_repo(std::path::Path::new(&project.path), cx))).collect();
        let runs = sidebar::runs(cx).to_vec();
        sidebar::group_cloud_sidebar_entries(&runs, &adopted, &projects, now_ms())
    }

    /// A cloud run with no session here yet; opening it makes it one (`cloud-run-sidebar-row.tsx`).
    /// A conversation an agent keeps for the project outside Athas; opening it imports it as a
    /// session the agent replays.
    pub(crate) fn render_outside_session_row(&self, session: &agent_ui::outside_sessions::OutsideSession, now: u64, cx: &mut Context<Self>) -> gpui::AnyElement {
        let colors = cx.theme().colors.clone();
        let updated = Some(session.updated_ms()).filter(|ms| *ms > 0).map(|ms| relative_time(ms, now));
        let (open, menu_session) = (session.clone(), session.clone());
        SidebarListItem::new(gpui::ElementId::Name(format!("outside-session-{}-{}", session.agent, session.session_id).into()), session.title.clone())
            .leading(Icon::new(agent_ui::model_vendor::provider_icon(&session.agent)).size(IconSize::XSmall).color(colors.subtle_foreground))
            .trailing(div().text_size(ui::typography::text_caption()).text_color(colors.subtle_foreground).children(updated))
            .on_click(cx.listener(move |this, _, _, cx| this.import_outside_session(open.clone(), cx)))
            .on_secondary_mouse_down(cx.listener(move |this, event: &gpui::MouseDownEvent, window, cx| {
                cx.stop_propagation();
                let session = menu_session.clone();
                let view = cx.entity();
                let entries: Vec<ui::MenuEntry> = vec![
                    ui::MenuItem::new("Open in Athas")
                        .icon(IconName::ChatBubbleText)
                        .on_select(move |_, cx| view.update(cx, |this, cx| this.import_outside_session(session.clone(), cx)))
                        .into(),
                ];
                this.show_menu("outside-session-context", entries, event.position, Anchor::TopLeft, window, cx);
            }))
            .into_any_element()
    }

    pub(crate) fn render_cloud_run_row(&self, run: &agent_ui::cloud::CloudRun, now: u64, cx: &mut Context<Self>) -> gpui::AnyElement {
        let colors = cx.theme().colors.clone();
        let agent = agent_ui::cloud::session::session_agent(&run.agent);
        let trailing = if run.status.is_active() {
            div().child(Icon::new(IconName::CircleDotted).size(IconSize::XSmall).color(colors.primary))
        } else {
            let icon = match run.status {
                agent_ui::cloud::RunStatus::Succeeded if run.pr_url.is_some() => IconName::GitPullRequest,
                agent_ui::cloud::RunStatus::Failed => IconName::Xcircle,
                _ => IconName::Cloud,
            };
            let created = Some(agent_ui::cloud::sidebar::created_ms(run)).filter(|ms| *ms > 0).map(|ms| relative_time(ms, now));
            div()
                .flex()
                .items_center()
                .gap(px(4.))
                .text_color(colors.subtle_foreground)
                .child(Icon::new(icon).size(IconSize::XSmall).color(colors.subtle_foreground))
                .children(created)
        };
        let title = if run.title.is_empty() { run.repo.clone() } else { run.title.clone() };
        let open = run.clone();
        let menu_run = run.clone();
        SidebarListItem::new(gpui::ElementId::Name(format!("cloud-run-{}", run.id).into()), title)
            .leading(Icon::new(agent_ui::model_vendor::provider_icon(agent)).size(IconSize::XSmall).color(colors.subtle_foreground))
            .description(run.repo.clone())
            .trailing(trailing)
            .on_click(move |_, _, cx| agent_ui::cloud::session::open_run_as_session(open.clone(), cx))
            .on_secondary_mouse_down(cx.listener(move |this, event: &gpui::MouseDownEvent, window, cx| {
                cx.stop_propagation();
                let run = menu_run.clone();
                let mut entries: Vec<ui::MenuEntry> = vec![{
                    let run = run.clone();
                    ui::MenuItem::new("Open").icon(IconName::ChatBubbleText).on_select(move |_, cx| agent_ui::cloud::session::open_run_as_session(run.clone(), cx)).into()
                }];
                if let Some(url) = run.pr_url.clone() {
                    entries.push(ui::MenuItem::new("Open Pull Request").icon(IconName::GitPullRequest).external().on_select(move |_, cx| cx.open_url(&url)).into());
                }
                let repo = run.repo.clone();
                entries.push(
                    ui::MenuItem::new("Copy Repository Name")
                        .icon(IconName::Copy)
                        .on_select(move |_, cx| cx.write_to_clipboard(gpui::ClipboardItem::new_string(repo.clone())))
                        .into(),
                );
                this.show_menu("cloud-run-context", entries, event.position, Anchor::TopLeft, window, cx);
            }))
            .into_any_element()
    }

    /// Turns a session's sidebar row into a field holding its title.
    pub fn start_session_rename(&mut self, id: &workspace::SessionId, window: &mut Window, cx: &mut Context<Self>) {
        let Some(session) = self.state.session(id) else { return };
        let title = session.title.clone();
        let input = cx.new(|cx| {
            let mut input = ui::TextInput::new(window, cx).appearance(ui::InputAppearance::Bare).placeholder("Session title");
            input.set_text(title, cx);
            input.select_all_text(cx);
            input
        });
        let subscription = cx.subscribe_in(&input, window, |this, _, event: &ui::TextInputEvent, window, cx| match event {
            ui::TextInputEvent::Confirmed => this.finish_session_rename(true, cx),
            ui::TextInputEvent::Cancelled => this.finish_session_rename(false, cx),
            ui::TextInputEvent::Blurred => {
                let Some((_, input, _, opened)) = &this.session_rename else { return };
                if opened.elapsed() < RENAME_FOCUS_SETTLE {
                    let input = input.clone();
                    window.defer(cx, move |window, cx| {
                        let handle = input.focus_handle(cx);
                        window.focus(&handle, cx);
                    });
                } else {
                    this.finish_session_rename(true, cx);
                }
            }
            _ => {}
        });
        let focus = input.clone();
        window.defer(cx, move |window, cx| {
            let handle = focus.focus_handle(cx);
            window.focus(&handle, cx);
        });
        self.session_rename = Some((id.clone(), input, subscription, std::time::Instant::now()));
        cx.notify();
    }

    fn finish_session_rename(&mut self, keep: bool, cx: &mut Context<Self>) {
        let Some((id, input, _, _)) = self.session_rename.take() else { return };
        let title = input.read(cx).text().trim().to_string();
        let changed = self.state.session(&id).is_some_and(|session| session.title != title);
        if keep && !title.is_empty() && changed {
            self.update_state(cx, |state| state.rename_session(&id, &title));
            let key = crate::centre_views::tab_key(&workspace::TabItem::Session { id: id.clone() });
            if let Some(view) = self.centre_views.get(&key).and_then(|view| view.session.clone()) {
                view.update(cx, |view, _| view.rename(title));
            }
        }
        cx.notify();
    }
}

/// How long ago a session was active, as its row says it (`relativeTime` of
/// `workbench-sessions.tsx`): now, minutes, hours, days for the first week, then weeks.
fn session_age(then: u64, now: u64) -> String {
    let minutes = now.saturating_sub(then) / 60_000;
    let (hours, days) = (minutes / 60, minutes / 1440);
    match () {
        _ if minutes < 1 => "now".into(),
        _ if hours < 1 => format!("{minutes}m"),
        _ if days < 1 => format!("{hours}h"),
        _ if days < 7 => format!("{days}d"),
        _ => format!("{}w", days / 7),
    }
}

#[cfg(test)]
mod session_age_tests {
    #[test]
    fn counts_weeks_past_the_first() {
        let now = 100 * 86_400_000;
        assert_eq!(super::session_age(now - 30_000, now), "now");
        assert_eq!(super::session_age(now - 5 * 60_000, now), "5m");
        assert_eq!(super::session_age(now - 6 * 86_400_000, now), "6d");
        assert_eq!(super::session_age(now - 63 * 86_400_000, now), "9w");
    }
}
