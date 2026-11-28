//! The bodies of the GitHub footer's lists, as the secondary column draws them.
//!
//! Releases and deployments opened the Command surface -- a palette over the whole window for a
//! list that belongs beside the sidebar that opened it. They are panels in the secondary column
//! now, the shape Source Control's History and the session footer's Usage take: the workbench
//! builds the shell (title, actions, hairline) and asks here for what goes in it.

use chrono::Utc;
use gpui::{AnyElement, ClickEvent, Context, IntoElement, ParentElement, SharedString, Styled, div};
use theme::ActiveTheme;
use ui::scale::px;
use ui::{Button, ButtonSize, ButtonVariant, EmptyState, Icon, IconName, IconSize, SidebarListItem};

use crate::{GitHubPanel, Section, delivery_view, model};

/// What the secondary column needs to draw one of these lists.
pub struct SectionBody {
    /// The buttons beside the title.
    pub actions: Vec<AnyElement>,
    /// The row that narrows the list, when it has one.
    pub filters: Option<AnyElement>,
    pub rows: Vec<AnyElement>,
    /// What shows in place of the rows when there are none.
    pub empty: EmptyState,
}

impl GitHubPanel {
    pub fn section_body(&mut self, section: Section, cx: &mut Context<Self>) -> SectionBody {
        match section {
            Section::Deployments => self.deployments_body(cx),
            _ => self.releases_body(cx),
        }
    }

    /// Refresh, which is the only thing either list does to itself.
    fn refresh_action(&self, section: Section, cx: &mut Context<Self>) -> AnyElement {
        Button::icon("github-section-refresh", IconName::ArrowClockwise)
            .size(ButtonSize::XSmall)
            .variant(ButtonVariant::Ghost)
            .tooltip("Refresh")
            .on_click(cx.listener(move |panel, _: &ClickEvent, _, cx| panel.load_section(section, cx)))
            .into_any_element()
    }

    /// Why a list is empty, in the words the reader needs: not a repository, not signed in, still
    /// loading, GitHub's own error, or genuinely nothing.
    fn empty_state<T: Clone>(&self, what: &str, list: &crate::List<T>) -> EmptyState {
        let (title, detail): (String, Option<String>) = match (self.repo_path(), self.auth.token()) {
            (None, _) => ("No GitHub repository".into(), Some("This folder is not a GitHub repository.".into())),
            (_, None) => ("Not signed in".into(), Some(format!("Sign in to GitHub to see its {what}."))),
            _ => match (&list.items, &list.error, list.loading) {
                (_, Some(error), _) => (format!("Could not load the {what}"), Some(error.to_string())),
                (_, _, true) => (format!("Loading {what}…"), None),
                (None, ..) => (format!("No {what} loaded yet"), None),
                _ => (format!("No {what}"), Some(format!("This repository has no {what}."))),
            },
        };
        let state = EmptyState::new(title).icon(if list.error.is_some() { IconName::WarningCircle } else { IconName::Tag });
        match detail {
            Some(detail) => state.message(detail),
            None => state,
        }
    }

    /// The row of filters over a list, as the Command surface had them.
    fn section_filters(&self, labels: Vec<(&'static str, bool)>, cx: &mut Context<Self>, set: fn(&mut GitHubPanel, usize, &mut Context<GitHubPanel>)) -> AnyElement {
        let colors = cx.theme().colors.clone();
        div()
            .flex()
            .flex_wrap()
            .items_center()
            .gap(px(4.))
            .px(px(8.))
            .py(px(4.))
            .text_color(colors.subtle_foreground)
            .children(labels.into_iter().enumerate().map(|(index, (label, current))| {
                Button::new(SharedString::from(format!("github-filter-{label}")), label)
                    .size(ButtonSize::XSmall)
                    .variant(ButtonVariant::Ghost)
                    .active(current)
                    .filled_when_active()
                    .on_click(cx.listener(move |panel, _: &ClickEvent, _, cx| set(panel, index, cx)))
                    .into_any_element()
            }))
            .into_any_element()
    }

    fn releases_body(&mut self, cx: &mut Context<Self>) -> SectionBody {
        let now = Utc::now();
        let colors = cx.theme().colors.clone();
        let current = self.release_filter;
        let filters = self.section_filters(
            model::ReleaseFilter::ALL.into_iter().map(|filter| (filter.label(), filter == current)).collect(),
            cx,
            |panel, index, cx| {
                if let Some(filter) = model::ReleaseFilter::ALL.get(index).copied() {
                    panel.set_release_filter(filter, cx);
                }
            },
        );
        let releases = self.releases.items.clone().unwrap_or_default();
        let rows = releases
            .iter()
            .filter(|release| model::release_matches(release, current, ""))
            .map(|release| {
                let (id, title) = (release.id, delivery_view::release_title(release));
                let (label, _) = delivery_view::release_status(release);
                let when = release.published_at.clone().unwrap_or_else(|| release.created_at.clone());
                let open = title.clone();
                SidebarListItem::new(SharedString::from(format!("github-release-{id}")), title)
                    .leading(
                        Icon::new(if release.draft { IconName::PencilLine } else { IconName::Tag })
                            .size(IconSize::XSmall)
                            .color(colors.subtle_foreground),
                    )
                    .detail(format!("{} · {label}", release.tag_name))
                    .trailing(model::sidebar_time(&when, now))
                    .on_click(cx.listener(move |panel, _: &ClickEvent, _, cx| {
                        panel.open(Section::Releases, "github-release", id, open.clone(), cx)
                    }))
                    .into_any_element()
            })
            .collect();
        SectionBody {
            actions: vec![self.refresh_action(Section::Releases, cx)],
            filters: Some(filters),
            rows,
            empty: self.empty_state("releases", &self.releases),
        }
    }

    fn deployments_body(&mut self, cx: &mut Context<Self>) -> SectionBody {
        let now = Utc::now();
        let colors = cx.theme().colors.clone();
        let current = self.deployment_filter;
        let filters = self.section_filters(
            model::DeploymentFilter::ALL.into_iter().map(|filter| (filter.label(), filter == current)).collect(),
            cx,
            |panel, index, cx| {
                if let Some(filter) = model::DeploymentFilter::ALL.get(index).copied() {
                    panel.set_deployment_filter(filter, cx);
                }
            },
        );
        let deployments = self.deployments.items.clone().unwrap_or_default();
        let rows = deployments
            .iter()
            .filter(|deployment| {
                let (_, _, state) = delivery_view::deployment_state(deployment);
                model::deployment_matches(deployment, current, state, "")
            })
            .map(|deployment| {
                let (label, _, _) = delivery_view::deployment_state(deployment);
                let id = deployment.id;
                let title = deployment.git_ref.clone();
                let open = format!("{} · {}", deployment.environment, deployment.git_ref);
                SidebarListItem::new(SharedString::from(format!("github-deployment-{id}")), title)
                    .leading(Icon::new(IconName::Rocket).size(IconSize::XSmall).color(colors.subtle_foreground))
                    .detail(format!("{} · {label}", deployment.environment))
                    .trailing(model::sidebar_time(&deployment.created_at, now))
                    .on_click(cx.listener(move |panel, _: &ClickEvent, _, cx| {
                        panel.open(Section::Deployments, "github-deployment", id, open.clone(), cx)
                    }))
                    .into_any_element()
            })
            .collect();
        SectionBody {
            actions: vec![self.refresh_action(Section::Deployments, cx)],
            filters: Some(filters),
            rows,
            empty: self.empty_state("deployments", &self.deployments),
        }
    }
}
