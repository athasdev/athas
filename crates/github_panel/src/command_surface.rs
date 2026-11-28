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
        rows.extend(self.surface_note("releases", &self.releases, cx));
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
        rows.extend(self.surface_note("deployments", &self.deployments, cx));
        CommandList::new("Deployments", rows).icon(IconName::Rocket).placeholder("Search deployments").empty("No matching deployments")
    }
}

impl GitHubPanel {
    /// What to say when a surface has no items to show, so the rows it does have -- the ones
    /// that narrow it -- are never the whole answer. A list that is still loading, failed, or is
    /// genuinely empty each read differently, and none of them is "four filters and nothing".
    fn surface_note<T: Clone>(&self, what: &str, list: &crate::List<T>, cx: &Context<Self>) -> Option<CommandRow> {
        // Why nothing can be fetched at all comes first: a list that was never asked for is not
        // an empty list, and "no releases" would be a lie told to someone who is signed out.
        let blocked = match (self.repo_path(), self.auth.token()) {
            (None, _) => Some("This folder is not a GitHub repository".to_string()),
            (_, None) => Some(format!("Sign in to GitHub to see its {what}")),
            _ => None,
        };
        let label: SharedString = match (blocked, &list.items, &list.error, list.loading) {
            (Some(reason), ..) => reason.into(),
            (_, _, Some(error), _) => format!("Could not load the {what}. {error}").into(),
            (_, _, _, true) => format!("Loading {what}…").into(),
            (_, None, ..) => format!("No {what} loaded yet").into(),
            (_, Some(items), ..) if items.is_empty() => format!("This repository has no {what}").into(),
            _ => return None,
        };
        let icon = if list.error.is_some() { IconName::WarningCircle } else { IconName::Info };
        Some(self.row(label, icon, cx, |_, _| {}).section("Releases"))
    }

    /// Opens a footer surface, having first fetched what it lists. Picking Releases used to show
    /// the rows that narrow the list and nothing else, because nothing had asked GitHub for the
    /// releases yet -- they load when the panel's own section is opened, which it never was.
    pub fn open_command_surface(&mut self, which: &str, cx: &mut Context<Self>) {
        let section = match which {
            "releases" => Section::Releases,
            "deployments" => Section::Deployments,
            _ => return,
        };
        let empty = match section {
            Section::Releases => self.releases.items.is_none(),
            _ => self.deployments.items.is_none(),
        };
        // The footer's lists can be the first thing anyone asks of GitHub in a window, before
        // the panel has gone looking for a token. Without one `load_section` returns having done
        // nothing, which is how "no releases loaded yet" came to stand for "never asked".
        let signed_in = self.auth.token().is_some();
        if !signed_in && self.auth != crate::auth::Auth::Checking {
            self.check_auth(false, cx);
        }
        if empty && signed_in {
            self.load_section(section, cx);
        }
        let which = which.to_string();
        // Shown now with whatever it has, and again when the answer lands: the first says what it
        // is doing, the second is what the reader came for.
        if let Some(list) = self.command_surface(&which, cx) {
            palette::show_command_list(cx, list);
        }
        if !empty {
            return;
        }
        cx.spawn(async move |this, cx| {
            // Waits for the token first, then for the list: a window that has not checked yet
            // would otherwise be told it has no releases before anyone looked.
            for _ in 0..150 {
                cx.background_executor().timer(std::time::Duration::from_millis(100)).await;
                let state = this.read_with(cx, |this, _| {
                    let loading = match which.as_str() {
                        "releases" => this.releases.loading,
                        _ => this.deployments.loading,
                    };
                    let items = match which.as_str() {
                        "releases" => this.releases.items.is_some(),
                        _ => this.deployments.items.is_some(),
                    };
                    (this.auth.clone(), loading, items)
                });
                let Ok((auth, loading, items)) = state else { break };
                if auth == crate::auth::Auth::Checking || loading {
                    continue;
                }
                // The token arrived after the surface opened: ask for the list now.
                if auth.token().is_some() && !items {
                    this.update(cx, |this, cx| this.load_section(section, cx)).ok();
                    continue;
                }
                break;
            }
            this.update(cx, |this, cx| {
                if let Some(list) = this.command_surface(&which, cx) {
                    palette::show_command_list(cx, list);
                }
            })
            .ok();
        })
        .detach();
    }

    /// One of the footer's surfaces by name, for the headless snapshot.
    pub fn command_surface(&self, which: &str, cx: &Context<Self>) -> Option<CommandList> {
        Some(match which {
            "releases" => self.releases_surface(cx),
            "deployments" => self.deployments_surface(cx),
            _ => return None,
        })
    }
}
