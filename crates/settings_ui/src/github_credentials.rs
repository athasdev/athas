//! Settings > Git > GitHub Account (`tabs/github-credentials.tsx`): which credential GitHub calls
//! use, the scopes worth a warning, the personal access token kept in the keychain and the `gh`
//! CLI's token.

use athas_github::{GitHubTokenStatus, TokenSourcePreference};
use ui::scale::px;
use gpui::{AnyElement, Context, Entity, Subscription, Window, div, prelude::*,};
use notifications::NotificationKind;
use ui::{Badge, Button, ButtonTone, ButtonVariant, IconName, TextInput, TextInputEvent};

use crate::notify;

pub struct GitHubCredentials {
    status: Option<Result<GitHubTokenStatus, String>>,
    loading: bool,
    saving: bool,
    token: Entity<TextInput>,
    source: String,
    _subscriptions: Vec<Subscription>,
}

impl GitHubCredentials {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let token = cx.new(|cx| TextInput::new(window, cx).placeholder("ghp_…").leading_icon(IconName::Key).masked());
        let typed = cx.subscribe(&token, |this, _, event: &TextInputEvent, cx| match event {
            TextInputEvent::Confirmed => this.save_token(cx),
            TextInputEvent::Changed(_) => cx.notify(),
            _ => {}
        });
        // The resolver reads the preference, so the active source can change with no token touched.
        let preference = cx.observe_global::<settings::SettingsStore>(|this: &mut Self, cx| {
            let source = settings::get(cx).github_token_source.clone();
            if source != this.source {
                this.source = source;
                this.load(cx);
            }
        });
        let mut credentials = Self {
            status: None,
            loading: false,
            saving: false,
            token,
            source: settings::get(cx).github_token_source.clone(),
            _subscriptions: vec![typed, preference],
        };
        credentials.load(cx);
        credentials
    }

    fn load(&mut self, cx: &mut Context<Self>) {
        self.loading = true;
        cx.notify();
        let preference = TokenSourcePreference::from_setting(Some(&self.source));
        let task = cx.background_spawn(async move { github_panel::auth::token_status(preference) });
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

    fn status(&self) -> Option<&GitHubTokenStatus> {
        self.status.as_ref().and_then(|status| status.as_ref().ok())
    }

    fn save_token(&mut self, cx: &mut Context<Self>) {
        let token = self.token.read(cx).text().trim().to_string();
        if token.is_empty() || self.saving {
            return;
        }
        self.saving = true;
        cx.notify();
        let save = cx.background_spawn(async move { github_panel::auth::save_personal_access_token(&token) });
        cx.spawn(async move |this, cx| {
            let result = save.await;
            this.update(cx, |this, cx| {
                this.saving = false;
                match result {
                    Ok(()) => {
                        this.token.update(cx, |input, cx| input.set_text("", cx));
                        notify(cx, NotificationKind::Success, "GitHub personal access token saved", None);
                        this.load(cx);
                    }
                    Err(_) => notify(cx, NotificationKind::Error, "Failed to save personal access token", None),
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    fn remove_token(&mut self, cx: &mut Context<Self>) {
        match github_panel::auth::remove_personal_access_token() {
            Ok(()) => {
                self.token.update(cx, |input, cx| input.set_text("", cx));
                notify(cx, NotificationKind::Success, "GitHub personal access token removed", None);
                self.load(cx);
            }
            Err(_) => notify(cx, NotificationKind::Error, "Failed to remove personal access token", None),
        }
    }

    /// Scopes the active token has that can destroy or re-configure things.
    pub fn destructive_scopes(&self) -> Vec<String> {
        github_panel::auth::destructive_scopes(self.status().and_then(|status| status.scopes.as_deref()))
    }

    /// The description of one of the section's rows.
    pub fn description(&self, label: &str) -> Option<String> {
        match label {
            "Active Credential" if self.loading => None,
            "Active Credential" => Some(match &self.status {
                Some(Err(error)) => error.clone(),
                Some(Ok(status)) if status.source.is_some() && status.login.is_some() => status.login.clone().unwrap_or_default(),
                Some(Ok(status)) if status.source.is_some() => "GitHub rejected the resolved token".into(),
                _ => "No GitHub credential available".into(),
            }),
            "Token Permissions" => Some(self.destructive_scopes().join(", ")),
            "Personal Access Token" => Some("Needs the repo scope".into()),
            "GitHub CLI" => Some(if self.status().is_some_and(|status| status.gh_cli_installed) { "gh detected" } else { "gh not found on this machine" }.into()),
            _ => None,
        }
    }

    /// The control of one of the section's rows.
    pub fn control(&self, label: &str, cx: &mut Context<Self>) -> AnyElement {
        match label {
            "Active Credential" => div()
                .flex()
                .items_center()
                .gap(px(8.))
                .map(|this| match self.status() {
                    _ if self.loading => this.child(Badge::new("Checking credential")),
                    Some(status) if status.login.is_some() => {
                        this.children(status.source.map(|source| Badge::new(github_panel::auth::source_label(source))))
                    }
                    _ => this,
                })
                .child(Button::new("github-credential-refresh", "Refresh").variant(ButtonVariant::Outline).on_click(cx.listener(|this, _, _, cx| this.load(cx))))
                .into_any_element(),
            "Personal Access Token" => {
                let saved = self.status().is_some_and(|status| status.has_personal_access_token);
                let typed = !self.token.read(cx).text().trim().is_empty();
                self.token.update(cx, |input, cx| {
                    input.set_placeholder(if saved { "••••••••  (saved)" } else { "ghp_…" }, cx);
                    input.set_disabled(self.saving, cx);
                });
                div()
                    .flex()
                    .items_center()
                    .gap(px(8.))
                    .child(div().w(px(256.)).child(self.token.clone()))
                    .child(
                        Button::new("github-pat-save", if self.saving { "Saving…" } else { "Save" })
                            .variant(ButtonVariant::Outline)
                            .disabled(!typed || self.saving)
                            .on_click(cx.listener(|this, _, _, cx| this.save_token(cx))),
                    )
                    .when(saved, |this| {
                        this.child(
                            Button::icon("github-pat-remove", IconName::Trash)
                                .variant(ButtonVariant::Ghost)
                                .tone(ButtonTone::Danger)
                                .tooltip("Remove saved personal access token")
                                .on_click(cx.listener(|this, _, _, cx| this.remove_token(cx))),
                        )
                    })
                    .into_any_element()
            }
            "GitHub CLI" if self.status().is_some_and(|status| status.gh_cli_installed) => Button::new("github-gh-refresh", "Re-read token")
                .variant(ButtonVariant::Outline)
                .on_click(cx.listener(|this, _, _, cx| {
                    athas_github::invalidate_gh_cli_token_cache();
                    this.load(cx);
                }))
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

/// The rows of the section the Settings view draws through this view.
pub fn is_credentials_row(tab: &str, label: &str) -> bool {
    tab == "git" && matches!(label, "Active Credential" | "Token Permissions" | "Personal Access Token" | "GitHub CLI")
}
