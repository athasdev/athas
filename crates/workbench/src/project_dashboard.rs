//! A project's home (`project-dashboard-view.tsx`), the project's tab: its name and folder, its
//! branch and uncommitted lines, how many sessions work or need you, a new session, sessions
//! worth starting, every session of the project, its open pull requests and other worktrees.

use ui::TooltipExt as _;
use ui::WithScrollbar;
use std::{collections::HashMap, path::PathBuf};

use agent_ui::project_suggestions::{self, ProjectState};
use ui::scale::px;
use gpui::{AnyElement, Context, Global, IntoElement, ParentElement, Styled, Window, div, prelude::*,};
use theme::ActiveTheme;
use ui::{Button, ButtonVariant, EmptyState, IconName, SidebarListItem, typography};
use workspace::{ProjectId, SessionStatus, now_ms};

use crate::Workbench;

/// How long a project's Git state is shown before it is read again, in milliseconds.
const STATE_TTL_MS: u64 = 10_000;

/// Each project's Git state as last read, by folder, and whether a read is under way.
#[derive(Default)]
struct DashboardStates(HashMap<String, (Option<u64>, Option<ProjectState>)>);

impl Global for DashboardStates {}

/// How long a project's open issues are shown before they are asked for again, in milliseconds.
const ISSUES_TTL_MS: u64 = 60_000;

/// Each project's open issues as last fetched, by folder, with when they were asked for.
#[derive(Default)]
struct DashboardIssues(HashMap<String, (u64, Vec<(u64, String, String, String)>)>);

impl Global for DashboardIssues {}

/// Pull requests listed before the rest are left out.
const SHOWN_PULL_REQUESTS: usize = 5;

/// Each project's open pull requests as last fetched (`None` when the request failed), by folder,
/// with when they were asked for.
#[derive(Default)]
struct DashboardPullRequests(HashMap<String, (u64, Option<Vec<github_panel::quick_open::ProjectPullRequest>>)>);

impl Global for DashboardPullRequests {}

/// One of the project's other worktrees: its folder, branch and size on disk once measured.
#[derive(Clone, Debug, PartialEq)]
struct DashboardWorktree {
    path: String,
    branch: Option<String>,
    size: Option<u64>,
}

/// Each project's other worktrees as last read, by folder, with when they were read.
#[derive(Default)]
struct DashboardWorktrees(HashMap<String, (u64, Vec<DashboardWorktree>)>);

impl Global for DashboardWorktrees {}

/// The worktrees of `path` other than its own that still exist on disk, with their sizes.
fn read_worktrees(path: PathBuf) -> Vec<DashboardWorktree> {
    let Some(repository) = git_panel::discover_repository(&path) else { return Vec::new() };
    let Ok(worktrees) = repository.worktrees() else { return Vec::new() };
    worktrees
        .into_iter()
        // A prunable worktree's folder is gone; git only keeps its record, so it cannot be opened.
        .filter(|worktree| !worktree.is_current && !worktree.is_bare && !worktree.prunable)
        .map(|worktree| {
            let size = file_tree::local_fs().directory_size(std::path::Path::new(&worktree.path)).ok();
            DashboardWorktree { path: worktree.path, branch: worktree.branch, size }
        })
        .collect()
}

/// The branch, its distance from upstream and the uncommitted files and lines of `path`.
fn read_state(path: PathBuf) -> Option<ProjectState> {
    let status = git_panel::discover_repository(&path)?.status().ok()?;
    let (additions, deletions) = status.stats.iter().fold((0, 0), |(additions, deletions), stat| (additions + stat.additions, deletions + stat.deletions));
    Some(ProjectState { branch: status.branch, ahead: status.ahead, behind: status.behind, changed_files: status.files.len(), additions, deletions, issues: Vec::new() })
}

/// Sessions the project overview lists before "Show all".
const DASHBOARD_SESSIONS: usize = 8;

impl Workbench {
    pub(crate) fn render_project_dashboard(&self, id: &ProjectId, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let colors = cx.theme().colors.clone();
        let Some(project) = self.state.project(id).cloned() else {
            return div().flex().flex_1().justify_center().pt(px(72.)).child(EmptyState::new("Project").message("This project is not open.")).into_any_element();
        };
        let ai_enabled = cx.try_global::<settings::SettingsStore>().is_none_or(|_| settings::get(cx).core_features.ai_chat);
        let mut sessions: Vec<_> = self.state.sessions.iter().filter(|session| session.project.as_ref() == Some(id) && session.archived_at.is_none()).cloned().collect();
        sessions.sort_by(|a, b| b.last_activity_at.cmp(&a.last_activity_at));
        let working = sessions.iter().filter(|session| session.status == SessionStatus::Running).count();
        let attention = sessions.iter().filter(|session| session.status == SessionStatus::NeedsInput).count();
        let summary = [
            (working > 0).then(|| format!("{working} working")),
            (attention > 0).then(|| format!("{attention} need{} you", if attention == 1 { "s" } else { "" })),
        ]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>()
        .join(" · ");
        let issues = self.project_issues(&project.path, cx);
        let state = self.project_state(&project.path, cx).map(|state| ProjectState { issues, ..state });
        let now = now_ms();
        // The project's sessions, the conversations its agents keep outside Athas and its cloud
        // runs with no session yet, newest first, as the sidebar lists them.
        let outside = agent_ui::outside_sessions::sidebar_sessions(std::path::Path::new(&project.path), cx);
        let cloud_runs = self.cloud_sidebar_groups(cx).runs_by_project.remove(&project.id.0).unwrap_or_default();
        // Sorted before any row is built: a project can have hundreds of sessions (the agents'
        // own history included), and building every row made the page slow to open.
        enum Entry<'a> {
            Session(&'a workspace::Session),
            Outside(&'a agent_ui::outside_sessions::OutsideSession),
            Cloud(&'a agent_ui::cloud::CloudRun),
        }
        let mut entries: Vec<(u64, Entry)> = sessions.iter().filter(|session| !session.pinned).map(|session| (session.last_activity_at, Entry::Session(session))).collect();
        entries.extend(outside.iter().map(|session| (session.updated_ms(), Entry::Outside(session))));
        entries.extend(cloud_runs.iter().map(|run| (agent_ui::cloud::sidebar::created_ms(run), Entry::Cloud(run))));
        entries.sort_by_key(|(at, _)| std::cmp::Reverse(*at));
        let total = entries.len();
        let shown = if self.dashboard_all_sessions { total } else { total.min(DASHBOARD_SESSIONS) };
        let mut rows: Vec<AnyElement> = entries
            .into_iter()
            .take(shown)
            .map(|(_, entry)| match entry {
                Entry::Session(session) => self.render_session_row_in(session, false, false, false, now, cx),
                Entry::Outside(session) => self.render_outside_session_row(session, now, cx),
                Entry::Cloud(run) => self.render_cloud_run_row(run, now, cx),
            })
            .collect();
        if total > DASHBOARD_SESSIONS {
            let label = if self.dashboard_all_sessions { "Show fewer".to_string() } else { format!("Show all ({total})") };
            rows.push(
                SidebarListItem::new("dashboard-sessions-toggle", label)
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.dashboard_all_sessions = !this.dashboard_all_sessions;
                        cx.notify();
                    }))
                    .into_any_element(),
            );
        }
        let suggestions: Vec<AnyElement> = state
            .as_ref()
            .map(project_suggestions::suggestions)
            .unwrap_or_default()
            .into_iter()
            .map(|suggestion| {
                let (project, prompt) = (project.id.clone(), suggestion.prompt.clone());
                let mut row = SidebarListItem::new(gpui::ElementId::Name(format!("suggestion-{}", suggestion.id).into()), suggestion.title).leading(ui::Icon::new(suggestion.icon).size(ui::IconSize::XSmall).when(suggestion.id.starts_with("issue-"), |icon| icon.color(colors.success)));
                if let Some(meta) = suggestion.meta {
                    row = row.trailing(div().text_size(typography::text_sm()).text_color(colors.subtle_foreground).child(meta));
                }
                row.on_click(cx.listener(move |this, _, window, cx| this.start_session_with_prompt(project.clone(), prompt.clone(), window, cx)))
                    .into_any_element()
            })
            .collect();
        let project_id = project.id.clone();
        let header = div()
            .flex()
            .items_center()
            .gap(px(12.))
            .child(crate::project_icon::project_glyph(Some(&project.path), project.custom_icon.as_deref(), typography::text_base(), colors.foreground))
            .child(
                div()
                    .flex()
                    .flex_col()
                    .flex_1()
                    .min_w_0()
                    .gap(px(2.))
                    .child(
                        div()
                            .flex()
                            .flex_wrap()
                            .items_center()
                            .gap(px(8.))
                            .min_w_0()
                            .child(div().min_w_0().text_size(typography::text_lg()).font_weight(typography::MEDIUM).truncate().child(project.name.clone()))
                            .when_some(state.clone().filter(|state| !state.branch.is_empty()), |row, state| {
                        let changes = (state.changed_files > 0).then(|| {
                            let files = format!("{} changed file{}", state.changed_files, if state.changed_files == 1 { "" } else { "s" });
                            let label: AnyElement = if state.additions > 0 || state.deletions > 0 {
                                div()
                                    .flex()
                                    .gap(px(4.))
                                    .child(div().text_color(colors.git_added).child(format!("+{}", state.additions)))
                                    .child(div().text_color(colors.git_deleted).child(format!("−{}", state.deletions)))
                                    .into_any_element()
                            } else {
                                div().child(files.clone()).into_any_element()
                            };
                            div()
                                .id("dashboard-changes")
                                .px(px(6.))
                                .rounded(ui::metrics::radius())
                                .hover(|style| style.bg(colors.accent))
                                .anchored_tooltip({ let text: gpui::SharedString = (format!("{files}, review the diff")).into(); move || ui::Tooltip::new(text.clone()) })
                                .on_click({
                                    let repo = PathBuf::from(&project.path);
                                    move |_, _, cx| git_diff::open_diff(cx, Some(&repo), &git_diff::DiffTarget::WorkingTree { scope: git_diff::Scope::All })
                                })
                                .child(label)
                        });
                        row.child(
                            div()
                                .flex()
                                .items_center()
                                .gap(px(4.))
                                .text_size(typography::text_sm())
                                .child(ui::Badge::new(project_suggestions::branch_label(&state)).icon(IconName::GitBranch))
                                .children(changes),
                        )
                    }),
                    )
                    .when(!summary.is_empty(), |column| {
                        column.child(div().text_size(typography::text_sm()).text_color(colors.subtle_foreground).truncate().child(summary))
                    }),
            )
            .when(ai_enabled, |header| {
                header.child(
                    Button::new("dashboard-new-session", "New Session")
                        .variant(ButtonVariant::Accent)
                        .leading_icon(IconName::Plus)
                        .on_click(cx.listener(move |this, _, _, cx| this.start_session(Some(project_id.clone()), cx))),
                )
            });
        let suggestions_section = (!suggestions.is_empty()).then(|| {
            div()
                .flex()
                .flex_col()
                .gap(px(6.))
                .child(section_title("Start With"))
                .child(div().flex().flex_col().gap(px(1.)).px(px(4.)).children(suggestions))
        });
        let sessions_section = div()
            .flex()
            .flex_col()
            .gap(px(6.))
            .child(section_title("Sessions"))
            .child(div().flex().flex_col().gap(px(1.)).px(px(4.)).map(|list| {
                if rows.is_empty() {
                    list.child(div().px(px(8.)).py(px(6.)).text_size(typography::text_sm()).text_color(colors.subtle_foreground).child("No sessions yet"))
                } else {
                    list.children(rows)
                }
            }));
        let pull_requests: Vec<AnyElement> = self
            .project_pull_requests(&project.path, cx)
            .into_iter()
            .map(|pr| {
                let (number, title) = (pr.number, pr.title.clone());
                let trailing = format!("{}#{} · {}", if pr.draft { "Draft · " } else { "" }, pr.number, project_suggestions::compact_relative_date(&pr.updated_at, now));
                div()
                    .id(gpui::ElementId::Name(format!("dashboard-pr-tip-{}", pr.number).into()))
                    .anchored_tooltip({ let text: gpui::SharedString = (format!("{} — {} · {}", pr.title, pr.author, pr.head)).into(); move || ui::Tooltip::new(text.clone()) })
                    .child(
                        SidebarListItem::new(gpui::ElementId::Name(format!("dashboard-pr-{}", pr.number).into()), pr.title.clone())
                            .leading(ui::Icon::new(IconName::GitPullRequest).size(ui::IconSize::XSmall).color(if pr.draft { colors.muted_foreground } else { colors.success }))
                            .trailing(div().text_size(typography::text_sm()).text_color(colors.subtle_foreground).child(trailing))
                            .on_click(cx.listener(move |this, _, _, cx| this.update_state(cx, |state| state.open_resource("github-pr", &number.to_string(), &title)))),
                    )
                    .into_any_element()
            })
            .collect();
        let worktrees: Vec<AnyElement> = self
            .project_worktrees(&project.path, cx)
            .into_iter()
            .map(|worktree| {
                let name = std::path::Path::new(&worktree.path).file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_else(|| worktree.path.clone());
                let tooltip = match &worktree.branch {
                    Some(branch) => format!("{branch} · {}", worktree.path),
                    None => worktree.path.clone(),
                };
                let path = PathBuf::from(&worktree.path);
                div()
                    .id(gpui::ElementId::Name(format!("dashboard-worktree-tip-{}", worktree.path).into()))
                    .anchored_tooltip({ let text: gpui::SharedString = (tooltip).into(); move || ui::Tooltip::new(text.clone()) })
                    .child(
                        SidebarListItem::new(gpui::ElementId::Name(format!("dashboard-worktree-{}", worktree.path).into()), name)
                            .leading(ui::Icon::new(IconName::GitBranch).size(ui::IconSize::XSmall))
                            .when_some(worktree.size.filter(|size| *size > 0), |row, size| {
                                row.trailing(div().text_size(typography::text_sm()).text_color(colors.subtle_foreground).child(project_suggestions::format_file_size(size)))
                            })
                            .on_click(cx.listener(move |this, _, _, cx| this.open_project_path(path.clone(), cx))),
                    )
                    .into_any_element()
            })
            .collect();
        let list_section = |title: &'static str, rows: Vec<AnyElement>| {
            (!rows.is_empty()).then(|| div().flex().flex_col().gap(px(6.)).child(section_title(title)).child(div().flex().flex_col().gap(px(1.)).px(px(4.)).children(rows)))
        };
        let pull_requests_section = list_section("Pull Requests", pull_requests);
        let worktrees_section = list_section("Worktrees", worktrees);
        div()
            .id("project-dashboard")
            .flex()
            .flex_col()
            .flex_1()
            .min_h_0()
            .overflow_y_scroll()
            .font_family(typography::UI_FONT)
            .text_size(typography::text_base())
            .text_color(colors.foreground)
            .child(
                div().w_full().flex().justify_center().px(px(24.)).py(px(20.)).child(
                    div()
                        .w_full()
                        .max_w(px(720.))
                        .flex()
                        .flex_col()
                        .gap(px(24.))
                        .child(header)
                        .child(
                            div()
                                .flex()
                                .flex_col()
                                .gap(px(32.))
                                .when(ai_enabled, |column| column.children(suggestions_section).child(sessions_section))
                                .children(pull_requests_section)
                                .children(worktrees_section),
                        ),
                ),
            )
            .scrollbar(window, cx)
            .into_any_element()
    }

    /// The project's Git state, read again in the background once it is older than a few seconds.
    fn project_state(&self, path: &str, cx: &mut Context<Self>) -> Option<ProjectState> {
        let (loading, state) = cx.default_global::<DashboardStates>().0.get(path).cloned().unwrap_or_default();
        if loading.is_none_or(|at| now_ms().saturating_sub(at) > STATE_TTL_MS) {
            let key = path.to_string();
            cx.default_global::<DashboardStates>().0.insert(key.clone(), (Some(now_ms()), state.clone()));
            let folder = PathBuf::from(path);
            cx.spawn(async move |this, cx| {
                let read = cx.background_spawn(async move { read_state(folder) }).await;
                this.update(cx, |_, cx| {
                    let states = &mut cx.default_global::<DashboardStates>().0;
                    let at = states.get(&key).and_then(|(at, _)| *at);
                    let changed = states.get(&key).is_none_or(|(_, previous)| *previous != read);
                    states.insert(key, (at, read));
                    if changed {
                        cx.notify();
                    }
                })
                .ok();
            })
            .detach();
        }
        state
    }

    /// The project's open issues once GitHub is signed in, asked for again after a minute.
    fn project_issues(&self, path: &str, cx: &mut Context<Self>) -> Vec<(u64, String, String, String)> {
        let (at, issues) = cx.default_global::<DashboardIssues>().0.get(path).cloned().unwrap_or_default();
        if (at == 0 || now_ms().saturating_sub(at) > ISSUES_TTL_MS)
            && let Some(fetch) = github_panel::quick_open::open_issues(PathBuf::from(path), cx)
        {
            let key = path.to_string();
            cx.default_global::<DashboardIssues>().0.insert(key.clone(), (now_ms(), issues.clone()));
            cx.spawn(async move |this, cx| {
                let fetched = fetch.await;
                this.update(cx, |_, cx| {
                    let states = &mut cx.default_global::<DashboardIssues>().0;
                    let at = states.get(&key).map_or(0, |(at, _)| *at);
                    if states.get(&key).is_none_or(|(_, previous)| *previous != fetched) {
                        states.insert(key, (at, fetched));
                        cx.notify();
                    }
                })
                .ok();
            })
            .detach();
        }
        issues
    }

    /// The project's open pull requests, newest activity first, once GitHub is signed in; asked
    /// for again after a minute, none while the last request failed.
    fn project_pull_requests(&self, path: &str, cx: &mut Context<Self>) -> Vec<github_panel::quick_open::ProjectPullRequest> {
        let (at, list) = cx.default_global::<DashboardPullRequests>().0.get(path).cloned().unwrap_or_default();
        if (at == 0 || now_ms().saturating_sub(at) > ISSUES_TTL_MS)
            && let Some(fetch) = github_panel::quick_open::open_pull_requests(PathBuf::from(path), cx)
        {
            let key = path.to_string();
            cx.default_global::<DashboardPullRequests>().0.insert(key.clone(), (now_ms(), list.clone()));
            cx.spawn(async move |this, cx| {
                let fetched = fetch.await;
                this.update(cx, |_, cx| {
                    let lists = &mut cx.default_global::<DashboardPullRequests>().0;
                    let at = lists.get(&key).map_or(0, |(at, _)| *at);
                    if lists.get(&key).is_none_or(|(_, previous)| *previous != fetched) {
                        lists.insert(key, (at, fetched));
                        cx.notify();
                    }
                })
                .ok();
            })
            .detach();
        }
        let mut list = list.unwrap_or_default();
        list.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
        list.truncate(SHOWN_PULL_REQUESTS);
        list
    }

    /// The project's other worktrees, read again in the background after a minute.
    fn project_worktrees(&self, path: &str, cx: &mut Context<Self>) -> Vec<DashboardWorktree> {
        let (at, list) = cx.default_global::<DashboardWorktrees>().0.get(path).cloned().unwrap_or_default();
        if at == 0 || now_ms().saturating_sub(at) > ISSUES_TTL_MS {
            let key = path.to_string();
            cx.default_global::<DashboardWorktrees>().0.insert(key.clone(), (now_ms(), list.clone()));
            let folder = PathBuf::from(path);
            cx.spawn(async move |this, cx| {
                let read = cx.background_spawn(async move { read_worktrees(folder) }).await;
                this.update(cx, |_, cx| {
                    let lists = &mut cx.default_global::<DashboardWorktrees>().0;
                    let at = lists.get(&key).map_or(0, |(at, _)| *at);
                    if lists.get(&key).is_none_or(|(_, previous)| *previous != read) {
                        lists.insert(key, (at, read));
                        cx.notify();
                    }
                })
                .ok();
            })
            .detach();
        }
        list
    }

    /// Starts a session in the project with `prompt` (`startAgentWithPrompt`).
    fn start_session_with_prompt(&mut self, project: ProjectId, prompt: String, window: &mut Window, cx: &mut Context<Self>) {
        self.start_session(Some(project), cx);
        let Some(id) = self.state.focused_session().map(|session| session.id.clone()) else { return };
        if let Some(view) = self.ensure_session_view(&id, window, cx) {
            view.update(cx, |session, cx| session.send(prompt, cx));
        }
    }
}

/// A dashboard section's heading (`GroupedSection` with the `flat` variant).
fn section_title(title: &'static str) -> impl IntoElement {
    div().flex().items_center().min_h(px(24.)).px(px(12.)).text_size(typography::text_base()).font_weight(typography::MEDIUM).child(title)
}
