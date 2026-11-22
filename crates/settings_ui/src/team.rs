//! Settings > Team (`tabs/team-settings.tsx`): the team you collaborate with
//! (`collaboration-settings.tsx`), shared workspaces (`team_workspaces`) and the organization's policy (`enterprise-settings.tsx`), each
//! shown when the plan includes it.

use account::AccountStore;
use ui::scale::px;
use gpui::{AnyElement, App, Context, Entity, SharedString, Subscription, Window, div, prelude::*,};
use serde_json::{Value, json};
use theme::ActiveTheme;
use ui::{Badge, Button, ButtonVariant, IconName, Switch, TextArea, TextAreaEvent, metrics, typography};

use crate::{notify, team_workspaces::WorkspaceSettings};

/// `parseAllowlistInput`: lowercase ids, one per line or comma-separated, each once.
pub fn parse_allowlist(text: &str) -> Vec<String> {
    let mut ids: Vec<String> = Vec::new();
    for id in text.split(['\n', ',']).map(|item| item.trim().to_lowercase()).filter(|item| !item.is_empty()) {
        if !ids.contains(&id) {
            ids.push(id);
        }
    }
    ids
}

pub struct TeamSettings {
    store: Option<Entity<AccountStore>>,
    workspaces: Entity<WorkspaceSettings>,
    allowlist: Entity<TextArea>,
    /// The allowlist the field was last filled from, so a refreshed policy refills it.
    shown_allowlist: Option<Vec<String>>,
    saving: bool,
    _subscriptions: Vec<Subscription>,
}

impl TeamSettings {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let store = AccountStore::global(cx);
        let allowlist = cx.new(|cx| TextArea::new(cx).rows(8).mono().placeholder("athas.typescript\nathas.python\nathas.go"));
        let mut subscriptions = vec![cx.subscribe(&allowlist, |_, _, _: &TextAreaEvent, cx| cx.notify())];
        if let Some(store) = &store {
            subscriptions.push(cx.observe(store, |_, _, cx| cx.notify()));
        }
        let workspaces = cx.new(|cx| WorkspaceSettings::new(window, cx));
        Self { store, workspaces, allowlist, shown_allowlist: None, saving: false, _subscriptions: subscriptions }
    }

    /// `savePolicyPatch`: admins change the policy, then the plan is fetched again.
    fn save_policy(&mut self, patch: Value, cx: &mut Context<Self>) {
        let Some(store) = self.store.clone() else { return };
        let (client, token) = {
            let store = store.read(cx);
            (store.client().clone(), store.token().map(str::to_string))
        };
        let Some(token) = token else { return };
        self.saving = true;
        cx.notify();
        let update = cx.background_spawn(async move { client.update_enterprise_policy(&token, &patch) });
        cx.spawn(async move |this, cx| {
            let result = update.await;
            this.update(cx, |this, cx| {
                this.saving = false;
                match result {
                    Ok(_) => {
                        store.update(cx, |store, cx| store.refresh_subscription(cx).detach());
                    }
                    Err(error) => notify(cx, notifications::NotificationKind::Error, error.to_string(), None),
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    fn section(title: impl Into<SharedString>, actions: Option<AnyElement>, description: Option<&'static str>, rows: Vec<AnyElement>, cx: &App) -> AnyElement {
        let colors = cx.theme().colors.clone();
        div()
            .flex()
            .flex_col()
            .gap(px(8.))
            .child(
                div()
                    .flex()
                    .items_center()
                    .justify_between()
                    .px(px(12.))
                    .child(
                        div()
                            .flex()
                            .items_baseline()
                            .gap(px(8.))
                            .child(div().text_size(typography::text_sm()).font_weight(typography::MEDIUM).text_color(colors.muted_foreground).child(title.into()))
                            .children(description.map(|description| div().text_size(typography::text_sm()).text_color(colors.subtle_foreground).child(description))),
                    )
                    .children(actions),
            )
            .child(
                div()
                    .flex()
                    .flex_col()
                    .rounded(metrics::island_radius())
                    .bg(colors.raised)
                    .shadow(cx.theme().shadows.raised.clone())
                    .children(rows.into_iter().enumerate().map(|(index, row)| {
                        div()
                            .relative()
                            .when(index > 0, |this| this.child(div().absolute().top_0().left(px(12.)).right_0().h(px(1.)).bg(colors.divider)))
                            .child(row)
                    })),
            )
            .into_any_element()
    }

    fn row(label: &'static str, description: Option<String>, control: impl IntoElement, cx: &App) -> AnyElement {
        let colors = cx.theme().colors.clone();
        div()
            .flex()
            .items_center()
            .justify_between()
            .gap(px(24.))
            .min_h(px(44.))
            .py(px(10.))
            .px(px(12.))
            .child(
                div()
                    .flex()
                    .flex_col()
                    .flex_1()
                    .min_w_0()
                    .gap(px(2.))
                    .child(div().text_size(typography::text_sm()).text_color(colors.foreground).child(label))
                    .children(description.map(|description| div().text_size(typography::text_sm()).text_color(colors.subtle_foreground).child(description))),
            )
            .child(div().flex_none().child(control))
            .into_any_element()
    }

    fn empty(message: &'static str, cx: &App) -> AnyElement {
        div()
            .py(px(20.))
            .text_center()
            .text_size(typography::text_sm())
            .text_color(cx.theme().colors.muted_foreground)
            .child(message)
            .into_any_element()
    }

    fn collaboration(&self, collaboration: &account::api::Collaboration, cx: &App) -> AnyElement {
        let members = &collaboration.members;
        let active = members.iter().filter(|member| member.status == "active").count();
        let invitations = collaboration.invitations.len();
        let shared = collaboration.settings.as_ref().and_then(|settings| settings.get("sharedSettings"));
        let invite_policy = shared.and_then(|shared| shared.get("invitePolicy")).and_then(Value::as_str).unwrap_or("admins_only").to_string();
        let limit = |key: &str| match shared.and_then(|shared| shared.get(key)) {
            Some(Value::Number(number)) => number.to_string(),
            Some(Value::String(text)) => text.clone(),
            _ => "Unlimited".to_string(),
        };
        let collaboration_url = account::urls(cx).collaboration();
        let actions = div()
            .flex()
            .gap(px(4.))
            .child(Button::new("team-open", "Open Team").variant(ButtonVariant::Ghost).leading_icon(IconName::Users).on_click(|_, window, cx| {
                if let Some(action) = cx.try_global::<keymap::CommandRegistry>().and_then(|registry| registry.action("team.open")) {
                    window.dispatch_action(action, cx);
                }
            }))
            .child(Button::new("team-dashboard", "Dashboard").variant(ButtonVariant::Ghost).on_click(move |_, _, cx| cx.open_url(&collaboration_url)));
        let title = collaboration.workspace.as_ref().map_or("Collaboration".to_string(), |workspace| workspace.name.clone());
        let following = collaboration::following_user(cx);
        let followed = following.and_then(|id| members.iter().find(|member| member.user_id == Some(id))).map(|member| member.name.clone());
        let (stream_status, stream_detail, stream_failed) = collaboration::document_stream_summary(cx);
        let stream_badge = if stream_failed { Badge::new(stream_status).tone(ui::Tone::Danger) } else { Badge::new(stream_status) };
        Self::section(
            title,
            Some(actions.into_any_element()),
            None,
            vec![
                Self::row("Members", (invitations > 0).then(|| format!("{invitations} pending")), Badge::new(format!("{active}/{} active", members.len())), cx),
                Self::row("Shared Sessions", Some("Agent sessions shared with the team".into()), Badge::new(collaboration.shared_sessions.len().to_string()), cx),
                Self::row(
                    "Presence",
                    followed.map(|name| format!("Following {name}")),
                    div()
                        .flex()
                        .items_center()
                        .gap(px(8.))
                        .child(Badge::new(format!("{} sessions", collaboration.presence.len())))
                        .child(
                            Button::new("team-stop-following", "Stop Following")
                                .variant(ButtonVariant::Outline)
                                .disabled(following.is_none())
                                .on_click(|_, _, cx| collaboration::set_following(None, cx)),
                        ),
                    cx,
                ),
                Self::row("Document Stream", stream_detail, stream_badge, cx),
                Self::row("Workspace Rules", Some(format!("Invites: {invite_policy}")), Badge::new(format!("Seats {} · Updates {}", limit("memberSeatLimit"), limit("monthlyDocumentUpdateLimit"))), cx),
            ],
            cx,
        )
    }

    fn enterprise(&mut self, enterprise: &account::api::Enterprise, cx: &mut Context<Self>) -> Vec<AnyElement> {
        if !enterprise.has_access {
            return vec![Self::section("Enterprise Controls", None, None, vec![Self::empty("Available in enterprise workspaces", cx)], cx)];
        }
        let Some(policy) = enterprise.policy.clone() else {
            return vec![Self::section("Enterprise Controls", None, None, vec![Self::empty("Could not load the policy. Try signing in again.", cx)], cx)];
        };
        if self.shown_allowlist.as_ref() != Some(&policy.allowed_extension_ids) {
            let text = policy.allowed_extension_ids.join("\n");
            self.allowlist.update(cx, |area, cx| area.set_text(text, cx));
            self.shown_allowlist = Some(policy.allowed_extension_ids.clone());
        }
        let admin = enterprise.is_admin;
        let editable = admin && !self.saving && policy.managed_mode;
        self.allowlist.update(cx, |area, cx| area.set_disabled(!editable, cx));
        let weak = cx.entity().downgrade();
        let switch = |id: &'static str, field: &'static str, on: bool, enabled: bool, _: &mut Context<Self>| {
            let weak = weak.clone();
            Switch::new(id, on).disabled(!enabled).on_change(move |checked, _, cx| {
                weak.update(cx, |this, cx| this.save_policy(json!({ field: checked }), cx)).ok();
            })
        };
        let gated = admin && !self.saving;
        let rows = vec![
            Self::row("Managed Mode", None, switch("enterprise-managed", "managedMode", policy.managed_mode, gated, cx), cx),
            Self::row("Require Integration Allowlist", None, switch("enterprise-allowlist", "requireExtensionAllowlist", policy.require_extension_allowlist, editable, cx), cx),
            Self::row("Allow BYOK Autocomplete", None, switch("enterprise-byok", "allowByok", policy.allow_byok, editable, cx), cx),
            Self::row("Enable AI Autocomplete", None, switch("enterprise-completion", "aiCompletionEnabled", policy.ai_completion_enabled, editable, cx), cx),
            Self::row("Enable Agent", None, switch("enterprise-agent", "aiChatEnabled", policy.ai_chat_enabled, editable, cx), cx),
        ];
        let parsed = parse_allowlist(self.allowlist.read(cx).text());
        let colors = cx.theme().colors.clone();
        let allowlist = div()
            .flex()
            .flex_col()
            .gap(px(12.))
            .px(px(12.))
            .py(px(10.))
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(6.))
                    .child(div().text_size(typography::text_sm()).font_weight(typography::MEDIUM).text_color(colors.foreground).child("Approved integration IDs"))
                    .child(self.allowlist.clone())
                    .child(div().text_size(typography::text_sm()).text_color(colors.subtle_foreground).child("One per line, or comma-separated.")),
            )
            .child(
                div()
                    .flex()
                    .items_center()
                    .justify_between()
                    .gap(px(8.))
                    .child(
                        div()
                            .flex()
                            .gap(px(4.))
                            .text_size(typography::text_sm())
                            .text_color(colors.subtle_foreground)
                            .child("Parsed entries:")
                            .child(div().text_color(colors.foreground).child(parsed.len().to_string())),
                    )
                    .child(
                        div()
                            .flex()
                            .gap(px(8.))
                            .child(Button::new("enterprise-allowlist-clear", "Clear").variant(ButtonVariant::Outline).disabled(!editable).on_click(cx.listener(
                                |this, _, _, cx| this.allowlist.update(cx, |area, cx| area.set_text("", cx)),
                            )))
                            .child(
                                Button::new("enterprise-allowlist-apply", if self.saving { "Saving..." } else { "Apply allowlist" })
                                    .variant(ButtonVariant::Accent)
                                    .disabled(!editable)
                                    .on_click(cx.listener(move |this, _, _, cx| {
                                        let ids = parse_allowlist(this.allowlist.read(cx).text());
                                        this.save_policy(json!({ "allowedExtensionIds": ids }), cx);
                                    })),
                            ),
                    ),
            )
            .into_any_element();
        vec![
            Self::section("Enterprise Controls", None, (!admin).then_some("Read only"), rows, cx),
            Self::section("Integration Allowlist", None, None, vec![allowlist], cx),
        ]
    }
}

impl Render for TeamSettings {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let subscription = self.store.as_ref().and_then(|store| store.read(cx).subscription().cloned());
        let mut sections = Vec::new();
        if let Some(collaboration) = subscription.as_ref().and_then(|subscription| subscription.collaboration.as_ref()).filter(|team| team.enabled) {
            sections.push(self.collaboration(collaboration, cx));
        }
        sections.push(
            div()
                .flex()
                .flex_col()
                .gap(px(8.))
                .child(div().px(px(12.)).text_size(typography::text_sm()).font_weight(typography::MEDIUM).text_color(cx.theme().colors.muted_foreground).child("Workspaces"))
                .child(self.workspaces.clone())
                .into_any_element(),
        );
        if let Some(enterprise) = subscription.as_ref().map(|subscription| subscription.enterprise.clone()).filter(|enterprise| enterprise.has_access) {
            sections.extend(self.enterprise(&enterprise, cx));
        }
        div().flex().flex_col().gap(px(24.)).children(sections)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allowlists_parse_like_the_web_workbench() {
        assert_eq!(parse_allowlist("athas.TypeScript\nathas.python, athas.go\n\n athas.python "), vec!["athas.typescript", "athas.python", "athas.go"]);
        assert!(parse_allowlist(" ,\n").is_empty());
    }
}
