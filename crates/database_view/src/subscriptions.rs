//! PostgreSQL logical replication subscriptions: a tab with their per-table status and settings
//! (`postgres-subscription-schema-view.tsx`), and enabling, refreshing, creating and dropping them.

#[cfg(not(target_family = "wasm"))]
use anyhow::Result;
use athas_database::sql_common::PostgresSubscriptionInfo;
use gpui::{AnyElement, Context, Window, div, prelude::*, px};
use theme::ActiveTheme;
use ui::{Button, ButtonSize, ButtonVariant, Icon, IconName, IconSize, WithScrollbar, typography};

#[cfg(target_family = "wasm")]
use crate::athas_database;
#[cfg(all(feature = "postgres", not(target_family = "wasm")))]
use crate::backend::{block_on, network::MANAGER};
#[cfg(not(target_family = "wasm"))]
use crate::{backend::Backend, forms::SubscriptionDraft, model::ResultSet};
use crate::{DatabaseView, DbTab, TabBody, TableMode, grid::GridCapabilities, model::ObjectKind};

#[derive(Clone, Debug, PartialEq)]
pub struct SubscriptionDetails {
    pub name: String,
    pub enabled: bool,
    pub fields: Vec<(&'static str, String)>,
}

pub(crate) struct SubscriptionTab {
    pub name: String,
    pub details: Option<SubscriptionDetails>,
    pub mode: TableMode,
}

fn yes_no(value: bool) -> String {
    if value { "true" } else { "false" }.to_string()
}

fn or_dash(value: Option<&str>) -> String {
    value.filter(|value| !value.is_empty()).unwrap_or("-").to_string()
}

pub fn subscription_details(info: &PostgresSubscriptionInfo) -> SubscriptionDetails {
    let publications = info.publications.join(", ");
    SubscriptionDetails {
        name: info.name.clone(),
        enabled: info.enabled,
        fields: vec![
            ("Owner", info.owner.clone()),
            ("Enabled", yes_no(info.enabled)),
            ("Publications", or_dash(Some(&publications))),
            ("Slot", or_dash(info.slot_name.as_deref())),
            ("Sync Commit", or_dash(info.synchronous_commit.as_deref())),
            ("Streaming", or_dash(info.streaming.as_deref())),
            ("Two Phase", yes_no(info.two_phase)),
            ("Two Phase State", or_dash(info.two_phase_state.as_deref())),
            ("Binary", yes_no(info.binary)),
            ("Disable on Error", yes_no(info.disable_on_error)),
            ("Password Required", yes_no(info.password_required)),
            ("Run as Owner", yes_no(info.run_as_owner)),
            ("Origin", or_dash(info.origin.as_deref())),
            ("Failover", yes_no(info.failover)),
            ("Connection", or_dash(Some(&info.connection_string))),
        ],
    }
}

#[cfg(not(target_family = "wasm"))]
pub fn subscription_params(draft: &SubscriptionDraft) -> athas_database::sql_common::CreatePostgresSubscriptionParams {
    let draft = draft.clone().normalized();
    athas_database::sql_common::CreatePostgresSubscriptionParams {
        name: draft.name,
        connection_string: draft.connection_string,
        publications: draft.publications,
        enabled: draft.enabled,
        create_slot: draft.create_slot,
        copy_data: draft.copy_data,
        connect: draft.connect,
        failover: draft.failover,
        with_slot_name: draft.slot_name,
    }
}

#[cfg(all(feature = "postgres", not(target_family = "wasm")))]
macro_rules! postgres {
    ($backend:expr, |$id:ident| $call:expr) => {{
        let $id = match $backend.network_id() {
            Some(id) if $backend.provider() == crate::model::Provider::Postgres => id.to_string(),
            _ => return Err(anyhow::anyhow!("Subscriptions need a PostgreSQL connection")),
        };
        block_on($call)
    }};
}

#[cfg(all(not(feature = "postgres"), not(target_family = "wasm")))]
macro_rules! postgres {
    ($backend:expr, |$id:ident| $call:expr) => {{
        let _ = &$backend;
        Err(anyhow::anyhow!("PostgreSQL is not available in this build"))
    }};
}

#[cfg(not(target_family = "wasm"))]
impl Backend {
    pub fn subscription_info(&self, name: &str) -> Result<PostgresSubscriptionInfo> {
        let _ = name;
        postgres!(self, |id| athas_database::providers::get_postgres_subscription_info(id, name.to_string(), &MANAGER))
    }

    pub fn subscription_details(&self, name: &str) -> Result<SubscriptionDetails> {
        Ok(subscription_details(&self.subscription_info(name)?))
    }

    pub fn subscription_status(&self, name: &str) -> Result<ResultSet> {
        let _ = name;
        let result: athas_database::sql_common::QueryResult =
            postgres!(self, |id| athas_database::providers::get_postgres_subscription_status(id, name.to_string(), &MANAGER))?;
        Ok(ResultSet { columns: result.columns, rows: result.rows })
    }

    pub fn create_subscription(&self, draft: &SubscriptionDraft) -> Result<()> {
        let _ = draft;
        let _: i64 = postgres!(self, |id| athas_database::providers::create_postgres_subscription(
            id,
            subscription_params(draft),
            &MANAGER
        ))?;
        Ok(())
    }

    pub fn drop_subscription(&self, name: &str) -> Result<u64> {
        let _ = name;
        let rows: i64 =
            postgres!(self, |id| athas_database::providers::drop_postgres_subscription(id, name.to_string(), true, &MANAGER))?;
        Ok(rows.max(0) as u64)
    }

    pub fn set_subscription_enabled(&self, name: &str, enabled: bool) -> Result<()> {
        let _ = (name, enabled);
        let _: i64 = postgres!(self, |id| athas_database::providers::set_postgres_subscription_enabled(
            id,
            name.to_string(),
            enabled,
            &MANAGER
        ))?;
        Ok(())
    }

    pub fn refresh_subscription(&self, name: &str) -> Result<()> {
        let _ = name;
        let _: i64 =
            postgres!(self, |id| athas_database::providers::refresh_postgres_subscription(id, name.to_string(), false, &MANAGER))?;
        Ok(())
    }
}

enum SubscriptionChange {
    Reload,
    SetEnabled(bool),
    Refresh,
}

impl DatabaseView {
    pub(crate) fn open_subscription(&mut self, name: &str, window: &mut Window, cx: &mut Context<Self>) -> Option<usize> {
        if let Some(tab) = self.tabs.iter().find(|tab| matches!(&tab.body, TabBody::Subscription(sub) if sub.name == name)) {
            self.active_tab = Some(tab.id);
            cx.notify();
            return self.active_tab;
        }
        let id = self.new_tab(
            TabBody::Subscription(SubscriptionTab { name: name.to_string(), details: None, mode: TableMode::Data }),
            window,
            cx,
        );
        self.reload_subscription(id, cx);
        Some(id)
    }

    pub(crate) fn reload_subscription(&mut self, id: usize, cx: &mut Context<Self>) {
        self.change_subscription(id, SubscriptionChange::Reload, cx);
    }

    pub(crate) fn toggle_subscription(&mut self, id: usize, cx: &mut Context<Self>) {
        let enabled = self.subscription(id).and_then(|sub| sub.details.as_ref()).is_some_and(|details| details.enabled);
        self.change_subscription(id, SubscriptionChange::SetEnabled(!enabled), cx);
    }

    pub(crate) fn refresh_publication(&mut self, id: usize, cx: &mut Context<Self>) {
        self.change_subscription(id, SubscriptionChange::Refresh, cx);
    }

    pub(crate) fn set_subscription_mode(&mut self, id: usize, mode: TableMode, cx: &mut Context<Self>) {
        if let Some(TabBody::Subscription(sub)) = self.tabs.iter_mut().find(|tab| tab.id == id).map(|tab| &mut tab.body) {
            sub.mode = mode;
        }
        cx.notify();
    }

    fn subscription(&self, id: usize) -> Option<&SubscriptionTab> {
        match &self.tabs.iter().find(|tab| tab.id == id)?.body {
            TabBody::Subscription(sub) => Some(sub),
            _ => None,
        }
    }

    /// Runs `change` (if any), then reloads the subscription's settings and status.
    fn change_subscription(&mut self, id: usize, change: SubscriptionChange, cx: &mut Context<Self>) {
        let Some(backend) = self.backend.clone() else { return };
        let Some(name) = self.subscription(id).map(|sub| sub.name.clone()) else { return };
        let generation = self.generation;
        let Some(tab) = self.tabs.iter_mut().find(|tab| tab.id == id) else { return };
        tab.request += 1;
        tab.loading = true;
        let request = tab.request;
        cx.notify();
        let task = cx.background_spawn(async move {
            match change {
                SubscriptionChange::Reload => {}
                SubscriptionChange::SetEnabled(enabled) => backend.set_subscription_enabled(&name, enabled)?,
                SubscriptionChange::Refresh => backend.refresh_subscription(&name)?,
            }
            anyhow::Ok((backend.subscription_details(&name)?, backend.subscription_status(&name)?))
        });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            this.update(cx, |this, cx| {
                if this.generation != generation {
                    return;
                }
                let Some(tab) = this.tabs.iter_mut().find(|tab| tab.id == id && tab.request == request) else { return };
                tab.loading = false;
                let grid = tab.grid.clone();
                let TabBody::Subscription(sub) = &mut tab.body else { return };
                match result {
                    Ok((details, status)) => {
                        tab.error = None;
                        sub.details = Some(details);
                        grid.update(cx, |grid, cx| {
                            grid.set_capabilities(GridCapabilities::default(), cx);
                            grid.set_data(status, &[], &[], 0, cx);
                        });
                    }
                    Err(error) => tab.error = Some(error.to_string()),
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    pub(crate) fn render_subscription_tab(&self, tab: &DbTab, sub: &SubscriptionTab, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let colors = cx.theme().colors.clone();
        let id = tab.id;
        let mode = sub.mode;
        let enabled = sub.details.as_ref().map(|details| details.enabled);
        let mode_button = |label: &'static str, target: TableMode, cx: &mut Context<Self>| {
            Button::new(gpui::SharedString::from(format!("subscription-mode-{label}")), label)
                .variant(ButtonVariant::Tab)
                .size(ButtonSize::Small)
                .active(mode == target)
                .on_click(cx.listener(move |this, _, _, cx| this.set_subscription_mode(id, target, cx)))
        };
        let drop_name = sub.name.clone();
        let toolbar = Self::toolbar(cx)
            .child(mode_button("Status", TableMode::Data, cx))
            .child(mode_button("Details", TableMode::Structure, cx))
            .child(div().flex_1())
            .when(tab.loading, |this| {
                this.child(div().text_size(typography::TEXT_CAPTION).text_color(colors.subtle_foreground).child("Loading…"))
            })
            .when_some(enabled, |this, enabled| {
                this.child(
                    Button::icon("toggle-subscription", if enabled { IconName::Pause } else { IconName::Play })
                        .size(ButtonSize::Small)
                        .tooltip(if enabled { "Disable subscription" } else { "Enable subscription" })
                        .disabled(tab.loading)
                        .on_click(cx.listener(move |this, _, _, cx| this.toggle_subscription(id, cx))),
                )
            })
            .child(
                Button::icon("refresh-subscription", IconName::ArrowsClockwise)
                    .size(ButtonSize::Small)
                    .tooltip("Refresh subscription")
                    .disabled(tab.loading)
                    .on_click(cx.listener(move |this, _, _, cx| this.refresh_publication(id, cx))),
            )
            .child(
                Button::icon("reload-subscription", IconName::ArrowClockwise)
                    .size(ButtonSize::Small)
                    .tooltip("Reload")
                    .on_click(cx.listener(move |this, _, _, cx| this.reload_subscription(id, cx))),
            )
            .child(
                Button::icon("drop-subscription", IconName::Trash)
                    .size(ButtonSize::Small)
                    .tone(ui::ButtonTone::Danger)
                    .tooltip("Drop subscription")
                    .on_click(cx.listener(move |this, _, _, cx| this.request_drop(&drop_name, ObjectKind::Subscription, cx))),
            );

        let body = match mode {
            TableMode::Data => div().flex().flex_col().flex_1().min_h_0().child(tab.grid.clone()).into_any_element(),
            TableMode::Structure | TableMode::Info => div()
                .id("subscription-details")
                .flex()
                .flex_col()
                .flex_1()
                .min_h_0()
                .overflow_y_scroll()
                .p(px(16.))
                .gap(px(12.))
                .text_size(typography::TEXT_SM)
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(8.))
                        .child(Icon::new(IconName::Broadcast).size(IconSize::Small).color(colors.subtle_foreground))
                        .child(
                            div()
                                .flex()
                                .flex_col()
                                .child(sub.name.clone())
                                .child(div().text_color(colors.subtle_foreground).child("logical replication subscription")),
                        ),
                )
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .max_w(px(640.))
                        .rounded(ui::metrics::RADIUS_LG)
                        .bg(colors.surface)
                        .children(sub.details.iter().flat_map(|details| details.fields.clone()).enumerate().map(|(ix, (label, value))| {
                            div()
                                .flex()
                                .flex_col()
                                .gap(px(2.))
                                .px(px(12.))
                                .py(px(8.))
                                .when(ix > 0, |this| this.border_t_1().border_color(colors.divider))
                                .child(
                                    div()
                                        .text_size(typography::TEXT_CAPTION)
                                        .text_color(colors.subtle_foreground)
                                        .child(label.to_uppercase()),
                                )
                                .child(div().child(value))
                        })),
                )
                .scrollbar(window, cx)
                .into_any_element(),
        };

        div()
            .flex()
            .flex_col()
            .flex_1()
            .min_h_0()
            .child(toolbar)
            .children(tab.error.as_ref().map(|error| Self::error_banner(error, cx)))
            .child(body)
            .into_any_element()
    }
}
