//! Drawing the sidebar, after `github-prs-view.tsx` and the stream list it is built from.

use ui::TooltipExt as _;
use crate::gh::{Deployment, IssueListItem, PullRequest, Release, WorkflowRunListItem};
use chrono::Utc;
use ui::scale::px;
use gpui::{
    Anchor, AnyElement, ClickEvent, Context, IntoElement, MouseButton, MouseDownEvent, Render, SharedString, Window, div, prelude::*,
};
use theme::{ActiveTheme, ThemeColors};
use ui::{Button, ButtonSize, ButtonVariant, EmptyState, Icon, IconName, IconSize, MenuEntry, MenuItem, Plane, metrics, typography};

use crate::{
    GitHubPanel, RepoState, RunAction, Section,
    auth::Auth,
    menus::{self, below},
    delivery_view,
    model::{self, DeploymentFilter, IssueFilter, PrFilter, ReleaseFilter, RunFilter, Tone},
    widgets::{self, Preview, PreviewLeading, Row, list_message, tone_color},
};

/// One item of a section, as the Filter menu's search lists it.
pub(crate) struct SearchRow {
    label: String,
    keywords: String,
    icon: IconName,
    trailing: String,
    kind: &'static str,
    id: i64,
    section: Section,
}

/// The rows whose label or keywords hold every word typed, as menu entries that open them.
pub(crate) fn matching_rows(rows: &[SearchRow], query: &str, panel: &gpui::WeakEntity<GitHubPanel>) -> Vec<MenuEntry> {
    let query = query.to_lowercase();
    rows.iter()
        .filter(|row| {
            let haystack = format!("{} {}", row.label, row.keywords).to_lowercase();
            query.split_whitespace().all(|word| haystack.contains(word))
        })
        .map(|row| {
            let (panel, kind, id, section, title) = (panel.clone(), row.kind, row.id, row.section, row.label.clone());
            MenuItem::new(row.label.clone())
                .icon(row.icon)
                .trailing_text(row.trailing.clone())
                .on_select(move |_, cx| {
                    panel.update(cx, |panel, cx| panel.open(section, kind, id, title.clone(), cx)).ok();
                })
                .into()
        })
        .collect()
}

/// The repository row and the filter row.
fn bar_height() -> gpui::Pixels { px(32.) }
/// Rows a section shows before "Show more", as the git sidebar's history does.
const SHOWN: usize = 5;

impl Section {
    fn title(self) -> &'static str {
        match self {
            Section::PullRequests => "PRs",
            Section::Issues => "Issues",
            Section::Actions => "Actions",
            Section::Releases => "Releases",
            Section::Deployments => "Deployments",
        }
    }

    fn icon(self) -> IconName {
        match self {
            Section::PullRequests => IconName::GitPullRequest,
            Section::Issues => IconName::ChatBubbleText,
            Section::Actions => IconName::Bolt,
            Section::Releases => IconName::Tag,
            Section::Deployments => IconName::Rocket,
        }
    }
}

impl GitHubPanel {
    pub(crate) fn render_header_buttons(&self, cx: &mut Context<Self>) -> AnyElement {
        let menu_open = menus::is_open(&self.open_menu, "github-actions");
        div()
            .flex()
            .items_center()
            .gap(px(2.))
            .child(
                Button::icon("github-refresh", IconName::ArrowClockwise)
                    .size(ButtonSize::Small)
                    .plane(Plane::Page)
                    .tooltip("Refresh")
                    .disabled(self.is_loading())
                    .on_click(cx.listener(|this, _, _, cx| this.refresh(cx))),
            )
            .child(
                Button::icon("github-actions", IconName::Dots)
                    .size(ButtonSize::Small)
                    .plane(Plane::Page)
                    .active(menu_open)
                    .tooltip("GitHub actions")
                    .on_click(cx.listener(|this, event: &ClickEvent, window, cx| {
                        let entries = this.actions_menu(cx);
                        menus::show(this, "github-actions", entries, below(event), Anchor::TopRight, window, cx);
                    })),
            )
            .into_any_element()
    }

    fn actions_menu(&self, cx: &Context<Self>) -> Vec<MenuEntry> {
        let mut entries = vec![menus::item("Refresh", cx, |this, _, cx| this.refresh(cx)).icon(IconName::ArrowClockwise).into()];
        if let Some(repo) = self.repository() {
            let url = repo.slug.url();
            entries.push(MenuEntry::Separator);
            entries.push(menus::link("Open repository on GitHub", url.clone()).icon(IconName::OpenExternal).into());
            entries.push(menus::link("New pull request on GitHub", format!("{url}/compare")).icon(IconName::GitPullRequest).into());
            entries.push(menus::link("New issue on GitHub", format!("{url}/issues/new")).icon(IconName::ChatBubbleText).into());
            entries.push(menus::copy("Copy repository URL", url).icon(IconName::Link).into());
        }
        if let Auth::Authenticated(token) = &self.auth {
            entries.push(MenuEntry::Separator);
            entries.push(MenuEntry::Label(format!("Signed in with {}", crate::auth::source_label(token.source)).into()));
        }
        entries
    }

    fn render_auth(&self, colors: &ThemeColors, cx: &mut Context<Self>) -> AnyElement {
        let retry = |label: &'static str, variant: ButtonVariant, cx: &mut Context<Self>| {
            Button::new(SharedString::from(format!("github-auth-{label}")), label)
                .variant(variant)
                .size(ButtonSize::Small)
                .on_click(cx.listener(|this, _, _, cx| this.check_auth(true, cx)))
        };
        let state = match &self.auth {
            Auth::Checking => {
                return widgets::fill_message("Checking GitHub account…", None, None, colors).into_any_element();
            }
            Auth::Authenticated(_) => return div().into_any_element(),
            Auth::Unavailable(error) => EmptyState::new("GitHub is temporarily unavailable")
                .icon(IconName::CloudWarning)
                .message(error.clone())
                .action(retry("Retry", ButtonVariant::Default, cx)),
            Auth::Missing { gh_installed, rejected } => {
                let title = if *rejected { "GitHub rejected the token" } else { "GitHub not authenticated" };
                let message = if *gh_installed {
                    "Run `gh auth login` in a terminal, or set GITHUB_TOKEN, then retry."
                } else {
                    "Install the GitHub CLI and run `gh auth login`, or set GITHUB_TOKEN, then retry."
                };
                let mut state = EmptyState::new(title).icon(IconName::Github).message(message).action(retry("Retry", ButtonVariant::Default, cx));
                // A per-user credential as a first-class way out: `gh`'s token when it is there,
                // the settings for a pasted token otherwise.
                state = state.action(if self.gh_has_token {
                    Button::new("github-use-gh", "Use GitHub CLI")
                        .variant(ButtonVariant::Ghost)
                        .size(ButtonSize::Small)
                        .on_click(cx.listener(|this, _, _, cx| this.use_gh_cli(cx)))
                } else {
                    Button::new("github-own-token", "Use your own token")
                        .variant(ButtonVariant::Ghost)
                        .size(ButtonSize::Small)
                        .on_click(|_, _, cx| workbench_api::open_settings(cx, Some("git"), Some("GitHub Account")))
                });
                if !gh_installed {
                    state = state.action(
                        Button::new("github-install-gh", "Get GitHub CLI")
                            .variant(ButtonVariant::Ghost)
                            .size(ButtonSize::Small)
                            .on_click(|_, _, cx| cx.open_url("https://cli.github.com")),
                    );
                }
                state
            }
        };
        div().flex().flex_1().min_h_0().items_center().justify_center().child(state).into_any_element()
    }

    /// The sections as an accordion: each folds open under its row, one under the other, all in
    /// one scrolling column. An open row shows its filter and create buttons on hover.
    fn render_accordion(&mut self, colors: &ThemeColors, cx: &mut Context<Self>) -> impl IntoElement {
        let mut column = div().id("github-list").flex().flex_col().size_full().overflow_y_scroll().track_scroll(&self.list_scroll).gap(px(2.)).pb(px(12.));
        for section in self.sections.clone().into_iter().filter(|section| !section.in_footer()) {
            let open = self.open_sections.contains(&section);
            let count = self.section_count(section);
            let mut row = ui::AccordionRow::new(
                gpui::ElementId::Name(format!("github-section-{}", section.id()).into()),
                section.title(),
                section.icon(),
                open,
                cx.listener(move |panel, _: &ClickEvent, _, cx| panel.toggle_section(section, cx)),
            )
            .count(count);
            if open {
                row = row.trailing(self.render_section_buttons(section, cx));
            }
            column = column.child(row);
            if open {
                let rows = match (&self.repo, section) {
                    (RepoState::Missing(error), _) => vec![self.render_repo_missing(error.clone(), colors, cx)],
                    (_, Section::PullRequests) => self.render_pull_requests(colors, cx),
                    (_, Section::Issues) => self.render_issues(colors, cx),
                    (_, Section::Actions) => self.render_runs(colors, cx),
                    (_, Section::Releases) => self.render_releases(colors, cx),
                    (_, Section::Deployments) => self.render_deployments(colors, cx),
                };
                column = column.child(div().flex().flex_col().px(px(8.)).pb(px(4.)).children(rows));
            }
        }
        div()
            .relative()
            .flex()
            .flex_col()
            .flex_1()
            .min_h_0()
            .overflow_hidden()
            .child(column)
            .child(ui::Scrollbar::new("github-list-scrollbar", &self.list_scroll))
    }

    /// The rows under the list: releases and deployments, each opening its command surface
    /// where the Source Control sidebar's stashes open theirs.
    fn render_footer(&self, colors: &ThemeColors, cx: &mut Context<Self>) -> impl IntoElement {
        let mut rows: Vec<AnyElement> = Vec::new();
        for section in self.sections.iter().copied().filter(|section| section.in_footer()) {
            let open: fn(&GitHubPanel, &Context<GitHubPanel>) -> palette::CommandList = match section {
                Section::Deployments => GitHubPanel::deployments_surface,
                _ => GitHubPanel::releases_surface,
            };
            let item = ui::SidebarListItem::new(SharedString::from(format!("github-footer-{}", section.id())), section.title())
                .leading(Icon::new(section.icon()).size(IconSize::XSmall).color(colors.subtle_foreground))
                .trailing(self.section_count(section).to_string())
                .on_click(cx.listener(move |panel, _: &ClickEvent, _, cx| {
                    let list = open(panel, cx);
                    palette::show_command_list(cx, list);
                }));
            rows.push(div().flex_none().px(px(8.)).child(item).into_any_element());
        }
        div().flex().flex_col().flex_none().gap(px(2.)).py(px(4.)).children(rows)
    }

    /// What a section's row counts: everything loaded for it.
    fn section_count(&self, section: Section) -> usize {
        match section {
            Section::PullRequests => self.pulls.len(),
            Section::Issues => self.issues.len(),
            Section::Actions => self.runs.len(),
            Section::Releases => self.releases.len(),
            Section::Deployments => self.deployments.len(),
        }
    }

    /// A section's filter and create buttons.
    fn render_section_buttons(&self, section: Section, cx: &mut Context<Self>) -> impl IntoElement {
        let (label, filtered) = self.filter_label(section);
        let key = SharedString::from(format!("github-filter-{}", section.id()));
        let menu_key = key.clone();
        let create = self.repository().and_then(|_| match section {
            Section::PullRequests => Some(("New pull request", "github-new", "pull-request")),
            Section::Issues => Some(("New issue", "github-new", "issue")),
            Section::Actions => Some(("Run workflow", "github-new", "action")),
            Section::Releases => Some(("New release", "github-release", "new")),
            Section::Deployments => None,
        });
        div()
            .flex()
            .items_center()
            .gap(px(2.))
            .child(
                Button::icon(key.clone(), IconName::Filter)
                    .size(ButtonSize::XSmall)
                    .active(filtered || menus::is_open(&self.open_menu, &key))
                    .tooltip(format!("Filter: {label}"))
                    .on_click(cx.listener(move |this, event: &ClickEvent, window, cx| {
                        let entries = this.filter_menu(section, cx);
                        menus::show(this, &menu_key, entries, below(event), Anchor::TopRight, window, cx);
                        // As the Sessions sidebar's Filter: the states to show, and a field that
                        // searches the section itself once something is typed.
                        let noun = section.noun();
                        menus::make_searchable(this, &menu_key, format!("Search {noun}…"), format!("No matching {noun}"), cx);
                        let rows = this.section_rows(section);
                        let weak = cx.weak_entity();
                        menus::set_query_source(this, &menu_key, move |query, _, _| matching_rows(&rows, query, &weak), cx);
                    })),
            )
            .children(create.map(|(label, kind, id)| {
                Button::icon(SharedString::from(format!("github-create-{}", section.id())), IconName::Plus)
                    .size(ButtonSize::XSmall)
                    .tooltip(label)
                    .on_click(cx.listener(move |_, _, _, cx| cx.emit(crate::GitHubEvent::OpenResource { kind: kind.into(), id: id.into(), title: label.into() })))
            }))
    }

    /// The header before there are sections to switch between (signed out, still checking):
    /// the tool's name, so the sidebar's tools all start the same way.
    fn render_title_only(&mut self, cx: &mut Context<Self>) -> impl IntoElement {
        let actions = self.render_header_buttons(cx);
        div().flex_none().px(px(8.)).pb(px(2.)).child(ui::SectionLabel::new("GitHub").trailing(actions))
    }

    fn render_bar(&self, colors: &ThemeColors, cx: &mut Context<Self>) -> impl IntoElement {
        let (name, branch) = match self.repository() {
            Some(repo) => (repo.slug.name.clone(), repo.branch.clone()),
            None => ("No repository".to_string(), None),
        };
        let accent = colors.accent;
        let tooltip = self.repository().map(|repo| format!("{}\n{}", repo.slug.full_name(), repo.root.display())).unwrap_or_default();
        let buttons = self.render_header_buttons(cx);
        div().flex().flex_none().items_center().gap(px(2.)).h(bar_height()).px(px(8.)).child(
            div()
                .id("github-repo-button")
                .flex()
                .min_w_0()
                .items_center()
                .gap(px(6.))
                .h(metrics::chrome_control())
                .px(px(6.))
                .rounded(metrics::radius_md())
                .text_size(typography::text_sm())
                .hover(move |style| style.bg(accent))
                .when(menus::is_open(&self.open_menu, "github-repo"), |this| this.bg(accent))
                .child(Icon::new(IconName::Github).size(IconSize::XSmall).color(colors.subtle_foreground))
                .child(
                    div()
                        .flex()
                        .min_w_0()
                        .overflow_hidden()
                        .whitespace_nowrap()
                        .child(div().flex_none().font_weight(typography::MEDIUM).text_color(colors.foreground).child(name))
                        .children(branch.map(|branch| div().min_w_0().truncate().text_color(colors.subtle_foreground).child(format!(" / {branch}")))),
                )
                .child(Icon::new(IconName::ChevronDown).size(IconSize::XSmall).color(colors.subtle_foreground))
                .anchored_tooltip(move || ui::Tooltip::new(tooltip.clone()))
                .on_click(cx.listener(|this, event: &ClickEvent, window, cx| {
                    let entries = this.repo_menu(cx);
                    menus::show(this, "github-repo", entries, below(event), Anchor::TopLeft, window, cx);
                })),
        )
        .child(div().flex_1())
        .child(buttons)
    }

    fn repo_menu(&self, cx: &Context<Self>) -> Vec<MenuEntry> {
        let browse_label = if self.selecting_repo { "Selecting…" } else { "Browse Repository…" };
        let browse = menus::item(browse_label, cx, |this, _, cx| this.select_repository(cx)).icon(IconName::FolderOpen).disabled(self.selecting_repo).into();
        let Some(repo) = self.repository() else { return vec![browse] };
        let url = repo.slug.url();
        vec![
            ui::MenuItem::new(repo.slug.full_name()).checked(true).into(),
            MenuEntry::Separator,
            menus::link("Open on GitHub", url.clone()).icon(IconName::OpenExternal).into(),
            menus::link("Pull requests on GitHub", format!("{url}/pulls")).icon(IconName::GitPullRequest).into(),
            menus::link("Actions on GitHub", format!("{url}/actions")).icon(IconName::Bolt).into(),
            menus::copy("Copy repository URL", url).icon(IconName::Copy).into(),
            MenuEntry::Separator,
            browse,
        ]
    }

    /// `StreamEmpty` when the folder has no GitHub repository: Browse Repository for a folder
    /// outside Git, Try again otherwise.
    fn render_repo_missing(&self, error: crate::repo::RepoError, colors: &ThemeColors, cx: &mut Context<Self>) -> AnyElement {
        let not_a_repo = error == crate::repo::RepoError::NotARepository;
        let hint = self.repo_selection_error.clone().unwrap_or_else(|| {
            if not_a_repo { "Select a folder that contains a .git repository.".into() } else { error.message().into() }
        });
        let label = match (not_a_repo, self.selecting_repo) {
            (true, true) => "Selecting…",
            (true, false) => "Browse Repository",
            (false, _) => "Try again",
        };
        let action = Button::new("github-repo-action", label)
            .variant(ButtonVariant::Ghost)
            .size(ButtonSize::Small)
            .disabled(self.selecting_repo)
            .on_click(cx.listener(move |this, _, _, cx| if not_a_repo { this.select_repository(cx) } else { this.refresh(cx) }));
        list_message(error.title(), Some(hint), Some(action.into_any_element()), colors).into_any_element()
    }

    fn filter_label(&self, section: Section) -> (&'static str, bool) {
        match section {
            Section::PullRequests => (self.pr_filter.label(), self.pr_filter != PrFilter::default()),
            Section::Issues => (self.issue_filter.label(), self.issue_filter != IssueFilter::default()),
            Section::Actions => (self.run_filter.label(), self.run_filter != RunFilter::default()),
            Section::Releases => (self.release_filter.label(), self.release_filter != ReleaseFilter::default()),
            Section::Deployments => (self.deployment_filter.label(), self.deployment_filter != DeploymentFilter::default()),
        }
    }

    /// Every item of a section, for the Filter menu's search.
    fn section_rows(&self, section: Section) -> Vec<SearchRow> {
        let now = Utc::now();
        match section {
            Section::PullRequests => self
                .pulls
                .items
                .clone()
                .unwrap_or_default()
                .iter()
                .map(|pr| SearchRow {
                    label: pr.title.clone(),
                    keywords: format!("#{} {}", pr.number, pr.author.login),
                    icon: IconName::GitPullRequest,
                    trailing: model::sidebar_time(&pr.updated_at, now),
                    kind: "github-pr",
                    id: pr.number,
                    section,
                })
                .collect(),
            Section::Issues => self
                .issues
                .items
                .clone()
                .unwrap_or_default()
                .iter()
                .map(|issue| SearchRow {
                    label: issue.title.clone(),
                    keywords: format!("#{} {}", issue.number, issue.author.login),
                    icon: IconName::CircleDot,
                    trailing: model::sidebar_time(&issue.updated_at, now),
                    kind: "github-issue",
                    id: issue.number,
                    section,
                })
                .collect(),
            Section::Actions => self
                .runs
                .items
                .clone()
                .unwrap_or_default()
                .iter()
                .map(|run| SearchRow {
                    label: model::list_run_title(run),
                    keywords: format!("{} {}", model::run_label(run.run_number, run.database_id), run.workflow_name.clone().unwrap_or_default()),
                    icon: IconName::Play,
                    trailing: model::sidebar_time(run.updated_at.as_deref().unwrap_or_default(), now),
                    kind: "github-run",
                    id: run.database_id,
                    section,
                })
                .collect(),
            // The footer's sections search inside their own command surface.
            Section::Releases | Section::Deployments => Vec::new(),
        }
    }

    fn filter_menu(&self, section: Section, cx: &Context<Self>) -> Vec<MenuEntry> {
        match section {
            Section::PullRequests => PrFilter::ALL
                .map(|filter| menus::item(filter.label(), cx, move |this, _, cx| this.set_pr_filter(filter, cx)).checked(filter == self.pr_filter).into())
                .into(),
            Section::Issues => IssueFilter::ALL
                .map(|filter| menus::item(filter.label(), cx, move |this, _, cx| this.set_issue_filter(filter, cx)).checked(filter == self.issue_filter).into())
                .into(),
            Section::Actions => RunFilter::ALL
                .map(|filter| menus::item(filter.label(), cx, move |this, _, cx| this.set_run_filter(filter, cx)).checked(filter == self.run_filter).into())
                .into(),
            Section::Releases => ReleaseFilter::ALL
                .map(|filter| menus::item(filter.label(), cx, move |this, _, cx| this.set_release_filter(filter, cx)).checked(filter == self.release_filter).into())
                .into(),
            Section::Deployments => DeploymentFilter::ALL
                .map(|filter| menus::item(filter.label(), cx, move |this, _, cx| this.set_deployment_filter(filter, cx)).checked(filter == self.deployment_filter).into())
                .into(),
        }
    }

    fn render_toolbar(&self) -> impl IntoElement {
        div().flex().flex_none().items_center().h(bar_height()).pl(px(12.)).pr(px(8.)).child(div().flex_1().min_w_0().child(self.filter_input.clone()))
    }

    fn query(&self, cx: &Context<Self>) -> String {
        self.filter_input.read(cx).text().trim().to_lowercase()
    }

    /// The list's state when it has nothing to show, or `None` when it does.
    fn list_status<T>(&self, section: Section, list: &crate::List<T>, shown: usize, colors: &ThemeColors, cx: &mut Context<Self>) -> Option<AnyElement> {
        let noun = section.noun();
        if let Some(error) = list.error.clone().filter(|_| list.len() == 0) {
            let retry = Button::new("github-list-retry", "Try again")
                .variant(ButtonVariant::Ghost)
                .size(ButtonSize::Small)
                .on_click(cx.listener(|this, _, _, cx| this.refresh(cx)));
            return Some(list_message(error, None, Some(retry.into_any_element()), colors).into_any_element());
        }
        if list.items.is_none() {
            return Some(list_message(format!("Loading {noun}…"), None, None, colors).into_any_element());
        }
        if list.len() == 0 {
            let title = match section {
                Section::Actions => "No workflow runs yet".to_string(),
                _ => format!("No {noun}"),
            };
            return Some(list_message(title, None, None, colors).into_any_element());
        }
        (shown == 0).then(|| list_message(format!("No matching {noun}"), None, None, colors).into_any_element())
    }

    /// A section's rows: the newest five, then a row for the rest, the way the git sidebar's
    /// history lists commits. A search shows every match instead. `paging` is the (exhausted,
    /// loading) pair of a section that reads its list a page at a time.
    fn render_rows<T>(
        &self,
        section: Section,
        matching: Vec<&T>,
        paging: Option<(bool, bool)>,
        colors: &ThemeColors,
        cx: &mut Context<Self>,
        row: impl Fn(&Self, &T, &ThemeColors, &mut Context<Self>) -> AnyElement,
    ) -> Vec<AnyElement> {
        let searching = !self.query(cx).is_empty();
        let expanded = searching || self.expanded.contains(&section);
        let shown = if expanded { matching.len() } else { matching.len().min(SHOWN) };
        let mut children: Vec<AnyElement> = matching.iter().take(shown).map(|item| row(self, item, colors, cx)).collect();
        if !expanded {
            let hidden = matching.len() - shown;
            if hidden > 0 {
                children.push(self.render_more_row(section, "Show more", Some(hidden.to_string()), false, cx));
            }
            return children;
        }
        // Expanded, the rest of a paged list is one more click away, and the list folds back.
        if let Some((false, loading)) = paging.filter(|_| !searching) {
            children.push(self.render_more_row(section, if loading { "Loading…" } else { "Load more" }, None, true, cx));
        }
        if !searching && matching.len() > SHOWN {
            children.push(self.render_more_row(section, "Show less", None, false, cx));
        }
        children
    }

    /// The quiet row under a list: "Show more", "Show less" or "Load more".
    fn render_more_row(&self, section: Section, label: &'static str, count: Option<String>, paging: bool, cx: &mut Context<Self>) -> AnyElement {
        let id = SharedString::from(format!("github-{}-{}", section.id(), if paging { "load-more" } else { "show-more" }));
        let mut item = ui::SidebarListItem::new(id, label).on_click(cx.listener(
            move |this, _: &ClickEvent, _, cx| {
                if paging {
                    this.load_more(section, cx);
                } else {
                    this.toggle_expanded(section, cx);
                }
            },
        ));
        if let Some(count) = count {
            item = item.trailing(count);
        }
        div().flex_none().child(item).into_any_element()
    }

    fn render_pull_requests(&self, colors: &ThemeColors, cx: &mut Context<Self>) -> Vec<AnyElement> {
        let query = self.query(cx);
        let items = self.pulls.items.clone().unwrap_or_default();
        let matching: Vec<&PullRequest> = items.iter().filter(|pr| model::pr_matches(pr, &query)).collect();
        if let Some(status) = self.list_status(Section::PullRequests, &self.pulls, matching.len(), colors, cx) {
            return vec![status];
        }
        self.render_rows(Section::PullRequests, matching, None, colors, cx, Self::render_pr_row)
    }

    fn render_pr_row(&self, pr: &PullRequest, colors: &ThemeColors, cx: &mut Context<Self>) -> AnyElement {
        let now = Utc::now();
        let status = model::PrStatus::of(&pr.state, pr.is_draft, None);
        let mut badges = vec![(status.label().into(), status.tone())];
        if let Some((label, tone)) = model::review_decision_badge(pr.review_decision.as_deref()) {
            badges.push((label.into(), tone));
        }
        let preview = Preview {
            title: pr.title.clone().into(),
            subtitle: format!("#{} by {}", pr.number, pr.author.login).into(),
            leading: PreviewLeading::Avatar(pr.author.login.clone()),
            badges,
            labels: Vec::new(),
            details: vec![
                ("Updated".into(), model::time_ago(&pr.updated_at, now).into(), false),
                ("Created".into(), model::time_ago(&pr.created_at, now).into(), false),
                ("Branches".into(), format!("{} ← {}", pr.base_ref, pr.head_ref).into(), true),
                ("Changes".into(), format!("+{} / −{}", pr.additions, pr.deletions).into(), true),
            ],
            action: Some((3, {
                let (entity, number, title) = (cx.entity().downgrade(), pr.number, pr.title.clone());
                std::rc::Rc::new(move |_: &mut Window, cx: &mut gpui::App| {
                    entity
                        .update(cx, |this, cx| {
                            this.selected = Some((Section::PullRequests, number));
                            cx.emit(crate::GitHubEvent::OpenResource { kind: "github-pr".into(), id: format!("{number}/files"), title: title.clone() });
                            cx.notify();
                        })
                        .ok();
                })
            })),
        };
        let mut row = Row::new(SharedString::from(format!("github-pr-{}", pr.number)), widgets::avatar(&pr.author.login, 18.), pr.title.clone());
        row.secondary = Some(format!("#{} · {}", pr.number, pr.author.login).into());
        row.meta = Some(div().child(model::sidebar_time(&pr.updated_at, now)).into_any_element());
        row.selected = self.selected == Some((Section::PullRequests, pr.number));
        let (number, title) = (pr.number, pr.title.clone());
        row.action = Some(self.new_window_action("github-pr", number, title.clone(), cx));
        let menu_pr = pr.clone();
        let dragged = ui::DraggedResource::new("github-pr", number.to_string(), title.clone(), format!("#{number} {title}"), IconName::GitPullRequest);
        row.render(colors)
            .hoverable_tooltip(preview.tooltip())
            .on_drag(dragged, |dragged, _, _, cx| dragged.preview(cx))
            .on_click(cx.listener(move |this, event: &ClickEvent, _, cx| {
                if event.click_count() == 2 {
                    this.open_in_new_window("github-pr", number, title.clone(), cx);
                } else {
                    this.open(Section::PullRequests, "github-pr", number, title.clone(), cx);
                }
            }))
            .on_mouse_down(
                MouseButton::Right,
                cx.listener(move |this, event: &MouseDownEvent, window, cx| {
                    let entries = this.pr_menu(&menu_pr, cx);
                    menus::show(this, &format!("pr:{}", menu_pr.number), entries, event.position, Anchor::TopLeft, window, cx);
                }),
            )
            .into_any_element()
    }

    fn new_window_action(&self, kind: &'static str, id: i64, title: String, cx: &mut Context<Self>) -> AnyElement {
        let entity = cx.entity().downgrade();
        widgets::new_window_button(SharedString::from(format!("{kind}-{id}-new-window")), move |_, cx| {
            entity.update(cx, |this, cx| this.open_in_new_window(kind, id, title.clone(), cx)).ok();
        })
    }

    fn pr_menu(&self, pr: &PullRequest, cx: &Context<Self>) -> Vec<MenuEntry> {
        let (number, title) = (pr.number, pr.title.clone());
        vec![
            menus::item("Open PR", cx, {
                let title = title.clone();
                move |this, _, cx| this.open(Section::PullRequests, "github-pr", number, title.clone(), cx)
            })
            .icon(IconName::GitPullRequest)
            .into(),
            menus::item("Open in New Window", cx, move |this, _, cx| this.open_in_new_window("github-pr", number, title.clone(), cx)).icon(IconName::WindowExpand).into(),
            menus::link("Open on GitHub", pr.url.clone()).icon(IconName::OpenExternal).into(),
            menus::item("Checkout Branch", cx, move |this, _, cx| this.checkout_pull_request(number, cx)).icon(IconName::GitBranch).into(),
            MenuEntry::Separator,
            menus::copy_named("Copy Link", "PR link", pr.url.clone()).icon(IconName::Link).into(),
            menus::copy("Copy Title", pr.title.clone()).icon(IconName::Copy).into(),
            menus::copy("Copy Branch Name", pr.head_ref.clone()).icon(IconName::GitBranch).into(),
        ]
    }

    fn render_issues(&self, colors: &ThemeColors, cx: &mut Context<Self>) -> Vec<AnyElement> {
        let query = self.query(cx);
        let items = self.issues.items.clone().unwrap_or_default();
        let matching: Vec<&IssueListItem> = items.iter().filter(|issue| model::issue_matches(issue, &query)).collect();
        if let Some(status) = self.list_status(Section::Issues, &self.issues, matching.len(), colors, cx) {
            return vec![status];
        }
        self.render_rows(Section::Issues, matching, None, colors, cx, Self::render_issue_row)
    }

    fn render_issue_row(&self, issue: &IssueListItem, colors: &ThemeColors, cx: &mut Context<Self>) -> AnyElement {
        let now = Utc::now();
        let open = model::issue_is_open(&issue.state);
        let labels_text = if issue.labels.is_empty() { "None".to_string() } else { issue.labels.iter().map(|label| label.name.as_str()).collect::<Vec<_>>().join(", ") };
        let preview = Preview {
            title: issue.title.clone().into(),
            subtitle: format!("#{} by {}", issue.number, issue.author.login).into(),
            leading: PreviewLeading::Avatar(issue.author.login.clone()),
            badges: vec![(if open { "Open" } else { "Closed" }.into(), if open { Tone::Success } else { Tone::Muted })],
            labels: issue.labels.iter().take(3).map(|label| (label.name.clone(), label.color.clone())).collect(),
            details: vec![
                ("Updated".into(), model::time_ago(&issue.updated_at, now).into(), false),
                ("Author".into(), issue.author.login.clone().into(), true),
                ("Labels".into(), labels_text.into(), false),
            ],
            action: None,
        };
        let dots = issue.labels.iter().take(3).map(|label| {
            let color: gpui::Hsla = model::label_rgb(&label.color).map(|(r, g, b)| gpui::Rgba { r, g, b, a: 1. }.into()).unwrap_or(colors.subtle_foreground);
            div().size(px(6.)).rounded_full().bg(color)
        });
        let mut row = Row::new(SharedString::from(format!("github-issue-{}", issue.number)), widgets::avatar(&issue.author.login, 18.), issue.title.clone());
        row.secondary = Some(format!("#{} · {}", issue.number, issue.author.login).into());
        row.meta = Some(div().flex().items_center().gap(px(6.)).child(div().flex().gap(px(2.)).children(dots)).child(model::sidebar_time(&issue.updated_at, now)).into_any_element());
        row.selected = self.selected == Some((Section::Issues, issue.number));
        let (number, title, url, copy_title) = (issue.number, issue.title.clone(), issue.url.clone(), issue.title.clone());
        row.action = Some(self.new_window_action("github-issue", number, title.clone(), cx));
        let dragged = ui::DraggedResource::new("github-issue", number.to_string(), title.clone(), format!("#{number} {title}"), IconName::CircleDot);
        row.render(colors)
            .tooltip(preview.tooltip())
            .on_drag(dragged, |dragged, _, _, cx| dragged.preview(cx))
            .on_click(cx.listener(move |this, event: &ClickEvent, _, cx| {
                if event.click_count() == 2 {
                    this.open_in_new_window("github-issue", number, title.clone(), cx);
                } else {
                    this.open(Section::Issues, "github-issue", number, title.clone(), cx);
                }
            }))
            .on_mouse_down(
                MouseButton::Right,
                cx.listener(move |this, event: &MouseDownEvent, window, cx| {
                    let open_title = copy_title.clone();
                    let entries = vec![
                        menus::item("Open Issue", cx, move |this, _, cx| this.open(Section::Issues, "github-issue", number, open_title.clone(), cx)).icon(IconName::CircleDot).into(),
                        menus::link("Open on GitHub", url.clone()).icon(IconName::OpenExternal).into(),
                        MenuEntry::Separator,
                        menus::copy("Copy Link", url.clone()).icon(IconName::Link).into(),
                        menus::copy("Copy Title", copy_title.clone()).icon(IconName::Copy).into(),
                    ];
                    menus::show(this, &format!("issue:{number}"), entries, event.position, Anchor::TopLeft, window, cx);
                }),
            )
            .into_any_element()
    }

    fn render_runs(&self, colors: &ThemeColors, cx: &mut Context<Self>) -> Vec<AnyElement> {
        let query = self.query(cx);
        let items = self.runs.items.clone().unwrap_or_default();
        let mut matching: Vec<&WorkflowRunListItem> = items.iter().filter(|run| self.run_filter.matches(run) && model::run_matches(run, &query)).collect();
        // The newest runs first, whatever order they arrived in: only the first few are shown.
        matching.sort_by_key(|run| std::cmp::Reverse(run.created_at.as_deref().or(run.updated_at.as_deref()).and_then(model::parse_time)));
        if let Some(status) = self.list_status(Section::Actions, &self.runs, matching.len(), colors, cx) {
            return vec![status];
        }
        self.render_rows(Section::Actions, matching, None, colors, cx, Self::render_run_row)
    }

    fn render_run_row(&self, run: &WorkflowRunListItem, colors: &ThemeColors, cx: &mut Context<Self>) -> AnyElement {
        let now = Utc::now();
        let title = model::list_run_title(run);
        let state = model::run_state(run.status.as_deref(), run.conclusion.as_deref());
        let duration = model::elapsed(run.run_started_at.as_deref().or(run.created_at.as_deref()), run.updated_at.as_deref(), state.is_active, now);
        let label = model::run_label(run.run_number, run.database_id);
        let mut badges = vec![(state.label.clone().into(), state.tone)];
        if let Some(attempt) = run.run_attempt.filter(|attempt| *attempt > 1) {
            badges.push((format!("Attempt {attempt}").into(), Tone::Warning));
        }
        badges.extend(run.event.clone().map(|event| (event.into(), Tone::Muted)));
        let detail = |label: &str, value: Option<String>, mono: bool| value.map(|value| (SharedString::from(label.to_string()), SharedString::from(value), mono));
        let preview = Preview {
            title: title.clone().into(),
            subtitle: run
                .head_commit_message
                .clone()
                .filter(|message| *message != title)
                .map(|message| message.lines().next().unwrap_or_default().to_string())
                .or(run.workflow_name.clone())
                .unwrap_or_else(|| label.clone())
                .into(),
            leading: PreviewLeading::Run(state.clone()),
            badges,
            labels: Vec::new(),
            details: [
                detail("Workflow", run.workflow_name.clone(), true),
                detail("Run", Some(label.clone()), true),
                detail("Branch", run.head_branch.clone(), true),
                detail("Commit", run.head_sha.as_deref().map(|sha| model::short_sha(sha).to_string()), true),
                detail("Actor", run.actor.as_ref().map(|actor| actor.login.clone()), false),
                detail(if state.is_active { "Elapsed" } else { "Duration" }, duration.clone(), false),
                detail("Updated", run.updated_at.as_deref().map(|at| model::time_ago(at, now)), false),
            ]
            .into_iter()
            .flatten()
            .collect(),
            action: None,
        };
        let busy = self.busy_runs.contains(&run.database_id);
        let leading = if busy {
            Icon::new(IconName::ArrowsClockwise).size(IconSize::XSmall).color(colors.primary)
        } else {
            widgets::run_status_icon(&state, IconSize::Small, colors)
        };
        let meta = if state.is_active {
            duration.map(|duration| div().text_color(colors.primary).child(duration).into_any_element())
        } else {
            run.updated_at.as_deref().map(|at| div().child(model::sidebar_time(at, now)).into_any_element())
        };
        let mut row = Row::new(SharedString::from(format!("github-run-{}", run.database_id)), leading, title.clone());
        row.secondary = Some([Some(state.label.clone()), run.head_branch.clone()].into_iter().flatten().collect::<Vec<_>>().join(" · ").into());
        row.meta = meta;
        row.selected = self.selected == Some((Section::Actions, run.database_id));
        let id = run.database_id;
        row.action = Some(self.new_window_action("github-run", id, title.clone(), cx));
        let menu_run = run.clone();
        let dragged = ui::DraggedResource::new("github-run", id.to_string(), title.clone(), title.clone(), IconName::PlayCircle);
        row.render(colors)
            .tooltip(preview.tooltip())
            .on_drag(dragged, |dragged, _, _, cx| dragged.preview(cx))
            .on_click(cx.listener(move |this, event: &ClickEvent, _, cx| {
                if event.click_count() == 2 {
                    this.open_in_new_window("github-run", id, title.clone(), cx);
                } else {
                    this.open(Section::Actions, "github-run", id, title.clone(), cx);
                }
            }))
            .on_mouse_down(
                MouseButton::Right,
                cx.listener(move |this, event: &MouseDownEvent, window, cx| {
                    let entries = this.run_menu(&menu_run, cx);
                    menus::show(this, &format!("run:{}", menu_run.database_id), entries, event.position, Anchor::TopLeft, window, cx);
                }),
            )
            .into_any_element()
    }

    fn run_menu(&self, run: &WorkflowRunListItem, cx: &Context<Self>) -> Vec<MenuEntry> {
        let (id, title) = (run.database_id, model::list_run_title(run));
        let state = model::run_state(run.status.as_deref(), run.conclusion.as_deref());
        let busy = self.busy_runs.contains(&id);
        let open_title = title.clone();
        let mut entries: Vec<MenuEntry> = vec![
            menus::item("Open Run", cx, move |this, _, cx| this.open(Section::Actions, "github-run", id, open_title.clone(), cx)).icon(IconName::Play).into(),
            menus::link("Open on GitHub", run.url.clone()).icon(IconName::OpenExternal).into(),
            menus::copy_named("Copy Link", "Run link", run.url.clone()).icon(IconName::Link).into(),
            menus::copy("Copy Title", title).icon(IconName::Copy).into(),
            MenuEntry::Separator,
        ];
        let action = |label: &str, icon, action: RunAction| {
            menus::item(label.to_string(), cx, move |this, _, cx| this.run_action(id, action, cx)).icon(icon).disabled(busy)
        };
        if state.is_active {
            entries.push(action("Cancel Run", IconName::Stop, RunAction::Cancel).destructive().into());
        } else {
            entries.push(action("Re-run All Jobs", IconName::ArrowClockwise, RunAction::Rerun).into());
            if state.is_failed {
                entries.push(action("Re-run Failed Jobs", IconName::ArrowCounterClockwise, RunAction::RerunFailed).into());
            }
        }
        entries
    }

    fn render_releases(&self, colors: &ThemeColors, cx: &mut Context<Self>) -> Vec<AnyElement> {
        let query = self.query(cx);
        let items = self.releases.items.clone().unwrap_or_default();
        let matching: Vec<&Release> = items.iter().filter(|release| model::release_matches(release, self.release_filter, &query)).collect();
        if let Some(status) = self.list_status(Section::Releases, &self.releases, matching.len(), colors, cx) {
            return vec![status];
        }
        let paging = (query.is_empty() && items.len() >= crate::RELEASE_PAGE).then_some((self.releases_exhausted, self.releases.loading));
        self.render_rows(Section::Releases, matching, paging, colors, cx, Self::render_release_row)
    }

    fn render_release_row(&self, release: &Release, colors: &ThemeColors, cx: &mut Context<Self>) -> AnyElement {
        let now = Utc::now();
        let title = delivery_view::release_title(release);
        let (label, tone) = delivery_view::release_status(release);
        let icon = if release.draft { IconName::PencilLine } else { IconName::Tag };
        let when = release.published_at.clone().unwrap_or_else(|| release.created_at.clone());
        let id = release.id;
        let mut row = Row::new(SharedString::from(format!("github-release-{id}")), Icon::new(icon).size(IconSize::Small).color(tone_color(tone, colors)), title.clone());
        row.secondary = Some(format!("{} · {label}", release.tag_name).into());
        row.meta = Some(div().child(model::sidebar_time(&when, now)).into_any_element());
        row.selected = self.selected == Some((Section::Releases, id));
        let dragged = ui::DraggedResource::new("github-release", id.to_string(), title.clone(), title.clone(), IconName::Tag);
        row.render(colors)
            .on_drag(dragged, |dragged, _, _, cx| dragged.preview(cx))
            .on_click(cx.listener(move |this, _, _, cx| this.open(Section::Releases, "github-release", id, title.clone(), cx)))
            .into_any_element()
    }

    fn render_deployments(&self, colors: &ThemeColors, cx: &mut Context<Self>) -> Vec<AnyElement> {
        let query = self.query(cx);
        let items = self.deployments.items.clone().unwrap_or_default();
        let matching: Vec<&Deployment> =
            items.iter().filter(|deployment| model::deployment_matches(deployment, self.deployment_filter, delivery_view::deployment_state(deployment).2, &query)).collect();
        if let Some(status) = self.list_status(Section::Deployments, &self.deployments, matching.len(), colors, cx) {
            return vec![status];
        }
        let paging = (query.is_empty() && items.len() >= crate::RELEASE_PAGE).then_some((self.deployments_exhausted, self.deployments.loading));
        self.render_rows(Section::Deployments, matching, paging, colors, cx, Self::render_deployment_row)
    }

    fn render_deployment_row(&self, deployment: &Deployment, colors: &ThemeColors, cx: &mut Context<Self>) -> AnyElement {
        let now = Utc::now();
        let (label, tone, _) = delivery_view::deployment_state(deployment);
        let id = deployment.id;
        let title = format!("{} · {}", deployment.environment, deployment.git_ref);
        let mut row = Row::new(
            SharedString::from(format!("github-deployment-{id}")),
            Icon::new(IconName::Rocket).size(IconSize::Small).color(tone_color(tone, colors)),
            deployment.git_ref.clone(),
        );
        row.secondary = Some(format!("{} · {label}", deployment.environment).into());
        row.meta = Some(div().child(model::sidebar_time(&deployment.created_at, now)).into_any_element());
        row.selected = self.selected == Some((Section::Deployments, id));
        let dragged = ui::DraggedResource::new("github-deployment", id.to_string(), title.clone(), title.clone(), IconName::Rocket);
        row.render(colors)
            .on_drag(dragged, |dragged, _, _, cx| dragged.preview(cx))
            .on_click(cx.listener(move |this, _, _, cx| this.open(Section::Deployments, "github-deployment", id, title.clone(), cx)))
            .into_any_element()
    }

    fn render_notice(&self, colors: &ThemeColors, cx: &mut Context<Self>) -> Option<impl IntoElement> {
        let notice = self.notice.as_ref()?;
        let (icon, tone) = match notice.tone {
            Tone::Error => (IconName::WarningCircle, colors.destructive),
            _ => (IconName::CheckCircle, colors.success),
        };
        let theme = cx.theme().clone();
        Some(
            div().flex_none().px(px(8.)).pb(px(8.)).child(
                div()
                    .flex()
                    .items_start()
                    .gap(px(8.))
                    .p(px(8.))
                    .rounded(metrics::radius_lg())
                    .bg(colors.raised)
                    .shadow(theme.shadows.raised.clone())
                    .text_size(typography::text_sm())
                    .child(div().pt(px(2.)).child(Icon::new(icon).size(IconSize::XSmall).color(tone)))
                    .child(div().flex_1().min_w_0().text_color(colors.foreground).child(notice.message.clone()))
                    .child(Button::icon("github-notice-close", IconName::X).size(ButtonSize::XSmall).tooltip("Dismiss").on_click(cx.listener(|this, _, _, cx| {
                        this.notice = None;
                        cx.notify();
                    }))),
            ),
        )
    }
}

impl Render for GitHubPanel {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = cx.theme().colors.clone();
        // As `GitHubPRsView`: the account first, then the tabs and bars over the list, which says
        // when the repository is missing.
        let body = match (&self.repo, &self.auth) {
            (_, Auth::Checking) | (RepoState::Detecting, Auth::Authenticated(_)) => div()
                .flex()
                .flex_col()
                .flex_1()
                .min_h_0()
                .child(self.render_title_only(cx))
                .child(widgets::fill_message("Checking GitHub account…", None, None, &colors))
                .into_any_element(),
            (_, Auth::Authenticated(_)) => {
                div()
                    .flex()
                    .flex_col()
                    .flex_1()
                    .min_h_0()
                    .child(self.render_bar(&colors, cx))
                    .child(self.render_toolbar())
                    .child(self.render_accordion(&colors, cx))
                    .child(self.render_footer(&colors, cx))
                    .into_any_element()
            }
            _ => div().flex().flex_col().flex_1().min_h_0().child(self.render_title_only(cx)).child(self.render_auth(&colors, cx)).into_any_element(),
        };
        div()
            .id("github-panel")
            .track_focus(&self.focus_handle)
            .flex()
            .flex_col()
            .flex_1()
            .size_full()
            .min_h_0()
            .min_w_0()
            .font_family(typography::ui_font())
            .child(body)
            .children(self.render_notice(&colors, cx))
            .children(self.open_menu.as_ref().map(|menu| menu.render()))
    }
}
