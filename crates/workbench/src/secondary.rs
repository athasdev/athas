//! The secondary column beside the sidebar, and the lists that open in it.
//!
//! The Inbox had this column to itself; Usage and Accounts were menus, and Archived was a section
//! the sidebar unfolded. A menu is the wrong shape for a list you read, compare and act on, and
//! three different shapes for three rows of the same footer is three things to learn. They are
//! one shape now: [`panel`] builds every one of them from the same parts, in the same order —
//! an island, a `pane_header` with a `PaneTitle` and `pane_actions`, an optional row of filters,
//! a hairline, then the body. The Inbox is still the exemplar; these follow it.

use gpui::{AnyElement, Context, IntoElement, ParentElement, Styled, Window, div, prelude::*};
use theme::ActiveTheme;
use ui::scale::px;
use ui::{Button, ButtonSize, ButtonVariant, EmptyState, Icon, IconName, IconSize, SidebarListItem, pane_actions, typography};

use crate::Workbench;

/// What the one secondary column is showing.
pub(crate) enum Secondary {
    Usage,
    Accounts,
    Archived,
    /// One of the Source Control footer's lists: History, stashes, remotes or tags. They opened
    /// the Command surface -- a palette over the whole window for a list that belongs beside the
    /// sidebar that opened it.
    Git(git_panel::GitSection),
}

impl Secondary {
    /// The footer row that opens it, for the row to light up while it is open.
    pub(crate) fn row_id(&self) -> &'static str {
        match self {
            Secondary::Usage => "sessions-usage",
            Secondary::Accounts => "sessions-accounts",
            Secondary::Archived => "sessions-archived",
            Secondary::Git(section) => section.row_id(),
        }
    }
}

/// The shell every panel in this column is built from: the title and its actions, whatever row of
/// filters the panel has, then its body under a hairline.
pub(crate) fn panel(
    id: &'static str,
    title: &'static str,
    detail: Option<String>,
    actions: Vec<AnyElement>,
    filters: Option<AnyElement>,
    body: AnyElement,
    cx: &mut Context<Workbench>,
) -> AnyElement {
    let header = ui::PanelHeader::new(title).when_some(detail, |this, detail| this.detail(detail)).trailing(
        pane_actions().children(actions).child(
            Button::icon("secondary-close", IconName::X)
                .variant(ButtonVariant::Ghost)
                .size(ButtonSize::Small)
                .tooltip(format!("Close {title}"))
                .on_click(cx.listener(|this, _, window, cx| this.close_secondary(window, cx))),
        ),
    );
    // Flat, like the sidebar beside it: this column sits inside the shell, it does not float
    // over it, so it takes no rounding and no shadow of its own.
    div()
        .id(id)
        .flex()
        .flex_col()
        .size_full()
        .min_h_0()
        .min_w_0()
        .overflow_hidden()
        .pt(ui::metrics::workbench_gap())
        .child(header)
        .children(filters)
        .child(div().flex().flex_col().flex_1().min_h_0().child(body))
        .into_any_element()
}

/// A list in one of these panels: its rows, or a word when it has none.
pub(crate) fn list(id: &'static str, rows: Vec<AnyElement>, empty: EmptyState, scroll: &gpui::ScrollHandle, cx: &Context<Workbench>) -> AnyElement {
    if rows.is_empty() {
        return div().flex().flex_1().items_center().justify_center().p(px(16.)).child(empty).into_any_element();
    }
    let body = div()
        .id(id)
        .flex()
        .flex_col()
        .flex_1()
        .min_h_0()
        .min_w_0()
        .overflow_y_scroll()
        .track_scroll(scroll)
        .px(ui::metrics::sidebar_inset())
        .pb(px(8.))
        .gap(px(2.))
        .children(rows);
    ui::faded_scroll(body, scroll, ui::sidebar_fade_plane(cx)).flex_1().into_any_element()
}

/// A heading between groups of rows, as the Inbox's categories read.
pub(crate) fn group(label: impl Into<gpui::SharedString>, cx: &Context<Workbench>) -> AnyElement {
    heading(label, cx.theme().colors.subtle_foreground)
}

fn heading(label: impl Into<gpui::SharedString>, colour: gpui::Hsla) -> AnyElement {
    div()
        .flex_none()
        .px(ui::metrics::sidebar_inset() + px(6.))
        .pt(px(8.))
        .pb(px(2.))
        .text_size(typography::text_caption())
        .text_color(colour)
        .child(label.into())
        .into_any_element()
}

impl Workbench {
    /// Opens one of the footer's lists in the secondary column, or closes it if it is the one
    /// already there.
    pub(crate) fn toggle_secondary(&mut self, which: Secondary, window: &mut Window, cx: &mut Context<Self>) {
        if self.secondary.as_ref().is_some_and(|open| open.row_id() == which.row_id()) {
            self.close_secondary(window, cx);
            return;
        }
        if matches!(which, Secondary::Accounts) {
            // Opening it looks at the linked GitHub account and the saved keys again, as the
            // account menu does.
            account::linked_accounts::refresh_github(cx);
            crate::sidebar::refresh_provider_keys(cx);
        }
        self.secondary = Some(which);
        self.clear_git_section(cx);
        cx.notify();
    }

    /// Whether a footer row's panel is the one open, so the row reads as pressed.
    pub(crate) fn secondary_is(&self, row_id: &str) -> bool {
        self.secondary.as_ref().is_some_and(|open| open.row_id() == row_id)
    }

    /// The panel the column draws, whichever list is open.
    pub(crate) fn render_secondary_panel(&self, cx: &mut Context<Self>) -> Option<AnyElement> {
        match self.secondary.as_ref()? {
            Secondary::Usage => Some(self.render_usage_panel(cx)),
            Secondary::Accounts => Some(self.render_accounts_panel(cx)),
            Secondary::Archived => Some(self.render_archived_panel(cx)),
            Secondary::Git(section) => self.render_git_panel_section(*section, cx),
        }
    }

    /// One of the Source Control footer's lists. The panel is the same shell as the rest; the
    /// rows and their actions come from the Git panel, which owns the repository.
    fn render_git_panel_section(&self, section: git_panel::GitSection, cx: &mut Context<Self>) -> Option<AnyElement> {
        let git = self.git_panel.as_ref()?.0.clone();
        let body = git.update(cx, |panel, cx| panel.section_body(section, cx));
        let id = match section {
            git_panel::GitSection::History => "git-history-panel",
            git_panel::GitSection::Stashes => "git-stashes-panel",
            git_panel::GitSection::Remotes => "git-remotes-panel",
            git_panel::GitSection::Tags => "git-tags-panel",
        };
        Some(panel(id, section.title(), None, body.actions, body.filters, list(id, body.rows, body.empty, &self.secondary_scroll, cx), cx))
    }

    /// Usage: what each account has left this period, then what the sessions open now have spent.
    fn render_usage_panel(&self, cx: &mut Context<Self>) -> AnyElement {
        let colors = cx.theme().colors.clone();
        let allowances = crate::agent_usage::rows(cx);
        let spend = self.session_spend(cx);
        let mut rows: Vec<AnyElement> = Vec::new();
        if !allowances.is_empty() {
            rows.push(group("Left this period", cx));
            for row in &allowances {
                let url = row.url.clone();
                let mut item = SidebarListItem::new(gpui::SharedString::from(format!("usage-{}", row.label)), row.label)
                    .leading(Icon::new(row.icon).size(IconSize::XSmall).color(colors.subtle_foreground))
                    .trailing(row.value.clone());
                if !row.detail.is_empty() {
                    item = item.description(row.detail.clone());
                }
                rows.push(match url.is_empty() {
                    true => item.into_any_element(),
                    false => item.on_click(move |_, _, cx| cx.open_url(&url)).into_any_element(),
                });
            }
        }
        if !spend.is_empty() {
            rows.push(group("Spent by the sessions open now", cx));
            for agent in &spend {
                rows.push(
                    SidebarListItem::new(gpui::SharedString::from(format!("spend-{}", agent.id)), agent.name.clone())
                        .leading(Icon::new(agent_ui::model_vendor::provider_icon(&agent.id)).size(IconSize::XSmall).color(colors.subtle_foreground))
                        .description(agent.detail())
                        .trailing(agent.value())
                        .into_any_element(),
                );
            }
        }
        let billing = account::urls(cx).billing();
        let actions = vec![
            Button::icon("usage-billing", IconName::CreditCard)
                .variant(ButtonVariant::Ghost)
                .size(ButtonSize::Small)
                .tooltip("Plan & Billing")
                .on_click(move |_, _, cx| cx.open_url(&billing))
                .into_any_element(),
            Button::icon("usage-ai-settings", IconName::Sparkle)
                .variant(ButtonVariant::Ghost)
                .size(ButtonSize::Small)
                .tooltip("AI settings")
                .on_click(cx.listener(|this, _, window, cx| this.open_settings_page(Some("ai"), window, cx)))
                .into_any_element(),
        ];
        let empty = EmptyState::new("Nothing to show")
            .icon(IconName::Activity)
            .message("No account here publishes an allowance, and no session open now has said what it spent.");
        panel(
            "usage-panel",
            "Usage",
            None, actions, None, list("usage-list", rows, empty, &self.secondary_scroll, cx), cx)
    }

    /// Accounts: the Athas account, GitHub, the agents installed here and the providers with a
    /// key. Each row goes where it is managed; the submenus the menu needed are gone.
    fn render_accounts_panel(&self, cx: &mut Context<Self>) -> AnyElement {
        let colors = cx.theme().colors.clone();
        let urls = account::urls(cx);
        let mut rows: Vec<AnyElement> = Vec::new();
        let row = |id: String, label: String, icon: IconName, trailing: Option<String>| {
            SidebarListItem::new(gpui::SharedString::from(id), label)
                .leading(Icon::new(icon).size(IconSize::XSmall).color(colors.subtle_foreground))
                .when_some(trailing, |this, trailing| this.trailing(trailing))
        };

        let subtle = colors.subtle_foreground;
        let section = |rows: &mut Vec<AnyElement>, label: &'static str, mut found: Vec<AnyElement>| {
            if found.is_empty() {
                return;
            }
            rows.push(heading(label, subtle));
            rows.append(&mut found);
        };

        let mut athas: Vec<AnyElement> = Vec::new();
        match account::AccountStore::global(cx) {
            Some(store) if store.read(cx).is_signed_in() => {
                let (name, _) = store.read(cx).identity();
                let plan = store.read(cx).plan_label();
                athas.push(
                    row("account-athas".into(), name, IconName::Sparkle, Some(plan.to_string()))
                        .on_click(cx.listener(|this, _, window, cx| this.open_settings_page(Some("account"), window, cx)))
                        .into_any_element(),
                );
            }
            Some(store) => athas.push(
                row("account-sign-in".into(), "Sign in to Athas".into(), IconName::SignIn, None)
                    .on_click(move |_, _, cx| store.update(cx, |store, cx| store.sign_in(cx)))
                    .into_any_element(),
            ),
            None => {}
        }
        section(&mut rows, "Athas", athas);

        let mut github: Vec<AnyElement> = Vec::new();
        match account::linked_accounts::github(cx) {
            Some(linked) if linked.connected => {
                let login = linked.login.unwrap_or_default();
                let profile = if login.is_empty() { "https://github.com".to_string() } else { format!("https://github.com/{login}") };
                let trailing = if login.is_empty() { "Connected".to_string() } else { login };
                github.push(
                    row("account-github".into(), "GitHub".into(), IconName::BrandGithub, Some(trailing))
                        .on_click(move |_, _, cx| cx.open_url(&profile))
                        .into_any_element(),
                );
            }
            _ => {
                let integrations = urls.integrations();
                github.push(
                    row("account-github-connect".into(), "Connect GitHub".into(), IconName::BrandGithub, None)
                        .on_click(move |_, _, cx| cx.open_url(&integrations))
                        .into_any_element(),
                );
            }
        }
        section(&mut rows, "GitHub", github);

        let mut agent_rows: Vec<AnyElement> = Vec::new();
        let agents = crate::sidebar::installed_agents(cx);
        if agents.is_empty() {
            agent_rows.push(
                row("account-install-agent".into(), "Install an agent…".into(), IconName::Plus, None)
                    .on_click(cx.listener(|this, _, window, cx| this.open_settings_page(Some("ai"), window, cx)))
                    .into_any_element(),
            );
        }
        for agent in &agents {
            agent_rows.push(
                row(format!("account-agent-{}", agent.id), agent.name.clone(), agent_ui::model_vendor::provider_icon(&agent.id), Some(agent.source.clone()))
                    .on_click(cx.listener(|this, _, window, cx| this.open_settings_page(Some("ai"), window, cx)))
                    .into_any_element(),
            );
        }
        section(&mut rows, "Agents", agent_rows);

        let mut provider_rows: Vec<AnyElement> = Vec::new();
        let providers = crate::sidebar::provider_keys(cx);
        if providers.is_empty() {
            provider_rows.push(
                row("account-add-key".into(), "Add an API key…".into(), IconName::Plus, None)
                    .on_click(cx.listener(|this, _, window, cx| this.open_settings_page(Some("ai"), window, cx)))
                    .into_any_element(),
            );
        }
        for provider in &providers {
            provider_rows.push(
                row(format!("account-key-{}", provider.id), provider.name.clone(), agent_ui::model_vendor::provider_icon(&provider.id), Some(provider.masked.clone()))
                    .on_click(cx.listener(|this, _, window, cx| this.open_settings_page(Some("ai"), window, cx)))
                    .into_any_element(),
            );
        }
        section(&mut rows, "Model providers", provider_rows);

        let actions = vec![
            Button::icon("accounts-settings", IconName::Settings)
                .variant(ButtonVariant::Ghost)
                .size(ButtonSize::Small)
                .tooltip("Account settings")
                .on_click(cx.listener(|this, _, window, cx| this.open_settings_page(Some("account"), window, cx)))
                .into_any_element(),
        ];
        let empty = EmptyState::new("No accounts").icon(IconName::UserCircle).message("Sign in, connect GitHub or add an API key.");
        panel(
            "accounts-panel",
            "Accounts",
            None, actions, None, list("accounts-list", rows, empty, &self.secondary_scroll, cx), cx)
    }
}
