//! Settings > Git > GitHub Account in the web build: the GitHub views use the workspace server's
//! credential (`GITHUB_TOKEN`/`GH_TOKEN` or its `gh` CLI), so the rows show which one is active and
//! whom it belongs to. The token itself never reaches the browser.

use ui::scale::px;
use gpui::{AnyElement, Context, Window, div, prelude::*,};
use ui::{Badge, Button, ButtonVariant};
use github_panel::relay::TokenStatus;

pub struct GitHubCredentials {
    status: Option<Result<TokenStatus, String>>,
    loading: bool,
}

impl GitHubCredentials {
    pub fn new(_: &mut Window, cx: &mut Context<Self>) -> Self {
        let mut credentials = Self { status: None, loading: false };
        credentials.load(false, cx);
        credentials
    }

    fn load(&mut self, reread: bool, cx: &mut Context<Self>) {
        self.loading = true;
        cx.notify();
        let task = cx.background_spawn(async move { github_panel::relay::token_status(reread) });
        cx.spawn(async move |this, cx| {
            let status = task.await;
            this.update(cx, |this, cx| {
                this.status = Some(status);
                this.loading = false;
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    fn status(&self) -> Option<&TokenStatus> {
        self.status.as_ref().and_then(|status| status.as_ref().ok())
    }

    fn source_label(&self) -> Option<&'static str> {
        let source = self.status()?.source.clone()?;
        let source = serde_json::from_value(serde_json::Value::String(source)).ok()?;
        Some(github_panel::auth::source_label(source))
    }

    pub fn destructive_scopes(&self) -> Vec<String> {
        github_panel::auth::destructive_scopes(self.status().and_then(|status| status.scopes.as_deref()))
    }

    pub fn description(&self, label: &str) -> Option<String> {
        match label {
            "Active Credential" if self.loading => None,
            "Active Credential" => Some(match &self.status {
                Some(Err(error)) => error.clone(),
                Some(Ok(status)) if status.source.is_some() && status.login.is_some() => status.login.clone().unwrap_or_default(),
                Some(Ok(status)) if status.source.is_some() => "GitHub rejected the workspace server's token".into(),
                _ => "No GitHub credential on the workspace server".into(),
            }),
            "Token Permissions" => Some(self.destructive_scopes().join(", ")),
            "Personal Access Token" => Some(
                if self.status().is_some_and(|status| status.has_environment_token) {
                    "Set on the workspace server (GITHUB_TOKEN or GH_TOKEN)"
                } else {
                    "Set GITHUB_TOKEN or GH_TOKEN where the workspace server runs; needs the repo scope"
                }
                .into(),
            ),
            "GitHub CLI" => Some(
                if self.status().is_some_and(|status| status.gh_cli_installed) {
                    "gh detected on the workspace server"
                } else {
                    "gh not found on the workspace server"
                }
                .into(),
            ),
            _ => None,
        }
    }

    pub fn control(&self, label: &str, cx: &mut Context<Self>) -> AnyElement {
        match label {
            "Active Credential" => div()
                .flex()
                .items_center()
                .gap(px(8.))
                .map(|this| match self.source_label() {
                    _ if self.loading => this.child(Badge::new("Checking credential")),
                    Some(source) if self.status().is_some_and(|status| status.login.is_some()) => this.child(Badge::new(source)),
                    _ => this,
                })
                .child(Button::new("github-credential-refresh", "Refresh").variant(ButtonVariant::Outline).on_click(cx.listener(|this, _, _, cx| this.load(false, cx))))
                .into_any_element(),
            "Personal Access Token" if self.status().is_some_and(|status| status.has_environment_token) => {
                Badge::new("Server environment").into_any_element()
            }
            "GitHub CLI" if self.status().is_some_and(|status| status.gh_cli_installed) => Button::new("github-gh-refresh", "Re-read token")
                .variant(ButtonVariant::Outline)
                .on_click(cx.listener(|this, _, _, cx| this.load(true, cx)))
                .into_any_element(),
            _ => div().into_any_element(),
        }
    }
}

impl Render for GitHubCredentials {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        div()
    }
}

pub fn is_credentials_row(tab: &str, label: &str) -> bool {
    tab == "git" && matches!(label, "Active Credential" | "Token Permissions" | "Personal Access Token" | "GitHub CLI")
}
