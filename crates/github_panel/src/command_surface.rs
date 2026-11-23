//! The lists under the GitHub sidebar's footer: releases and deployments.
//!
//! They are read far less often than pull requests, issues and runs, so they sit at the bottom
//! as the Source Control sidebar's stashes do, and open the Command surface
//! (`palette::CommandList`) instead of folding the list open. Each surface starts with what it
//! is narrowed to, then its items; picking an item opens its page.

use chrono::Utc;
use gpui::{Context, SharedString};
use palette::{CommandList, CommandRow};
use ui::IconName;

use crate::{
    GitHubPanel, Section, delivery_view, model,
    model::{DeploymentFilter, ReleaseFilter},
};

impl GitHubPanel {
    /// A row that calls back into the panel.
    fn row(
        &self,
        label: impl Into<SharedString>,
        icon: IconName,
        cx: &Context<Self>,
        action: impl Fn(&mut Self, &mut Context<Self>) + 'static,
    ) -> CommandRow {
        let this = cx.entity().downgrade();
        CommandRow::new(label).icon(icon).on_select(move |_, cx| {
            this.update(cx, |panel, cx| action(panel, cx)).ok();
        })
    }

    /// The rows that narrow a surface, checked by their label, then reopen it.
    fn filter_row(
        &self,
        label: &'static str,
        current: bool,
        cx: &Context<Self>,
        set: impl Fn(&mut Self, &mut Context<Self>) + 'static,
        reopen: fn(&GitHubPanel, &Context<GitHubPanel>) -> CommandList,
    ) -> CommandRow {
        self.row(label, if current { IconName::Check } else { IconName::Filter }, cx, move |panel, cx| {
            set(panel, cx);
            let list = reopen(panel, cx);
            palette::show_command_list(cx, list);
        })
        .section("Show")
    }

    /// Releases, newest first, under what the list is narrowed to.
    pub(crate) fn releases_surface(&self, cx: &Context<Self>) -> CommandList {
        let now = Utc::now();
        let mut rows: Vec<CommandRow> = ReleaseFilter::ALL
            .into_iter()
            .map(|filter| {
                self.filter_row(
                    filter.label(),
                    filter == self.release_filter,
                    cx,
                    move |panel, cx| panel.set_release_filter(filter, cx),
                    GitHubPanel::releases_surface,
                )
            })
            .collect();
        for release in self.releases.items.clone().unwrap_or_default().iter() {
            if !model::release_matches(release, self.release_filter, "") {
                continue;
            }
            let (id, title) = (release.id, delivery_view::release_title(release));
            let (label, _) = delivery_view::release_status(release);
            let when = release.published_at.clone().unwrap_or_else(|| release.created_at.clone());
            let open = title.clone();
            let page = release.html_url.clone();
            rows.push(
                self.row(title.clone(), if release.draft { IconName::PencilLine } else { IconName::Tag }, cx, move |panel, cx| {
                    panel.open(Section::Releases, "github-release", id, open.clone(), cx)
                })
                .action(IconName::OpenExternal, "Open on GitHub", move |_, cx| cx.open_url(&page))
                .section("Releases")
                .description(format!("{} · {label}", release.tag_name))
                .trailing(model::sidebar_time(&when, now))
                .keywords(release.tag_name.clone()),
            );
        }
        CommandList::new("Releases", rows).icon(IconName::Tag).placeholder("Search releases").empty("No matching releases")
    }

    /// Deployments, newest first, under what the list is narrowed to.
    pub(crate) fn deployments_surface(&self, cx: &Context<Self>) -> CommandList {
        let now = Utc::now();
        let mut rows: Vec<CommandRow> = DeploymentFilter::ALL
            .into_iter()
            .map(|filter| {
                self.filter_row(
                    filter.label(),
                    filter == self.deployment_filter,
                    cx,
                    move |panel, cx| panel.set_deployment_filter(filter, cx),
                    GitHubPanel::deployments_surface,
                )
            })
            .collect();
        for deployment in self.deployments.items.clone().unwrap_or_default().iter() {
            let (label, _, state) = delivery_view::deployment_state(deployment);
            if !model::deployment_matches(deployment, self.deployment_filter, state, "") {
                continue;
            }
            let id = deployment.id;
            let title = format!("{} · {}", deployment.environment, deployment.git_ref);
            let open = title.clone();
            rows.push(
                self.row(deployment.git_ref.clone(), IconName::Rocket, cx, move |panel, cx| {
                    panel.open(Section::Deployments, "github-deployment", id, open.clone(), cx)
                })
                .section("Deployments")
                .description(format!("{} · {label}", deployment.environment))
                .trailing(model::sidebar_time(&deployment.created_at, now))
                .keywords(format!("{} {}", deployment.environment, deployment.sha)),
            );
        }
        CommandList::new("Deployments", rows).icon(IconName::Rocket).placeholder("Search deployments").empty("No matching deployments")
    }
}

impl GitHubPanel {
    /// One of the footer's surfaces by name, for the headless snapshot.
    pub fn command_surface(&self, which: &str, cx: &Context<Self>) -> Option<CommandList> {
        Some(match which {
            "releases" => self.releases_surface(cx),
            "deployments" => self.deployments_surface(cx),
            _ => return None,
        })
    }
}
